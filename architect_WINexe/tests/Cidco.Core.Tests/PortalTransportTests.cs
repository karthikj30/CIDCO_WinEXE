using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// Choosing between CIDCO's two doors. The architect writes which one; the
/// agent never infers it from whatever happens to answer, because a program
/// that silently changed protocol would be impossible to reason about the
/// first time it surprised somebody.
/// </summary>
public class TransportChoiceTests
{
    private static ServerAddress Parse(string text)
    {
        Assert.True(ServerAddress.TryParse(text, out var address, out var problem), problem);
        return address;
    }

    [Fact]
    public void A_bare_address_still_means_the_SFTP_intake()
    {
        var address = Parse("13.207.123.12");
        Assert.Equal(Transport.Sftp, address.Transport);
        Assert.False(address.IsPortal);
        Assert.Equal(2222, address.Port);
    }

    [Fact]
    public void An_http_address_means_the_web_portal()
    {
        var address = Parse("http://13.207.123.12:8010");
        Assert.True(address.IsPortal);
        Assert.Equal("13.207.123.12", address.Host);
        Assert.Equal(8010, address.Port);
        Assert.False(address.Secure);
    }

    [Fact]
    public void An_https_address_means_the_portal_over_TLS()
    {
        var address = Parse("https://cidco.example.gov.in");
        Assert.True(address.IsPortal);
        Assert.True(address.Secure);
        Assert.Equal(443, address.Port);       // the web default, not CIDCO's SFTP one
    }

    [Fact]
    public void A_plain_http_address_defaults_to_the_web_port_not_the_SFTP_one() =>
        Assert.Equal(80, Parse("http://13.207.123.12").Port);

    [Fact]
    public void An_sftp_scheme_is_still_the_intake()
    {
        var address = Parse("sftp://13.207.123.12");
        Assert.Equal(Transport.Sftp, address.Transport);
        Assert.Equal(2222, address.Port);
    }

    [Fact]
    public void The_portal_base_carries_the_scheme_host_and_port()
    {
        Assert.Equal("http://13.207.123.12:8010/", Parse("http://13.207.123.12:8010").PortalBase().ToString());
        Assert.Equal("https://cidco.example.gov.in/", Parse("https://cidco.example.gov.in").PortalBase().ToString());
    }

    [Fact]
    public void A_portal_address_is_never_searched_for_on_other_ports()
    {
        // It was named outright, scheme and all. There is nothing to look for.
        Assert.Equal(new[] { 8010 }, Parse("http://13.207.123.12:8010").PortsToTry());
    }

    [Fact]
    public void A_pasted_portal_URL_with_a_path_still_reads_as_the_host()
    {
        var address = Parse("http://13.207.123.12:8010/architect/sftp");
        Assert.True(address.IsPortal);
        Assert.Equal("13.207.123.12", address.Host);
        Assert.Equal(8010, address.Port);
    }
}

/// <summary>
/// The upload the portal door puts on the wire.
///
/// These pin the two things that made it fail silently the first time, both of
/// which are invisible from the outside: an unquoted field name, which strict
/// parsers read as no fields at all, and a quoted boundary, which trips some of
/// the same parsers.
/// </summary>
public class PortalUploadShapeTests
{
    private static PortalSender Sender(string baseUrl = "http://127.0.0.1:9") =>
        new(new Uri(baseUrl), "cidco@example.com", "123456", "ABCD123", "/tmp",
            TimeSpan.FromSeconds(2));

    [Fact]
    public void It_posts_to_the_channels_own_upload_endpoint() =>
        Assert.Equal("http://13.207.123.12:8010/api/architect/sftp/transfer",
            new PortalSender(new Uri("http://13.207.123.12:8010"), "u", "p", "ABCD123", "/tmp").UploadUri.ToString());

    [Fact]
    public void The_endpoint_is_the_one_the_browser_drag_and_drop_uses() =>
        Assert.Equal("/api/architect/sftp/transfer", PortalSender.UploadPath);

