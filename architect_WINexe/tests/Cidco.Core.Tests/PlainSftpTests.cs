using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// Pointing the agent at an ordinary SFTP server.
///
/// Name a folder in the address and the file goes straight there, with that
/// server's own login — the agent behaving like any SFTP client. It is how you
/// prove the transfer works before CIDCO's side exists, and it is deliberately
/// not a compliance submission: no company is checked, nothing is filed, and
/// every message says so, because a green line that looked like a real
/// submission would be worse than a red one.
/// </summary>
public class PlainSftpAddressTests
{
    private static ServerAddress Parse(string text)
    {
        Assert.True(ServerAddress.TryParse(text, out var address, out var problem), problem);
        return address;
    }

    [Fact]
    public void A_folder_in_the_address_makes_it_a_plain_server()
    {
        var address = Parse("13.207.123.12:22/home/ubuntu/uploads");

        Assert.True(address.IsPlainSftp);
        Assert.Equal("13.207.123.12", address.Host);
        Assert.Equal(22, address.Port);
        Assert.Equal("/home/ubuntu/uploads", address.RemoteDirectory);
    }

    [Fact]
    public void Without_a_folder_it_is_still_CIDCOs_intake()
    {
        var address = Parse("13.207.123.12:22");

        Assert.False(address.IsPlainSftp);
        Assert.Equal("", address.RemoteDirectory);
    }

    [Fact]
    public void A_folder_works_on_the_default_port_too() =>
        Assert.True(Parse("13.207.123.12/srv/incoming").IsPlainSftp);

    [Fact]
    public void An_sftp_scheme_with_a_folder_is_understood()
    {
        var address = Parse("sftp://13.207.123.12:22/home/ubuntu/uploads");
        Assert.True(address.IsPlainSftp);
        Assert.Equal("/home/ubuntu/uploads", address.RemoteDirectory);
    }

    [Fact]
    public void A_portal_address_keeps_no_folder()
    {
        // The portal's upload path is fixed, so a path pasted with it is the
        // page it was copied from, not a destination.
        var address = Parse("http://13.207.123.12:8010/architect/sftp");
        Assert.True(address.IsPortal);
        Assert.False(address.IsPlainSftp);
        Assert.Equal("", address.RemoteDirectory);
    }

    [Fact]
    public void A_plain_address_is_never_searched_for_on_other_ports() =>
        Assert.Equal(new[] { 22 }, Parse("13.207.123.12:22/home/ubuntu/uploads").PortsToTry());

    // --- where the file lands ---------------------------------------------

    [Fact]
    public void The_file_goes_into_the_named_folder_with_no_company_prefix() =>
        Assert.Equal("/home/ubuntu/uploads/readings.csv",
            RemotePath.Join("/home/ubuntu/uploads", "readings.csv"));

    [Fact]
    public void A_trailing_slash_does_not_double_up() =>
        Assert.Equal("/srv/incoming/readings.csv", RemotePath.Join("/srv/incoming/", "readings.csv"));

    [Fact]
    public void The_root_of_the_server_is_a_legal_destination() =>
        Assert.Equal("/readings.csv", RemotePath.Join("/", "readings.csv"));

    [Fact]
    public void Only_the_file_name_is_used() =>
        Assert.Equal("/uploads/readings.csv",
            RemotePath.Join("/uploads", @"C:\CIDCO\exports\readings.csv"));

    [Fact]
    public void It_is_nothing_like_the_CIDCO_layout()
    {
        // The two must not be confusable: CIDCO's is scoped to the company, a
        // plain upload goes into the folder the architect named and nowhere else.
        var plain = RemotePath.Join("/home/ubuntu/uploads", "readings.csv");
        var cidco = RemotePath.For("ABCD123", "readings.csv");

        Assert.DoesNotContain("ABCD123", plain);
        Assert.Contains("ABCD123", cidco);
        Assert.NotEqual(plain, cidco);
    }
}

/// <summary>
/// A real upload to a real, ordinary SFTP server — no CIDCO involved.
///
/// Needs a plain SSH server and a login on it:
///
///     CIDCO_TEST_PLAIN_PORT=2022 CIDCO_TEST_PLAIN_USER=sftptest \
///     CIDCO_TEST_PLAIN_PASSWORD=... CIDCO_TEST_PLAIN_DIR=/home/sftptest/uploads dotnet test
/// </summary>
public class LivePlainSftpTests
{
    private static string Host => Environment.GetEnvironmentVariable("CIDCO_TEST_HOST") ?? "";
    private static int? Port =>
        int.TryParse(Environment.GetEnvironmentVariable("CIDCO_TEST_PLAIN_PORT"), out var p) ? p : null;
    private static string User => Environment.GetEnvironmentVariable("CIDCO_TEST_PLAIN_USER") ?? "";
    private static string Password => Environment.GetEnvironmentVariable("CIDCO_TEST_PLAIN_PASSWORD") ?? "";
    private static string Dir => Environment.GetEnvironmentVariable("CIDCO_TEST_PLAIN_DIR") ?? "";

