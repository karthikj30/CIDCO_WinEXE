using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// Where a transfer says it came from.
///
/// The position used to be fixed at install, so an architect who sent from a
/// second site still stamped the first one on every file. These cover the
/// rule that replaced it: ask afresh, prefer whatever knows most, and never
/// let any of it stop a transfer.
/// </summary>
public class LiveLocationTests
{
    /// <summary>A source that answers with whatever the test wants, or refuses.</summary>
    private sealed class Stub : ILocationSource
    {
        private readonly LocationFix _fix;
        private readonly Exception? _throws;
        public int Reads { get; private set; }

        public Stub(LocationOrigin origin, double? lat = null, double? lon = null, Exception? throws = null)
        {
            Origin = origin;
            _throws = throws;
            _fix = lat is null || lon is null
                ? LocationFix.Unknown
                : LocationFix.Of(lat.Value, lon.Value, origin, DateTimeOffset.UnixEpoch);
        }

        public LocationOrigin Origin { get; }

        public LocationFix Read(TimeSpan timeout)
        {
            Reads++;
            if (_throws is not null) throw _throws;
            return _fix;
        }
    }

    private static LiveLocation Chain(params ILocationSource[] sources) =>
        new(sources, cacheFor: TimeSpan.Zero);

    [Fact]
    public void The_device_answer_wins_when_there_is_one()
    {
        var fix = Chain(
            new Stub(LocationOrigin.Device, 19.033, 73.0297),
            new Stub(LocationOrigin.Network, 1, 1),
            new Stub(LocationOrigin.Registered, 2, 2)).Current();

        Assert.Equal(LocationOrigin.Device, fix.Origin);
        Assert.Equal("19.033", fix.Latitude);
        Assert.Equal("73.0297", fix.Longitude);
    }

    [Fact]
    public void A_silent_device_falls_through_to_the_network()
    {
        var fix = Chain(
            new Stub(LocationOrigin.Device),
            new Stub(LocationOrigin.Network, 18.52, 73.8567),
            new Stub(LocationOrigin.Registered, 2, 2)).Current();

        Assert.Equal(LocationOrigin.Network, fix.Origin);
        Assert.Equal("18.52", fix.Latitude);
    }

    /// <summary>
    /// The registered position is the floor, not the answer: it is only right
    /// when nothing can say where the PC actually is.
    /// </summary>
    [Fact]
    public void Only_when_nothing_can_measure_does_the_registered_position_stand()
    {
        var fix = Chain(
            new Stub(LocationOrigin.Device),
            new Stub(LocationOrigin.Network),
            new Stub(LocationOrigin.Registered, 19.033, 73.0297)).Current();

        Assert.Equal(LocationOrigin.Registered, fix.Origin);
    }

    [Fact]
    public void A_source_that_throws_is_just_the_next_one_s_turn()
    {
        var after = new Stub(LocationOrigin.Network, 18.52, 73.8567);
        var fix = Chain(new Stub(LocationOrigin.Device, throws: new InvalidOperationException("no")), after).Current();

        Assert.Equal(LocationOrigin.Network, fix.Origin);
        Assert.Equal(1, after.Reads);
    }

    [Fact]
    public void With_nothing_to_go_on_the_transfer_still_has_a_name_to_use()
    {
        var fix = Chain(new Stub(LocationOrigin.Device), new Stub(LocationOrigin.Network)).Current();

        Assert.False(fix.HasPosition);
        Assert.Equal(LocationOrigin.None, fix.Origin);
        // The sender falls back to the registered strings, so the file name is
        // the one the old build produced rather than a broken one.
        Assert.Equal("", fix.Latitude);
    }

    /// <summary>A burst of sends must not mean a lookup per file.</summary>
    [Fact]
    public void An_answer_is_held_briefly_rather_than_asked_again_per_file()
    {
        var device = new Stub(LocationOrigin.Device, 19.033, 73.0297);
        var now = DateTimeOffset.UnixEpoch;
        var live = new LiveLocation(new[] { device }, cacheFor: TimeSpan.FromSeconds(20), now: () => now);

        live.Current();
        live.Current();
        live.Current();
        Assert.Equal(1, device.Reads);

        now = now.AddSeconds(21);
        live.Current();
        Assert.Equal(2, device.Reads);
    }

