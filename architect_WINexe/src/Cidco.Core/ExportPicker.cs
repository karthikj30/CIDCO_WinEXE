namespace Cidco.Core;

/// <summary>Choosing which file to send out of the architect's export folder.</summary>
public static class ExportPicker
{
    /// <summary>
    /// The most recently written .csv in the export folder, or null
    /// if there is nothing to send. An export that overwrites the same file
    /// every time works exactly as well as one that writes a new name.
    /// </summary>
    public static FileInfo? Newest(string folder)
    {
        if (string.IsNullOrWhiteSpace(folder)) return null;

        DirectoryInfo directory;
        try
        {
            directory = new DirectoryInfo(folder);
            if (!directory.Exists) return null;
        }
        catch (Exception)
        {
            // An unreachable drive or a malformed path is "nothing to send",
            // not a crash — the agent runs unattended.
            return null;
        }

        try
        {
            return directory.EnumerateFiles()
                .Where(f => AqiCsv.IsAccepted(f.Name))
                .OrderByDescending(f => f.LastWriteTimeUtc)
                .FirstOrDefault();
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>Everything sendable in the folder, newest first, for the local pane.</summary>
    public static IReadOnlyList<FileInfo> List(string folder)
    {
        if (string.IsNullOrWhiteSpace(folder)) return Array.Empty<FileInfo>();
        try
        {
            var directory = new DirectoryInfo(folder);
            if (!directory.Exists) return Array.Empty<FileInfo>();
            return directory.EnumerateFiles()
                .Where(f => AqiCsv.IsAccepted(f.Name))
                .OrderByDescending(f => f.LastWriteTimeUtc)
                .ToList();
        }
        catch (Exception)
        {
            return Array.Empty<FileInfo>();
        }
    }
}
