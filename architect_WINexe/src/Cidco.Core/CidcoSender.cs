using Renci.SshNet;
using Renci.SshNet.Common;

namespace Cidco.Core;

/// <summary>
/// What kind of thing happened, as opposed to what it said.
///
/// The agent runs unattended, so it has to decide on its own whether trying
/// again could possibly help. Losing the network is worth waiting out; a
/// password CIDCO rejected, or a site name they do not recognise, will fail
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
public sealed class CidcoSender : ICidcoTransport
{
    public string Host { get; }
    public int Port { get; }
    public string Username { get; }
    private readonly string _password;
    public string SiteName { get; }
    public string CsvFolder { get; }
    public TimeSpan Timeout { get; }

    /// <summary>
    /// Where the PC is now, resolved fresh on every send.
    ///
    /// The position used to be fixed at install, which was wrong the moment an
    /// architect drove to a second site: every file still claimed the first
    /// one. CIDCO holds these coordinates to tell where data was sent from, so
    /// the answer has to be taken at the moment of sending.
    ///
    /// Null, or a resolver that cannot answer, falls back to the registered
    /// position below. Nothing here can stop a transfer.
    /// </summary>
    public LiveLocation? Location { get; init; }

    /// <summary>
    /// The position typed in while installing. Used only when nothing can say
    /// where the PC is now, and kept so CIDCO can compare where a file says it
    /// came from against where the site was registered.
    /// </summary>
    public string Latitude { get; init; } = "";
    public string Longitude { get; init; } = "";

    /// <summary>
    /// The position to stamp on the file being sent right now: whatever the
    /// PC can be told about itself, and the registered position only when
    /// nothing else answers.
    /// </summary>
    internal (string Latitude, string Longitude) StampNow()
    {
        var fix = Location?.Current() ?? LocationFix.Unknown;
        return fix.HasPosition ? (fix.Latitude, fix.Longitude) : (Latitude, Longitude);
    }


    /// <summary>
    /// A folder to upload into on an ordinary SFTP server.
    ///
    /// Empty for CIDCO, whose intake works out where a file belongs from the
    /// site name and the declared path. Set when the architect named a folder
    /// in the address, which points the agent at a plain server instead.
    /// </summary>
    public string RemoteDirectory { get; init; } = "";

    /// <summary>True when this is a plain SFTP upload, not a CIDCO submission.</summary>
    public bool IsPlainSftp => RemoteDirectory.Length > 0;

    /// <summary>
    /// A private key file to sign in with, instead of a password.
    ///
    /// A cloud server usually will not take a password at all: an AWS image
    /// ships with PasswordAuthentication turned off and the default account
    /// has no password set, so the key pair is the only way in. PuTTY's .ppk
    /// and OpenSSH's .pem both work.
    ///
    /// When a key is set, the password box holds the key's passphrase, if it
    /// has one — the same thing WinSCP does with it.
    /// </summary>
    public string PrivateKeyPath { get; init; } = "";

    public bool UsesPrivateKey => PrivateKeyPath.Trim().Length > 0;

    public CidcoSender(
        string host,
        int port,
        string username,
        string password,
        string siteName,
        string csvFolder,
        TimeSpan? timeout = null)
    {
        Host = host.Trim();
        Port = port;
        Username = username.Trim();
        _password = password;
        SiteName = siteName.Trim();
        CsvFolder = csvFolder.Trim();
        Timeout = timeout ?? TimeSpan.FromSeconds(20);
    }

    /// <summary>Where this is sending, for the status line.</summary>
    public string Describe => IsPlainSftp
        ? $"{Host}:{Port}{RemoteDirectory} (plain SFTP \u2014 not CIDCO)"
        : $"{SiteName} \u2192 {Host}:{Port}";

