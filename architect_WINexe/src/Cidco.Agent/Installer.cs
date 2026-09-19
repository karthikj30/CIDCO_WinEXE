using System.Runtime.Versioning;
using Cidco.Core;
using Cidco.Ui;

namespace Cidco.Agent;

/// <summary>
/// The install itself: unpack the agent, put it somewhere sensible, give the
/// architect a way to start it, and tell Windows it is there so it turns up in
/// Apps &amp; features like any other program.
///
/// Everything lands under the user's own profile, so no administrator prompt is
/// needed — an architect on a locked-down site PC can still install it.
/// </summary>
[SupportedOSPlatform("windows")]
internal static class Installer
{
    public static string DefaultInstallFolder() => WindowsIntegration.DefaultInstallFolder();

    public sealed record Options
    {
        public string InstallFolder { get; init; } = "";
        public bool DesktopShortcut { get; init; } = true;
        public bool StartMenuShortcut { get; init; } = true;
        public bool RunAtLogin { get; init; }
    }

    /// <summary>Writes the program to disk and returns the path it can be run from.</summary>
    public static string Install(Options options, Settings settings, IProgress<string>? progress = null)
    {
        var folder = string.IsNullOrWhiteSpace(options.InstallFolder)
            ? DefaultInstallFolder()
            : options.InstallFolder;

        progress?.Report("Creating the program folder…");
        Directory.CreateDirectory(folder);

        progress?.Report("Copying the agent…");
        var exePath = Path.Combine(folder, WindowsIntegration.AgentExeName);
        InstallSelf(exePath);

        progress?.Report("Setting up the database…");
        settings.InstallFolder = folder;
        settings.InstalledAt = DateTimeOffset.Now.ToString("o");
        using (var db = Database.Open())
        {
            settings.Save(db);
        }

        progress?.Report("Creating shortcuts…");
        if (options.StartMenuShortcut)
            WindowsIntegration.TryCreateShortcut(WindowsIntegration.StartMenuShortcut(), exePath, folder);
        if (options.DesktopShortcut)
            WindowsIntegration.TryCreateShortcut(WindowsIntegration.DesktopShortcut(), exePath, folder);

        progress?.Report("Registering with Windows…");
        WindowsIntegration.Register(folder, exePath);
        WindowsIntegration.SetRunAtLogin(options.RunAtLogin, exePath);

        progress?.Report("Finishing up…");
        return exePath;
    }

    /// <summary>
    /// Copies this exe into the program folder. The downloaded file is both the
    /// installer and the agent, so there is nothing else to unpack — which is
    /// also why the architect only ever downloads one file.
    /// </summary>
    private static void InstallSelf(string exePath)
    {
        var source = Environment.ProcessPath
                     ?? throw new InvalidOperationException("Could not work out where this installer is running from.");

        if (string.Equals(Path.GetFullPath(source), Path.GetFullPath(exePath), StringComparison.OrdinalIgnoreCase))
            return; // already running from the install folder — a repair, not a copy

        // Windows will not overwrite a file that is in use, but it will let us
        // rename it out of the way first.
        if (File.Exists(exePath))
        {
            var stale = exePath + ".old";
            try
            {
                if (File.Exists(stale)) File.Delete(stale);
                File.Move(exePath, stale);
            }
            catch (IOException)
            {
                // Nothing held it after all, or it is genuinely locked — the
                // copy below will report the real problem.
            }
        }

        File.Copy(source, exePath, overwrite: true);
    }
}
