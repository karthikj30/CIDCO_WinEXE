using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

public class ScheduleTests
{
    [Fact]
    public void It_offers_every_interval_CIDCO_asked_for()
    {
        Assert.Equal(
            new[] { 5, 15, 30, 60, 300, 600, 900, 1200, 1800, 2700, 3600, 7200, 10800 },
            Schedule.Intervals.Select(i => i.Seconds));
    }

    [Fact]
    public void Labels_and_seconds_round_trip()
    {
        foreach (var (label, seconds) in Schedule.Intervals)
        {
            Assert.Equal(seconds, Schedule.SecondsFor(label));
            Assert.Equal(label, Schedule.LabelFor(seconds));
        }
    }

    [Fact]
    public void An_unknown_label_falls_back_to_the_default()
    {
        Assert.Equal(Schedule.DefaultSeconds, Schedule.SecondsFor("Every fortnight"));
        Assert.Equal(3 * 60 * 60, Schedule.DefaultSeconds);
    }

    [Theory]
    [InlineData(5, "5 seconds")]
    [InlineData(60, "1 minute")]
    [InlineData(1800, "30 minutes")]
    [InlineData(3600, "1 hour")]
    [InlineData(10800, "3 hours")]
    public void Describe_reads_naturally(int seconds, string expected) =>
        Assert.Equal(expected, Schedule.Describe(seconds));

    [Fact]
    public void The_installer_has_a_label_for_every_interval() =>
        Assert.Equal(Schedule.Intervals.Count, Schedule.Labels.Length);
}
