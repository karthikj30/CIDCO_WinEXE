namespace Cidco.Core;

/// <summary>
/// How often the agent sends the CSV.
///
/// The choices the installer offers, in one place, so the setup wizard and the
/// agent's status line can never drift apart.
/// </summary>
public static class Schedule
{
    /// <summary>The interval CIDCO published, in the order they are offered.</summary>
    public static readonly IReadOnlyList<(string Label, int Seconds)> Intervals = new[]
    {
        ("Every 5 seconds", 5),
        ("Every 15 seconds", 15),
        ("Every 30 seconds", 30),
        ("Every 1 minute", 60),
        ("Every 5 minutes", 5 * 60),
        ("Every 10 minutes", 10 * 60),
        ("Every 15 minutes", 15 * 60),
        ("Every 20 minutes", 20 * 60),
        ("Every 30 minutes", 30 * 60),
        ("Every 45 minutes", 45 * 60),
        ("Every 1 hour", 60 * 60),
        ("Every 2 hours", 2 * 60 * 60),
        ("Every 3 hours", 3 * 60 * 60),
    };

    public const int DefaultSeconds = 3 * 60 * 60;

    public static string[] Labels => Intervals.Select(i => i.Label).ToArray();

    /// <summary>Seconds behind an installer label; falls back to the 3-hour default.</summary>
    public static int SecondsFor(string label)
    {
        foreach (var (text, seconds) in Intervals)
            if (string.Equals(text, label, StringComparison.Ordinal))
                return seconds;
        return DefaultSeconds;
    }

    /// <summary>The label for a stored interval, for showing it back to the user.</summary>
    public static string LabelFor(int seconds)
    {
        foreach (var (text, value) in Intervals)
            if (value == seconds)
                return text;
        return $"Every {seconds} seconds";
    }

    /// <summary>A short human reading of an interval, e.g. "3 hours".</summary>
    public static string Describe(int seconds)
    {
        if (seconds < 60) return $"{seconds} seconds";
        if (seconds < 3600)
        {
            var minutes = seconds / 60;
            return $"{minutes} minute{(minutes == 1 ? "" : "s")}";
        }
        var hours = seconds / 3600;
        return $"{hours} hour{(hours == 1 ? "" : "s")}";
    }
}
