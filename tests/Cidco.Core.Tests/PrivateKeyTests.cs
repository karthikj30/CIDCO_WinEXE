using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// Signing in with a private key instead of a password.
///
/// Most cloud servers will not take a password at all. An AWS image ships with
/// PasswordAuthentication turned off and its default account has no password
/// set, so no password is the right password and the key pair is the only way
/// in — which reads, from the agent, exactly like bad credentials.
/// </summary>
public class PrivateKeySettingsTests
{
    private static Database NewDb()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cidco-key-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        return new Database(Path.Combine(folder, "agent.db"));
    }

    [Fact]
    public void No_key_means_the_password_is_used()
    {
        var sender = new CidcoSender("h", 22, "u", "p", "ABCD123", "/tmp");
        Assert.False(sender.UsesPrivateKey);
    }

    [Fact]
    public void A_key_path_switches_it_to_key_authentication()
    {
        var sender = new CidcoSender("h", 22, "u", "", "ABCD123", "/tmp")
        {
            PrivateKeyPath = @"C:\keys\server.ppk",
        };
        Assert.True(sender.UsesPrivateKey);
    }

    [Fact]
    public void Whitespace_is_not_a_key_path()
    {
        var sender = new CidcoSender("h", 22, "u", "p", "ABCD123", "/tmp") { PrivateKeyPath = "   " };
        Assert.False(sender.UsesPrivateKey);
    }

    [Fact]
    public void The_key_path_survives_a_restart()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cidco-key-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "agent.db");

        using (var db = new Database(path))
            new Settings { PrivateKeyPath = @"C:\keys\cidco.ppk" }.Save(db);

        using (var db = new Database(path))
            Assert.Equal(@"C:\keys\cidco.ppk", Settings.Load(db).PrivateKeyPath);
    }

    [Fact]
    public void The_passphrase_is_never_written_down()
    {
        using var db = NewDb();
        // The password box holds the key's passphrase when a key is in use, and
        // it must stay out of the database exactly as a password does.
        new Settings { PrivateKeyPath = @"C:\keys\k.ppk", Password = "the-passphrase" }.Save(db);

        var raw = File.ReadAllText(db.Path);
        Assert.DoesNotContain("the-passphrase", raw);
        Assert.Equal("", Settings.Load(db).Password);
    }

    [Fact]
    public void A_key_that_is_not_there_is_reported_as_a_key_problem()
    {
        var sender = new CidcoSender("127.0.0.1", 9, "u", "", "ABCD123", "/tmp", TimeSpan.FromSeconds(3))
        {
            PrivateKeyPath = Path.Combine(Path.GetTempPath(), "definitely-missing-" + Guid.NewGuid() + ".ppk"),
        };

        var result = sender.CheckConnection();

        Assert.False(result.Ok);
        Assert.Contains("No private key at", result.Message);
        Assert.Contains("Check the private key path", result.Message);
    }

    [Fact]
    public void A_file_that_is_not_a_key_says_which_formats_work()
    {
        var notAKey = Path.Combine(Path.GetTempPath(), "notakey-" + Guid.NewGuid().ToString("N") + ".ppk");
        File.WriteAllText(notAKey, "this is not a private key at all\n");

        var sender = new CidcoSender("127.0.0.1", 9, "u", "", "ABCD123", "/tmp", TimeSpan.FromSeconds(3))
        {
            PrivateKeyPath = notAKey,
        };

        var result = sender.CheckConnection();

        Assert.False(result.Ok);
        Assert.Contains("could not be read", result.Message);
        Assert.Contains(".ppk", result.Message);
        Assert.Contains(".pem", result.Message);
    }
}

/// <summary>
/// Key authentication against a real server that refuses passwords — the same
/// shape as a stock cloud image.
///
///     CIDCO_TEST_KEY=/path/to/key.ppk dotnet test
/// </summary>
public class LivePrivateKeyTests
{
    private static string Host => Environment.GetEnvironmentVariable("CIDCO_TEST_HOST") ?? "";
    private static int? Port =>
        int.TryParse(Environment.GetEnvironmentVariable("CIDCO_TEST_PLAIN_PORT"), out var p) ? p : null;
    private static string User => Environment.GetEnvironmentVariable("CIDCO_TEST_PLAIN_USER") ?? "";
    private static string Dir => Environment.GetEnvironmentVariable("CIDCO_TEST_PLAIN_DIR") ?? "";
    private static string Key => Environment.GetEnvironmentVariable("CIDCO_TEST_KEY") ?? "";
    private static string OpenSshKey => Environment.GetEnvironmentVariable("CIDCO_TEST_KEY_PEM") ?? "";

    private static bool Available =>
        !string.IsNullOrWhiteSpace(Host) && Port is not null &&
        !string.IsNullOrWhiteSpace(User) && !string.IsNullOrWhiteSpace(Dir) &&
        !string.IsNullOrWhiteSpace(Key);

    private static FileInfo Export()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cidco-key-live-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "readings.csv");
        File.WriteAllText(path, AqiCsv.HeaderRow() + "\nCIDCO-KHR-012\n");
        return new FileInfo(path);
    }

    private static CidcoSender Sender(string key, string password = "") =>
        new(Host, Port!.Value, User, password, "ABCD123", Path.GetTempPath(), TimeSpan.FromSeconds(10))
        {
            RemoteDirectory = Dir,
            PrivateKeyPath = key,
        };

    [SkippableFact]
    public void A_PuTTY_ppk_key_signs_in()
    {
        Skip.IfNot(Available, "no key-authenticated server configured");
        var result = Sender(Key).CheckConnection();
        Assert.True(result.Ok, result.Message);
    }

    [SkippableFact]
    public void An_OpenSSH_pem_key_signs_in_too()
    {
        Skip.IfNot(Available, "no key-authenticated server configured");
        Skip.If(string.IsNullOrWhiteSpace(OpenSshKey), "no OpenSSH-format key configured");

        var result = Sender(OpenSshKey).CheckConnection();
        Assert.True(result.Ok, result.Message);
    }

    [SkippableFact]
    public void The_file_lands_when_signed_in_by_key()
    {
        Skip.IfNot(Available, "no key-authenticated server configured");
        var result = Sender(Key).Send(Export());

        Assert.True(result.Ok, result.Message);
        Assert.Equal($"{Dir}/readings.csv", result.Remote);
    }

    [SkippableFact]
    public void The_password_alone_gets_nowhere_on_such_a_server()
    {
        Skip.IfNot(Available, "no key-authenticated server configured");

        // The whole reason the key field exists: this is what an architect
        // sees on a cloud server before they have one.
        var noKey = new CidcoSender(Host, Port!.Value, User, "any-password-at-all", "ABCD123",
            Path.GetTempPath(), TimeSpan.FromSeconds(10))
        { RemoteDirectory = Dir };

        var result = noKey.CheckConnection();

        Assert.False(result.Ok);
        Assert.Equal(TransferOutcome.BadCredentials, result.Outcome);
    }

    [SkippableFact]
    public void A_key_works_through_the_transport_factory_as_well()
    {
        Skip.IfNot(Available, "no key-authenticated server configured");

        var typed = $"{Host}:{Port}{Dir}";
        Assert.True(ServerAddress.TryParse(typed, out var address, out var problem), problem);

        var (transport, connected) = CidcoTransports.Connect(
            address, User, "", "ABCD123", Path.GetTempPath(),
            TimeSpan.FromSeconds(10), privateKeyPath: Key);

        Assert.True(connected.Ok, connected.Message);
        Assert.True(transport.Send(Export()).Ok);
    }
}
