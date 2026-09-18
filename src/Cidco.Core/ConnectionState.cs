namespace Cidco.Core;

/// <summary>
/// Whether the agent currently believes it can reach CIDCO, and when it is
/// worth trying again if it cannot.
///
/// This exists because the agent is unattended. A site PC sending every three
/// hours will meet a rebooted server, a dropped VPN and a changed address, and
/// nobody will be watching to press Connect afterwards. Treating "connected"
/// as something latched on once is how an agent ends up quietly sending
/// nothing for a fortnight.
///
/// So the health is derived from what actually happened last, and a network
/// failure schedules its own retry, backing off so a server that is down for
/// the afternoon is not hammered every five seconds.
/// </summary>
public sealed class ConnectionState
{
    /// <summary>
    /// How long to wait after each consecutive failure. Quick at first,
    /// because most outages are a blip; then slower, because the ones that are
    /// not a blip tend to last.
    /// </summary>
    public static readonly IReadOnlyList<TimeSpan> Backoff = new[]
    {
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(15),
        TimeSpan.FromSeconds(45),
        TimeSpan.FromMinutes(2),
        TimeSpan.FromMinutes(5),
        TimeSpan.FromMinutes(15),
    };

    /// <summary>True while the last thing we tried worked.</summary>
    public bool Healthy { get; private set; }

    /// <summary>How many network failures in a row. Reset by any success.</summary>
    public int ConsecutiveFailures { get; private set; }

    /// <summary>
    /// Set when CIDCO has answered with something a person has to look at —
    /// a rejected password, or a transfer they refused.
    /// </summary>
    public string? NeedsAttention { get; private set; }

    /// <summary>
    /// Set only when carrying on would be wrong rather than merely useless.
    ///
    /// A rejected password is the case: it cannot come right without somebody
    /// typing a new one, and an agent re-presenting a bad credential every few
    /// minutes is how accounts get locked out. A refused transfer is not —
    /// that can be fixed from CIDCO's side by correcting the registration, and
    /// an agent that has given up for good would never notice.
    /// </summary>
    public bool Blocked { get; private set; }

    /// <summary>When the next attempt becomes worthwhile. Null means now.</summary>
    public DateTimeOffset? RetryAt { get; private set; }

    /// <summary>How long the agent will wait after the failures seen so far.</summary>
    public TimeSpan CurrentBackoff =>
        Backoff[Math.Min(Math.Max(ConsecutiveFailures - 1, 0), Backoff.Count - 1)];

    /// <summary>The connection is up and there is nothing outstanding.</summary>
    public void RecordSuccess()
    {
        Healthy = true;
        ConsecutiveFailures = 0;
        NeedsAttention = null;
        Blocked = false;
        RetryAt = null;
    }

    /// <summary>Files an attempt, and works out what should happen next.</summary>
    public void Record(SendResult result, DateTimeOffset now)
    {
        if (result.Ok)
        {
            RecordSuccess();
            return;
        }

        switch (result.Outcome)
        {
            case TransferOutcome.Unreachable:
                // The connection is what failed, so it is the connection that
                // needs re-establishing — after a wait that grows.
                Healthy = false;
                ConsecutiveFailures++;
                NeedsAttention = null;
                RetryAt = now + CurrentBackoff;
                break;

            case TransferOutcome.BadCredentials:
                // CIDCO answered, and said no. Carrying on would re-present a
                // rejected credential until the account is locked.
                Healthy = false;
                ConsecutiveFailures = 0;
                NeedsAttention = result.Message;
                Blocked = true;
                RetryAt = null;
                break;

            case TransferOutcome.RefusedByCidco:
                // We reached CIDCO, so the link is fine — the registration
                // does not match. That can be put right from their side, so
                // the agent keeps to its normal schedule instead of giving up:
                // an agent that stops for good would never see the fix.
                Healthy = true;
                ConsecutiveFailures = 0;
                NeedsAttention = result.Message;
                RetryAt = null;
                break;

            case TransferOutcome.NothingToSend:
                // Not a failure. The export simply is not there yet, and the
                // next tick will look again.
                ConsecutiveFailures = 0;
                NeedsAttention = null;
                RetryAt = null;
                break;
        }
    }

    /// <summary>
    /// Whether to try again now. False while waiting out a backoff, or while
    /// something is wrong that only a person can fix.
    /// </summary>
    public bool ShouldTry(DateTimeOffset now)
    {
        if (Blocked) return false;
        return RetryAt is null || now >= RetryAt;
    }

    /// <summary>Whether the connection wants re-establishing before the next send.</summary>
    public bool NeedsReconnect => !Healthy && !Blocked;

    /// <summary>The status line, in the architect's terms.</summary>
    public string Describe(string connectedTo)
    {
        if (Blocked) return "Needs attention";
        if (Healthy && NeedsAttention is not null)
            return $"Connected · {connectedTo} — last transfer refused";
        if (Healthy) return $"Connected · {connectedTo}";
        if (ConsecutiveFailures == 0) return "Not connected";

        return ConsecutiveFailures == 1
            ? "Lost CIDCO — reconnecting…"
            : $"Lost CIDCO — reconnecting (attempt {ConsecutiveFailures}, " +
              $"next in {Describe(CurrentBackoff)})";
    }

    private static string Describe(TimeSpan span) =>
        span.TotalSeconds < 60
            ? $"{(int)span.TotalSeconds}s"
            : $"{(int)span.TotalMinutes} min";
}
