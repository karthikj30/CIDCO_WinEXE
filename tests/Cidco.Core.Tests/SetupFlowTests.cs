using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// The wizard's decisions, without a window. The bug this guards against is
/// real: an earlier build compared steps in a way that was never equal, so the
/// folder check never ran and Install did nothing at all.
/// </summary>
public class SetupFlowTests
{
    /// <summary>Stands in for the file system, so the tests need no real folders.</summary>
    private static Func<string, bool> FolderExists(params string[] present) =>
        path => present.Contains(path);

    [Fact]
    public void It_opens_on_the_role_question()
    {
        var flow = new SetupFlow();
        Assert.Equal(SetupStep.Role, flow.Current);
        Assert.False(flow.CanGoBack);
        Assert.Equal("architect", flow.Role);
    }

    [Fact]
    public void The_architect_branch_asks_folder_then_schedule_then_installs() =>
        Assert.Equal(
            new[] { SetupStep.Role, SetupStep.Folder, SetupStep.Schedule, SetupStep.Install },
            new SetupFlow().Steps);

    [Fact]
    public void The_administrator_branch_installs_nothing()
    {
        var flow = new SetupFlow { Role = "admin" };
        Assert.Equal(new[] { SetupStep.Role, SetupStep.Admin }, flow.Steps);
        Assert.True(flow.IsAdmin);
    }

    [Fact]
    public void Switching_to_administrator_from_a_later_step_does_not_fall_off_the_end()
    {
        var flow = new SetupFlow { CsvFolder = @"C:\exports" };
        flow.TryAdvance(FolderExists(@"C:\exports"));
        flow.TryAdvance(FolderExists(@"C:\exports"));
        Assert.Equal(SetupStep.Schedule, flow.Current);

        flow.Role = "admin";
        Assert.Equal(SetupStep.Admin, flow.Current); // clamped, not out of range
    }

    [Fact]
    public void An_empty_folder_stops_the_wizard_with_a_reason()
    {
        var flow = new SetupFlow();
        flow.TryAdvance(FolderExists());
        Assert.Equal(SetupStep.Folder, flow.Current);

        Assert.False(flow.TryAdvance(FolderExists()));
        Assert.Equal(SetupStep.Folder, flow.Current);
        Assert.Contains("Choose the folder", flow.Status);
    }

    [Fact]
    public void A_folder_that_is_not_there_stops_the_wizard_too()
    {
        var flow = new SetupFlow { CsvFolder = @"D:\not\here" };
        flow.TryAdvance(FolderExists());

        Assert.False(flow.TryAdvance(FolderExists(@"C:\exports")));
        Assert.Equal(SetupStep.Folder, flow.Current);
        Assert.Contains("does not exist", flow.Status);
    }

    [Fact]
    public void A_folder_that_is_there_lets_the_wizard_through()
    {
        var flow = new SetupFlow { CsvFolder = @"  C:\CIDCO\exports  " };
        flow.TryAdvance(FolderExists());

        Assert.True(flow.TryAdvance(FolderExists(@"C:\CIDCO\exports")));
        Assert.Equal(SetupStep.Schedule, flow.Current);
        Assert.Equal("", flow.Status);
        Assert.Equal(@"C:\CIDCO\exports", flow.CsvFolder); // trimmed on the way through
    }

    [Fact]
    public void Back_returns_to_the_previous_step_and_clears_the_complaint()
    {
        var flow = new SetupFlow();
        flow.TryAdvance(FolderExists());
        Assert.False(flow.TryAdvance(FolderExists()));
        Assert.NotEqual("", flow.Status);

        flow.GoBack();
        Assert.Equal(SetupStep.Role, flow.Current);
        Assert.Equal("", flow.Status);
        Assert.False(flow.CanGoBack);
    }

    [Fact]
    public void The_button_says_what_the_step_does()
    {
        var flow = new SetupFlow { CsvFolder = @"C:\exports" };
        var exists = FolderExists(@"C:\exports");

        Assert.Equal("Next >", flow.NextButtonText);
        flow.TryAdvance(exists);
        Assert.Equal("Next >", flow.NextButtonText);
        flow.TryAdvance(exists);
        Assert.Equal("Next >", flow.NextButtonText);
        flow.TryAdvance(exists);
        Assert.Equal(SetupStep.Install, flow.Current);
        Assert.Equal("Install", flow.NextButtonText);
    }

    [Fact]
    public void The_administrator_step_offers_Finish_rather_than_Next()
    {
        var flow = new SetupFlow { Role = "admin" };
        flow.TryAdvance(FolderExists());
        Assert.Equal(SetupStep.Admin, flow.Current);
        Assert.Equal("Finish", flow.NextButtonText);
    }

    [Fact]
    public void Advancing_past_the_last_step_stays_on_it()
    {
        var flow = new SetupFlow { CsvFolder = @"C:\exports" };
        var exists = FolderExists(@"C:\exports");
        for (var i = 0; i < 10; i++) flow.TryAdvance(exists);
        Assert.Equal(SetupStep.Install, flow.Current);
    }

    [Fact]
    public void What_the_wizard_collected_becomes_the_settings_that_are_saved()
    {
        var flow = new SetupFlow
        {
            CsvFolder = @"  C:\CIDCO\exports  ",
            IntervalLabel = "Every 30 minutes",
        };

        var settings = flow.ToSettings();

        Assert.Equal("architect", settings.Role);
        Assert.Equal(@"C:\CIDCO\exports", settings.CsvFolder);
        Assert.Equal(1800, settings.IntervalSeconds);
        Assert.Equal("cidco@example.com", settings.Username);
        Assert.Equal("ABCD123", settings.CompanyId);
        Assert.Equal(2222, settings.Port);
        Assert.Equal("", settings.Password);
    }

    [Fact]
    public void An_untouched_schedule_is_the_three_hour_default() =>
        Assert.Equal(Schedule.DefaultSeconds, new SetupFlow().ToSettings().IntervalSeconds);

    [Fact]
    public void The_whole_architect_walk_ends_ready_to_install()
    {
        var flow = new SetupFlow();
        var exists = FolderExists(@"C:\CIDCO\exports");

        Assert.Equal(SetupStep.Role, flow.Current);
        Assert.True(flow.TryAdvance(exists));

        Assert.Equal(SetupStep.Folder, flow.Current);
        Assert.False(flow.TryAdvance(exists));           // nothing typed yet
        flow.CsvFolder = @"C:\CIDCO\exports";
        Assert.True(flow.TryAdvance(exists));

        Assert.Equal(SetupStep.Schedule, flow.Current);
        flow.IntervalLabel = "Every 15 minutes";
        Assert.True(flow.TryAdvance(exists));

        Assert.Equal(SetupStep.Install, flow.Current);
        Assert.Equal(900, flow.ToSettings().IntervalSeconds);
    }
}
