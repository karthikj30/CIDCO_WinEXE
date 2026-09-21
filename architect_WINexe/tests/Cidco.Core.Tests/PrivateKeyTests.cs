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

        // Filed under the dated tree the agent builds, beneath the folder
        // that was named.
        Assert.StartsWith($"{Dir}/ABCD123/", result.Remote);
        Assert.EndsWith(".csv", result.Remote);
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

/// <summary>
/// Limited write access: the agent checks that the named folder exists and
/// refuses to create one. Files are renamed to
/// companyId_dd_mm_yyyy_hh-mm-ss_AQI.csv.
/// </summary>
public class LivePathCheckTests
{
    private static string Host => Environment.GetEnvironmentVariable("CIDCO_TEST_HOST") ?? "";
    private static int? Port =>
        int.TryParse(Environment.GetEnvironmentVariable("CIDCO_TEST_PLAIN_PORT"), out var p) ? p : null;
    private static string User => Environment.GetEnvironmentVariable("CIDCO_TEST_PLAIN_USER") ?? "";
    private static string Key => Environment.GetEnvironmentVariable("CIDCO_TEST_KEY") ?? "";

    /// <summary>An existing base folder under the test account.</summary>
    private static string Base => Environment.GetEnvironmentVariable("CIDCO_TEST_TREE_BASE") ?? "";

    private static bool Available =>
        !string.IsNullOrWhiteSpace(Host) && Port is not null &&
        !string.IsNullOrWhiteSpace(User) && !string.IsNullOrWhiteSpace(Key) &&
        !string.IsNullOrWhiteSpace(Base);

    private static FileInfo Export()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cidco-tree-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "readings.csv");
        File.WriteAllText(path, AqiCsv.HeaderRow() + "\nCIDCO-KHR-012\n");
        return new FileInfo(path);
    }

    private static ICidcoTransport Connect(string baseDirectory)
    {
        Assert.True(ServerAddress.TryParse($"{Host}:{Port}{baseDirectory}", out var address, out var problem), problem);
        var (transport, connected) = CidcoTransports.Connect(
            address, User, "", "ABCD123", Path.GetTempPath(),
            TimeSpan.FromSeconds(12), privateKeyPath: Key);
        Assert.True(connected.Ok, connected.Message);
        return transport;
    }

    [SkippableFact]
    public void A_folder_that_does_not_exist_is_refused_not_created()
    {
        Skip.IfNot(Available, "no key-authenticated server configured");

        var fresh = $"{Base}/made-up-{Guid.NewGuid():N}";
        var result = Connect(fresh).Send(Export());

        Assert.False(result.Ok);
        Assert.Contains("does not exist", result.Message);
    }

    /// <summary>
    /// A folder that is there but will not take the file.
    ///
    /// Needs a folder the login can see and not write into:
    ///
    ///     CIDCO_TEST_READONLY_DIR=/home/sftptest/cidco/sftp1   (owned by root)
    /// </summary>
    [SkippableFact]
    public void A_folder_it_may_not_write_to_says_so_without_mentioning_CIDCO()
    {
        var readOnly = Environment.GetEnvironmentVariable("CIDCO_TEST_READONLY_DIR") ?? "";
        Skip.If(!Available || readOnly.Length == 0, "no read-only folder configured");

        var result = Connect(readOnly).Send(Export());

        Assert.False(result.Ok);

        // The existence check already passed, so the folder is not in question
        // and the message must not send the architect back to look at it.
        Assert.Contains("found " + readOnly, result.Message);
        Assert.Contains("permission denied", result.Message);
        Assert.DoesNotContain("Path does not exist", result.Message);

        // It is their own server. CIDCO has no part in it, and the advice that
        // belongs on CIDCO's intake would send them to the wrong people.
        Assert.DoesNotContain("CIDCO", result.Message);
        Assert.DoesNotContain("company id", result.Message);

        // Something to actually do.
        Assert.Contains("chown", result.Message);
        Assert.Contains(User, result.Message);
    }

    [SkippableFact]
    public void The_file_is_renamed_into_the_named_folder()
    {
        Skip.IfNot(Available, "no key-authenticated server configured");
        var now = DateTimeOffset.Now;
        var result = Connect(Base).Send(Export());

        Assert.True(result.Ok, result.Message);
        Assert.StartsWith(Base + "/", result.Remote);
        Assert.Contains("ABCD123_", result.Remote);
        // dd_mm_yyyy, the way CIDCO's poll1 reads it back.
        Assert.Contains($"_{now:dd_MM_yyyy}_", result.Remote);
        Assert.EndsWith("_AQI.csv", result.Remote);
        // A colon would be a reserved character in a Windows file name, and
        // the file has to be openable on both sides.
        Assert.DoesNotContain(":", result.Remote[(result.Remote.LastIndexOf('/') + 1)..]);
        // One flat name, dropped in the folder the architect named — the agent
        // does not build companyId/dd_mm_yyyy/ itself.
        Assert.Equal(Base, RemotePath.ParentOf(result.Remote));
    }

    [SkippableFact]
    public void Two_sends_in_a_row_both_survive()
    {
        Skip.IfNot(Available, "no key-authenticated server configured");
        var transport = Connect(Base);

        var first = transport.Send(Export());
        Thread.Sleep(1100);   // the stamp has second resolution
        var second = transport.Send(Export());

        Assert.True(first.Ok, first.Message);
        Assert.True(second.Ok, second.Message);
        Assert.NotEqual(first.Remote, second.Remote);
    }

    [SkippableFact]
    public void Sending_twice_into_an_existing_folder_is_fine()
    {
        Skip.IfNot(Available, "no key-authenticated server configured");

        Assert.True(Connect(Base).Send(Export()).Ok);
        Thread.Sleep(1100);
        Assert.True(Connect(Base).Send(Export()).Ok);
    }
}
