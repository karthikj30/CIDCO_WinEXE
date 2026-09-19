using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// Every CSV is renamed to companyId_timestamp_AQI.csv before upload.
/// The agent never builds a dated folder tree — CIDCO's poll1 does that.
/// </summary>
public class AqiFileNameTests
{
    private static readonly DateTimeOffset Noon =
        new(2026, 9, 19, 13, 28, 49, TimeSpan.Zero);

    [Fact]
    public void Any_local_name_becomes_company_timestamp_AQI() =>
        Assert.Equal("ABCD123_2026-09-19_13-28-49_AQI.csv",
            RemotePath.AqiFileName("ABCD123", Noon));

    [Fact]
    public void The_company_moves_with_the_company() =>
        Assert.Equal("WXYZ789_2026-09-19_13-28-49_AQI.csv",
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
            "/home/ubuntu/SFTP/ABCD123_2026-09-19_13-28-49_AQI.csv",
            RemotePath.IntoFolder("/home/ubuntu/SFTP", "ABCD123", Noon));

    [Fact]
    public void CIDCO_intake_gets_the_renamed_file_under_company_and_source() =>
        Assert.Equal(
            "/ABCD123/C:/CIDCO/exports/ABCD123_2026-09-19_13-28-49_AQI.csv",
            RemotePath.For("ABCD123", "C:/CIDCO/exports",
                RemotePath.AqiFileName("ABCD123", Noon)));

    [Fact]
    public void Parent_of_a_file_is_its_folder() =>
        Assert.Equal("/home/ubuntu/SFTP",
            RemotePath.ParentOf("/home/ubuntu/SFTP/ABCD123_2026-09-19_13-28-49_AQI.csv"));

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
}
