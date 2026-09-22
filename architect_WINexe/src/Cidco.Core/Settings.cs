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
    public const string SiteName = "site_name";
    public const string Latitude = "latitude";
    public const string Longitude = "longitude";

    /// <summary>
    /// What the site name was stored under before it was called a site name.
    /// Read on load so an agent installed under the old build keeps its value.
    /// </summary>
    public const string LegacySiteName = "company_id";
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
    public string SiteName { get; set; } = "";

    /// <summary>
    /// Station coordinates, set once during install and locked afterwards.
    /// Embedded in every uploaded file name alongside the existing stamp.
    /// </summary>
    public string Latitude { get; set; } = "";
    public string Longitude { get; set; } = "";

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
        public const string SiteName = "ABCD123";
        /// <summary>Navi Mumbai — pre-filled so the installer has a starting point.</summary>
        public const string Latitude = "19.0330";
        public const string Longitude = "73.0297";
    }

    public static Settings Load(Database db)
    {
        var settings = new Settings
        {
            Role = db.GetSetting(SettingsKeys.Role) ?? "architect",
            CsvFolder = db.GetSetting(SettingsKeys.CsvFolder) ?? "",
            DesignatedIp = db.GetSetting(SettingsKeys.DesignatedIp) ?? "",
            Username = db.GetSetting(SettingsKeys.Username) ?? "",
            SiteName = db.GetSetting(SettingsKeys.SiteName)
                ?? db.GetSetting(SettingsKeys.LegacySiteName) ?? "",
            Latitude = db.GetSetting(SettingsKeys.Latitude) ?? "",
            Longitude = db.GetSetting(SettingsKeys.Longitude) ?? "",
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
        db.SetSetting(SettingsKeys.SiteName, SiteName);
        db.SetSetting(SettingsKeys.Latitude, Latitude);
        db.SetSetting(SettingsKeys.Longitude, Longitude);
        db.SetSetting(SettingsKeys.InstallFolder, InstallFolder);
        db.SetSetting(SettingsKeys.PrivateKeyPath, PrivateKeyPath);
        if (!string.IsNullOrEmpty(InstalledAt)) db.SetSetting(SettingsKeys.InstalledAt, InstalledAt);
    }

    /// <summary>The value to show in a field, falling back to what CIDCO published.</summary>
    public string IpOrDefault => string.IsNullOrWhiteSpace(DesignatedIp) ? Defaults.DesignatedIp : DesignatedIp;
    public string UsernameOrDefault => string.IsNullOrWhiteSpace(Username) ? Defaults.Username : Username;
    public string SiteNameOrDefault => string.IsNullOrWhiteSpace(SiteName) ? Defaults.SiteName : SiteName;
    public string LatitudeOrDefault => string.IsNullOrWhiteSpace(Latitude) ? Defaults.Latitude : Latitude;
    public string LongitudeOrDefault => string.IsNullOrWhiteSpace(Longitude) ? Defaults.Longitude : Longitude;
    public int PortOrDefault => Port <= 0 ? Defaults.Port : Port;
}
