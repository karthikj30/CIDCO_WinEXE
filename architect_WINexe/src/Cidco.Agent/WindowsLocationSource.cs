using System.Runtime.Versioning;
using Cidco.Core;
using Windows.Devices.Geolocation;

namespace Cidco.Agent;

/// <summary>
/// Windows Location Service — the same one that answers for Maps and Weather.
///
/// On a site laptop with no GPS receiver this resolves from nearby Wi-Fi and
/// the network, which is typically good to tens of metres indoors in a city
/// and much worse in the open. It is still the best answer available on the
/// machine, so it is tried before a plain IP lookup.
///
/// It needs location turned on for desktop apps in Windows Settings. When it
/// is off, this says nothing and the next source gets its turn — the transfer
/// is never blocked on it.
/// </summary>
[SupportedOSPlatform("windows10.0.17763.0")]
internal sealed class WindowsLocationSource : ILocationSource
{
    public LocationOrigin Origin => LocationOrigin.Device;

    public LocationFix Read(TimeSpan timeout)
    {
        // Asking for access is what makes Windows show the prompt the first
        // time, and what reports a flat refusal afterwards.
        var access = Geolocator.RequestAccessAsync().AsTask();
        if (!access.Wait(timeout)) return LocationFix.Unknown;
        if (access.Result != GeolocationAccessStatus.Allowed) return LocationFix.Unknown;

        var locator = new Geolocator
        {
            // A construction site is a place, not a lane on a road: metres of
            // accuracy would only spend battery and time for no more truth.
            DesiredAccuracyInMeters = 50,
            ReportInterval = 1000,
        };

        // maximumAge lets Windows hand back a fix it already had, which is
        // what makes this fast enough to sit in front of a transfer.
        var reading = locator
            .GetGeopositionAsync(TimeSpan.FromMinutes(2), timeout)
            .AsTask();
        if (!reading.Wait(timeout)) return LocationFix.Unknown;

        var point = reading.Result?.Coordinate?.Point?.Position;
        if (point is null) return LocationFix.Unknown;

        return LocationFix.Of(point.Value.Latitude, point.Value.Longitude, LocationOrigin.Device, DateTimeOffset.Now);
    }
}
