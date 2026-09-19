namespace Cidco.Core;

/// <summary>
/// Where a file is written on CIDCO's side.
///
/// The agent signs in with the one CIDCO username and password, so the upload
/// path is what tells CIDCO which company is sending:
///
///     /&lt;companyId&gt;/&lt;the folder the CSV was taken from&gt;/&lt;file&gt;.csv
///
/// CIDCO validates all three — company id, the address it arrived from, and
/// that folder — against the company it registered, before storing a reading.
/// This mirrors the server's own rule so the two cannot disagree.
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
    /// "C:/CIDCO/exports" + "readings.csv" becomes
    /// "/ABCD123/C:/CIDCO/exports/readings.csv".
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
    /// Where a reading is filed on the receiving server:
    ///
    ///     &lt;base&gt;/&lt;companyId&gt;/&lt;year-month&gt;/&lt;date&gt;/&lt;file&gt;
    ///     /home/ubuntu/SFTP/ABCD123/2026-09-September/2026-09-19/readings_2026-09-19_13-28-49.csv
    ///
    /// The month folder is spelled the way CIDCO's own data table spells it, so
    /// a tree built here and a tree built there read the same.
    ///
    /// The time goes in the file name rather than the folder. The agent sends
    /// on a schedule — every few seconds while someone is testing — and a
    /// plain "readings.csv" in a per-day folder would mean each send silently
    /// destroying the one before it. Losing compliance data quietly is worse
    /// than a longer name.
    /// </summary>
    public static string DatedTree(string baseDirectory, string companyId, string fileName, DateTimeOffset at)
    {
        var company = companyId.Trim().Trim('/');
        var month = at.ToString("yyyy-MM-MMMM", System.Globalization.CultureInfo.InvariantCulture);
        var date = at.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

        var folder = Join(baseDirectory, "").TrimEnd('/');
        var parts = new[] { folder, company, month, date }.Where(p => p.Length > 0 && p != "/");

        return string.Join("/", parts).TrimEnd('/') + "/" + Stamped(fileName, at);
    }

    /// <summary>"readings.csv" at 13:28:49 becomes "readings_2026-09-19_13-28-49.csv".</summary>
    public static string Stamped(string fileName, DateTimeOffset at)
    {
        var name = FileNameOnly(fileName);
        var dot = name.LastIndexOf('.');
        var stem = dot < 0 ? name : name[..dot];
        var extension = dot < 0 ? "" : name[dot..];
        var when = at.ToString("yyyy-MM-dd_HH-mm-ss", System.Globalization.CultureInfo.InvariantCulture);
        return $"{stem}_{when}{extension}";
    }

    /// <summary>Every folder in a path, outermost first, for creating them in turn.</summary>
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
