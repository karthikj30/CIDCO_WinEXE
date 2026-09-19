namespace Cidco.Core;

/// <summary>
/// Where a file is written on CIDCO's side.
///
/// The agent signs in with the one CIDCO username and password, so the upload
/// path is what tells CIDCO which company is sending:
///
///     /&lt;companyId&gt;/&lt;the folder the CSV was taken from&gt;/&lt;companyId&gt;_&lt;timestamp&gt;_AQI.csv
///
/// The local export may be named anything (e.g. readings.csv); before upload it
/// is always renamed to companyId_timestamp_AQI.csv so CIDCO's poll handlers
/// can parse company and time from the file name alone.
///
/// The agent never creates folders on the server — that is CIDCO's job. It only
/// checks that the destination folder already exists, then drops the renamed
/// file there.
/// </summary>
public static class RemotePath
{
    /// <summary>Windows and POSIX spellings of the same folder must compare equal.</summary>
    public static string Normalise(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        var collapsed = value.Trim().Replace('\\', '/').TrimEnd('/');
        return collapsed.Length == 0 ? "/" : collapsed;
    }

    /// <summary>
    /// The fixed remote name every CSV is sent as:
    ///
    ///     ABCD123_2026-09-19_13-28-49_AQI.csv
    ///
    /// Company id, then month-date-time, then the AQI suffix. The original
    /// export name is discarded on purpose — CIDCO only needs this shape.
    /// </summary>
    public static string AqiFileName(string companyId, DateTimeOffset at)
    {
        var company = companyId.Trim().Trim('/');
        if (company.Length == 0) company = "UNKNOWN";
        var when = at.ToString("yyyy-MM-dd_HH-mm-ss", System.Globalization.CultureInfo.InvariantCulture);
        return $"{company}_{when}_AQI.csv";
    }

    /// <summary>
    /// "C:/CIDCO/exports" + renamed file becomes
    /// "/ABCD123/C:/CIDCO/exports/ABCD123_2026-09-19_13-28-49_AQI.csv".
    /// </summary>
    public static string For(string companyId, string csvFolder, string fileName)
    {
        var company = companyId.Trim().Trim('/');
        var source = Normalise(csvFolder).TrimStart('/');
        var name = FileNameOnly(fileName);

        var parts = new[] { company, source, name }.Where(p => p.Length > 0);
        return "/" + string.Join("/", parts);
    }

    /// <summary>
    /// A folder and a file name, joined for an ordinary SFTP server.
    ///
    /// No company prefix and no source folder: that layout belongs to CIDCO's
    /// intake, and a plain server has never heard of it.
    /// </summary>
    public static string Join(string directory, string fileName)
    {
        var folder = Normalise(directory).TrimEnd('/');
        var name = FileNameOnly(fileName);
        if (folder.Length == 0 || folder == "/") return "/" + name;
        return (folder.StartsWith('/') ? folder : "/" + folder) + "/" + name;
    }

    /// <summary>
    /// Destination on a plain SFTP server: the folder the architect named, plus
    /// the renamed AQI file. No company/month/date tree — the agent must not
    /// create folders; CIDCO's poll1 builds that layout after intake.
    /// </summary>
    public static string IntoFolder(string remoteDirectory, string companyId, DateTimeOffset at) =>
        Join(remoteDirectory, AqiFileName(companyId, at));

    /// <summary>
    /// Parent directory of a remote file path, or empty when the file sits at root.
    /// </summary>
    public static string ParentOf(string remoteFilePath)
    {
        var cut = remoteFilePath.LastIndexOf('/');
        if (cut <= 0) return "/";
        return remoteFilePath[..cut];
    }

    /// <summary>Every folder in a path, outermost first.</summary>
    public static IReadOnlyList<string> FoldersOf(string remoteFilePath)
    {
        var directory = remoteFilePath[..Math.Max(remoteFilePath.LastIndexOf('/'), 0)];
        var segments = directory.Split('/', StringSplitOptions.RemoveEmptyEntries);

        var folders = new List<string>();
        var built = "";
        foreach (var segment in segments)
        {
            built += "/" + segment;
            folders.Add(built);
        }
        return folders;
    }

    /// <summary>The last segment, whichever slash the caller used.</summary>
    internal static string FileNameOnly(string fileName)
    {
        var flattened = fileName.Replace('\\', '/');
        var cut = flattened.LastIndexOf('/');
        return cut < 0 ? flattened : flattened[(cut + 1)..];
    }
}
