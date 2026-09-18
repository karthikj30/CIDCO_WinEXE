using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Cidco.Core;

/// <summary>
/// Sends the CSV to CIDCO's web portal over HTTP instead of SFTP.
///
/// This is the same channel and the same intake — CIDCO validates the company
/// id, the address it came from and the file path exactly as they do for a
/// direct SFTP upload, and file it the same way. Only the door differs, and
/// CIDCO records which one was used.
///
/// It exists because the portal is often the thing that is actually reachable.
/// The SFTP intake is a separate service on its own port, and a site that has
/// opened the portal's port through its firewall has frequently not opened the
/// intake's.
/// </summary>
public sealed class PortalSender : ICidcoTransport
{
    /// <summary>The intake the portal exposes, alongside its web pages.</summary>
    public const string UploadPath = "/api/architect/sftp/transfer";

    private static readonly HttpClient Http = new(new HttpClientHandler
    {
        // CIDCO deployments are commonly reached over plain http on an IP, or
        // over https with a certificate issued for a name the architect does
        // not use. Neither is a reason to refuse to deliver compliance data:
        // the credentials and the per-transfer validation are what authorise
        // it, exactly as with SFTP, where the host key is trusted on sight too.
        ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
    });

    public Uri BaseAddress { get; }
    public string Username { get; }
    private readonly string _password;
    public string CompanyId { get; }
    public string CsvFolder { get; }
    public TimeSpan Timeout { get; }

    public PortalSender(
        Uri baseAddress,
        string username,
        string password,
        string companyId,
        string csvFolder,
        TimeSpan? timeout = null)
    {
        BaseAddress = baseAddress;
        Username = username.Trim();
        _password = password;
        CompanyId = companyId.Trim();
        CsvFolder = csvFolder.Trim();
        Timeout = timeout ?? TimeSpan.FromSeconds(30);
    }

    public Uri UploadUri => new(BaseAddress, UploadPath);

    /// <summary>Where this is sending, for the status line.</summary>
    public string Describe => $"{CompanyId} \u2192 {Where} (web portal)";

    private string Where => $"{BaseAddress.Host}:{BaseAddress.Port}";

