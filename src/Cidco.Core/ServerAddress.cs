using System.Globalization;

namespace Cidco.Core;

/// <summary>Which door into CIDCO a transfer goes through.</summary>
public enum Transport
{
    /// <summary>CIDCO's SFTP intake, on its own port.</summary>
    Sftp,

    /// <summary>The upload endpoint on CIDCO's web portal.</summary>
    Portal,
}

/// <summary>
/// The designated address CIDCO sends the architect, as one thing to type.
///
/// Asking for the port separately was a field to get wrong for no benefit:
/// CIDCO's intake is on the same port for everyone. It is still reachable by
/// typing it after a colon, because "everyone" holds right up until CIDCO puts
/// an instance somewhere else, and an architect who cannot say so is stuck.
/// </summary>
public sealed record ServerAddress(string Host, int Port, bool PortWasGiven)
{
    /// <summary>
    /// Which door into CIDCO this address names.
    ///
    /// Written by the architect, not guessed: an address with http:// or
    /// https:// in front of it goes to the portal, anything else to the SFTP
    /// intake. Switching protocol behind someone's back would be worse than
    /// asking for five characters.
    /// </summary>
    public Transport Transport { get; init; } = Transport.Sftp;

    public bool IsPortal => Transport == Transport.Portal;
    /// <summary>Where CIDCO's SFTP intake listens unless told otherwise.</summary>
    public const int StandardPort = 2222;

    /// <summary>
    /// The ports tried when the architect gave only an address.
    ///
    /// Just the one, deliberately. Port 22 was in here and had to come out: on
    /// a Linux server that is the operating system's own SSH service, not
    /// CIDCO's intake, so the agent was presenting CIDCO credentials to a
    /// machine that has never heard of them. Besides being useless, repeated
    /// failed logins there are what fail2ban exists to ban — and a ban lands
    /// on the architect's address, which would then lock them out of the real
    /// intake on that same host.
    ///
    /// An intake somewhere else is reached by typing the port, not by guessing
    /// at it.
    /// </summary>
    public static readonly IReadOnlyList<int> CandidatePorts = new[] { StandardPort };

    public override string ToString() => Host.Contains(':') ? $"[{Host}]:{Port}" : $"{Host}:{Port}";

    /// <summary>The same address on a different port.</summary>
    public ServerAddress On(int port) => this with { Port = port };

    /// <summary>The portal's base URL, for the HTTP door.</summary>
    public Uri PortalBase() => new UriBuilder(
        Transport == Transport.Portal && Secure ? "https" : "http",
        Host,
        Port).Uri;

    /// <summary>Whether https was asked for. Only meaningful for the portal.</summary>
    public bool Secure { get; init; }

    /// <summary>
    /// A folder on the server to upload into, taken from the address.
    ///
    /// Empty for CIDCO, whose intake decides where a file goes from the
    /// company id and the path the agent declares. Set when the architect
    /// names a folder outright — "13.207.123.12:22/home/ubuntu/uploads" — which
    /// is how you point the agent at an ordinary SFTP server, CIDCO's layout
    /// and validation being particular to CIDCO.
    /// </summary>
    public string RemoteDirectory { get; init; } = "";

    /// <summary>
    /// True when this address names an ordinary SFTP server rather than
    /// CIDCO's intake. Nothing about it is validated by CIDCO, and nothing
    /// sent to it counts as a compliance submission.
    /// </summary>
    public bool IsPlainSftp => Transport == Transport.Sftp && RemoteDirectory.Length > 0;

