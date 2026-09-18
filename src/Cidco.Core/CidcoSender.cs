using Renci.SshNet;
using Renci.SshNet.Common;

namespace Cidco.Core;

/// <summary>
/// What kind of thing happened, as opposed to what it said.
///
/// The agent runs unattended, so it has to decide on its own whether trying
/// again could possibly help. Losing the network is worth waiting out; a
/// password CIDCO rejected, or a company id they do not recognise, will fail
/// exactly the same way forever and needs a person.
/// </summary>
public enum TransferOutcome
{
    /// <summary>CIDCO took the file.</summary>
    Sent,

    /// <summary>Could not get to CIDCO at all. Worth trying again later.</summary>
    Unreachable,

    /// <summary>CIDCO answered and rejected the credentials. A person must fix this.</summary>
    BadCredentials,

    /// <summary>CIDCO took the connection and refused the transfer. A person must fix this.</summary>
    RefusedByCidco,

    /// <summary>There was no export to send. Not a failure — just nothing to do yet.</summary>
    NothingToSend,
}

/// <summary>What came of one attempt to reach CIDCO.</summary>
public sealed record SendResult(bool Ok, string Message)
{
    public string FileName { get; init; } = "";
    public string Remote { get; init; } = "";
    public long SizeBytes { get; init; }
    public DateTimeOffset SentAt { get; init; } = DateTimeOffset.Now;
    public TransferOutcome Outcome { get; init; } = TransferOutcome.Sent;

    /// <summary>Whether trying the same thing again could plausibly work.</summary>
    public bool WorthRetrying => Outcome is TransferOutcome.Unreachable;

    public static SendResult Failed(string message, TransferOutcome outcome) =>
        new(false, message) { Outcome = outcome };
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

    /// <summary>The same sender pointed at a different port.</summary>
    public CidcoSender On(int port) =>
        new(Host, port, Username, _password, CompanyId, CsvFolder, Timeout);

