using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// Every CSV is renamed to siteName_dd_mm_yyyy_hh-mm-ss_AQI.csv before upload.
/// The agent never builds a folder tree — CIDCO's poll1 takes this name apart
/// and files it as &lt;siteName&gt;/&lt;dd_mm_yyyy&gt;/&lt;hh-mm-ss&gt;.csv.
/// </summary>
public class AqiFileNameTests
{
    private static readonly DateTimeOffset Noon =
        new(2026, 9, 19, 13, 28, 49, TimeSpan.Zero);

    [Fact]
    public void Any_local_name_becomes_company_date_time_AQI() =>
        Assert.Equal("ABCD123_19_09_2026_13-28-49_AQI.csv",
            RemotePath.AqiFileName("ABCD123", Noon));

    [Fact]
    public void The_company_moves_with_the_company() =>
        Assert.Equal("WXYZ789_19_09_2026_13-28-49_AQI.csv",
            RemotePath.AqiFileName("WXYZ789", Noon));

    [Fact]
    public void Two_sends_a_second_apart_do_not_collide()
    {
        var first = RemotePath.AqiFileName("ABCD123", Noon);
        var second = RemotePath.AqiFileName("ABCD123", Noon.AddSeconds(1));
        Assert.NotEqual(first, second);
    }

    [Fact]
    public void Into_a_named_folder_keeps_the_folder_and_renames_the_file() =>
        Assert.Equal(
            "/home/ubuntu/SFTP/ABCD123_19_09_2026_13-28-49_AQI.csv",
            RemotePath.IntoFolder("/home/ubuntu/SFTP", "ABCD123", Noon));

    [Fact]
    public void CIDCO_intake_gets_the_renamed_file_under_the_company() =>
        Assert.Equal(
            "/ABCD123/ABCD123_19_09_2026_13-28-49_AQI.csv",
            RemotePath.For("ABCD123", RemotePath.AqiFileName("ABCD123", Noon)));

    [Fact]
    public void Parent_of_a_file_is_its_folder() =>
        Assert.Equal("/home/ubuntu/SFTP",
            RemotePath.ParentOf("/home/ubuntu/SFTP/ABCD123_19_09_2026_13-28-49_AQI.csv"));

    [Fact]
    public void Parent_at_root_is_slash() =>
        Assert.Equal("/", RemotePath.ParentOf("/readings.csv"));

    [Fact]
    public void Every_folder_is_listed_outermost_first()
    {
        var folders = RemotePath.FoldersOf(
            "/home/ubuntu/SFTP/ABCD123/2026-09-September/2026-09-19/file.csv");

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

    // --- the shape CIDCO parses ------------------------------------------

    [Fact]
    public void The_date_is_day_then_month_then_year()
    {
        // 19 September, not September 19 — dd_mm_yyyy is what CIDCO's poll1
        // reads, and 09_10 versus 10_09 is a silently wrong folder.
        Assert.Equal("19_09_2026", RemotePath.DateFolder(Noon));
        Assert.Equal("02_01_2027", RemotePath.DateFolder(new DateTimeOffset(2027, 1, 2, 3, 4, 5, TimeSpan.Zero)));
    }

    [Fact]
    public void The_time_is_hyphenated_never_a_colon()
    {
        // A colon is reserved in a Windows file name: NTFS would read
        // "11:30:24.csv" as an alternate data stream on a file called "11".
        var name = RemotePath.AqiFileName("ABCD123", Noon);
        Assert.Equal("13-28-49", RemotePath.TimeStem(Noon));
        Assert.DoesNotContain(":", name);
    }

    [Fact]
    public void Nothing_in_the_name_is_illegal_on_Windows()
    {
        var name = RemotePath.AqiFileName("ABCD123", Noon);
        Assert.DoesNotContain(name, c => Path.GetInvalidFileNameChars().Contains(c));
        // And it is a name, not a path: poll1 owns the folders.
        Assert.DoesNotContain("/", name);
        Assert.DoesNotContain("\\", name);
    }

    [Fact]
    public void Midnight_and_noon_are_told_apart()
    {
        // A 12-hour clock would file 00:30 and 12:30 under the same name.
        var midnight = new DateTimeOffset(2026, 9, 19, 0, 30, 0, TimeSpan.Zero);
        var midday = new DateTimeOffset(2026, 9, 19, 12, 30, 0, TimeSpan.Zero);
        Assert.NotEqual(RemotePath.AqiFileName("ABCD123", midnight),
                        RemotePath.AqiFileName("ABCD123", midday));
        Assert.Contains("00-30-00", RemotePath.AqiFileName("ABCD123", midnight));
    }

    [Fact]
    public void Two_sends_on_different_days_land_on_different_dates() =>
        Assert.NotEqual(RemotePath.DateFolder(Noon), RemotePath.DateFolder(Noon.AddDays(1)));
}
