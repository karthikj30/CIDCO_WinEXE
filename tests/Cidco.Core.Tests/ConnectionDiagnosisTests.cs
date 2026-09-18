using System.Net;
using System.Net.Sockets;
using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// What the architect is told when a connection fails.
///
/// These run against real sockets, because the whole point is to translate what
/// the network actually does into something someone can act on. SSH.NET's own
/// wording ("no valid SSH identification string was received") tells the person
/// at the keyboard nothing.
/// </summary>
public class ConnectionDiagnosisTests
{
    /// <summary>A socket that accepts a connection and closes it — what any non-SSH service looks like.</summary>
    private sealed class SilentListener : IDisposable
    {
        private readonly TcpListener _listener;
        private readonly CancellationTokenSource _stop = new();

        public int Port { get; }

        public SilentListener()
        {
            _listener = new TcpListener(IPAddress.Loopback, 0);
            _listener.Start();
            Port = ((IPEndPoint)_listener.LocalEndpoint).Port;

            _ = Task.Run(async () =>
            {
                while (!_stop.IsCancellationRequested)
                {
                    try
                    {
                        using var client = await _listener.AcceptTcpClientAsync(_stop.Token);
                        client.Close();
                    }
                    catch (Exception) { return; }
                }
            });
        }

        public void Dispose()
        {
            _stop.Cancel();
            _listener.Stop();
            _stop.Dispose();
        }
    }

    private static CidcoSender SenderFor(int port) =>
        new("127.0.0.1", port, "cidco@example.com", "123456", "ABCD123", "/tmp",
            timeout: TimeSpan.FromSeconds(5));

    private static int AClosedPort()
    {
        // Bind and release, so the port is almost certainly free.
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return port;
    }

    [Fact]
    public void A_port_with_something_that_is_not_SFTP_on_it_says_so()
    {
        using var listener = new SilentListener();
        var result = SenderFor(listener.Port).CheckConnection();

        Assert.False(result.Ok);
        Assert.Contains("not an SFTP server", result.Message);
        Assert.Contains(listener.Port.ToString(), result.Message);

        // The point is to stop surfacing SSH internals.
        Assert.DoesNotContain("identification string", result.Message);
    }

    [Fact]
    public void It_points_at_the_usual_cause_which_is_the_wrong_port()
    {
        using var listener = new SilentListener();
        var message = SenderFor(listener.Port).CheckConnection().Message;

        Assert.Contains("2222", message);       // the port it probably should be
        Assert.Contains("web portal", message); // what it probably is instead
    }

    [Fact]
    public void A_port_with_nothing_on_it_is_told_apart_from_one_with_something()
    {
        var result = SenderFor(AClosedPort()).CheckConnection();

        Assert.False(result.Ok);
        Assert.Contains("Nothing is listening", result.Message);
        Assert.DoesNotContain("not an SFTP server", result.Message);
    }

    [Fact]
    public void A_host_name_that_does_not_resolve_says_to_check_the_IP()
    {
        var sender = new CidcoSender(
            "not-a-real-host.invalid", 2222, "u", "p", "ABCD123", "/tmp",
            timeout: TimeSpan.FromSeconds(5));

        var result = sender.CheckConnection();

        Assert.False(result.Ok);
        Assert.Contains("could not be looked up", result.Message);
    }

    [Fact]
    public void A_failed_send_explains_itself_the_same_way_a_failed_connect_does()
    {
        using var listener = new SilentListener();
        var folder = Path.Combine(Path.GetTempPath(), "cidco-diag-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var file = Path.Combine(folder, "readings.csv");
        File.WriteAllText(file, AqiCsv.HeaderRow() + "\n");

        var result = SenderFor(listener.Port).Send(new FileInfo(file));

        Assert.False(result.Ok);
        Assert.Contains("not an SFTP server", result.Message);
    }
}

/// <summary>
/// A rejected login has to name the server that rejected it.
///
/// The agent picks the port itself, so without the endpoint an architect
/// cannot tell CIDCO's intake from a machine's own sshd — which rejects a
/// CIDCO user id in exactly the same words.
/// </summary>
public class RejectedLoginTests
{
    private static string MessageFrom(int port)
    {
        // Nothing is listening, so this never gets as far as a real login —
        // but the wording is built from the endpoint either way.
        var sender = new CidcoSender("198.51.100.7", port, "cidco@example.com", "123456",
            "ABCD123", "/tmp", TimeSpan.FromSeconds(2));
        return sender.CheckConnection().Message;
    }

    [SkippableFact]
    public void It_names_the_host_and_port_that_said_no()
    {
        var host = Environment.GetEnvironmentVariable("CIDCO_TEST_HOST");
        Skip.If(string.IsNullOrWhiteSpace(host), "no CIDCO server configured");

        var sender = new CidcoSender(host!, 2222, "cidco@example.com", "definitely-wrong",
            "ABCD123", "/tmp", TimeSpan.FromSeconds(6));
        var result = sender.CheckConnection();

        Assert.False(result.Ok);
        Assert.Equal(TransferOutcome.BadCredentials, result.Outcome);
        Assert.Contains($"{host}:2222", result.Message);
        Assert.Contains("refused that username and password", result.Message);
    }

    [SkippableFact]
    public void Port_22_carries_a_warning_that_it_may_not_be_CIDCO_at_all()
    {
        var host = Environment.GetEnvironmentVariable("CIDCO_TEST_HOST");
        Skip.If(string.IsNullOrWhiteSpace(host), "no CIDCO server configured");

        // The message for port 22 is built the same way wherever it is used.
        var sender = new CidcoSender(host!, 22, "cidco@example.com", "wrong",
            "ABCD123", "/tmp", TimeSpan.FromSeconds(3));
        var message = sender.CheckConnection().Message;

        // Either it could not reach anything there, or it was refused — but if
        // it was refused, it must warn about what port 22 usually is.
        if (message.Contains("refused that username and password"))
            Assert.Contains("machine's own SSH service", message);
    }
}
