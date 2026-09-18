using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// One field, not two. The architect types the designated address CIDCO sent
/// them; the port is CIDCO's standard one unless they say otherwise.
/// </summary>
public class ServerAddressTests
{
    private static ServerAddress Parse(string text)
    {
        Assert.True(ServerAddress.TryParse(text, out var address, out var problem), problem);
        return address;
    }

    [Fact]
    public void A_bare_address_uses_CIDCOs_standard_port()
    {
        var address = Parse("13.207.123.12");
        Assert.Equal("13.207.123.12", address.Host);
        Assert.Equal(2222, address.Port);
        Assert.False(address.PortWasGiven);
    }

    [Fact]
    public void A_port_after_a_colon_is_taken_as_given()
    {
        var address = Parse("13.207.123.12:8010");
        Assert.Equal("13.207.123.12", address.Host);
        Assert.Equal(8010, address.Port);
        Assert.True(address.PortWasGiven);
    }

    [Fact]
    public void A_host_name_works_as_well_as_an_IP() =>
        Assert.Equal("cidco.example.gov.in", Parse("cidco.example.gov.in").Host);

    [Theory]
    [InlineData("  13.207.123.12  ")]
    [InlineData("sftp://13.207.123.12")]
    [InlineData("ssh://13.207.123.12/")]
    [InlineData("13.207.123.12/")]
    public void The_shapes_someone_might_paste_all_read_the_same(string typed)
    {
        var address = Parse(typed);
        Assert.Equal("13.207.123.12", address.Host);
        Assert.Equal(2222, address.Port);
    }

    [Fact]
    public void A_pasted_URL_keeps_its_port() =>
        Assert.Equal(8010, Parse("sftp://13.207.123.12:8010/uploads").Port);

    [Fact]
    public void A_user_pasted_in_front_of_the_host_is_dropped() =>
        Assert.Equal("13.207.123.12", Parse("cidco@example.com@13.207.123.12").Host);

    [Fact]
    public void A_bracketed_IPv6_address_is_understood()
    {
        var address = Parse("[::1]:2200");
        Assert.Equal("::1", address.Host);
        Assert.Equal(2200, address.Port);
    }

    [Fact]
    public void A_bare_IPv6_address_is_not_mistaken_for_a_port()
    {
        var address = Parse("fe80::1ff:fe23:4567:890a");
        Assert.Equal("fe80::1ff:fe23:4567:890a", address.Host);
        Assert.Equal(2222, address.Port);
    }

    [Fact]
    public void It_renders_back_the_way_it_was_understood()
    {
        Assert.Equal("13.207.123.12:8010", Parse("13.207.123.12:8010").ToString());
        Assert.Equal("[::1]:2200", Parse("[::1]:2200").ToString());
    }

    // --- what it refuses ---------------------------------------------------

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void An_empty_address_is_refused_with_something_to_do(string? typed)
    {
        Assert.False(ServerAddress.TryParse(typed, out _, out var problem));
        Assert.Contains("designated IP", problem);
    }

    [Theory]
    [InlineData("13.207.123.12:notaport")]
    [InlineData("13.207.123.12:0")]
    [InlineData("13.207.123.12:70000")]
    [InlineData("13.207.123.12:-1")]
    public void A_port_that_is_not_a_port_says_so(string typed)
    {
        Assert.False(ServerAddress.TryParse(typed, out _, out var problem));
        Assert.Contains("2222", problem);   // and names the one to fall back to
    }

    [Fact]
    public void An_address_with_a_space_in_it_is_refused()
    {
        Assert.False(ServerAddress.TryParse("13.207 .123.12", out _, out var problem));
        Assert.Contains("spaces", problem);
    }

    // --- which ports get tried --------------------------------------------

    [Fact]
    public void Only_an_address_means_the_usual_ports_are_worth_trying()
    {
        var ports = Parse("13.207.123.12").PortsToTry();
        Assert.Equal(2222, ports[0]);           // the standard one first
        Assert.Contains(22, ports);             // then plain SSH
        Assert.Equal(ports.Distinct().Count(), ports.Count);
    }

    [Fact]
    public void An_explicit_port_is_taken_at_its_word_and_nothing_else_is_tried()
    {
        var ports = Parse("13.207.123.12:8010").PortsToTry();
        Assert.Equal(new[] { 8010 }, ports);
    }

    [Fact]
    public void On_moves_the_same_address_to_another_port()
    {
        var moved = Parse("13.207.123.12").On(8010);
        Assert.Equal("13.207.123.12", moved.Host);
        Assert.Equal(8010, moved.Port);
    }
}
