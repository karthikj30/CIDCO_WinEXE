using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// Where a reading is filed on the receiving server.
///
///     &lt;base&gt;/&lt;companyId&gt;/&lt;year-month&gt;/&lt;date&gt;/&lt;file&gt;
///
/// CIDCO's own intake builds this tree itself, from the company id and the
/// timestamp. An ordinary server has nothing that would, so the agent lays out
/// the same shape by hand and creates whatever is missing.
/// </summary>
public class DatedTreeTests
{
    private static readonly DateTimeOffset Noon =
        new(2026, 9, 19, 13, 28, 49, TimeSpan.Zero);

    [Fact]
    public void The_whole_path_is_company_then_month_then_date_then_file() =>
        Assert.Equal(
            "/home/ubuntu/SFTP/ABCD123/2026-09-September/2026-09-19/readings_2026-09-19_13-28-49.csv",
            RemotePath.DatedTree("/home/ubuntu/SFTP", "ABCD123", "readings.csv", Noon));

    [Fact]
    public void The_month_folder_is_spelled_the_way_CIDCOs_data_table_spells_it()
    {
        // A tree built here and a tree built by CIDCO must read the same.
        var path = RemotePath.DatedTree("/srv", "ABCD123", "r.csv", Noon);
        Assert.Contains("/2026-09-September/", path);
    }

    [Fact]
    public void The_date_folder_is_just_the_date()
    {
        var path = RemotePath.DatedTree("/srv", "ABCD123", "r.csv", Noon);
        Assert.Contains("/2026-09-19/", path);
    }

    [Fact]
    public void Every_level_moves_with_the_clock()
    {
        var newYear = new DateTimeOffset(2027, 1, 2, 3, 4, 5, TimeSpan.Zero);
        Assert.Equal(
            "/srv/ABCD123/2027-01-January/2027-01-02/r_2027-01-02_03-04-05.csv",
            RemotePath.DatedTree("/srv", "ABCD123", "r.csv", newYear));
    }

    [Fact]
    public void The_company_moves_with_the_company() =>
        Assert.Contains("/WXYZ789/", RemotePath.DatedTree("/srv", "WXYZ789", "r.csv", Noon));

    // --- not losing files --------------------------------------------------

    [Fact]
    public void Two_sends_a_second_apart_do_not_land_on_each_other()
    {
        // The agent sends on a schedule. A plain "readings.csv" in a per-day
        // folder would mean every send destroying the one before it.
        var first = RemotePath.DatedTree("/srv", "ABCD123", "readings.csv", Noon);
        var second = RemotePath.DatedTree("/srv", "ABCD123", "readings.csv", Noon.AddSeconds(1));

        Assert.NotEqual(first, second);
        // ...but they are still filed together, under the same day.
        Assert.Equal(Folder(first), Folder(second));
    }

    [Fact]
    public void Sends_on_the_same_day_share_a_folder_and_ones_on_different_days_do_not()
    {
        var today = RemotePath.DatedTree("/srv", "ABCD123", "r.csv", Noon);
        var tomorrow = RemotePath.DatedTree("/srv", "ABCD123", "r.csv", Noon.AddDays(1));

        Assert.NotEqual(Folder(today), Folder(tomorrow));
    }

    private static string Folder(string path) => path[..path.LastIndexOf('/')];

    // --- the file name -----------------------------------------------------

    [Fact]
    public void The_stamp_goes_before_the_extension_so_it_stays_a_csv() =>
        Assert.Equal("readings_2026-09-19_13-28-49.csv", RemotePath.Stamped("readings.csv", Noon));

    [Fact]
    public void A_name_with_dots_in_it_keeps_only_its_real_extension() =>
        Assert.Equal("aqi.daily_2026-09-19_13-28-49.csv", RemotePath.Stamped("aqi.daily.csv", Noon));

    [Fact]
    public void A_name_with_no_extension_still_works() =>
        Assert.Equal("readings_2026-09-19_13-28-49", RemotePath.Stamped("readings", Noon));

    [Fact]
    public void An_xlsx_stays_an_xlsx() =>
        Assert.EndsWith(".xlsx", RemotePath.Stamped("readings.xlsx", Noon));

    [Fact]
    public void A_windows_path_contributes_only_its_file_name() =>
        Assert.Equal("readings_2026-09-19_13-28-49.csv",
            RemotePath.Stamped(@"\\192.168.1.100\common\karthik\readings.csv", Noon));

    // --- the folders to create --------------------------------------------

    [Fact]
    public void Every_folder_is_listed_outermost_first()
    {
        var folders = RemotePath.FoldersOf(
            "/home/ubuntu/SFTP/ABCD123/2026-09-September/2026-09-19/readings.csv");

        Assert.Equal(new[]
        {
            "/home",
            "/home/ubuntu",
            "/home/ubuntu/SFTP",
            "/home/ubuntu/SFTP/ABCD123",
            "/home/ubuntu/SFTP/ABCD123/2026-09-September",
            "/home/ubuntu/SFTP/ABCD123/2026-09-September/2026-09-19",
        }, folders);
    }

    [Fact]
    public void The_file_itself_is_not_one_of_the_folders()
    {
        var folders = RemotePath.FoldersOf("/srv/incoming/readings.csv");
        Assert.DoesNotContain(folders, f => f.EndsWith("readings.csv"));
    }

    [Fact]
    public void A_file_at_the_root_needs_no_folders() =>
        Assert.Empty(RemotePath.FoldersOf("/readings.csv"));

    // --- and CIDCO's own layout is untouched -------------------------------

    [Fact]
    public void CIDCOs_intake_still_gets_the_path_it_reads_the_company_from()
    {
        // The intake works the company and source folder out of the path
        // itself; it must not be handed a dated tree instead.
        Assert.Equal("/ABCD123/C:/CIDCO/exports/readings.csv",
            RemotePath.For("ABCD123", "C:/CIDCO/exports", "readings.csv"));
    }
}
