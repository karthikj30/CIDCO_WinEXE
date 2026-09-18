using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>The upload path is how CIDCO learns which company sent the file.</summary>
public class RemotePathTests
{
    [Fact]
    public void A_windows_folder_becomes_a_company_scoped_path() =>
        Assert.Equal(
            "/ABCD123/C:/CIDCO/exports/readings.csv",
            RemotePath.For("ABCD123", @"C:\CIDCO\exports", "readings.csv"));

    [Fact]
    public void A_posix_folder_keeps_its_shape() =>
        Assert.Equal(
            "/ABCD123/srv/aqi/exports/readings.csv",
            RemotePath.For("ABCD123", "/srv/aqi/exports", "readings.csv"));

    [Fact]
    public void The_company_and_the_folder_are_always_separated()
    {
        // A missing separator here is what silently broke an early build.
        var path = RemotePath.For("ABCD123", "C:/CIDCO/exports", "readings.csv");
        Assert.StartsWith("/ABCD123/", path);
        Assert.DoesNotContain("//", path.TrimStart('/'));
    }

    [Fact]
    public void Only_the_file_name_is_used() =>
        Assert.Equal(
            "/ABCD123/C:/exports/readings.csv",
            RemotePath.For("ABCD123", "C:/exports", @"C:\somewhere\else\readings.csv"));

    [Fact]
    public void Trailing_slashes_and_spaces_do_not_change_the_path() =>
        Assert.Equal(
            "/ABCD123/C:/CIDCO/exports/readings.csv",
            RemotePath.For("  ABCD123  ", "  C:/CIDCO/exports/  ", "readings.csv"));

    [Fact]
    public void A_network_share_is_sent_as_its_server_and_share()
    {
        // Architects commonly export to a UNC share rather than a local disk.
        Assert.Equal(
            "/ABCD123/192.168.1.100/common/karthik/readings.csv",
            RemotePath.For("ABCD123", @"\\192.168.1.100\common\karthik", "readings.csv"));
    }

    [Fact]
    public void A_named_network_share_works_the_same_way() =>
        Assert.Equal(
            "/ABCD123/fileserver/common/aqi/readings.csv",
            RemotePath.For("ABCD123", @"\\fileserver\common\aqi", "readings.csv"));

    [Fact]
    public void A_share_does_not_leave_an_empty_segment_from_its_double_slash()
    {
        var path = RemotePath.For("ABCD123", @"\\192.168.1.100\common", "readings.csv");
        Assert.DoesNotContain("//", path.TrimStart('/'));
    }

    [Theory]
    [InlineData(@"\\192.168.1.100\common\karthik", "//192.168.1.100/common/karthik")]
    [InlineData(@"C:\CIDCO\exports\", "C:/CIDCO/exports")]
    [InlineData("/srv/aqi/", "/srv/aqi")]
    [InlineData("", "")]
    [InlineData("   ", "")]
    public void Normalise_agrees_with_the_server(string given, string expected) =>
        Assert.Equal(expected, RemotePath.Normalise(given));
}
