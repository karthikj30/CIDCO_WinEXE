namespace Cidco.Core;

/// <summary>The shape of the file CIDCO reads.</summary>
public static class AqiCsv
{
    /// <summary>
    /// The AQI columns CIDCO published, in order. CIDCO matches headers on
    /// their letters and digits alone, so an existing sheet spelling them
    /// "PM 2.5", "NO2" or "Station/Device ID" is accepted unchanged.
    /// </summary>
    public static readonly IReadOnlyList<string> Columns = new[]
    {
        "Project / Site ID",
        "AQI Monitoring Station / Device ID",
        "OEM / Model",
        "Date & Time of Reading",
        "AQI Value",
        "PM2.5",
        "PM10",
        "NO\u2082",
        "SO\u2082",
        "CO",
        "O\u2083",
        "Temperature",
        "Humidity",
        "Other applicable environmental parameters",
        "Data Source / Integration Method",
        "Data Receipt Timestamp",
    };

    /// <summary>The file types CIDCO accepts. CSV is the everyday one.</summary>
    public static readonly IReadOnlyList<string> AcceptedSuffixes = new[] { ".csv", ".xlsx" };

    public static bool IsAccepted(string fileName) =>
        AcceptedSuffixes.Any(suffix => fileName.EndsWith(suffix, StringComparison.OrdinalIgnoreCase));

    public static string HeaderRow() => string.Join(",", Columns);
}
