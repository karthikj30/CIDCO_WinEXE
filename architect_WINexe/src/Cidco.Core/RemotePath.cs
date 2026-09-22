namespace Cidco.Core;

/// <summary>
/// Where a file is written on CIDCO's side.
///
/// The agent signs in with the one CIDCO username and password, so the upload
/// path is what tells CIDCO which company is sending:
///
///     /&lt;siteName&gt;/&lt;the folder the CSV was taken from&gt;/&lt;siteName&gt;_&lt;timestamp&gt;_AQI.csv
///
/// The local export may be named anything (e.g. readings.csv); before upload it
/// is always renamed to siteName_timestamp[_lat_lon]_AQI.csv so CIDCO's poll
/// handlers can parse company and time from the file name alone.
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
    ///     ABCD123_21_09_2026_11-30-24_19.033_73.0297_AQI.csv
    ///
    /// Site name, then the date as dd_mm_yyyy, then the time as hh-mm-ss,
    /// then latitude and longitude when the installer collected them, then
    /// the AQI suffix. The original export name is discarded on purpose.
    ///
    /// Without coordinates (older installs), the stamp is unchanged:
    ///
    ///     ABCD123_21_09_2026_11-30-24_AQI.csv
    ///
    /// It is one flat name rather than a folder path because the agent is not
    /// allowed to create folders on the server. Everything CIDCO needs to file
    /// it — the company and the moment — therefore has to travel in the name,
    /// and poll1 takes it apart again to build
    /// &lt;siteName&gt;/&lt;dd_mm_yyyy&gt;/&lt;hh-mm-ss&gt;.csv on CIDCO's side.
    ///
    /// The time is hyphenated, not "11:30:24". A colon is a reserved character
    /// in a Windows file name — NTFS reads "11:30:24.csv" as an alternate data
    /// stream on a file called "11" — so an officer who downloaded a
    /// colon-named file could not save it. Linux accepts it; Windows is the
    /// side that breaks, and both sides have to be able to hold this file.
    /// </summary>
    public static string AqiFileName(
        string siteName,
        DateTimeOffset at,
        string? latitude = null,
        string? longitude = null)
    {
        var company = siteName.Trim().Trim('/');
        if (company.Length == 0) company = "UNKNOWN";
        var stem = $"{company}_{DateFolder(at)}_{TimeStem(at)}";
        var lat = (latitude ?? "").Trim();
        var lon = (longitude ?? "").Trim();
        if (lat.Length > 0 && lon.Length > 0)
            return $"{stem}_{lat}_{lon}_AQI.csv";
        return $"{stem}_AQI.csv";
    }

    /// <summary>Decimal degrees for a file name — invariant, no scientific notation.</summary>
    public static string FormatCoord(double value) =>
        value.ToString("0.######", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>The date as CIDCO files it: 21_09_2026.</summary>
    public static string DateFolder(DateTimeOffset at) =>
        at.ToString("dd_MM_yyyy", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>The time as CIDCO names the file: 11-30-24.</summary>
    public static string TimeStem(DateTimeOffset at) =>
        at.ToString("HH-mm-ss", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>
    /// Where CIDCO's own intake takes the file:
    ///
    ///     /ABCD123/ABCD123_21_09_2026_11-30-24_AQI.csv
    ///
    /// The site name, then the renamed file. Nothing else.
    ///
    /// It used to carry the folder the CSV was taken from as well, because the
    /// intake read the company and the source path out of the upload path. It
    /// does not any more — the file name carries the company and the moment,
    /// and poll1 builds the tree from that — so the source folder was doing no
    /// work and was actively harmful: an architect exporting to a network
    /// share sent
    ///
    ///     /ABCD123/192.168.1.100/common/karthik/…
    ///
    /// which is a path on nobody's server. A local folder is a fact about the
    /// architect's PC and has no business in a remote path.
    /// </summary>
    public static string For(string siteName, string fileName)
    {
        var company = siteName.Trim().Trim('/');
        var name = FileNameOnly(fileName);

        var parts = new[] { company, name }.Where(p => p.Length > 0);
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
    public static string IntoFolder(
        string remoteDirectory,
        string siteName,
        DateTimeOffset at,
        string? latitude = null,
        string? longitude = null) =>
        Join(remoteDirectory, AqiFileName(siteName, at, latitude, longitude));

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
