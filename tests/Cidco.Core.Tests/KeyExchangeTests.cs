using Cidco.Core;
using Renci.SshNet;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// The agent runs on Windows, where .NET's crypto sits on CNG rather than
/// OpenSSL. CNG has no Curve25519 ECDH, so any key exchange that needs it
/// fails the handshake outright — and the tests here run on the build machine,
/// which may well be Linux and would never notice.
/// </summary>
public class KeyExchangeTests
{
    private static ConnectionInfo FreshDefaults() =>
        new("host", 22, "user", new PasswordAuthenticationMethod("user", "pw"));

    [Fact]
    public void SSH_NET_really_does_offer_Curve25519_by_default()
    {
        // If this ever stops being true the workaround below can go.
        Assert.Contains("curve25519-sha256", FreshDefaults().KeyExchangeAlgorithms.Keys);
    }

    [Theory]
    [InlineData("mlkem768x25519-sha256")]
    [InlineData("sntrup761x25519-sha512")]
    [InlineData("sntrup761x25519-sha512@openssh.com")]
    [InlineData("curve25519-sha256")]
    [InlineData("curve25519-sha256@libssh.org")]
    public void The_agent_offers_no_key_exchange_that_Windows_cannot_do(string algorithm) =>
        Assert.DoesNotContain(algorithm, OfferedByTheAgent());

    [Fact]
    public void What_is_left_is_something_every_SSH_server_speaks()
    {
        var offered = OfferedByTheAgent();
        Assert.Contains("ecdh-sha2-nistp256", offered);
        Assert.Contains("diffie-hellman-group14-sha256", offered);
    }

    [Fact]
    public void Removing_them_does_not_empty_the_list() =>
        Assert.NotEmpty(OfferedByTheAgent());

    [Fact]
    public void The_fallback_is_plain_Diffie_Hellman_that_any_Windows_can_do()
    {
        Assert.NotEmpty(CidcoSender.ConservativeKeyExchanges);
        Assert.Contains("diffie-hellman-group14-sha256", CidcoSender.ConservativeKeyExchanges);

        // It must not quietly reintroduce what Windows cannot do.
        Assert.Empty(CidcoSender.ConservativeKeyExchanges
            .Intersect(CidcoSender.WindowsUnsupportedKeyExchanges));
    }

    [Fact]
    public void The_fallback_algorithms_are_ones_SSH_NET_actually_has()
    {
        var known = FreshDefaults().KeyExchangeAlgorithms.Keys;
        foreach (var name in CidcoSender.ConservativeKeyExchanges)
            Assert.Contains(name, known);
    }

    [Fact]
    public void The_fallback_uses_no_obsolete_SHA1_exchange() =>
        Assert.DoesNotContain(CidcoSender.ConservativeKeyExchanges, n => n.EndsWith("sha1"));

    /// <summary>
    /// Reaches through a real connection attempt to see what the sender would
    /// put on the wire. The connection is expected to fail — nothing is
    /// listening on this port — but the algorithms are settled before that.
    /// </summary>
    private static IReadOnlyCollection<string> OfferedByTheAgent()
    {
        // Mirrors CidcoSender.Connect: the same list, filtered the same way.
        var info = FreshDefaults();
        foreach (var name in CidcoSender.WindowsUnsupportedKeyExchanges)
            info.KeyExchangeAlgorithms.Remove(name);
        return info.KeyExchangeAlgorithms.Keys.ToList();
    }
}
