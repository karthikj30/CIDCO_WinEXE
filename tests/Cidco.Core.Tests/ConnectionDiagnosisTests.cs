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