    /// <summary>
    /// Reads what the architect typed. Accepts a bare address, one with a port
    /// after a colon, a bracketed IPv6 address, and an sftp:// or ssh:// URL
    /// pasted out of an email.
    /// </summary>
    public static bool TryParse(string? text, out ServerAddress address, out string problem)
    {
        address = new ServerAddress("", StandardPort, false);
        problem = "";

        var value = (text ?? "").Trim();
        if (value.Length == 0)
        {
            problem = "Enter the designated IP address CIDCO sent you.";
            return false;
        }

        // The scheme, when there is one, says which door to use.
        var transport = Transport.Sftp;
        var secure = false;
        var defaultPort = StandardPort;

        if (value.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            transport = Transport.Portal;
            secure = true;
            defaultPort = 443;
            value = value["https://".Length..];
        }
        else if (value.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
        {
            transport = Transport.Portal;
            defaultPort = 80;
            value = value["http://".Length..];
        }
        else
        {
            foreach (var scheme in new[] { "sftp://", "ssh://", "//" })
                if (value.StartsWith(scheme, StringComparison.OrdinalIgnoreCase))
                    value = value[scheme.Length..];
        }
        value = value.TrimEnd('/');

        // A path after the host is a plain SFTP destination: upload straight
        // there, rather than into CIDCO's /<companyId>/<folder>/ tree. That is
        // how an ordinary SFTP client behaves, and it is what a dry run against
        // a test server needs — the CIDCO layout only exists on CIDCO's intake.
        var remoteDirectory = "";
        var slash = value.IndexOf('/');
        if (slash >= 0)
        {
            remoteDirectory = value[slash..];
            value = value[..slash];
        }
        var at = value.LastIndexOf('@');
        if (at >= 0) value = value[(at + 1)..];

        if (value.Length == 0)
        {
            problem = "Enter the designated IP address CIDCO sent you.";
            return false;
        }

        var host = value;
        var port = defaultPort;
        var portWasGiven = false;

        if (value.StartsWith('['))
        {
            // [::1] or [::1]:2222
            var close = value.IndexOf(']');
            if (close < 0)
            {
                problem = "That address is missing its closing bracket.";
                return false;
            }
            host = value[1..close];
            var rest = value[(close + 1)..];
            if (rest.StartsWith(':'))
            {
                if (!TryPort(rest[1..], out port, out problem)) return false;
                portWasGiven = true;
            }
        }
        else
        {
            var colons = value.Count(c => c == ':');
            if (colons == 1)
            {
                var cut = value.IndexOf(':');
                host = value[..cut];
                if (!TryPort(value[(cut + 1)..], out port, out problem)) return false;
                portWasGiven = true;
            }
            else if (colons > 1)
            {
                // A bare IPv6 address. Anything after a port would need brackets.
                host = value;
            }
        }

        host = host.Trim();
        if (host.Length == 0)
        {
            problem = "That address has no host in it.";
            return false;
        }
        if (host.Any(char.IsWhiteSpace))
        {
            problem = "An address cannot contain spaces.";
            return false;
        }

        // A host may only keep colons if it really is an IPv6 address. Without
        // this, "host:3000:3000" parses into a host nothing can be built from,
        // and the failure surfaces later as a crash rather than as a sentence
        // telling the architect their address is wrong.
        if (host.Contains(':') && !System.Net.IPAddress.TryParse(host, out _))
        {
            problem = $"\"{host}\" is not an address. Write it as a host with at most one port, like " +
                      $"\"13.207.123.12\" or \"13.207.123.12:{StandardPort}\".";
            return false;
        }

        address = new ServerAddress(host, port, portWasGiven)
        {
            Transport = transport,
            Secure = secure,
            // The portal's own path is fixed, so one pasted with a portal
            // address is the page they copied it from, not a destination.
            RemoteDirectory = transport == Transport.Sftp ? remoteDirectory : "",
        };
        return true;
    }

    private static bool TryPort(string text, out int port, out string problem)
    {
        problem = "";
        if (!int.TryParse(text.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out port)
            || port < 1 || port > 65535)
        {
            port = StandardPort;
            problem = $"\"{text.Trim()}\" is not a port number. Leave it off to use CIDCO's usual {StandardPort}.";
            return false;
        }
        return true;
    }

    /// <summary>
    /// The ports to try, in order. An address the architect gave a port for is
    /// taken at their word and tried alone — guessing past an explicit
    /// instruction only muddies what went wrong.
    /// </summary>
    public IReadOnlyList<int> PortsToTry()
    {
        // The portal is named outright, scheme and all, so there is nothing to
        // search for.
        if (PortWasGiven || IsPortal) return new[] { Port };

        var ports = new List<int> { Port };
        foreach (var candidate in CandidatePorts)
            if (!ports.Contains(candidate))
                ports.Add(candidate);
        return ports;
    }
}