    /// <summary>
    /// These sign in with a password, so they need a server that takes one.
    /// A key-only server — the shape of most cloud images — is covered by
    /// LivePrivateKeyTests instead.
    /// </summary>
    private static bool Available =>
        !string.IsNullOrWhiteSpace(Host) && Port is not null &&
        !string.IsNullOrWhiteSpace(User) && !string.IsNullOrWhiteSpace(Dir) &&
        !string.IsNullOrWhiteSpace(Password);

    private static FileInfo Export()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cidco-plain-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "readings.csv");
        File.WriteAllText(path, AqiCsv.HeaderRow() + "\nCIDCO-KHR-012\n");
        return new FileInfo(path);
    }

    private static (ICidcoTransport Transport, SendResult Connected) Connect(string? password = null)
    {
        var typed = $"{Host}:{Port}{Dir}";
        Assert.True(ServerAddress.TryParse(typed, out var address, out var problem), problem);
        Assert.True(address.IsPlainSftp);

        return CidcoTransports.Connect(address, User, password ?? Password, "ABCD123",
            Path.GetTempPath(), TimeSpan.FromSeconds(10));
    }

    [SkippableFact]
    public void It_connects_with_that_servers_own_login()
    {
        Skip.IfNot(Available, "no plain SFTP server configured");
        var (_, connected) = Connect();
        Assert.True(connected.Ok, connected.Message);
    }

    [SkippableFact]
    public void The_file_actually_lands_in_the_named_folder()
    {
        Skip.IfNot(Available, "no plain SFTP server configured");
        var (transport, connected) = Connect();
        Assert.True(connected.Ok, connected.Message);

        var result = transport.Send(Export());

        Assert.True(result.Ok, result.Message);
        Assert.EndsWith("_AQI.csv", result.FileName);
        Assert.Equal($"{Dir}/{result.FileName}", result.Remote);
    }

    [SkippableFact]
    public void Nothing_about_it_claims_to_be_a_CIDCO_submission()
    {
        Skip.IfNot(Available, "no plain SFTP server configured");
        var (transport, connected) = Connect();

        // The connect, the status line and the send must all say so. A green
        // line that read like a real submission would be worse than a red one.
        Assert.Contains("not CIDCO", connected.Message);
        Assert.Contains("plain SFTP", transport.Describe);

        var result = transport.Send(Export());
        Assert.True(result.Ok, result.Message);
        Assert.Contains("CIDCO has not validated or stored anything", result.Message);
    }

    [SkippableFact]
    public void A_wrong_login_talks_about_that_server_not_about_CIDCOs_ports()
    {
        Skip.IfNot(Available, "no plain SFTP server configured");
        var (_, connected) = Connect(password: "definitely-not-the-password");

        Assert.False(connected.Ok);
        Assert.Equal(TransferOutcome.BadCredentials, connected.Outcome);
        Assert.Contains(User, connected.Message);
        Assert.Contains("that machine's own login", connected.Message);

        // The advice for CIDCO's intake would be actively wrong here.
        Assert.DoesNotContain("Ask CIDCO which port", connected.Message);
    }

    [SkippableFact]
    public void A_folder_that_is_not_there_says_what_to_check()
    {
        Skip.IfNot(Available, "no plain SFTP server configured");
        var typed = $"{Host}:{Port}/no/such/folder/here";
        Assert.True(ServerAddress.TryParse(typed, out var address, out _));

        var (transport, _) = CidcoTransports.Connect(address, User, Password, "ABCD123",
            Path.GetTempPath(), TimeSpan.FromSeconds(10));
        var result = transport.Send(Export());

        Assert.False(result.Ok);
        Assert.Contains("would not take the file", result.Message);
        Assert.Contains("may write to it", result.Message);
    }
}

/// <summary>
/// The address survives a connection.
///
/// After connecting, the agent writes back what it settled on so the next run
/// starts from it. That rewrite dropped the folder, which silently turned a
/// plain SFTP destination back into a CIDCO one — the sort of change nobody
/// would notice until data went somewhere unexpected.
/// </summary>
public class AddressRoundTripTests
{
    private static ServerAddress Parse(string text)
    {
        Assert.True(ServerAddress.TryParse(text, out var address, out var problem), problem);
        return address;
    }

    [Theory]
    [InlineData("13.207.123.12:22/home/ubuntu/uploads")]
    [InlineData("13.207.123.12/srv/incoming")]
    [InlineData("sftp://13.207.123.12:22/home/ubuntu/uploads")]
    public void A_plain_address_reparses_to_the_same_thing(string typed)
    {
        var first = Parse(typed);
        Assert.True(first.IsPlainSftp);

        // What the agent would store and read back next time.
        var stored = $"{first.Host}:{first.Port}{first.RemoteDirectory}";
        var again = Parse(stored);

        Assert.True(again.IsPlainSftp, $"\"{stored}\" stopped being a plain SFTP address");
        Assert.Equal(first.Host, again.Host);
        Assert.Equal(first.Port, again.Port);
        Assert.Equal(first.RemoteDirectory, again.RemoteDirectory);
    }

    [Fact]
    public void A_CIDCO_address_still_reparses_as_CIDCO()
    {
        var again = Parse("13.207.123.12:2222");
        Assert.False(again.IsPlainSftp);
        Assert.Equal("", again.RemoteDirectory);
    }
}
