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

    [Theory]
    [InlineData(@"C:\CIDCO\exports\", "C:/CIDCO/exports")]
    [InlineData("/srv/aqi/", "/srv/aqi")]
    [InlineData("", "")]
    [InlineData("   ", "")]
    public void Normalise_agrees_with_the_server(string given, string expected) =>
        Assert.Equal(expected, RemotePath.Normalise(given));
}
