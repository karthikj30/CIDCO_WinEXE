using System.Runtime.Versioning;
using Microsoft.Win32;

namespace Cidco.Ui;

/// <summary>
/// The Windows housekeeping around the agent: shortcuts, the Run-at-login
/// entry, and the Apps &amp; features listing.
///
/// Shared by the installer, which creates all of it, and the agent, which
/// removes it again when Windows asks it to uninstall.
///
/// Everything is written under HKEY_CURRENT_USER and the user's own profile, so
/// an architect without administrator rights can still install and remove it.
/// </summary>
[SupportedOSPlatform("windows")]
internal static class WindowsIntegration
{
    public const string ProductName = "CIDCO AQI Agent";
    public const string AgentExeName = "CIDCO_AQI_Agent.exe";
    public const string Version = "1.0.0";

    private const string UninstallKey =
        @"Software\Microsoft\Windows\CurrentVersion\Uninstall\CIDCO-AQI-Agent";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValue = "CIDCO AQI Agent";

    /// <summary>%LOCALAPPDATA%\Programs\CIDCO AQI Agent — no admin rights needed.</summary>
    public static string DefaultInstallFolder() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs", ProductName);

    public static string StartMenuShortcut() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.Programs), ProductName + ".lnk");

    public static string DesktopShortcut() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), ProductName + ".lnk");

    /// <summary>
    /// Creates a .lnk through the Windows shell, late-bound so no COM interop
    /// assembly is needed at build time. A shortcut is a convenience, so a
    /// failure here is swallowed rather than failing the install.
    /// </summary>
    public static void TryCreateShortcut(string linkPath, string targetExe, string workingFolder)
    {
        try
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType is null) return;

            dynamic? shell = Activator.CreateInstance(shellType);
            if (shell is null) return;

            var parent = Path.GetDirectoryName(linkPath);
            if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);

            dynamic link = shell.CreateShortcut(linkPath);
            link.TargetPath = targetExe;
            link.WorkingDirectory = workingFolder;
            link.Description = "Send AQI readings to CIDCO";
            link.IconLocation = targetExe + ",0";
            link.Save();
        }
        catch (Exception)
        {
        }
    }

    /// <summary>Puts the agent in Apps &amp; features, with a working uninstaller.</summary>
    public static void Register(string folder, string exePath)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(UninstallKey);
            if (key is null) return;

            key.SetValue("DisplayName", ProductName);
            key.SetValue("DisplayVersion", Version);
            key.SetValue("Publisher", "CIDCO");
            key.SetValue("InstallLocation", folder);
            key.SetValue("DisplayIcon", exePath);
            key.SetValue("UninstallString", $"\"{exePath}\" --uninstall");
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
        }
        catch (Exception)
        {
            // Not being listed is cosmetic; the program still works.
        }
    }

    public static void SetRunAtLogin(bool enabled, string exePath)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
            if (key is null) return;

            if (enabled) key.SetValue(RunValue, $"\"{exePath}\"");
            else key.DeleteValue(RunValue, throwOnMissingValue: false);
        }
        catch (Exception)
        {
        }
    }

    public static bool RunsAtLogin()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(RunValue) is not null;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>
    /// Undoes everything <see cref="Register"/> and the shortcuts did. The
    /// program folder itself is left for Windows to clean up, because the exe
    /// doing the uninstalling is inside it.
    /// </summary>
    public static void Remove(bool keepData, string? dataFolder)
    {
        try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, throwOnMissingSubKey: false); }
        catch (Exception) { }

        SetRunAtLogin(false, "");

        foreach (var link in new[] { StartMenuShortcut(), DesktopShortcut() })
        {
            try { if (File.Exists(link)) File.Delete(link); } catch (Exception) { }
        }

        if (!keepData && !string.IsNullOrEmpty(dataFolder))
        {
            try { if (Directory.Exists(dataFolder)) Directory.Delete(dataFolder, recursive: true); }
            catch (Exception) { }
        }
    }
}
