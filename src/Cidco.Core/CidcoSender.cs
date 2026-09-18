using Renci.SshNet;
using Renci.SshNet.Common;

namespace Cidco.Core;

/// <summary>What came of one attempt to reach CIDCO.</summary>
public sealed record SendResult(bool Ok, string Message)
{
    public string FileName { get; init; } = "";
    public string Remote { get; init; } = "";
    public long SizeBytes { get; init; }
    public DateTimeOffset SentAt { get; init; } = DateTimeOffset.Now;

    public static SendResult Failed(string message) => new(false, message);
}

/// <summary>
/// One SFTP conversation with CIDCO.
///
/// The architect never sees CIDCO's database; everything this class can learn
/// is what CIDCO answered, which is why a refusal is surfaced verbatim rather
/// than flattened into "failed".
/// </summary>
public sealed class CidcoSender
{
    public string Host { get; }
    public int Port { get; }
    public string Username { get; }
    private readonly string _password;
    public string CompanyId { get; }
    public string CsvFolder { get; }
    public TimeSpan Timeout { get; }

    public CidcoSender(
        string host,
        int port,
        string username,
        string password,
        string companyId,
        string csvFolder,
        TimeSpan? timeout = null)
    {
        Host = host.Trim();
        Port = port;
        Username = username.Trim();
        _password = password;
        CompanyId = companyId.Trim();
        CsvFolder = csvFolder.Trim();
        Timeout = timeout ?? TimeSpan.FromSeconds(20);
    }

    public static CidcoSender From(Settings settings) => new(
        settings.IpOrDefault,
        settings.PortOrDefault,
        settings.UsernameOrDefault,
        settings.Password,
        settings.CompanyIdOrDefault,
        settings.CsvFolder);

    /// <summary>
    /// Key exchanges that need Curve25519.
    ///
    /// SSH.NET offers these first, and they work when .NET is sitting on
    /// OpenSSL. On Windows it sits on CNG instead, which has no Curve25519
    /// ECDH, so the handshake dies with "The specified curve 'Curve25519' or
    /// its parameters are not valid for this platform" before a single byte of
    /// AQI data moves. The agent only ever runs on Windows, so they are never
    /// offered.
    /// </summary>
    public static readonly string[] WindowsUnsupportedKeyExchanges =
    {
        "mlkem768x25519-sha256",
        "sntrup761x25519-sha512",
        "sntrup761x25519-sha512@openssh.com",
        "curve25519-sha256",
        "curve25519-sha256@libssh.org",
    };

    /// <summary>
    /// Plain Diffie-Hellman, which every Windows can do.
    ///
    /// ECDH over the NIST curves is the better first choice and normal Windows
    /// has it. But a machine whose CNG is cut down — an old build, a locked
    /// down or FIPS-restricted image — answers ECDH with NTE_NOT_SUPPORTED
    /// (0x80090029), and a failed key exchange is fatal rather than something
    /// SSH renegotiates. So if the first handshake fails for a reason that
    /// looks like missing crypto, the agent tries again with only these.
    /// </summary>
    public static readonly string[] ConservativeKeyExchanges =
    {
        "diffie-hellman-group14-sha256",
        "diffie-hellman-group16-sha512",
        "diffie-hellman-group18-sha512",
    };

    private SftpClient Connect()
    {
        try
        {
            return Open(conservative: false);
        }
        catch (Exception error) when (WorthRetryingWithPlainDiffieHellman(error))
        {
            return Open(conservative: true);
        }
    }

    /// <summary>
    /// Whether a second attempt with fewer algorithms could plausibly help.
    ///
    /// Bad credentials and an unreachable host are answers, not crypto
    /// problems: retrying only makes the architect wait twice as long for the
    /// same message.
    /// </summary>
    private static bool WorthRetryingWithPlainDiffieHellman(Exception error) => error switch
    {
        SshAuthenticationException => false,
        SshOperationTimeoutException => false,
        System.Net.Sockets.SocketException => false,
        _ => true,
    };