    /// <summary>
    /// The case the whole change exists for: the architect drove somewhere
    /// else, and the next file has to say so.
    /// </summary>
    [Fact]
    public void Moving_between_sends_changes_what_the_next_file_is_stamped_with()
    {
        var at = 0;
        var moving = new MovingSource(() => at);
        var now = DateTimeOffset.UnixEpoch;
        var live = new LiveLocation(new[] { moving }, cacheFor: TimeSpan.FromSeconds(20), now: () => now);

        Assert.Equal("19.033", live.Current().Latitude);

        at = 1;
        now = now.AddMinutes(5);
        Assert.Equal("18.52", live.Current().Latitude);
    }

    private sealed class MovingSource(Func<int> index) : ILocationSource
    {
        private static readonly (double Lat, double Lon)[] Places = { (19.033, 73.0297), (18.52, 73.8567) };
        public LocationOrigin Origin => LocationOrigin.Device;
        public LocationFix Read(TimeSpan timeout)
        {
            var (lat, lon) = Places[index()];
            return LocationFix.Of(lat, lon, LocationOrigin.Device, DateTimeOffset.UnixEpoch);
        }
    }

    // --- the registered fallback ------------------------------------------

    [Fact]
    public void The_registered_source_reads_what_setup_stored() =>
        Assert.Equal("19.033", new RegisteredLocationSource(() => ("19.0330", "73.0297"))
            .Read(TimeSpan.FromSeconds(1)).Latitude);

    [Fact]
    public void An_install_that_was_never_given_one_says_nothing() =>
        Assert.False(new RegisteredLocationSource(() => ("", "")).Read(TimeSpan.FromSeconds(1)).HasPosition);

    [Fact]
    public void A_stored_position_past_the_pole_is_not_used() =>
        Assert.False(new RegisteredLocationSource(() => ("91", "73.0297")).Read(TimeSpan.FromSeconds(1)).HasPosition);

    // --- the network lookup ------------------------------------------------

    [Fact]
    public void A_good_lookup_becomes_a_position()
    {
        var fix = NetworkLocationSource.Parse(
            "{\"status\":\"success\",\"lat\":19.033,\"lon\":73.0297}", DateTimeOffset.UnixEpoch);

        Assert.Equal(LocationOrigin.Network, fix.Origin);
        Assert.Equal("19.033", fix.Latitude);
        Assert.Equal("73.0297", fix.Longitude);
    }

    [Fact]
    public void A_negative_pair_keeps_its_signs() =>
        Assert.Equal("-33.8688", NetworkLocationSource.Parse(
            "{\"status\":\"success\",\"lat\":-33.8688,\"lon\":-70.5}", DateTimeOffset.UnixEpoch).Latitude);

    [Theory]
    [InlineData("{\"status\":\"fail\",\"message\":\"private range\"}")]
    [InlineData("{\"status\":\"success\",\"lat\":91,\"lon\":73.0297}")]
    [InlineData("{\"status\":\"success\",\"lon\":73.0297}")]
    [InlineData("not json at all")]
    [InlineData("")]
    public void A_lookup_that_says_nothing_useful_is_no_position(string body) =>
        Assert.False(NetworkLocationSource.Parse(body, DateTimeOffset.UnixEpoch).HasPosition);

    /// <summary>
    /// A site hut with no internet must still be able to send: the lookup
    /// throwing is caught by the resolver, and the registered position is
    /// what ends up on the file.
    /// </summary>
    [Fact]
    public void A_lookup_that_cannot_reach_the_network_does_not_stop_a_send()
    {
        var offline = new NetworkLocationSource(_ => throw new HttpRequestException("offline"));
        var fix = Chain(offline, new Stub(LocationOrigin.Registered, 19.033, 73.0297)).Current();

        Assert.Equal(LocationOrigin.Registered, fix.Origin);
        Assert.Equal("19.033", fix.Latitude);
    }

    [Fact]
    public void An_empty_response_body_is_no_position() =>
        Assert.False(new NetworkLocationSource(_ => null).Read(TimeSpan.FromSeconds(1)).HasPosition);
}