    /// <summary>
    /// Finds CIDCO's intake behind an address, and connects to it.
    ///
    /// The architect types an address, not a port, so when the usual one turns
    /// out to have nothing on it — or something that is not SFTP — the other
    /// ports CIDCO is ever on are worth trying before giving up. A wrong
    /// password stops this immediately: that is an answer from the right
    /// server, and hammering the neighbouring ports with it would be both
    /// pointless and rude.
    /// </summary>
    public static (CidcoSender Sender, SendResult Result) FindIntake(
        ServerAddress address,
        string username,
        string password,
        string companyId,
        string csvFolder,
        TimeSpan? timeout = null)
    {
        var ports = address.PortsToTry();
        CidcoSender? attempted = null;
        SendResult? firstAnswer = null;

        foreach (var port in ports)
        {
            var sender = new CidcoSender(address.Host, port, username, password, companyId, csvFolder, timeout);
            var result = sender.CheckConnection();
            attempted = sender;

            if (result.Ok)
            {
                // Say so when the port was not the one that was tried first,
                // otherwise the architect has no idea what they are connected to.
                var message = port == ports[0] || ports.Count == 1
                    ? result.Message
                    : $"{result.Message.TrimEnd('.')} \u2014 found on port {port}.";
                return (sender, result with { Message = message });
            }

            // Wrong credentials means this IS the server. Stop.
            if (result.Outcome == TransferOutcome.BadCredentials)
                return (sender, result);

            firstAnswer ??= result;
        }

        // Nothing answered as SFTP. Report the first, most likely port rather
        // than whatever the last long shot happened to say.
        //
        // The nudge about naming a different port is only added when the agent
        // was the one guessing. Telling somebody who typed ":8010" that they
        // could try typing a port is noise on top of a message that already
        // told them what was wrong.
        var answer = firstAnswer!;

        if (!address.PortWasGiven)
        {
            answer = answer with
            {
                Message = answer.Message +
                    $" The agent tried port {ServerAddress.StandardPort}, which is where CIDCO's intake " +
                    $"normally listens. If theirs is somewhere else, put it after the address, like " +
                    $"\"{address.Host}:8010\".",
            };
        }

        return (attempted!, answer);
    }

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
            return SendResult.Failed(RefusedLogin(), TransferOutcome.BadCredentials);
        }
        catch (Exception error)
        {
            return SendResult.Failed(DiagnoseConnection(error), TransferOutcome.Unreachable);
        }
    }

    /// <summary>Sends one file — the newest export unless one is named.</summary>
    public SendResult Send(FileInfo? file = null)
    {
        var source = file ?? ExportPicker.Newest(CsvFolder);
        if (source is null)
            return SendResult.Failed($"No .csv found in {(string.IsNullOrWhiteSpace(CsvFolder) ? "(no folder set)" : CsvFolder)}", TransferOutcome.NothingToSend);

        source.Refresh();
        if (!source.Exists)
            return SendResult.Failed($"{source.Name} is no longer there", TransferOutcome.NothingToSend) with { FileName = source.Name };
        if (!AqiCsv.IsAccepted(source.Name))
            return SendResult.Failed($"{source.Name} is not a .csv or .xlsx file", TransferOutcome.NothingToSend) with { FileName = source.Name };

        var target = RemotePath.For(CompanyId, CsvFolder, source.Name);

        // Getting to CIDCO and being turned away by CIDCO are different
        // problems with different fixes, so they are caught separately. Saying
        // "CIDCO refused the transfer" when the server was never reached sends
        // the architect hunting through company ids and file paths when the
        // real answer is the address or the port.
        SftpClient client;
        try
        {
            client = Connect();
        }
        catch (SshAuthenticationException)
        {
            return SendResult.Failed(RefusedLogin(), TransferOutcome.BadCredentials)
                with { FileName = source.Name, Remote = target };
        }
        catch (Exception error)
        {
            return SendResult.Failed(DiagnoseConnection(error), TransferOutcome.Unreachable)
                with { FileName = source.Name, Remote = target };
        }

        try
        {
            using (client)
            using (var stream = source.OpenRead())
            {
                client.UploadFile(stream, target);
            }
        }
        catch (Exception error)
        {
            // A rejection from CIDCO arrives as a permission error. Say so in
            // the architect's terms rather than leaking an SSH status code.
            return SendResult.Failed($"{source.Name} — CIDCO refused the transfer ({Explain(error)})", TransferOutcome.RefusedByCidco)
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
            Outcome = result.Outcome,
        });
        return result;
    }

    /// <summary>
    /// Nothing came back at all.
    ///
    /// Worth spelling out, because a timeout and a refusal get confused and
    /// they mean opposite things. A refusal means the packets arrived and
    /// nothing was listening — the service is down. A timeout means they never
    /// arrived, so the service could be running perfectly and still be
    /// unreachable. Somebody who has just checked that their server is up will
    /// otherwise assume the agent is wrong.
    /// </summary>
    private static string TimedOut(string where) =>
        $"{where} did not answer at all \u2014 the connection timed out rather than being refused, " +
        "which means nothing came back, not that the service is down. Something is dropping the " +
        "traffic on the way: on AWS that is normally an inbound rule missing from the security group " +
        "for this port, and it can equally be this PC's own outbound firewall.";

    /// <summary>
    /// A rejected login, saying which server did the rejecting.
    ///
    /// The agent finds the port itself, so "refused" on its own leaves the
    /// architect unable to tell CIDCO's intake from some other SSH server that
    /// happened to answer — a machine's own sshd on port 22 will reject a
    /// CIDCO user id in exactly the same words. Naming the endpoint is what
    /// makes those two tellable apart.
    /// </summary>
    private string RefusedLogin()
    {
        var where = $"{Host}:{Port}";
        var aside = Port == 22
            ? " Port 22 is often a machine's own SSH service rather than CIDCO's intake, " +
              "which would reject a CIDCO user id like this. Check with CIDCO which port their SFTP intake is on."
            : "";

        return $"{where} refused that username and password.{aside}";
    }

    /// <summary>
    /// Turns a failed connection into something an architect can act on.
    ///
    /// The underlying errors talk about SSH internals — "no valid SSH
    /// identification string", socket codes — which tell the person at the
    /// keyboard nothing. Each one here maps to the thing that is actually
    /// wrong and who can fix it.
    /// </summary>
    public string DiagnoseConnection(Exception error)
    {
        var where = $"{Host}:{Port}";

        // Something answered on the port but never sent the "SSH-2.0-…"
        // greeting that opens every SSH conversation. A web server does
        // exactly this when you speak SSH at it, which is the usual story: the
        // port given out was the portal's, not the SFTP intake's.
        if (error is SshConnectionException &&
            error.Message.Contains("identification string", StringComparison.OrdinalIgnoreCase))
        {
            return $"Something is listening on {where}, but it is not an SFTP server — it closed the " +
                   "connection without an SSH greeting. That port is usually CIDCO's web portal rather " +
                   "than its SFTP intake, which listens on 2222 by default. Check the port with CIDCO, " +
                   "and that their SFTP service is running.";
        }

        if (error is System.Net.Sockets.SocketException socket)
        {
            return socket.SocketErrorCode switch
            {
                System.Net.Sockets.SocketError.ConnectionRefused =>
                    $"Nothing is listening on {where}. Check the designated IP and port with CIDCO, and " +
                    "that their SFTP service is running.",
                System.Net.Sockets.SocketError.TimedOut or System.Net.Sockets.SocketError.HostUnreachable =>
                    $"{where} did not answer. A firewall between this PC and CIDCO — or a closed port on " +
                    "their side — is the usual cause.",
                System.Net.Sockets.SocketError.HostNotFound =>
                    $"\"{Host}\" could not be looked up. Check the designated IP CIDCO sent you.",
                _ => $"Could not reach CIDCO at {where} — {Explain(error)}",
            };
        }

        if (error is SshOperationTimeoutException)
            return TimedOut(where);

        return $"Could not reach CIDCO at {where} — {Explain(error)}";
    }

    private static string Explain(Exception error) =>
        error is SftpPermissionDeniedException
            ? "permission denied — check the company id, the designated IP and the file path with CIDCO"
            : error.Message.Trim() is { Length: > 0 } message
                ? message
                : error.GetType().Name;
}