    public static CidcoSender From(Settings settings) => new(
        settings.IpOrDefault,
        settings.PortOrDefault,
        settings.UsernameOrDefault,
        settings.Password,
        settings.SiteNameOrDefault,
        settings.CsvFolder)
    {
        Latitude = settings.Latitude,
        Longitude = settings.Longitude,
        PrivateKeyPath = settings.PrivateKeyPath,
    };

    /// <summary>The same sender pointed at a different port.</summary>
    public CidcoSender On(int port) =>
        new(Host, port, Username, _password, SiteName, CsvFolder, Timeout)
        {
            RemoteDirectory = RemoteDirectory,
            PrivateKeyPath = PrivateKeyPath,
            Latitude = Latitude,
            Longitude = Longitude,
            Location = Location,
        };

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
        string siteName,
        string csvFolder,
        TimeSpan? timeout = null,
        string privateKeyPath = "",
        string latitude = "",
        string longitude = "",
        LiveLocation? location = null)
    {
        var ports = address.PortsToTry();
        CidcoSender? attempted = null;
        SendResult? firstAnswer = null;

        foreach (var port in ports)
        {
            var sender = new CidcoSender(address.Host, port, username, password, siteName, csvFolder, timeout)
            {
                PrivateKeyPath = privateKeyPath,
                Latitude = latitude,
                Longitude = longitude,
                Location = location,
            };
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
        var info = new ConnectionInfo(Host, Port, Username, AuthenticationMethod())
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

        try
        {
            client.Connect();
        }
        finally
        {
            // Every SSH server names itself before anyone authenticates, so
            // this is known even when the login is then refused — and it is
            // the one thing that says whether we reached CIDCO at all.
            ServerSoftware = info.ServerVersion;
        }
        return client;
    }

    /// <summary>
    /// How to prove who we are: the key if one was given, otherwise the
    /// password.
    /// </summary>
    private AuthenticationMethod AuthenticationMethod()
    {
        if (!UsesPrivateKey) return new PasswordAuthenticationMethod(Username, _password);

        var path = PrivateKeyPath.Trim();
        if (!File.Exists(path))
            throw new FileNotFoundException($"No private key at \"{path}\".", path);

        // The passphrase is whatever is in the password box; an unprotected
        // key simply ignores it.
        var key = _password.Length > 0
            ? new PrivateKeyFile(path, _password)
            : new PrivateKeyFile(path);

        return new PrivateKeyAuthenticationMethod(Username, key);
    }

    /// <summary>
    /// What the last server we reached called itself, e.g.
    /// "SSH-2.0-OpenSSH_9.6p1" or "SSH-2.0-ssh2js1.17.0".
    /// </summary>
    public string? ServerSoftware { get; private set; }

    /// <summary>A machine's own SSH service, rather than CIDCO's intake.</summary>
    private bool LooksLikeAnOperatingSystemSsh =>
        ServerSoftware?.Contains("OpenSSH", StringComparison.OrdinalIgnoreCase) == true;

    /// <summary>CIDCO's intake, which is built on the ssh2 library.</summary>
    private bool LooksLikeCidcosIntake =>
        ServerSoftware?.Contains("ssh2js", StringComparison.OrdinalIgnoreCase) == true;

    /// <summary>Proves the credentials work, without sending anything.</summary>
    public SendResult CheckConnection()
    {
        try
        {
            using var client = Connect();
            client.Disconnect();

            return new SendResult(true, IsPlainSftp
                ? $"Connected to {Host}:{Port} as {Username}. This is a plain SFTP server, not CIDCO \u2014 " +
                  "files sent here are not validated or stored as compliance data."
                : $"Connected to CIDCO at {Host}:{Port}.");
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
            return SendResult.Failed(
                $"{source.Name} is not a .csv file \u2014 every upload is sent as a .csv, so a spreadsheet would arrive unreadable",
                TransferOutcome.NothingToSend) with { FileName = source.Name };

        // Any local name is fine; the remote name is always
        // siteName_timestamp[_lat_lon]_AQI.csv so CIDCO can parse it without
        // the export name. The agent never creates folders — only drops the
        // renamed file into a path that already exists (or into CIDCO's intake
        // when no plain folder was named).
        var sentAt = DateTimeOffset.Now;
        var (stampLat, stampLon) = StampNow();
        var remoteName = RemotePath.AqiFileName(SiteName, sentAt, stampLat, stampLon);
        var target = IsPlainSftp
            ? RemotePath.IntoFolder(RemoteDirectory, SiteName, sentAt, stampLat, stampLon)
            : RemotePath.For(SiteName, remoteName);
        var parent = RemotePath.ParentOf(target);

        SftpClient client;
        try
        {
            client = Connect();
        }
        catch (SshAuthenticationException)
        {
            return SendResult.Failed(RefusedLogin(), TransferOutcome.BadCredentials)
                with { FileName = remoteName, Remote = target };
        }
        catch (Exception error)
        {
            return SendResult.Failed(DiagnoseConnection(error), TransferOutcome.Unreachable)
                with { FileName = remoteName, Remote = target };
        }

        try
        {
            using (client)
            {
                // Limited write access: check the destination folder exists.
                // Never create it — CIDCO's poll1 owns the folder tree.
                if (!client.Exists(parent))
                {
                    return SendResult.Failed(MissingFolder(parent), TransferOutcome.RefusedByCidco)
                        with { FileName = remoteName, Remote = target };
                }

                using var stream = source.OpenRead();
                client.UploadFile(stream, target);
            }
        }
        catch (Exception error)
        {
            return SendResult.Failed(Refusal(error, remoteName), TransferOutcome.RefusedByCidco)
                with { FileName = remoteName, Remote = target };
        }

        var message = IsPlainSftp
            ? $"{source.Name} renamed to {remoteName} and uploaded to {Host}:{Port}{target} \u2014 plain SFTP, " +
              "so CIDCO has not validated or stored anything."
            : $"{source.Name} renamed to {remoteName} and sent to CIDCO";

        return new SendResult(true, message)
        {
            FileName = remoteName,
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
            SiteName = SiteName,
            SentAt = result.SentAt,
            Outcome = result.Outcome,
        });
        return result;
    }

    /// <summary>
    /// The destination folder is not there, and the agent will not make it.
    ///
    /// Which of two mistakes this is depends on whether a folder was named in
    /// the address, and the difference matters: on CIDCO's intake the folder
    /// is theirs to create and there is nothing the architect can do, while on
    /// an ordinary server it means the address is missing the destination and
    /// the fix is one line in the box above. Saying only "path does not exist"
    /// leaves the architect staring at a path they never typed.
    /// </summary>
    private string MissingFolder(string parent)
    {
        if (IsPlainSftp)
        {
            return $"Path does not exist on {Host}:{Port}: {parent}. The agent will not create " +
                   $"folders on the server, so create it there — or point the address at a folder " +
                   $"that already exists — and make sure {Username} may write to it.";
        }

        // No folder was named, so this is CIDCO's own layout.
        return $"Path does not exist: {parent}. The agent will not create folders on the server. " +
               "That path is CIDCO's layout, used because the address names no folder. If this is " +
               $"your own server rather than CIDCO's intake, put the destination folder in the " +
               $"address \u2014 for example {Host}:{Port}/home/ubuntu/uploads \u2014 and the file goes " +
               "straight there instead.";
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

        // A folder was named, so the architect is pointing at their own server
        // on purpose. Telling them to ask CIDCO about ports would be nonsense.
        if (IsPlainSftp)
        {
            var software = ServerSoftware is null ? "" : $" The server there is {Pretty(ServerSoftware)}.";
            return $"{where} refused the username \"{Username}\" and that password.{software} " +
                   "For a plain SFTP server these are that machine's own login, not CIDCO's.";
        }

        // Which server answered is the whole question, and it tells us
        // itself. Without this an architect cannot distinguish "the password
        // is wrong" from "this is not CIDCO", and the two need opposite fixes.
        if (LooksLikeCidcosIntake)
        {
            return $"{where} refused that username and password. That server is CIDCO's intake " +
                   $"({Pretty(ServerSoftware)}), so the address and port are right \u2014 it is the user id " +
                   "or password that CIDCO does not recognise.";
        }

        if (LooksLikeAnOperatingSystemSsh)
        {
            return $"{where} refused that username and password, and it is not CIDCO's intake: the server " +
                   $"there is {Pretty(ServerSoftware)}, which is the machine's own SSH service. It has never " +
                   "heard of a CIDCO user id, so no password would work. Ask CIDCO which port their SFTP " +
                   "intake is on \u2014 it is a separate service from the machine's own.";
        }

        var named = ServerSoftware is null ? "" : $" The server there is {Pretty(ServerSoftware)}.";
        return $"{where} refused that username and password.{named}";
    }

    /// <summary>"SSH-2.0-OpenSSH_9.6p1" reads better as "OpenSSH_9.6p1".</summary>
    private static string Pretty(string? version)
    {
        var text = (version ?? "").Trim();
        return text.StartsWith("SSH-2.0-", StringComparison.Ordinal) ? text["SSH-2.0-".Length..] : text;
    }

    /// <summary>
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

        // A key we cannot read is a problem with this PC, not with the network.
        if (error is FileNotFoundException missing)
            return $"{missing.Message} Check the private key path.";

        // A key SSH.NET cannot parse: the wrong sort of file, a corrupted one,
        // or a passphrase-protected key with no passphrase given.
        if (UsesPrivateKey &&
            (error is System.Security.Cryptography.CryptographicException
                   or FormatException
                   or SshException { Message: "Invalid private key file." }))
        {
            return $"That private key could not be read \u2014 {error.Message} " +
                   "A .ppk from PuTTY and a .pem from OpenSSH both work; if the key has a passphrase, " +
                   "put it in the Password box.";
        }

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

    /// <summary>
    /// The technical reason, and nothing more.
    ///
    /// This used to append "check the site name, the designated IP and the
    /// file path with CIDCO" to every permission denial. On CIDCO's intake
    /// that is the advice; on an architect's own server CIDCO has no part in
    /// it, and sending someone to ask CIDCO about their own AWS box is worse
    /// than saying nothing. What to do about it now belongs to the caller,
    /// which knows which server it is talking to.
    /// </summary>
    private static string Explain(Exception error) =>
        error is SftpPermissionDeniedException
            ? "permission denied"
            : error.Message.Trim() is { Length: > 0 } message
                ? message
                : error.GetType().Name;

    /// <summary>
    /// An upload that failed after the folder had already been found.
    ///
    /// The existence check ran first and passed, so the folder is there. That
    /// rules one thing out for good, and the message should say so rather than
    /// repeat "check the folder exists" — a denial here is about what this
    /// login may do in a folder that demonstrably exists, which is a different
    /// thing to go and fix.
    /// </summary>
    private string Refusal(Exception error, string remoteName)
    {
        if (!IsPlainSftp)
        {
            return $"{remoteName} \u2014 CIDCO refused the transfer ({Explain(error)})";
        }

        if (error is SftpPermissionDeniedException)
        {
            return $"{remoteName} \u2014 {Host}:{Port} found {RemoteDirectory} but would not let " +
                   $"{Username} write into it (permission denied). The folder is there, so this is " +
                   $"about access to it rather than the path. On the server, either give {Username} " +
                   $"the folder \u2014 sudo chown -R {Username} {RemoteDirectory} \u2014 or point the " +
                   $"address at one {Username} already owns.";
        }

        return $"{remoteName} \u2014 {Host}:{Port} would not take the file at {RemoteDirectory} " +
               $"({Explain(error)}). The folder was found, so this is not the path.";
    }
}
