using Microsoft.Data.Sqlite;

namespace Cidco.Core;

/// <summary>
/// The agent's local SQLite database.
///
/// It holds two things: what the installer chose, and every transfer the agent
/// has attempted. The second is why this is a database rather than a settings
/// file — the architect needs yesterday's failures to still be on screen this
/// morning, and CIDCO's own records are not visible from this side.
/// </summary>
public sealed class Database : IDisposable
{
    private readonly SqliteConnection _connection;

    public string Path { get; }

    public Database(string path)
    {
        Path = path;
        var folder = System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(path));
        if (!string.IsNullOrEmpty(folder)) Directory.CreateDirectory(folder);

        _connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
        }.ToString());
        _connection.Open();
        Migrate();
    }

    /// <summary>Where the database lives: %LOCALAPPDATA%\CIDCO-AQI-Agent\agent.db.</summary>
    public static string DefaultPath()
    {
        var overridden = Environment.GetEnvironmentVariable("CIDCO_AGENT_HOME");
        var home = !string.IsNullOrWhiteSpace(overridden)
            ? overridden
            : System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CIDCO-AQI-Agent");
        return System.IO.Path.Combine(home, "agent.db");
    }

    public static Database Open() => new(DefaultPath());

    private void Migrate()
    {
        Execute("PRAGMA journal_mode=WAL;");
        Execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """);
        Execute("""
            CREATE TABLE IF NOT EXISTS transfers (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                file_name   TEXT    NOT NULL,
                remote_path TEXT    NOT NULL,
                size_bytes  INTEGER NOT NULL DEFAULT 0,
                accepted    INTEGER NOT NULL,
                message     TEXT    NOT NULL,
                company_id  TEXT    NOT NULL DEFAULT '',
                sent_at     TEXT    NOT NULL
            );
            """);
        Execute("CREATE INDEX IF NOT EXISTS ix_transfers_sent_at ON transfers (sent_at DESC);");
    }

    private void Execute(string sql)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    // --- settings ---------------------------------------------------------

    public string? GetSetting(string key)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT value FROM settings WHERE key = $key;";
        command.Parameters.AddWithValue("$key", key);
        return command.ExecuteScalar() as string;
    }

    public void SetSetting(string key, string value)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = """
            INSERT INTO settings (key, value) VALUES ($key, $value)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value;
            """;
        command.Parameters.AddWithValue("$key", key);
        command.Parameters.AddWithValue("$value", value);
        command.ExecuteNonQuery();
    }

    /// <summary>True once the installer has written its choices.</summary>
    public bool IsInstalled() => GetSetting(SettingsKeys.InstalledAt) is not null;

    // --- transfer history -------------------------------------------------

    public long RecordTransfer(TransferRecord record)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = """
            INSERT INTO transfers (file_name, remote_path, size_bytes, accepted, message, company_id, sent_at)
            VALUES ($file, $remote, $size, $accepted, $message, $company, $sentAt);
            SELECT last_insert_rowid();
            """;
        command.Parameters.AddWithValue("$file", record.FileName);
        command.Parameters.AddWithValue("$remote", record.RemotePath);
        command.Parameters.AddWithValue("$size", record.SizeBytes);
        command.Parameters.AddWithValue("$accepted", record.Accepted ? 1 : 0);
        command.Parameters.AddWithValue("$message", record.Message);
        command.Parameters.AddWithValue("$company", record.CompanyId);
        command.Parameters.AddWithValue("$sentAt", record.SentAt.ToString("o"));
        return (long)(command.ExecuteScalar() ?? 0L);
    }

    /// <summary>The most recent transfers, newest first.</summary>
    public IReadOnlyList<TransferRecord> RecentTransfers(int limit = 200)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = """
            SELECT id, file_name, remote_path, size_bytes, accepted, message, company_id, sent_at
            FROM transfers ORDER BY id DESC LIMIT $limit;
            """;
        command.Parameters.AddWithValue("$limit", limit);

        var rows = new List<TransferRecord>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            rows.Add(new TransferRecord
            {
                Id = reader.GetInt64(0),
                FileName = reader.GetString(1),
                RemotePath = reader.GetString(2),
                SizeBytes = reader.GetInt64(3),
                Accepted = reader.GetInt64(4) != 0,
                Message = reader.GetString(5),
                CompanyId = reader.GetString(6),
                SentAt = DateTimeOffset.Parse(reader.GetString(7)),
            });
        }
        return rows;
    }

    /// <summary>How many transfers CIDCO took, and how many it turned away.</summary>
    public (int Accepted, int Refused) TransferTally()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = """
            SELECT COALESCE(SUM(accepted), 0), COALESCE(SUM(1 - accepted), 0) FROM transfers;
            """;
        using var reader = command.ExecuteReader();
        return reader.Read() ? ((int)reader.GetInt64(0), (int)reader.GetInt64(1)) : (0, 0);
    }

    public void Dispose() => _connection.Dispose();
}

/// <summary>One attempted transfer, as the agent recorded it.</summary>
public sealed class TransferRecord
{
    public long Id { get; init; }
    public string FileName { get; init; } = "";
    public string RemotePath { get; init; } = "";
    public long SizeBytes { get; init; }
    public bool Accepted { get; init; }
    public string Message { get; init; } = "";
    public string CompanyId { get; init; } = "";
    public DateTimeOffset SentAt { get; init; } = DateTimeOffset.Now;
}
