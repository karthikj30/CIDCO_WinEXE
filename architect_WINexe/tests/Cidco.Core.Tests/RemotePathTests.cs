using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// The upload path CIDCO's own intake receives:
///
///     /&lt;companyId&gt;/&lt;the renamed file&gt;
///
/// The company id and the file, and nothing else. In particular not the folder
/// the CSV came off, which is a fact about the architect's PC.
/// </summary>
public class RemotePathTests
{
    private const string Sent = "ABCD123_21_09_2026_11-30-24_AQI.csv";

    [Fact]
    public void The_path_is_the_company_then_the_file() =>
        Assert.Equal($"/ABCD123/{Sent}", RemotePath.For("ABCD123", Sent));

    [Fact]
    public void The_company_and_the_file_are_always_separated()
    {
        // A missing separator here is what silently broke an early build.
        var path = RemotePath.For("ABCD123", Sent);
        Assert.StartsWith("/ABCD123/", path);
        Assert.DoesNotContain("//", path.TrimStart('/'));
    }

    [Fact]
    public void Only_the_file_name_is_used() =>
        Assert.Equal($"/ABCD123/{Sent}", RemotePath.For("ABCD123", @"C:\somewhere\else\" + Sent));

    [Fact]
    public void Trailing_slashes_and_spaces_do_not_change_the_path() =>
        Assert.Equal($"/ABCD123/{Sent}", RemotePath.For("  ABCD123  ", Sent));

    [Fact]
    public void The_company_moves_with_the_company() =>
        Assert.Equal($"/WXYZ789/{Sent}", RemotePath.For("WXYZ789", Sent));

    // --- what the local folder must never do to it -------------------------

    [Fact]
    public void A_network_share_the_export_came_from_stays_out_of_it()
    {
        // This is the bug, written down. An architect exporting to
        // \\192.168.1.100\common\karthik had that turned into the *remote*
        // path — "/ABCD123/192.168.1.100/common/karthik/…" — which is a path
        // on nobody's server, and every send was refused for a folder they
        // had never asked anyone to create.
        var path = RemotePath.For("ABCD123", Sent);

        Assert.Equal($"/ABCD123/{Sent}", path);
        Assert.DoesNotContain("192.168", path);
        Assert.DoesNotContain("karthik", path);
    }

    [Fact]
    public void A_windows_drive_letter_cannot_reach_the_remote_path()
    {
        // "C:" is not a thing on a POSIX server either.
        var path = RemotePath.For("ABCD123", @"C:\CIDCO\exports\" + Sent);
        Assert.DoesNotContain("C:", path);
    }

    [Fact]
    public void The_path_has_exactly_two_segments()
    {
        // Two, whatever the export folder looks like: the company and the file.
        foreach (var local in new[] { Sent, @"C:\CIDCO\exports\" + Sent, @"\\192.168.1.100\common\karthik\" + Sent })
        {
            var segments = RemotePath.For("ABCD123", local).Split('/', StringSplitOptions.RemoveEmptyEntries);
            Assert.Equal(2, segments.Length);
            Assert.Equal("ABCD123", segments[0]);
            Assert.Equal(Sent, segments[1]);
        }
    }

    // --- Normalise still has to agree with the server ----------------------

    [Theory]
    [InlineData(@"\\192.168.1.100\common\karthik", "//192.168.1.100/common/karthik")]
    [InlineData(@"C:\CIDCO\exports\", "C:/CIDCO/exports")]
    [InlineData("/srv/aqi/", "/srv/aqi")]
    [InlineData("", "")]
    [InlineData("   ", "")]
    public void Normalise_agrees_with_the_server(string given, string expected) =>
        Assert.Equal(expected, RemotePath.Normalise(given));
}
