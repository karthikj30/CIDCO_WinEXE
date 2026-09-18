using System.Net;
using System.Net.Sockets;
using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// Finding CIDCO's intake when the architect gave only an address.
///
/// The live ones need a CIDCO server; set CIDCO_TEST_HOST to run them.
/// </summary>
public class IntakeDiscoveryTests
{
    private static string Host => Environment.GetEnvironmentVariable("CIDCO_TEST_HOST") ?? "";
    private static int Port =>
        int.TryParse(Environment.GetEnvironmentVariable("CIDCO_TEST_PORT"), out var p) ? p : 2222;
    private static bool Available => !string.IsNullOrWhiteSpace(Host);

    private static (CidcoSender, SendResult) Find(ServerAddress address) => CidcoSender.FindIntake(
        address,
        Environment.GetEnvironmentVariable("CIDCO_TEST_USER") ?? "cidco@example.com",
        Environment.GetEnvironmentVariable("CIDCO_TEST_PASSWORD") ?? "123456",
        "ABCD123",
        "/tmp",
        TimeSpan.FromSeconds(6));

    [SkippableFact]
    public void An_address_alone_finds_the_intake_on_the_standard_port()
    {
        Skip.IfNot(Available, "no CIDCO server configured");
        Skip.If(Port != ServerAddress.StandardPort, "server is not on the standard port");

        var (sender, result) = Find(new ServerAddress(Host, ServerAddress.StandardPort, false));

        Assert.True(result.Ok, result.Message);
        Assert.Equal(ServerAddress.StandardPort, sender.Port);

        // Found where it was expected, so there is nothing to announce.
        Assert.DoesNotContain("found on port", result.Message);
    }

    [SkippableFact]
    public void When_the_first_port_is_wrong_it_keeps_looking_and_says_where_it_landed()
    {
        Skip.IfNot(Available, "no CIDCO server configured");

        // A port with nothing on it, then the real one.
        var address = new ServerAddress(Host, ClosedPort(), false);
        Assert.False(address.PortWasGiven);

        var (sender, result) = CidcoSender.FindIntake(
            address, "cidco@example.com", "123456", "ABCD123", "/tmp", TimeSpan.FromSeconds(6));

        Assert.True(result.Ok, result.Message);
        Assert.Equal(ServerAddress.StandardPort, sender.Port);
        Assert.Contains($"found on port {ServerAddress.StandardPort}", result.Message);
    }

    [SkippableFact]
    public void A_port_the_architect_typed_is_not_second_guessed()
    {
        Skip.IfNot(Available, "no CIDCO server configured");

        // Explicitly wrong: the search must not quietly rescue it, or the
        // architect never learns their port is wrong.
        var address = new ServerAddress(Host, ClosedPort(), PortWasGiven: true);
        var (_, result) = CidcoSender.FindIntake(
            address, "cidco@example.com", "123456", "ABCD123", "/tmp", TimeSpan.FromSeconds(6));

        Assert.False(result.Ok);
        Assert.Contains("Nothing is listening", result.Message);
    }

    [SkippableFact]
    public void A_wrong_password_stops_the_search_rather_than_trying_the_next_port()
    {
        Skip.IfNot(Available, "no CIDCO server configured");
        Skip.If(Port != ServerAddress.StandardPort, "server is not on the standard port");

        var (sender, result) = CidcoSender.FindIntake(
            new ServerAddress(Host, ServerAddress.StandardPort, false),
            "cidco@example.com", "not-the-password", "ABCD123", "/tmp", TimeSpan.FromSeconds(6));

        Assert.False(result.Ok);
        Assert.Contains("refused that username and password", result.Message);

        // It stopped at the server that answered, rather than walking on.
        Assert.Equal(ServerAddress.StandardPort, sender.Port);
    }

    [Fact]
    public void When_nothing_answers_anywhere_it_reports_the_most_likely_port()
    {
        // No server at all: the message should be about the standard port, not
        // whichever long shot happened to be tried last.
        var address = new ServerAddress("127.0.0.1", ServerAddress.StandardPort, false);
        var ports = address.PortsToTry();
        Assert.Equal(ServerAddress.StandardPort, ports[0]);
        Assert.True(ports.Count > 1);
    }

    private static int ClosedPort()
    {
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return port;
    }
}
