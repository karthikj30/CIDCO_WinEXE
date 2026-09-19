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

    /// <summary>The last segment, whichever slash the caller used.</summary>
    private static string FileNameOnly(string fileName)
    {
        var flattened = fileName.Replace('\\', '/');
        var cut = flattened.LastIndexOf('/');
        return cut < 0 ? flattened : flattened[(cut + 1)..];
    }
}
