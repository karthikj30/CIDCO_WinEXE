using System.Globalization;

namespace Cidco.Core;

/// <summary>Where a position came from, which decides how much to trust it.</summary>
public enum LocationOrigin
{
    /// <summary>Nothing answered. The file goes without a position.</summary>
    None,

    /// <summary>Windows Location Service — GPS if the PC has it, Wi-Fi if not.</summary>
    Device,

    /// <summary>Looked up from the public IP. A district, not a doorstep.</summary>
    Network,

    /// <summary>The position typed in while installing. A last resort.</summary>
    Registered,
}

/// <summary>
/// A position and where it came from.
///
/// Latitude and longitude are kept as the text that goes into the file name,
/// so what the agent shows is exactly what CIDCO receives.
/// </summary>
public readonly record struct LocationFix(
    string Latitude,
    string Longitude,
    LocationOrigin Origin,
    DateTimeOffset At)
{
    public static readonly LocationFix Unknown = new("", "", LocationOrigin.None, default);

    public bool HasPosition => Latitude.Length > 0 && Longitude.Length > 0;

    public static LocationFix Of(double latitude, double longitude, LocationOrigin origin, DateTimeOffset at) =>
        new(RemotePath.FormatCoord(latitude), RemotePath.FormatCoord(longitude), origin, at);

    /// <summary>How the agent window names the source.</summary>
    public string Describe => Origin switch
    {
        LocationOrigin.Device => "device location",
        LocationOrigin.Network => "network lookup",
        LocationOrigin.Registered => "registered position",
        _ => "unavailable",
    };
}

/// <summary>Anything that can say where this PC is.</summary>
public interface ILocationSource
{
    LocationOrigin Origin { get; }

    /// <summary>The current position, or <see cref="LocationFix.Unknown"/> when it cannot say.</summary>
    LocationFix Read(TimeSpan timeout);
}

/// <summary>
/// The position to stamp on the next file.
///
/// The agent asks for this fresh on every transfer rather than reusing what
/// was typed at install: an architect who drives to a second site and sends
/// from there should have the file say where it was actually sent from, which
/// is the whole point of CIDCO holding the coordinates at all.
///
/// Sources are tried in order of how much they know — the device first, a
/// network lookup next, and the registered position last. A send is never
/// blocked by any of them: each gets a short timeout, and a transfer with no
/// position is better than a transfer that did not happen.
///
/// Answers are held for a few seconds so a burst of sends does not ask the
/// network once per file. A PC does not move far in that time.
/// </summary>
public sealed class LiveLocation
{
    private readonly IReadOnlyList<ILocationSource> _sources;
    private readonly TimeSpan _perSource;
    private readonly TimeSpan _cacheFor;
    private readonly Func<DateTimeOffset> _now;

    private LocationFix _last = LocationFix.Unknown;
    private DateTimeOffset _lastAt = DateTimeOffset.MinValue;
    private readonly object _gate = new();

    public LiveLocation(
        IEnumerable<ILocationSource> sources,
        TimeSpan? perSourceTimeout = null,
        TimeSpan? cacheFor = null,
        Func<DateTimeOffset>? now = null)
    {
        _sources = sources.ToList();
        _perSource = perSourceTimeout ?? TimeSpan.FromSeconds(4);
        _cacheFor = cacheFor ?? TimeSpan.FromSeconds(20);
        _now = now ?? (() => DateTimeOffset.Now);
    }

    /// <summary>The last answer, without asking again. Empty until the first read.</summary>
    public LocationFix Last
    {
        get { lock (_gate) return _last; }
    }

    /// <summary>
    /// Where this PC is now. Never throws: a source that fails is simply the
    /// next one's turn.
    /// </summary>
    public LocationFix Current()
    {
        lock (_gate)
        {
            if (_last.HasPosition && _now() - _lastAt < _cacheFor) return _last;
        }

        var fix = LocationFix.Unknown;
        foreach (var source in _sources)
        {
            try
            {
                var answer = source.Read(_perSource);
                if (answer.HasPosition) { fix = answer; break; }
            }
            catch
            {
                // A source that cannot answer is not an error the architect
                // needs to see; the next one is tried, and if none answers the
                // file simply goes without a position.
            }
        }

        lock (_gate)
        {
            _last = fix;
            _lastAt = _now();
        }
        return fix;
    }
}