    [Fact]
    public void It_describes_itself_as_the_portal_so_the_status_line_says_so() =>
        Assert.Contains("web portal", Sender().Describe);

    [Fact]
    public void An_unreachable_portal_reads_as_worth_retrying()
    {
        // Nothing on port 9, so this fails fast without a real server.
        var result = Sender().CheckConnection();
        Assert.False(result.Ok);
        Assert.Equal(TransferOutcome.Unreachable, result.Outcome);
        Assert.True(result.WorthRetrying);
    }

    [Fact]
    public void An_empty_folder_is_nothing_to_send_rather_than_a_failure()
    {
        var empty = Path.Combine(Path.GetTempPath(), "cidco-portal-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(empty);

        var result = new PortalSender(new Uri("http://127.0.0.1:9"), "u", "p", "ABCD123", empty,
            TimeSpan.FromSeconds(2)).Send();

        Assert.Equal(TransferOutcome.NothingToSend, result.Outcome);
        Assert.False(result.WorthRetrying);
    }
}

/// <summary>
/// The portal door against a real CIDCO portal.
///
/// Skips unless one is configured, like the SFTP live tests:
///
///     CIDCO_TEST_PORTAL=http://127.0.0.1:3000 dotnet test
/// </summary>
public class LivePortalTests
{
    private static string Base => Environment.GetEnvironmentVariable("CIDCO_TEST_PORTAL") ?? "";
    private static bool Available => !string.IsNullOrWhiteSpace(Base);

    private static string User => Environment.GetEnvironmentVariable("CIDCO_TEST_USER") ?? "cidco@example.com";
    private static string Password => Environment.GetEnvironmentVariable("CIDCO_TEST_PASSWORD") ?? "123456";
    private static string Company => Environment.GetEnvironmentVariable("CIDCO_TEST_COMPANY") ?? "ABCD123";
    private static string RegisteredPath =>
        Environment.GetEnvironmentVariable("CIDCO_TEST_PATH") ?? "C:/CIDCO/exports";

