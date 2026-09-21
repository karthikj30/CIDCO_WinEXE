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
                // Two exports written in the same clock tick would otherwise
                // be ordered by whatever the filesystem happened to return,
                // so the agent could send a different one each run with
                // nothing having changed. The name settles it.
                .ThenByDescending(f => f.Name, StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault();
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>
    /// What makes one version of an export distinct: its name, the moment it
    /// was last written, and its length.
    ///
    /// Used to tell a genuinely new reading from the same file sitting there
    /// untouched. Name alone is not enough — an export that overwrites
    /// "readings.csv" every time keeps the name and changes everything else —
    /// and the write time alone is not either, because a file can be rewritten
    /// within the same second.
    /// </summary>
    public static string Fingerprint(FileInfo file) =>
        $"{file.Name}|{file.LastWriteTimeUtc.Ticks}|{file.Length}";

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
                .ThenByDescending(f => f.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        catch (Exception)
        {
            return Array.Empty<FileInfo>();
        }
    }
}
