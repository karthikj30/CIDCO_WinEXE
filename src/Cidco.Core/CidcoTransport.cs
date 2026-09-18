namespace Cidco.Core;

/// <summary>
/// A way of getting a file to CIDCO.
///
/// There are two doors into the same channel and the window does not care
/// which one it is holding: the SFTP intake on its own port, and the upload
/// endpoint on CIDCO's web portal. Both carry the same credentials, both are
/// validated identically on arrival, and both are filed the same way.
/// </summary>
public interface ICidcoTransport
{
    /// <summary>Where this is sending, for the status line.</summary>
    string Describe { get; }

    /// <summary>Proves CIDCO is reachable, without sending anything.</summary>
    SendResult CheckConnection();

    /// <summary>Sends one file — the newest export unless one is named.</summary>
    SendResult Send(FileInfo? file = null);

    /// <summary>Sends, and writes the outcome to the agent's own history.</summary>
    SendResult SendAndRecord(Database db, FileInfo? file = null);
}

/// <summary>Picks the door from the address the architect typed.</summary>
public static class CidcoTransports
{
    /// <summary>
    /// Opens whichever door the address names, and reports how it went.
    ///
    /// The choice is the architect's, made by writing http:// in front of the
    /// address or leaving it off — never inferred from what happens to answer.
    /// An agent that quietly switched protocol would be impossible to reason
    /// about the first time it did something unexpected.
    /// </summary>
    public static (ICidcoTransport Transport, SendResult Result) Connect(
        ServerAddress address,
        string username,
        string password,
        string companyId,
        string csvFolder,
        TimeSpan? timeout = null)
    {
        if (address.IsPortal)
        {
            var portal = new PortalSender(
                address.PortalBase(), username, password, companyId, csvFolder,
                timeout ?? TimeSpan.FromSeconds(30));
            return (portal, portal.CheckConnection());
        }

        var (sftp, result) = CidcoSender.FindIntake(
            address, username, password, companyId, csvFolder, timeout);
        return (sftp, result);
    }
}
