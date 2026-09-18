using System.Runtime.Versioning;
using Cidco.Core;
using Cidco.Ui;

namespace Cidco.Agent;

/// <summary>
/// One executable, two faces.
///
/// The architect downloads a single file. Run before it has been installed, it
/// shows the setup wizard; run afterwards — from the Start Menu or the desktop
/// shortcut — it shows the transfer window. Windows calls it back with
/// --uninstall from Apps &amp; features.
/// </summary>
[SupportedOSPlatform("windows")]
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        if (HasFlag(args, "--uninstall")) return Uninstall();

        try
        {
            using var db = Database.Open();

            // --setup re-runs the wizard on an already-installed PC, so the
            // export folder or the schedule can be changed without reinstalling.
            var install = HasFlag(args, "--setup") || !db.IsInstalled();

            if (install) Application.Run(new SetupWizard());
            else Application.Run(new AgentWindow(db));

            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(
                $"The agent could not start.\n\n{error.Message}",
                "CIDCO AQI Agent",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }

    private static bool HasFlag(string[] args, string flag) =>
        args.Any(a => a.Equals(flag, StringComparison.OrdinalIgnoreCase)
                      || a.Equals(flag.TrimStart('-'), StringComparison.OrdinalIgnoreCase));

    /// <summary>Removes the shortcuts, the Run entry and the Apps &amp; features listing.</summary>
    private static int Uninstall()
    {
        var answer = MessageBox.Show(
            "Remove the CIDCO AQI Agent from this PC?\n\n" +
            "Your export folder and its CSV files are not touched.",
            "CIDCO AQI Agent",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question);

        if (answer != DialogResult.Yes) return 1;

        var keepHistory = MessageBox.Show(
            "Keep the record of what has already been sent?\n\n" +
            "Choose No to delete the agent's local database as well.",
            "CIDCO AQI Agent",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question) == DialogResult.Yes;

        var dataFolder = Path.GetDirectoryName(Database.DefaultPath());
        WindowsIntegration.Remove(keepData: keepHistory, dataFolder: dataFolder);
        ScheduleSelfDelete();

        MessageBox.Show(
            "The CIDCO AQI Agent has been removed.",
            "CIDCO AQI Agent",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);
        return 0;
    }

    /// <summary>
    /// The exe running this sits inside the program folder, so it cannot delete
    /// itself. Hand that last step to a detached command that waits for us to
    /// exit first.
    /// </summary>
    private static void ScheduleSelfDelete()
    {
        try
        {
            var folder = Path.GetDirectoryName(Environment.ProcessPath);
            if (string.IsNullOrEmpty(folder)) return;

            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("cmd.exe",
                $"/c ping 127.0.0.1 -n 3 > nul & rmdir /s /q \"{folder}\"")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
            });
        }
        catch (Exception)
        {
            // Leaving the folder behind is untidy but harmless; everything that
            // makes the agent visible or run has already been removed.
        }
    }
}
