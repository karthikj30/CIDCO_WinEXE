using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>A fresh SQLite file per test, thrown away afterwards.</summary>
public sealed class TempDatabase : IDisposable
{
    public string Folder { get; }
    public Database Db { get; }

    public TempDatabase()
    {
        Folder = Path.Combine(Path.GetTempPath(), "cidco-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Folder);
        Db = new Database(Path.Combine(Folder, "agent.db"));
    }

    public void Dispose()
    {
        Db.Dispose();
        try { Directory.Delete(Folder, recursive: true); } catch (IOException) { }
    }
}

public class DatabaseTests : IClassFixture<TempDatabase>
{
    private readonly TempDatabase _temp;
    public DatabaseTests(TempDatabase temp) => _temp = temp;

    [Fact]
    public void It_creates_the_file_and_the_tables()
    {
        Assert.True(File.Exists(_temp.Db.Path));
        Assert.Null(_temp.Db.GetSetting("nothing-here"));
    }

    [Fact]
    public void A_setting_round_trips()
    {
        _temp.Db.SetSetting("colour", "violet");
        Assert.Equal("violet", _temp.Db.GetSetting("colour"));
    }

    [Fact]
    public void Writing_a_setting_twice_replaces_it_rather_than_failing()
    {
        _temp.Db.SetSetting("port", "2222");
        _temp.Db.SetSetting("port", "2200");
        Assert.Equal("2200", _temp.Db.GetSetting("port"));
    }
}

public class DatabaseLifecycleTests
{
    private static string NewFolder()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cidco-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        return folder;
    }

    [Fact]
    public void A_fresh_machine_reads_as_not_installed()
    {
        var folder = NewFolder();
        using var db = new Database(Path.Combine(folder, "agent.db"));
        Assert.False(db.IsInstalled());
        Assert.Equal(Schedule.DefaultSeconds, Settings.Load(db).IntervalSeconds);
    }

    [Fact]
    public void What_the_installer_chose_survives_a_restart()
    {
        var folder = NewFolder();
        var path = Path.Combine(folder, "agent.db");

        using (var db = new Database(path))
        {
            new Settings
            {
                Role = "architect",
                CsvFolder = @"C:\CIDCO\exports",
                IntervalSeconds = Schedule.SecondsFor("Every 30 minutes"),
                DesignatedIp = "10.0.0.9",
                Port = 2222,
                Username = "cidco@example.com",
                SiteName = "ABCD123",
                InstalledAt = DateTimeOffset.Now.ToString("o"),
            }.Save(db);
        }

        using (var db = new Database(path))
        {
            Assert.True(db.IsInstalled());
            var again = Settings.Load(db);
            Assert.Equal(@"C:\CIDCO\exports", again.CsvFolder);
            Assert.Equal(1800, again.IntervalSeconds);
            Assert.Equal("ABCD123", again.SiteName);
            Assert.Equal("10.0.0.9", again.DesignatedIp);
            Assert.Equal("architect", again.Role);
        }
    }

    [Fact]
    public void The_password_never_reaches_the_database()
    {
        var folder = NewFolder();
        var path = Path.Combine(folder, "agent.db");

        using (var db = new Database(path))
        {
            new Settings { Username = "cidco@example.com", Password = "123456" }.Save(db);
        }

        // Read the raw file: the password must not be anywhere in it.
        var bytes = File.ReadAllBytes(path);
        var text = System.Text.Encoding.UTF8.GetString(bytes);
        Assert.DoesNotContain("123456", text);

        using (var db = new Database(path))
        {
            Assert.Equal("", Settings.Load(db).Password);
        }
    }

    [Fact]
    public void It_creates_the_folder_it_is_pointed_at()
    {
        var nested = Path.Combine(NewFolder(), "deeper", "still");
        using var db = new Database(Path.Combine(nested, "agent.db"));
        Assert.True(Directory.Exists(nested));
    }

    [Fact]
    public void The_default_path_follows_CIDCO_AGENT_HOME()
    {
        var home = NewFolder();
        var previous = Environment.GetEnvironmentVariable("CIDCO_AGENT_HOME");
        try
        {
            Environment.SetEnvironmentVariable("CIDCO_AGENT_HOME", home);
            Assert.Equal(Path.Combine(home, "agent.db"), Database.DefaultPath());
        }
        finally
        {
            Environment.SetEnvironmentVariable("CIDCO_AGENT_HOME", previous);
        }
    }
}

