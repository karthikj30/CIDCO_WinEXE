using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// Staying connected without anybody watching.
///
/// The agent sends unattended for months. What it does after a failure matters
/// more than what it does after a success, because nobody is there to notice.
/// </summary>
public class ConnectionStateTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 18, 12, 0, 0, TimeSpan.Zero);

    private static SendResult Sent() => new(true, "readings.csv sent to CIDCO");
    private static SendResult Failed(TransferOutcome outcome, string message = "nope") =>
        SendResult.Failed(message, outcome);

    [Fact]
    public void It_starts_out_not_connected()
    {
        var state = new ConnectionState();
        Assert.False(state.Healthy);
        Assert.Equal(0, state.ConsecutiveFailures);
        Assert.Null(state.NeedsAttention);
        Assert.True(state.ShouldTry(Now));
    }

    [Fact]
    public void A_send_that_worked_means_connected()
    {
        var state = new ConnectionState();
        state.Record(Sent(), Now);

        Assert.True(state.Healthy);
        Assert.False(state.NeedsReconnect);
        Assert.Null(state.RetryAt);
    }

    // --- losing the network -----------------------------------------------

    [Fact]
    public void Losing_CIDCO_marks_the_connection_down_and_schedules_a_retry()
    {
        var state = new ConnectionState();
        state.Record(Sent(), Now);
        state.Record(Failed(TransferOutcome.Unreachable), Now);

        Assert.False(state.Healthy);
        Assert.True(state.NeedsReconnect);
        Assert.Equal(1, state.ConsecutiveFailures);
        Assert.Equal(Now + TimeSpan.FromSeconds(5), state.RetryAt);
    }

    [Fact]
    public void It_waits_out_the_backoff_rather_than_hammering()
    {
        var state = new ConnectionState();
        state.Record(Failed(TransferOutcome.Unreachable), Now);

        Assert.False(state.ShouldTry(Now));
        Assert.False(state.ShouldTry(Now + TimeSpan.FromSeconds(4)));
        Assert.True(state.ShouldTry(Now + TimeSpan.FromSeconds(5)));
    }

    [Fact]
    public void The_wait_grows_with_each_failure_in_a_row()
    {
        var state = new ConnectionState();
        var waits = new List<TimeSpan>();

        for (var i = 0; i < 8; i++)
        {
            state.Record(Failed(TransferOutcome.Unreachable), Now);
            waits.Add(state.CurrentBackoff);
        }

        // Growing, then holding at the longest rather than growing forever.
        Assert.Equal(TimeSpan.FromSeconds(5), waits[0]);
        Assert.Equal(TimeSpan.FromSeconds(15), waits[1]);
        Assert.True(waits[^1] >= waits[3]);
        Assert.Equal(ConnectionState.Backoff[^1], waits[^1]);
        Assert.Equal(waits.OrderBy(w => w).ToList(), waits);   // never goes back down
    }

    [Fact]
    public void One_success_clears_the_whole_backoff()
    {
        var state = new ConnectionState();
        for (var i = 0; i < 5; i++) state.Record(Failed(TransferOutcome.Unreachable), Now);
        Assert.Equal(5, state.ConsecutiveFailures);

        state.Record(Sent(), Now);

        Assert.True(state.Healthy);
        Assert.Equal(0, state.ConsecutiveFailures);
        Assert.Null(state.RetryAt);
        Assert.True(state.ShouldTry(Now));
    }

    [Fact]
    public void A_server_that_comes_back_is_picked_up_again()
    {
        var state = new ConnectionState();
        state.Record(Sent(), Now);

        // CIDCO goes away for a while.
        var clock = Now;
        for (var i = 0; i < 3; i++)
        {
            state.Record(Failed(TransferOutcome.Unreachable), clock);
            clock += state.CurrentBackoff;
            Assert.True(state.ShouldTry(clock));
        }
        Assert.False(state.Healthy);

        // And comes back.
        state.Record(Sent(), clock);
        Assert.True(state.Healthy);
        Assert.False(state.NeedsReconnect);
    }

    // --- things retrying cannot fix ---------------------------------------

    [Fact]
    public void A_rejected_password_stops_the_agent_rather_than_locking_the_account()
    {
        var state = new ConnectionState();
        state.Record(Failed(TransferOutcome.BadCredentials, "That username and password were refused by CIDCO."), Now);

        Assert.True(state.Blocked);
        Assert.NotNull(state.NeedsAttention);
        Assert.False(state.ShouldTry(Now));
        Assert.False(state.ShouldTry(Now + TimeSpan.FromHours(6)));
        Assert.False(state.NeedsReconnect);   // a new password is needed, not a new connection
    }

    [Fact]
    public void A_refused_transfer_keeps_to_the_schedule_so_a_fix_at_CIDCO_is_noticed()
    {
        var state = new ConnectionState();
        state.Record(Failed(TransferOutcome.RefusedByCidco, "file path is not the registered path"), Now);

        // Flagged for a person...
        Assert.NotNull(state.NeedsAttention);

        // ...but not given up on: CIDCO can correct the registration from their
        // side, and an agent that stopped for good would never see it.
        Assert.False(state.Blocked);
        Assert.True(state.ShouldTry(Now));

        // The connection itself is fine — we reached them to be refused.
        Assert.True(state.Healthy);
    }

    [Fact]
    public void A_registration_fixed_at_CIDCO_is_picked_up_without_anyone_at_the_PC()
    {
        var state = new ConnectionState();
        for (var i = 0; i < 3; i++)
        {
            state.Record(Failed(TransferOutcome.RefusedByCidco, "path does not match"), Now);
            Assert.True(state.ShouldTry(Now));   // still trying on each tick
        }

        state.Record(Sent(), Now);
        Assert.Null(state.NeedsAttention);
        Assert.True(state.Healthy);
    }

    [Fact]
    public void A_refusal_does_not_read_as_a_healthy_connection_with_nothing_wrong()
    {
        var state = new ConnectionState();
        state.Record(Failed(TransferOutcome.RefusedByCidco, "path does not match"), Now);
        Assert.Contains("last transfer refused", state.Describe("ABCD123"));
    }

    [Fact]
    public void Fixing_it_and_succeeding_clears_the_attention()
    {
        var state = new ConnectionState();
        state.Record(Failed(TransferOutcome.BadCredentials), Now);
        Assert.NotNull(state.NeedsAttention);
        Assert.True(state.Blocked);

        state.Record(Sent(), Now);
        Assert.Null(state.NeedsAttention);
        Assert.False(state.Blocked);
        Assert.True(state.ShouldTry(Now));
    }

    // --- nothing to send is not a failure ---------------------------------

    [Fact]
    public void An_empty_export_folder_does_not_count_against_the_connection()
    {
        var state = new ConnectionState();
        state.Record(Sent(), Now);
        state.Record(Failed(TransferOutcome.NothingToSend, "No .csv found"), Now);

        Assert.Equal(0, state.ConsecutiveFailures);
        Assert.Null(state.NeedsAttention);
        Assert.True(state.ShouldTry(Now));
    }

    // --- what the architect sees ------------------------------------------

    [Fact]
    public void The_status_line_says_which_of_the_three_states_it_is_in()
    {
        var state = new ConnectionState();
        Assert.Equal("Not connected", state.Describe("ABCD123 → 1.2.3.4:2222"));

        state.Record(Sent(), Now);
        Assert.Contains("Connected", state.Describe("ABCD123 → 1.2.3.4:2222"));

        state.Record(Failed(TransferOutcome.Unreachable), Now);
        Assert.Contains("reconnecting", state.Describe("x"));

        state.Record(Failed(TransferOutcome.Unreachable), Now);
        Assert.Contains("attempt 2", state.Describe("x"));

        state.Record(Failed(TransferOutcome.BadCredentials), Now);
        Assert.Equal("Needs attention", state.Describe("x"));
        Assert.True(state.Blocked);
    }

    [Fact]
    public void The_status_says_how_long_until_the_next_try()
    {
        var state = new ConnectionState();
        for (var i = 0; i < 3; i++) state.Record(Failed(TransferOutcome.Unreachable), Now);

        var described = state.Describe("x");
        Assert.Contains("45s", described);
    }
}
