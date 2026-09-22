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

    /// <summary>
    /// The file types the agent sends. CSV only, and deliberately so: every
    /// upload is renamed to siteName_timestamp_AQI.csv, so sending a
    /// spreadsheet would hand CIDCO a binary .xlsx wearing a .csv name. It
    /// would pass CIDCO's file-type check and fail its column check, which is
    /// the worst of both — so the agent refuses it here, where the message can
    /// still name the actual file.
    /// </summary>
    public static readonly IReadOnlyList<string> AcceptedSuffixes = new[] { ".csv" };

    /// <summary>
    /// Any name is fine as long as it is a .csv: readings.csv, aqi.daily.csv,
    /// Sept Export (2).csv. The name is discarded on upload anyway.
    /// </summary>
    public static bool IsAccepted(string fileName) =>
        AcceptedSuffixes.Any(suffix => fileName.EndsWith(suffix, StringComparison.OrdinalIgnoreCase));

    public static string HeaderRow() => string.Join(",", Columns);
}
