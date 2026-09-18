using System.Globalization;

namespace Cidco.Core;

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
    /// <summary>Where CIDCO's SFTP intake listens unless told otherwise.</summary>
    public const int StandardPort = 2222;

    /// <summary>
    /// Ports worth trying when the architect gave only an address: the
    /// standard one, then plain SSH, which is where an intake fronted by a
    /// firewall rule usually ends up.
    /// </summary>
    public static readonly IReadOnlyList<int> CandidatePorts = new[] { StandardPort, 22 };

    public override string ToString() => Host.Contains(':') ? $"[{Host}]:{Port}" : $"{Host}:{Port}";

    /// <summary>The same address on a different port.</summary>
    public ServerAddress On(int port) => this with { Port = port };

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

        // Tolerate a pasted URL, and a trailing slash with it.
        foreach (var scheme in new[] { "sftp://", "ssh://", "//" })
            if (value.StartsWith(scheme, StringComparison.OrdinalIgnoreCase))
                value = value[scheme.Length..];
        value = value.TrimEnd('/');

        // A path or credentials pasted along with the address are not ours.
        var slash = value.IndexOf('/');
        if (slash >= 0) value = value[..slash];
        var at = value.LastIndexOf('@');
        if (at >= 0) value = value[(at + 1)..];

        if (value.Length == 0)
        {
            problem = "Enter the designated IP address CIDCO sent you.";
            return false;
        }

        var host = value;
        var port = StandardPort;
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

        address = new ServerAddress(host, port, portWasGiven);
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
        if (PortWasGiven) return new[] { Port };

        var ports = new List<int> { Port };
        foreach (var candidate in CandidatePorts)
            if (!ports.Contains(candidate))
                ports.Add(candidate);
        return ports;
    }
}