    private SftpClient Open(bool conservative)
    {
        // CIDCO's host key is not distributed with the agent, so it is accepted
        // on sight. The credentials, not the host key, are what authorise the
        // upload, and CIDCO revalidates the company on every transfer.
        var info = new ConnectionInfo(Host, Port, Username, new PasswordAuthenticationMethod(Username, _password))
        {
            Timeout = Timeout,
        };

        var keep = conservative
            ? ConservativeKeyExchanges
            : info.KeyExchangeAlgorithms.Keys.Except(WindowsUnsupportedKeyExchanges).ToArray();

        foreach (var name in info.KeyExchangeAlgorithms.Keys.Except(keep).ToList())
            info.KeyExchangeAlgorithms.Remove(name);

        if (info.KeyExchangeAlgorithms.Count == 0)
            throw new InvalidOperationException(
                "No key exchange algorithm is available that this version of Windows supports.");

        var client = new SftpClient(info);
        client.HostKeyReceived += (_, e) => e.CanTrust = true;
        client.OperationTimeout = Timeout;
        client.Connect();
        return client;
    }

    /// <summary>Proves the credentials work, without sending anything.</summary>
    public SendResult CheckConnection()
    {
        try
        {
            using var client = Connect();
            client.Disconnect();
            return new SendResult(true, $"Connected to CIDCO at {Host}:{Port}.");
        }
        catch (SshAuthenticationException)
        {
            return SendResult.Failed("That username and password were refused by CIDCO.");
        }
        catch (Exception error)
        {
            return SendResult.Failed($"Could not reach CIDCO at {Host}:{Port} — {Explain(error)}");
        }
    }

    /// <summary>Sends one file — the newest export unless one is named.</summary>
    public SendResult Send(FileInfo? file = null)
    {
        var source = file ?? ExportPicker.Newest(CsvFolder);
        if (source is null)
            return SendResult.Failed($"No .csv found in {(string.IsNullOrWhiteSpace(CsvFolder) ? "(no folder set)" : CsvFolder)}");

        source.Refresh();
        if (!source.Exists)
            return SendResult.Failed($"{source.Name} is no longer there") with { FileName = source.Name };
        if (!AqiCsv.IsAccepted(source.Name))
            return SendResult.Failed($"{source.Name} is not a .csv or .xlsx file") with { FileName = source.Name };

        var target = RemotePath.For(CompanyId, CsvFolder, source.Name);

        try
        {
            using var client = Connect();
            using var stream = source.OpenRead();
            client.UploadFile(stream, target);
            client.Disconnect();
        }
        catch (SshAuthenticationException)
        {
            return SendResult.Failed("That username and password were refused by CIDCO.")
                with { FileName = source.Name, Remote = target };
        }
        catch (Exception error)
        {
            // A rejection from CIDCO arrives as a permission error. Say so in
            // the architect's terms rather than leaking an SSH status code.
            return SendResult.Failed($"{source.Name} — CIDCO refused the transfer ({Explain(error)})")
                with { FileName = source.Name, Remote = target };
        }

        return new SendResult(true, $"{source.Name} sent to CIDCO")
        {
            FileName = source.Name,
            Remote = target,
            SizeBytes = source.Length,
        };
    }

    /// <summary>Sends, and writes the outcome to the agent's own history.</summary>
    public SendResult SendAndRecord(Database db, FileInfo? file = null)
    {
        var result = Send(file);
        db.RecordTransfer(new TransferRecord
        {
            FileName = result.FileName.Length > 0 ? result.FileName : file?.Name ?? "",
            RemotePath = result.Remote,
            SizeBytes = result.SizeBytes,
            Accepted = result.Ok,
            Message = result.Message,
            CompanyId = CompanyId,
            SentAt = result.SentAt,
        });
        return result;
    }

    private static string Explain(Exception error) =>
        error is SftpPermissionDeniedException
            ? "permission denied — check the company id, the designated IP and the file path with CIDCO"
            : error.Message.Trim() is { Length: > 0 } message
                ? message
                : error.GetType().Name;
}