public class TransferHistoryTests
{
    private static Database NewDb()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cidco-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        return new Database(Path.Combine(folder, "agent.db"));
    }

    [Fact]
    public void An_empty_history_reads_as_empty()
    {
        using var db = NewDb();
        Assert.Empty(db.RecentTransfers());
        Assert.Equal((0, 0), db.TransferTally());
    }

    [Fact]
    public void Yesterdays_transfers_are_still_there_this_morning()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cidco-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "agent.db");

        using (var db = new Database(path))
        {
            db.RecordTransfer(new TransferRecord
            {
                FileName = "readings.csv",
                RemotePath = "/ABCD123/C:/CIDCO/exports/readings.csv",
                SizeBytes = 599,
                Accepted = true,
                Message = "readings.csv sent to CIDCO",
                SiteName = "ABCD123",
            });
        }

        // A brand new process, the next morning.
        using (var db = new Database(path))
        {
            var rows = db.RecentTransfers();
            Assert.Single(rows);
            Assert.Equal("readings.csv", rows[0].FileName);
            Assert.True(rows[0].Accepted);
            Assert.Equal(599, rows[0].SizeBytes);
            Assert.Equal("/ABCD123/C:/CIDCO/exports/readings.csv", rows[0].RemotePath);
        }
    }

    [Fact]
    public void The_newest_transfer_is_listed_first()
    {
        using var db = NewDb();
        foreach (var name in new[] { "first.csv", "second.csv", "third.csv" })
            db.RecordTransfer(new TransferRecord { FileName = name, Accepted = true, Message = "sent" });

        Assert.Equal(
            new[] { "third.csv", "second.csv", "first.csv" },
            db.RecentTransfers().Select(r => r.FileName));
    }

    [Fact]
    public void A_refusal_is_recorded_with_the_reason_CIDCO_gave()
    {
        using var db = NewDb();
        db.RecordTransfer(new TransferRecord
        {
            FileName = "readings.csv",
            Accepted = false,
            Message = "readings.csv — CIDCO refused the transfer (permission denied)",
        });

        var row = Assert.Single(db.RecentTransfers());
        Assert.False(row.Accepted);
        Assert.Contains("refused", row.Message);
        Assert.Equal((0, 1), db.TransferTally());
    }

    [Fact]
    public void The_tally_counts_both_sides()
    {
        using var db = NewDb();
        db.RecordTransfer(new TransferRecord { FileName = "a.csv", Accepted = true, Message = "sent" });
        db.RecordTransfer(new TransferRecord { FileName = "b.csv", Accepted = true, Message = "sent" });
        db.RecordTransfer(new TransferRecord { FileName = "c.csv", Accepted = false, Message = "refused" });
        Assert.Equal((2, 1), db.TransferTally());
    }

    [Fact]
    public void The_history_is_capped_by_the_limit_it_is_asked_for()
    {
        using var db = NewDb();
        for (var i = 0; i < 10; i++)
            db.RecordTransfer(new TransferRecord { FileName = $"{i}.csv", Accepted = true, Message = "sent" });

        Assert.Equal(3, db.RecentTransfers(limit: 3).Count);
        Assert.Equal(10, db.RecentTransfers().Count);
    }
}

/// <summary>
/// The Result column in the CIDCO pane. An outage is not CIDCO refusing
/// anything, and labelling it that way sends the architect looking in the
/// wrong place.
/// </summary>
public class TransferLabelTests
{
    private static Database NewDb()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cidco-label-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        return new Database(Path.Combine(folder, "agent.db"));
    }

    [Theory]
    [InlineData(TransferOutcome.Sent, "Accepted")]
    [InlineData(TransferOutcome.Unreachable, "No answer")]
    [InlineData(TransferOutcome.BadCredentials, "Login refused")]
    [InlineData(TransferOutcome.RefusedByCidco, "Refused")]
    [InlineData(TransferOutcome.NothingToSend, "Nothing to send")]
    public void Each_outcome_reads_as_what_actually_happened(TransferOutcome outcome, string expected) =>
        Assert.Equal(expected, new TransferRecord { Outcome = outcome }.ResultLabel);

    [Fact]
    public void An_outage_is_not_recorded_as_CIDCO_refusing_it()
    {
        using var db = NewDb();
        db.RecordTransfer(new TransferRecord
        {
            FileName = "readings.csv",
            Accepted = false,
            Message = "Nothing is listening on 1.2.3.4:2222.",
            Outcome = TransferOutcome.Unreachable,
        });

        var row = Assert.Single(db.RecentTransfers());
        Assert.Equal(TransferOutcome.Unreachable, row.Outcome);
        Assert.Equal("No answer", row.ResultLabel);
        Assert.NotEqual("Refused", row.ResultLabel);
    }

    [Fact]
    public void The_outcome_survives_a_restart()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cidco-label-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "agent.db");

        using (var db = new Database(path))
        {
            db.RecordTransfer(new TransferRecord { FileName = "a.csv", Accepted = false, Outcome = TransferOutcome.Unreachable });
            db.RecordTransfer(new TransferRecord { FileName = "b.csv", Accepted = true, Outcome = TransferOutcome.Sent });
        }

        using (var db = new Database(path))
        {
            var rows = db.RecentTransfers();
            Assert.Equal("Accepted", rows[0].ResultLabel);
            Assert.Equal("No answer", rows[1].ResultLabel);
        }
    }

    [Fact]
    public void A_database_written_before_outcomes_existed_still_opens()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cidco-old-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "agent.db");

        // A table in the shape the first release created, with no outcome column.
        using (var old = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={path}"))
        {
            old.Open();
            using var make = old.CreateCommand();
            make.CommandText = """
                CREATE TABLE transfers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_name TEXT NOT NULL, remote_path TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL,
                    message TEXT NOT NULL, company_id TEXT NOT NULL DEFAULT '',
                    sent_at TEXT NOT NULL);
                INSERT INTO transfers (file_name, remote_path, accepted, message, sent_at)
                VALUES ('old.csv', '/ABCD123/x/old.csv', 0, 'refused', '2026-09-01T00:00:00+00:00');
                """;
            make.ExecuteNonQuery();
        }

        // Opening it must upgrade rather than throw, and keep what was there.
        using var db = new Database(path);
        var row = Assert.Single(db.RecentTransfers());
        Assert.Equal("old.csv", row.FileName);
        Assert.False(row.Accepted);
    }
}