    /// <summary>
    /// Proves the portal is there and answering, without sending anything.
    ///
    /// There is no login to hold open over HTTP — every upload carries its own
    /// credentials — so this only establishes that CIDCO's portal is reachable
    /// at this address. The credentials are proven by the first transfer.
    /// </summary>
    public SendResult CheckConnection()
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(BaseAddress, "/api/health"));
            using var response = Send(request);

            // Any answer at all means something is serving HTTP here. A 404 is
            // still an answer, and older portals may not carry a health route.
            return new SendResult(true, $"CIDCO's web portal answered at {Where}.");
        }
        catch (Exception error)
        {
            return SendResult.Failed(Diagnose(error), TransferOutcome.Unreachable);
        }
    }

    /// <summary>Sends one file — the newest export unless one is named.</summary>
    public SendResult Send(FileInfo? file = null)
    {
        var source = file ?? ExportPicker.Newest(CsvFolder);
        if (source is null)
        {
            return SendResult.Failed(
                $"No .csv found in {(string.IsNullOrWhiteSpace(CsvFolder) ? "(no folder set)" : CsvFolder)}",
                TransferOutcome.NothingToSend);
        }

        source.Refresh();
        if (!source.Exists)
            return SendResult.Failed($"{source.Name} is no longer there", TransferOutcome.NothingToSend)
                with { FileName = source.Name };
        if (!AqiCsv.IsAccepted(source.Name))
            return SendResult.Failed($"{source.Name} is not a .csv or .xlsx file", TransferOutcome.NothingToSend)
                with { FileName = source.Name };

        byte[] bytes;
        try
        {
            bytes = File.ReadAllBytes(source.FullName);
        }
        catch (Exception error)
        {
            return SendResult.Failed($"Could not read {source.Name} — {error.Message}", TransferOutcome.NothingToSend)
                with { FileName = source.Name };
        }

        HttpResponseMessage response;
        string body;
        try
        {
            // An explicit boundary, without the quotes .NET puts around its
            // own. A quoted boundary is legal but trips several server-side
            // parsers, which then see no parts at all.
            var boundary = "CidcoAgent-" + Guid.NewGuid().ToString("N");
            using var content = new MultipartFormDataContent(boundary);

            AddField(content, "username", Username);
            AddField(content, "password", _password);
            AddField(content, "companyId", CompanyId);
            // The folder the CSV was taken from, which CIDCO checks against the
            // path they registered — the same value the SFTP upload carries
            // inside its remote path.
            AddField(content, "filePath", CsvFolder);

            var fileContent = new ByteArrayContent(bytes);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue(
                source.Name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
                    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    : "text/csv");
            fileContent.Headers.ContentDisposition = new ContentDispositionHeaderValue("form-data")
            {
                Name = "\"file\"",
                FileName = "\"" + source.Name + "\"",
            };
            content.Add(fileContent);

            content.Headers.ContentType = new MediaTypeHeaderValue("multipart/form-data")
            {
                Parameters = { new NameValueHeaderValue("boundary", boundary) },
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, UploadUri) { Content = content };
            response = Send(request);
            body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
        }
        catch (Exception error)
        {
            return SendResult.Failed(Diagnose(error), TransferOutcome.Unreachable)
                with { FileName = source.Name, Remote = UploadUri.ToString() };
        }

        using (response)
        {
            var sent = new SendResult(true, $"{source.Name} sent to CIDCO")
            {
                FileName = source.Name,
                Remote = UploadUri.ToString(),
                SizeBytes = source.Length,
            };

            if (response.IsSuccessStatusCode)
            {
                var detail = Explain(body);
                return detail.Length > 0 ? sent with { Message = $"{source.Name} sent to CIDCO — {detail}" } : sent;
            }

            var outcome = response.StatusCode switch
            {
                HttpStatusCode.Unauthorized => TransferOutcome.BadCredentials,
                HttpStatusCode.Forbidden => TransferOutcome.RefusedByCidco,
                HttpStatusCode.UnprocessableEntity => TransferOutcome.RefusedByCidco,
                // A portal that is down or broken may well be up again later.
                >= HttpStatusCode.InternalServerError => TransferOutcome.Unreachable,
                _ => TransferOutcome.RefusedByCidco,
            };

            var said = Explain(body);
            var message = outcome == TransferOutcome.BadCredentials
                ? $"{Where} refused that username and password." + (said.Length > 0 ? $" {said}" : "")
                : $"{source.Name} — CIDCO refused the transfer" + (said.Length > 0 ? $" ({said})" : $" ({(int)response.StatusCode})");

            return SendResult.Failed(message, outcome)
                with { FileName = source.Name, Remote = UploadUri.ToString() };
        }
    }

    /// <summary>Sends, and writes the outcome to the agent's own history.</summary>
    public SendResult SendAndRecord(Database db, FileInfo? file = null)
    {
        var result = Send(file);
        db.RecordTransfer(new TransferRecord
        {
            FileName = result.FileName.Length > 0 ? result.FileName : file?.Name ?? "",
            RemotePath = result.Remote,
            SizeBytes = result.SizeBytes,
            Accepted = result.Ok,
            Message = result.Message,
            CompanyId = CompanyId,
            SentAt = result.SentAt,
            Outcome = result.Outcome,
        });
        return result;
    }

    /// <summary>
    /// Adds one text field, with its name in quotes.
    ///
    /// .NET writes an unquoted `name=username`, which RFC 7578 does not allow
    /// and which strict parsers — the one behind CIDCO's portal among them —
    /// read as no fields being present at all. The upload then fails with a
    /// complaint about the form being missing, which is a maddening thing to
    /// debug from the outside.
    /// </summary>
    private static void AddField(MultipartFormDataContent content, string name, string value)
    {
        var part = new StringContent(value);
        part.Headers.ContentType = null;   // a bare field carries no type
        part.Headers.ContentDisposition = new ContentDispositionHeaderValue("form-data")
        {
            Name = "\"" + name + "\"",
        };
        content.Add(part);
    }

    /// <summary>
    /// The async path, waited on.
    ///
    /// HttpClient.Send, the synchronous one, does not buffer multipart content
    /// the same way and can put a request on the wire that a server reads as
    /// having no parts in it at all.
    /// </summary>
    private HttpResponseMessage Send(HttpRequestMessage request)
    {
        using var cancel = new CancellationTokenSource(Timeout);
        return Http.SendAsync(request, cancel.Token).GetAwaiter().GetResult();
    }

    /// <summary>Pulls CIDCO's own wording out of the JSON they answered with.</summary>
    private static string Explain(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return "";

        try
        {
            using var json = JsonDocument.Parse(body);
            var root = json.RootElement;

            if (root.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.String)
                return error.GetString() ?? "";

            if (root.TryGetProperty("data", out var data) &&
                data.TryGetProperty("message", out var message) &&
                message.ValueKind == JsonValueKind.String)
                return message.GetString() ?? "";
        }
        catch (JsonException)
        {
            // An HTML error page, most likely. Nothing useful to quote.
        }
        return "";
    }

    /// <summary>The same plain-terms diagnosis the SFTP side gives.</summary>
    private string Diagnose(Exception error)
    {
        var inner = error is HttpRequestException && error.InnerException is not null
            ? error.InnerException
            : error;

        if (inner is TaskCanceledException or OperationCanceledException)
        {
            return $"{Where} did not answer at all — the connection timed out rather than being refused, " +
                   "which means nothing came back, not that the portal is down. Something is dropping the " +
                   "traffic on the way: on AWS that is normally an inbound rule missing from the security " +
                   "group for this port, and it can equally be this PC's own outbound firewall.";
        }

        if (inner is System.Net.Sockets.SocketException socket)
        {
            return socket.SocketErrorCode switch
            {
                System.Net.Sockets.SocketError.ConnectionRefused =>
                    $"Nothing is listening on {Where}. Check the address with CIDCO, and that their portal is running.",
                System.Net.Sockets.SocketError.HostNotFound =>
                    $"\"{BaseAddress.Host}\" could not be looked up. Check the address CIDCO sent you.",
                _ => $"Could not reach CIDCO's portal at {Where} — {inner.Message}",
            };
        }

        return $"Could not reach CIDCO's portal at {Where} — {inner.Message}";
    }
}