    /// <summary>A real CSV on disk; the folder it claims to come from is the registered one.</summary>
    private static FileInfo Export()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cidco-portal-live-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "readings.csv");
        File.WriteAllText(path, string.Join("\n",
            AqiCsv.HeaderRow(),
            "CIDCO-KHR-012,STN-KHR-07,Aeroqual AQY-1,2026-09-18T06:00:00Z,176,78.3,152.9,41.2,12.7,0.9,48.6,33.4,62.1,noise,portal upload,2026-09-18T06:00:12Z") + "\n");
        return new FileInfo(path);
    }

    private static PortalSender Sender(string? password = null, string? company = null, string? folder = null)
    {
        Assert.True(ServerAddress.TryParse(Base, out var address, out var problem), problem);
        return new PortalSender(address.PortalBase(), User, password ?? Password,
            company ?? Company, folder ?? RegisteredPath, TimeSpan.FromSeconds(30));
    }

    [SkippableFact]
    public void The_portal_answers()
    {
        Skip.IfNot(Available, "no CIDCO portal configured");
        var result = Sender().CheckConnection();
        Assert.True(result.Ok, result.Message);
    }

    [SkippableFact]
    public void A_registered_company_gets_its_CSV_through_over_HTTP()
    {
        Skip.IfNot(Available, "no CIDCO portal configured");
        var result = Sender().Send(Export());

        Assert.True(result.Ok, result.Message);
        Assert.Equal("readings.csv", result.FileName);
        Assert.Equal(TransferOutcome.Sent, result.Outcome);
        // CIDCO's own words about what they stored.
        Assert.Contains("stored", result.Message);
    }

    [SkippableFact]
    public void The_shared_CIDCO_login_works_at_the_portal_door_too()
    {
        Skip.IfNot(Available, "no CIDCO portal configured");
        Skip.If(User != "cidco@example.com", "not using the shared login");

        // The whole point: one credential opens both doors.
        Assert.True(Sender().Send(Export()).Ok);
    }

    [SkippableFact]
    public void A_wrong_password_is_refused_and_not_retried()
    {
        Skip.IfNot(Available, "no CIDCO portal configured");
        var result = Sender(password: "definitely-wrong").Send(Export());

        Assert.False(result.Ok);
        Assert.Equal(TransferOutcome.BadCredentials, result.Outcome);
        Assert.False(result.WorthRetrying);
    }

    [SkippableFact]
    public void An_unregistered_company_is_turned_away()
    {
        Skip.IfNot(Available, "no CIDCO portal configured");
        var result = Sender(company: "NOPE999").Send(Export());

        Assert.False(result.Ok);
        Assert.Equal(TransferOutcome.RefusedByCidco, result.Outcome);
        Assert.False(result.WorthRetrying);
    }

    [SkippableFact]
    public void A_file_path_CIDCO_does_not_recognise_is_refused()
    {
        Skip.IfNot(Available, "no CIDCO portal configured");
        var result = Sender(folder: "/not/the/registered/path").Send(Export());

        Assert.False(result.Ok);
        Assert.Equal(TransferOutcome.RefusedByCidco, result.Outcome);
        Assert.Contains("refused", result.Message);
    }

    [SkippableFact]
    public void A_portal_send_writes_itself_into_the_local_history()
    {
        Skip.IfNot(Available, "no CIDCO portal configured");
        var folder = Path.Combine(Path.GetTempPath(), "cidco-portal-db-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);

        using var db = new Database(Path.Combine(folder, "agent.db"));
        var result = Sender().SendAndRecord(db, Export());

        Assert.True(result.Ok, result.Message);
        var row = Assert.Single(db.RecentTransfers());
        Assert.True(row.Accepted);
        Assert.Equal("Accepted", row.ResultLabel);
        Assert.Contains("/api/architect/sftp/transfer", row.RemotePath);
    }
}

/// <summary>
/// An address that cannot be used must be refused rather than half-accepted.
///
/// A saved address had its port appended a second time — "http://host:3000"
/// became "http://host:3000:3000" — which parsed into nonsense and then threw
/// when it was turned into a URL, stranding the window on "Connecting…" with
/// no way out. These pin the shapes that did it.
/// </summary>
public class MalformedAddressTests
{
    [Fact]
    public void A_doubled_port_does_not_quietly_become_a_host()
    {
        // Either it is refused outright, or it parses to something whose base
        // URL can actually be built. What it must not do is parse and then
        // throw when used.
        if (!ServerAddress.TryParse("http://127.0.0.1:3000:3000", out var address, out _)) return;

        var thrown = Record.Exception(() => address.PortalBase());
        Assert.True(thrown is null, $"parsed but could not be used: {thrown?.Message}");
    }

    [Theory]
    [InlineData("http://")]
    [InlineData("https://")]
    [InlineData("http:// ")]
    public void An_address_that_is_only_a_scheme_is_refused(string typed) =>
        Assert.False(ServerAddress.TryParse(typed, out _, out _));

    [Fact]
    public void Every_address_that_parses_can_be_turned_into_a_usable_base()
    {
        foreach (var typed in new[]
                 {
                     "13.207.123.12", "13.207.123.12:8010", "http://13.207.123.12:8010",
                     "https://cidco.example.gov.in", "sftp://13.207.123.12", "[::1]:2200",
                     "http://13.207.123.12:8010/architect/sftp", "cidco@example.com@13.207.123.12",
                 })
        {
            Assert.True(ServerAddress.TryParse(typed, out var address, out var problem), $"{typed}: {problem}");
            var thrown = Record.Exception(() => address.PortalBase());
            Assert.True(thrown is null, $"{typed} parsed but could not be used: {thrown?.Message}");
        }
    }
}
