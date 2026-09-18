using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// The agent talking to a real CIDCO SFTP server.
///
/// These skip unless one is reachable, so the suite still runs on a machine
/// that has never seen CIDCO. To run them, start the server side and point the
/// agent at it:
///
///     CIDCO_TEST_HOST=127.0.0.1 CIDCO_TEST_PORT=2222 dotnet test
/// </summary>
public class LiveServerTests
{
    private static string Host => Environment.GetEnvironmentVariable("CIDCO_TEST_HOST") ?? "";
    private static int Port =>
        int.TryParse(Environment.GetEnvironmentVariable("CIDCO_TEST_PORT"), out var p) ? p : 2222;
    private static string User => Environment.GetEnvironmentVariable("CIDCO_TEST_USER") ?? "cidco@example.com";
    private static string Password => Environment.GetEnvironmentVariable("CIDCO_TEST_PASSWORD") ?? "123456";
    private static string Company => Environment.GetEnvironmentVariable("CIDCO_TEST_COMPANY") ?? "ABCD123";
    private static string RegisteredPath =>
        Environment.GetEnvironmentVariable("CIDCO_TEST_PATH") ?? "C:/CIDCO/exports";

    private static bool Available => !string.IsNullOrWhiteSpace(Host);

    /// <summary>A folder holding one valid AQI CSV.</summary>
    private static (string Folder, FileInfo File) Export()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cidco-live-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "readings.csv");
        File.WriteAllText(path, string.Join("\n",
            AqiCsv.HeaderRow(),
            "CIDCO-KHR-012,STN-KHR-07,Aeroqual AQY-1,2026-09-18T06:00:00Z,176,78.3,152.9,41.2,12.7,0.9,48.6,33.4,62.1,noise=61 dB,SFTP automatic upload,2026-09-18T06:00:12Z",
            "CIDCO-KHR-012,STN-KHR-07,Aeroqual AQY-1,2026-09-18T07:00:00Z,164,71.8,140.2,38.5,11.9,0.8,44.1,34.1,59.7,noise=58 dB,SFTP automatic upload,2026-09-18T07:00:11Z") + "\n");
        return (folder, new FileInfo(path));
    }

    private static CidcoSender Sender(string? password = null, string? company = null, string? folder = null) =>
        new(Host, Port, User, password ?? Password, company ?? Company, folder ?? RegisteredPath);

    [SkippableFact]
    public void The_published_credentials_connect()
    {
        Skip.IfNot(Available, "no CIDCO server configured");
        var result = Sender().CheckConnection();
        Assert.True(result.Ok, result.Message);
        Assert.Contains("Connected to CIDCO", result.Message);
    }

    [SkippableFact]
    public void A_wrong_password_is_refused()
    {
        Skip.IfNot(Available, "no CIDCO server configured");
        var result = Sender(password: "not-the-password").CheckConnection();
        Assert.False(result.Ok);
        Assert.Contains("refused by CIDCO", result.Message);
    }

    [SkippableFact]
    public void A_registered_company_gets_its_CSV_through()
    {
        Skip.IfNot(Available, "no CIDCO server configured");
        var (_, file) = Export();

        var result = Sender().Send(file);

        Assert.True(result.Ok, result.Message);
        Assert.Equal("readings.csv", result.FileName);
        Assert.Equal($"/{Company}/{RegisteredPath.TrimStart('/')}/readings.csv", result.Remote);
        Assert.True(result.SizeBytes > 0);
    }

    [SkippableFact]
    public void An_unregistered_company_is_turned_away()
    {
        Skip.IfNot(Available, "no CIDCO server configured");
        var (_, file) = Export();

        var result = Sender(company: "NOPE999").Send(file);

        Assert.False(result.Ok);
        Assert.Contains("refused the transfer", result.Message);
    }

    [SkippableFact]
    public void A_send_writes_itself_into_the_local_history()
    {
        Skip.IfNot(Available, "no CIDCO server configured");
        var (_, file) = Export();
        var folder = Path.Combine(Path.GetTempPath(), "cidco-live-db-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);

        using var db = new Database(Path.Combine(folder, "agent.db"));
        var result = Sender().SendAndRecord(db, file);

        Assert.True(result.Ok, result.Message);
        var row = Assert.Single(db.RecentTransfers());
        Assert.True(row.Accepted);
        Assert.Equal("readings.csv", row.FileName);
        Assert.Equal(Company, row.CompanyId);
        Assert.Equal(result.Remote, row.RemotePath);
        Assert.Equal((1, 0), db.TransferTally());
    }

    [SkippableFact]
    public void A_refusal_is_recorded_too_so_the_architect_can_see_it()
    {
        Skip.IfNot(Available, "no CIDCO server configured");
        var (_, file) = Export();
        var folder = Path.Combine(Path.GetTempPath(), "cidco-live-db-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);

        using var db = new Database(Path.Combine(folder, "agent.db"));
        var result = Sender(company: "NOPE999").SendAndRecord(db, file);

        Assert.False(result.Ok);
        var row = Assert.Single(db.RecentTransfers());
        Assert.False(row.Accepted);
        Assert.Contains("refused", row.Message);
        Assert.Equal((0, 1), db.TransferTally());
    }

    [SkippableFact]
    public void A_file_path_CIDCO_does_not_recognise_is_refused_on_the_wire()
    {
        Skip.IfNot(Available, "no CIDCO server configured");
        var (_, file) = Export();

        // The architect never sees CIDCO's dashboard, so a mismatch has to come
        // back as a failure rather than a quiet success.
        var result = Sender(folder: "/not/the/registered/path").Send(file);

        Assert.False(result.Ok);
        Assert.Contains("refused the transfer", result.Message);

        // A refusal still has to say which file, or the architect cannot tell
        // which export CIDCO turned away.
        Assert.Equal("readings.csv", result.FileName);
        Assert.NotEqual("", result.Remote);
    }

    [SkippableFact]
    public void A_refused_transfer_is_named_in_the_local_history()
    {
        Skip.IfNot(Available, "no CIDCO server configured");
        var (_, file) = Export();
        var folder = Path.Combine(Path.GetTempPath(), "cidco-live-db-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);

        using var db = new Database(Path.Combine(folder, "agent.db"));
        Sender(folder: "/not/the/registered/path").SendAndRecord(db, file);

        var row = Assert.Single(db.RecentTransfers());
        Assert.False(row.Accepted);
        Assert.Equal("readings.csv", row.FileName);   // not an em dash
    }

    [SkippableFact]
    public void The_newest_export_is_the_one_that_goes()
    {
        Skip.IfNot(Available, "no CIDCO server configured");
        var (folder, _) = Export();
        // An older file that must not be chosen.
        var stale = Path.Combine(folder, "old-readings.csv");
        File.WriteAllText(stale, AqiCsv.HeaderRow() + "\n");
        File.SetLastWriteTimeUtc(stale, DateTime.UtcNow.AddHours(-2));

        var result = new CidcoSender(Host, Port, User, Password, Company, RegisteredPath).Send(
            ExportPicker.Newest(folder));

        Assert.True(result.Ok, result.Message);
        Assert.Equal("readings.csv", result.FileName);
    }
}
