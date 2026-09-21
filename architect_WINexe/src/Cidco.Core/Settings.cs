namespace Cidco.Core;

/// <summary>The setting names, so a typo cannot silently lose a value.</summary>
public static class SettingsKeys
{
    public const string Role = "role";
    public const string CsvFolder = "csv_folder";
    public const string IntervalSeconds = "interval_seconds";
    public const string DesignatedIp = "designated_ip";
    public const string Port = "port";
    public const string Username = "username";
    public const string CompanyId = "company_id";
    public const string InstalledAt = "installed_at";
    public const string InstallFolder = "install_folder";
    public const string PrivateKeyPath = "private_key_path";

    /// <summary>
    /// Identifies the export the last accepted automatic send was taken from,
    /// so an unchanged file is not sent again on the next tick.
    /// </summary>
    public const string LastSentExport = "last_sent_export";
}

/// <summary>
/// Everything the installer collects, plus what the agent remembers between
/// runs. The password is deliberately not part of this: it lives on the
/// <see cref="Settings"/> instance for the running session and is never saved.
/// </summary>
public sealed class Settings
{
    public string Role { get; set; } = "architect";

    /// <summary>The folder the architect's AQI export lands in.</summary>
    public string CsvFolder { get; set; } = "";

    public int IntervalSeconds { get; set; } = Schedule.DefaultSeconds;

    // --- connection, filled in on the agent's first run -------------------
    public string DesignatedIp { get; set; } = "";
    public int Port { get; set; } = 2222;
    public string Username { get; set; } = "";
    public string CompanyId { get; set; } = "";

    /// <summary>
    /// The private key to sign in with, when the server will not take a
    /// password — which is most cloud servers. Only the path is kept; the key
    /// itself stays where it is, and its passphrase is never stored.
    /// </summary>
    public string PrivateKeyPath { get; set; } = "";

    public string InstalledAt { get; set; } = "";
    public string InstallFolder { get; set; } = "";

    /// <summary>Kept for this session only. Never written to the database.</summary>
    public string Password { get; set; } = "";

    /// <summary>What CIDCO publishes, so the fields start out filled in.</summary>
    public static class Defaults
    {
        public const string DesignatedIp = "127.0.0.1";
        public const int Port = 2222;
        public const string Username = "cidco@example.com";
        public const string CompanyId = "ABCD123";
    }

    public static Settings Load(Database db)
    {
        var settings = new Settings
        {
            Role = db.GetSetting(SettingsKeys.Role) ?? "architect",
            CsvFolder = db.GetSetting(SettingsKeys.CsvFolder) ?? "",
            DesignatedIp = db.GetSetting(SettingsKeys.DesignatedIp) ?? "",
            Username = db.GetSetting(SettingsKeys.Username) ?? "",
            CompanyId = db.GetSetting(SettingsKeys.CompanyId) ?? "",
            InstalledAt = db.GetSetting(SettingsKeys.InstalledAt) ?? "",
            InstallFolder = db.GetSetting(SettingsKeys.InstallFolder) ?? "",
            PrivateKeyPath = db.GetSetting(SettingsKeys.PrivateKeyPath) ?? "",
        };

        settings.IntervalSeconds = int.TryParse(db.GetSetting(SettingsKeys.IntervalSeconds), out var every)
            ? every
            : Schedule.DefaultSeconds;
        settings.Port = int.TryParse(db.GetSetting(SettingsKeys.Port), out var port) ? port : Defaults.Port;
        return settings;
    }

    public void Save(Database db)
    {
        db.SetSetting(SettingsKeys.Role, Role);
        db.SetSetting(SettingsKeys.CsvFolder, CsvFolder);
        db.SetSetting(SettingsKeys.IntervalSeconds, IntervalSeconds.ToString());
        db.SetSetting(SettingsKeys.DesignatedIp, DesignatedIp);
        db.SetSetting(SettingsKeys.Port, Port.ToString());
        db.SetSetting(SettingsKeys.Username, Username);
        db.SetSetting(SettingsKeys.CompanyId, CompanyId);
        db.SetSetting(SettingsKeys.InstallFolder, InstallFolder);
        db.SetSetting(SettingsKeys.PrivateKeyPath, PrivateKeyPath);
        if (!string.IsNullOrEmpty(InstalledAt)) db.SetSetting(SettingsKeys.InstalledAt, InstalledAt);
    }

    /// <summary>The value to show in a field, falling back to what CIDCO published.</summary>
    public string IpOrDefault => string.IsNullOrWhiteSpace(DesignatedIp) ? Defaults.DesignatedIp : DesignatedIp;
    public string UsernameOrDefault => string.IsNullOrWhiteSpace(Username) ? Defaults.Username : Username;
    public string CompanyIdOrDefault => string.IsNullOrWhiteSpace(CompanyId) ? Defaults.CompanyId : CompanyId;
    public int PortOrDefault => Port <= 0 ? Defaults.Port : Port;
}
