using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// Which server refused the login.
///
/// "Refused that username and password" reads identically whether CIDCO turned
/// the credentials down or the agent reached some entirely different SSH
/// server — a machine's own sshd, most often, which has never heard of a CIDCO
/// user id and never will. Those two need opposite fixes, and telling them
/// apart by guesswork has cost more time here than anything else.
///
/// Every SSH server names itself before anyone authenticates, so the agent
/// knows which it reached even when the login is rejected. CIDCO's intake is
/// built on the ssh2 library and says so; OpenSSH says so too.
/// </summary>
public class ServerIdentityTests
{
    private static string Host => Environment.GetEnvironmentVariable("CIDCO_TEST_HOST") ?? "";
    private static int IntakePort =>
        int.TryParse(Environment.GetEnvironmentVariable("CIDCO_TEST_PORT"), out var p) ? p : 2222;

    /// <summary>A plain OpenSSH server to compare against, when one is running.</summary>
    private static int? OpenSshPort =>
        int.TryParse(Environment.GetEnvironmentVariable("CIDCO_TEST_OPENSSH_PORT"), out var p) ? p : null;

    private static CidcoSender Sender(int port, string password) =>
        new(Host, port, "cidco@example.com", password, "ABCD123", "/tmp", TimeSpan.FromSeconds(8));

    [SkippableFact]
    public void A_wrong_password_at_CIDCOs_intake_says_the_address_is_right()
    {
        Skip.If(string.IsNullOrWhiteSpace(Host), "no CIDCO server configured");

        var result = Sender(IntakePort, "definitely-not-the-password").CheckConnection();

        Assert.False(result.Ok);
        Assert.Equal(TransferOutcome.BadCredentials, result.Outcome);

        // The useful half: stop looking at the address, look at the credentials.
        Assert.Contains("CIDCO's intake", result.Message);
        Assert.Contains("address and port are right", result.Message);
    }

    [SkippableFact]
    public void The_intake_is_named_by_the_software_it_actually_runs()
    {
        Skip.If(string.IsNullOrWhiteSpace(Host), "no CIDCO server configured");

        var sender = Sender(IntakePort, "definitely-not-the-password");
        sender.CheckConnection();

        Assert.NotNull(sender.ServerSoftware);
        Assert.Contains("ssh2js", sender.ServerSoftware!, StringComparison.OrdinalIgnoreCase);
    }

    [SkippableFact]
    public void The_software_is_known_even_though_the_login_failed()
    {
        Skip.If(string.IsNullOrWhiteSpace(Host), "no CIDCO server configured");

        // The identification comes before authentication, which is the whole
        // reason this diagnosis is possible at all.
        var sender = Sender(IntakePort, "wrong");
        var result = sender.CheckConnection();

        Assert.False(result.Ok);
        Assert.False(string.IsNullOrWhiteSpace(sender.ServerSoftware));
    }

    [SkippableFact]
    public void A_machines_own_sshd_is_called_out_as_not_being_CIDCO()
    {
        Skip.If(string.IsNullOrWhiteSpace(Host), "no CIDCO server configured");
        Skip.If(OpenSshPort is null, "no OpenSSH server to compare against");

        var sender = Sender(OpenSshPort!.Value, "123456");
        var result = sender.CheckConnection();

        Assert.False(result.Ok);
        Assert.Equal(TransferOutcome.BadCredentials, result.Outcome);

        Assert.Contains("OpenSSH", sender.ServerSoftware!, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("not CIDCO's intake", result.Message);
        Assert.Contains("machine's own SSH service", result.Message);
        Assert.Contains("no password would work", result.Message);

        // And it must not claim the address is right, which is the opposite
        // advice and what the intake's own refusal says.
        Assert.DoesNotContain("address and port are right", result.Message);
    }

    [SkippableFact]
    public void The_two_refusals_do_not_read_the_same()
    {
        Skip.If(string.IsNullOrWhiteSpace(Host), "no CIDCO server configured");
        Skip.If(OpenSshPort is null, "no OpenSSH server to compare against");

        var atIntake = Sender(IntakePort, "wrong").CheckConnection().Message;
        var atSshd = Sender(OpenSshPort!.Value, "wrong").CheckConnection().Message;

        Assert.NotEqual(atIntake, atSshd);
    }

    [Fact]
    public void Nothing_is_claimed_about_a_server_that_was_never_reached()
    {
        // Port 9 discards everything, so no identification is ever exchanged.
        var sender = new CidcoSender("127.0.0.1", 9, "u", "p", "ABCD123", "/tmp", TimeSpan.FromSeconds(3));
        var result = sender.CheckConnection();

        Assert.False(result.Ok);
        Assert.Equal(TransferOutcome.Unreachable, result.Outcome);
        Assert.DoesNotContain("OpenSSH", result.Message);
        Assert.DoesNotContain("CIDCO's intake", result.Message);
    }
}