/// <summary>The position typed in while installing — always available, never current.</summary>
public sealed class RegisteredLocationSource : ILocationSource
{
    private readonly Func<(string Latitude, string Longitude)> _read;
    private readonly Func<DateTimeOffset> _now;

    public RegisteredLocationSource(
        Func<(string Latitude, string Longitude)> read,
        Func<DateTimeOffset>? now = null)
    {
        _read = read;
        _now = now ?? (() => DateTimeOffset.Now);
    }

    public LocationOrigin Origin => LocationOrigin.Registered;

    public LocationFix Read(TimeSpan timeout)
    {
        var (latitude, longitude) = _read();
        if (!SetupFlow.TryParseCoordinate(latitude, -90, 90, out var lat, out _)) return LocationFix.Unknown;
        if (!SetupFlow.TryParseCoordinate(longitude, -180, 180, out var lon, out _)) return LocationFix.Unknown;
        return LocationFix.Of(lat, lon, LocationOrigin.Registered, _now());
    }
}

/// <summary>
/// Where the public IP says this PC is.
///
/// This is a fallback, not a fix: it resolves to the exchange the connection
/// leaves through, which in a city is a few kilometres out and on a mobile
/// connection can be a different one entirely. It is here because a desktop
/// with no GPS and no Wi-Fi positioning would otherwise have nothing at all,
/// and a rough answer still shows that a file came from a different city.
/// </summary>
public sealed class NetworkLocationSource : ILocationSource
{
    private readonly Func<TimeSpan, string?> _fetch;
    private readonly Func<DateTimeOffset> _now;

    /// <summary>Free, no key, and returns plain JSON.</summary>
    public const string Endpoint = "http://ip-api.com/json/?fields=status,lat,lon";

    public NetworkLocationSource(Func<TimeSpan, string?>? fetch = null, Func<DateTimeOffset>? now = null)
    {
        _fetch = fetch ?? DefaultFetch;
        _now = now ?? (() => DateTimeOffset.Now);
    }

    public LocationOrigin Origin => LocationOrigin.Network;

    public LocationFix Read(TimeSpan timeout)
    {
        var body = _fetch(timeout);
        if (string.IsNullOrWhiteSpace(body)) return LocationFix.Unknown;
        return Parse(body, _now());
    }

    private static string? DefaultFetch(TimeSpan timeout)
    {
        using var http = new HttpClient { Timeout = timeout };
        return http.GetStringAsync(Endpoint).GetAwaiter().GetResult();
    }

    /// <summary>
    /// Pulls lat and lon out of the response without a JSON library, which
    /// Cidco.Core does not otherwise need. The shape is fixed and tiny:
    /// {"status":"success","lat":19.033,"lon":73.0297}
    /// </summary>
    public static LocationFix Parse(string body, DateTimeOffset at)
    {
        if (!body.Contains("\"success\"", StringComparison.Ordinal)) return LocationFix.Unknown;
        if (!TryNumber(body, "\"lat\"", out var lat)) return LocationFix.Unknown;
        if (!TryNumber(body, "\"lon\"", out var lon)) return LocationFix.Unknown;
        if (lat is < -90 or > 90 || lon is < -180 or > 180) return LocationFix.Unknown;
        return LocationFix.Of(lat, lon, LocationOrigin.Network, at);
    }

    private static bool TryNumber(string body, string key, out double value)
    {
        value = 0;
        var at = body.IndexOf(key, StringComparison.Ordinal);
        if (at < 0) return false;
        var colon = body.IndexOf(':', at + key.Length);
        if (colon < 0) return false;

        var start = colon + 1;
        while (start < body.Length && (body[start] == ' ' || body[start] == '"')) start++;
        var end = start;
        while (end < body.Length && (char.IsDigit(body[end]) || body[end] == '-' || body[end] == '+' ||
                                     body[end] == '.' || body[end] == 'e' || body[end] == 'E')) end++;

        return double.TryParse(body[start..end], NumberStyles.Float, CultureInfo.InvariantCulture, out value);
    }
}
