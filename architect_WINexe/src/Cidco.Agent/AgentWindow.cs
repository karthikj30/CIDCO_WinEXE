using System.Runtime.Versioning;
using Cidco.Core;
using Cidco.Ui;

namespace Cidco.Agent;

/// <summary>
/// The window the architect works in.
///
/// Laid out like WinSCP: connection details along the top, the architect's own
/// folder on the left, what CIDCO has taken on the right, and a transfer log
/// underneath. The schedule chosen during setup runs in the background and
/// sends the newest CSV on its own.
///
/// The architect never sees CIDCO's database. Everything on the right-hand side
/// is this agent's own record of what it sent and what CIDCO answered.
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class AgentWindow : Form
{
    private readonly Database _db;
    private readonly Settings _settings;

    private readonly ConnectionState _link = new();
    private string _connectedTo = "";
    private ICidcoTransport? _transport;
    private bool _sending;

    private readonly TextBox _ip = new();
    private readonly TextBox _username = new();
    private readonly TextBox _password = new();
    private readonly TextBox _company = new();
    private readonly TextBox _folder = new();
    private readonly TextBox _keyPath = new();

    private readonly Button _connect = new();
    private readonly Button _browseKey = new();
    private readonly Button _refresh = new();
    private readonly Button _sendSelected = new();
    private readonly Button _sendNow = new();
    private readonly Button _auto = new();

    private readonly Label _state = new();
    private readonly Label _scheduleText = new();
    private readonly ListView _local = new();
    private readonly ListView _remote = new();
    private readonly RichTextBox _log = new();
    private readonly System.Windows.Forms.Timer _timer = new();
    private SplitContainer? _panes;

    public AgentWindow(Database db)
    {
        _db = db;
        _settings = Settings.Load(db);

        Text = "CIDCO AQI Agent 1.0 — SFTP file transfer";
        ClientSize = new Size(1000, 660);
        MinimumSize = new Size(900, 600);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Theme.Surface;
        Font = Theme.Body;

        Build();
        LoadSettingsIntoFields();
        RefreshLocal();
        LoadHistory();

        if (!_db.IsInstalled())
            Log(false, "No setup found — run CIDCO_Setup first so the export folder and schedule are known.");

        _timer.Tick += async (_, _) =>
        {
            await SendAsync(null, scheduled: true);
            ReArmTimer();
        };
    }

    // -- layout ------------------------------------------------------------

    private void Build()
    {
        var connect = new GroupBox
        {
            Text = " Connect to CIDCO ",
            Dock = DockStyle.Top,
            Height = 166,
            Padding = new Padding(10, 6, 10, 6),
        };

        var fields = new[]
        {
            ("Designated IP  (CIDCO's address)", _ip, 186),
            ("User ID", _username, 170),
            ("Password", _password, 120),
            ("Company ID", _company, 110),
        };

        var x = 14;
        foreach (var (label, box, width) in fields)
        {
            connect.Controls.Add(new Label
            {
                Text = label,
                Font = Theme.Small,
                ForeColor = Theme.Muted,
                Location = new Point(x, 22),
                Size = new Size(width, 14),
            });
            box.Location = new Point(x, 38);
            box.Width = width;
            box.Font = Theme.Body;
            connect.Controls.Add(box);
            x += width + 12;
        }
        _password.UseSystemPasswordChar = true;

        connect.Controls.Add(new Label
        {
            Text = "File path (set during setup — the newest .csv here is the one that goes)",
            Font = Theme.Small,
            ForeColor = Theme.Muted,
            Location = new Point(14, 68),
            Size = new Size(420, 14),
        });
        _folder.Location = new Point(14, 84);
        _folder.Width = 560;
        _folder.Font = Theme.Body;
        _folder.TextChanged += (_, _) => RefreshLocal();
        connect.Controls.Add(_folder);

        // The key row. Cloud servers usually will not take a password at all,
        // so this is how an architect signs in to one.
        connect.Controls.Add(new Label
        {
            Text = "Private key (optional \u2014 .ppk or .pem, for servers that do not take a password)",
            Font = Theme.Small,
            ForeColor = Theme.Muted,
            Location = new Point(14, 112),
            Size = new Size(460, 14),
        });
        _keyPath.Location = new Point(14, 128);
        _keyPath.Width = 480;
        _keyPath.Font = Theme.Body;
        connect.Controls.Add(_keyPath);

        _browseKey.Text = "Browse\u2026";
        _browseKey.Size = new Size(80, 24);
        _browseKey.Location = new Point(502, 127);
        _browseKey.Click += (_, _) => BrowseForKey();
        connect.Controls.Add(_browseKey);

        _connect.Text = "Connect";
        _connect.Size = new Size(104, 30);
        _connect.Location = new Point(x, 34);
        _connect.Click += (_, _) => _ = ConnectAsync();
        connect.Controls.Add(_connect);


        // --- status line ---------------------------------------------------
        var status = new Panel { Dock = DockStyle.Top, Height = 26, Padding = new Padding(12, 4, 12, 4) };
        _state.Text = "Not connected";
        _state.Font = Theme.Strong;
        _state.AutoSize = true;
        _state.Location = new Point(12, 5);
        _scheduleText.Font = Theme.Small;
        _scheduleText.ForeColor = Theme.Muted;
        _scheduleText.AutoSize = true;
        _scheduleText.Location = new Point(560, 7);
        status.Controls.AddRange(new Control[] { _state, _scheduleText });

        // Keep the schedule text against the right edge, and stop the state
        // text before it. Both are AutoSize, and the state text grows with
        // what it has to say — "Connected · … (plain SFTP — not CIDCO) — last
        // transfer refused" ran straight through the schedule text and left
        // the two overprinted and unreadable.
        status.Layout += (_, _) =>
        {
            var right = status.ClientSize.Width - status.Padding.Right;
            _scheduleText.Left = Math.Max(12, right - _scheduleText.Width);
            _state.MaximumSize = new Size(Math.Max(120, _scheduleText.Left - 24), 0);
        };

        // --- the two panes -------------------------------------------------
        // The splitter is positioned in OnLoad, not here: SplitterDistance is
        // validated against the control's current width, and at this point it
        // has none, so setting it now throws.
        var panes = new SplitContainer { Dock = DockStyle.Fill };
        _panes = panes;

        var left = new GroupBox { Text = " This computer ", Dock = DockStyle.Fill, Padding = new Padding(8, 6, 8, 8) };
        _local.View = View.Details;
        _local.FullRowSelect = true;
        _local.Dock = DockStyle.Fill;
        _local.Columns.Add("Name", 220);
        _local.Columns.Add("Size", 80, HorizontalAlignment.Right);
        _local.Columns.Add("Modified", 130);
        _local.DoubleClick += (_, _) => SendSelected();
        left.Controls.Add(_local);

        var leftBar = new Panel { Dock = DockStyle.Bottom, Height = 36 };
        _refresh.Text = "Refresh";
        _refresh.Size = new Size(84, 28);
        _refresh.Location = new Point(0, 4);
        _refresh.Click += (_, _) => RefreshLocal();
        _sendSelected.Text = "Send selected →";
        _sendSelected.Size = new Size(124, 28);
        _sendSelected.Location = new Point(92, 4);
        _sendSelected.Click += (_, _) => SendSelected();
        leftBar.Controls.AddRange(new Control[] { _refresh, _sendSelected });
        left.Controls.Add(leftBar);
        panes.Panel1.Controls.Add(left);

        var right = new GroupBox { Text = " CIDCO ", Dock = DockStyle.Fill, Padding = new Padding(8, 6, 8, 8) };
        _remote.View = View.Details;
        _remote.FullRowSelect = true;
        _remote.Dock = DockStyle.Fill;
        _remote.Columns.Add("Sent", 190);
        _remote.Columns.Add("When", 130);
        _remote.Columns.Add("Result", 90);
        right.Controls.Add(_remote);

        var rightBar = new Panel { Dock = DockStyle.Bottom, Height = 36 };
        _sendNow.Text = "Send now";
        _sendNow.Size = new Size(94, 28);
        _sendNow.Location = new Point(0, 4);
        _sendNow.Click += (_, _) => _ = SendAsync(null);
        _auto.Text = "Start automatic sending";
        _auto.Size = new Size(168, 28);
        _auto.Location = new Point(102, 4);
        _auto.Click += (_, _) => ToggleAuto();
        rightBar.Controls.AddRange(new Control[] { _sendNow, _auto });
        right.Controls.Add(rightBar);
        panes.Panel2.Controls.Add(right);


        // --- transfer log ---------------------------------------------------
        var logBox = new GroupBox { Text = " Transfer log ", Dock = DockStyle.Bottom, Height = 160, Padding = new Padding(8, 6, 8, 8) };
        _log.Dock = DockStyle.Fill;
        _log.ReadOnly = true;
        _log.BackColor = Theme.LogBg;
        _log.ForeColor = Color.FromArgb(226, 232, 240);
        _log.Font = Theme.Mono;
        _log.BorderStyle = BorderStyle.None;
        // Diagnostics can be a couple of sentences long; wrapping beats making
        // the architect scroll sideways to read why a transfer failed.
        _log.WordWrap = true;
        _log.ScrollBars = RichTextBoxScrollBars.Vertical;
        logBox.Controls.Add(_log);

        // Docked controls are laid out in reverse z-order: whatever is added
        // last ends up closest to the form edge. So this goes innermost first —
        // the fill, then the log, then the status line, then the connect bar —
        // which reads top to bottom as: connect, status, panes, log.
        Controls.Add(panes);
        Controls.Add(logBox);
        Controls.Add(status);
        Controls.Add(connect);
    }

    private void LoadSettingsIntoFields()
    {
        // Exactly what was typed last time. Rebuilding it from a host and a
        // port appended the port a second time to an address that already
        // carried one — "http://host:3000" came back as "http://host:3000:3000",
        // which is not an address at all.
        _ip.Text = _settings.IpOrDefault;
        _username.Text = _settings.UsernameOrDefault;
        _company.Text = _settings.CompanyIdOrDefault;
        _folder.Text = _settings.CsvFolder;
        _keyPath.Text = _settings.PrivateKeyPath;
        _scheduleText.Text = $"Automatic sending is off · {Schedule.Describe(_settings.IntervalSeconds)}";
    }

    // -- helpers -----------------------------------------------------------

    private void Log(bool ok, string message)
    {
        _log.SelectionStart = _log.TextLength;
        _log.SelectionColor = ok ? Theme.LogGood : Theme.LogBad;
        _log.AppendText($"{DateTime.Now:HH:mm:ss}  {message}{Environment.NewLine}");
        _log.SelectionStart = _log.TextLength;
        _log.ScrollToCaret();
    }

    /// <summary>
    /// The sender for whatever is in the connection bar. Falls back to the
    /// port already connected on, so a send after a successful Connect goes to
    /// the same place rather than starting the search over.
    /// </summary>
    private CidcoSender Sender()
    {
        var port = ServerAddress.TryParse(_ip.Text, out var address, out _)
            ? (address.PortWasGiven ? address.Port : _settings.PortOrDefault)
            : _settings.PortOrDefault;

        var host = address.Host.Length > 0 ? address.Host : _ip.Text.Trim();

        return new CidcoSender(
            host,
            port,
            _username.Text.Trim(),
            _password.Text,
            _company.Text,
            _folder.Text.Trim())
        {
            PrivateKeyPath = _keyPath.Text.Trim(),
        };
    }

    /// <summary>Picks the private key file, the way any SSH client does.</summary>
    private void BrowseForKey()
    {
        using var dialog = new OpenFileDialog
        {
            Title = "Select the private key CIDCO or your server administrator gave you",
            Filter = "Private keys (*.ppk;*.pem;*.key)|*.ppk;*.pem;*.key|All files (*.*)|*.*",
            CheckFileExists = true,
        };

        var current = _keyPath.Text.Trim();
        if (current.Length > 0)
        {
            var folder = Path.GetDirectoryName(current);
            if (!string.IsNullOrEmpty(folder) && Directory.Exists(folder)) dialog.InitialDirectory = folder;
        }

        if (dialog.ShowDialog(this) == DialogResult.OK) _keyPath.Text = dialog.FileName;
    }

    private void RefreshLocal()
    {
        _local.BeginUpdate();
        _local.Items.Clear();

        var folder = _folder.Text.Trim();
        var files = ExportPicker.List(folder);

        if (files.Count == 0)
        {
            _local.Items.Add(new ListViewItem(new[]
            {
                Directory.Exists(folder) ? "(no .csv files yet)" : "(folder not found)", "", "",
            })
            { ForeColor = Theme.Faint });
        }
        else
        {
            foreach (var file in files)
            {
                _local.Items.Add(new ListViewItem(new[]
                {
                    file.Name,
                    Theme.HumanSize(file.Length),
                    file.LastWriteTime.ToString("dd/MM HH:mm"),
                })
                { Tag = file.FullName });
            }
        }
        _local.EndUpdate();
    }

    /// <summary>Fills the right-hand pane from this agent's own history.</summary>
    private void LoadHistory()
    {
        _remote.BeginUpdate();
        _remote.Items.Clear();
        foreach (var row in _db.RecentTransfers(200)) AddHistoryRow(row, append: true);
        _remote.EndUpdate();

        var (accepted, refused) = _db.TransferTally();
        if (accepted + refused > 0)
            Log(refused == 0, $"{accepted} transfer(s) accepted, {refused} refused so far.");
    }

    private void AddHistoryRow(TransferRecord row, bool append = false)
    {
        var item = new ListViewItem(new[]
        {
            row.FileName.Length > 0 ? row.FileName : "—",
            row.SentAt.LocalDateTime.ToString("dd/MM HH:mm:ss"),
            row.ResultLabel,
        })
        {
            ForeColor = row.Accepted ? Theme.Good : Theme.Bad,
            ToolTipText = row.Message,
        };

        if (append) _remote.Items.Add(item);
        else _remote.Items.Insert(0, item);
    }

    // -- actions -----------------------------------------------------------

    private async Task ConnectAsync()
    {
        // A private key is a credential in its own right — on a server that
        // takes keys there is usually no password to give.
        if (_password.Text.Length == 0 && _keyPath.Text.Trim().Length == 0)
        {
            Log(false, "Enter the CIDCO password, or choose a private key, before connecting.");
            return;
        }

        if (!ServerAddress.TryParse(_ip.Text, out var address, out var problem))
        {
            Log(false, problem);
            return;
        }

        _connect.Enabled = false;
        _state.Text = "Connecting\u2026";

        ICidcoTransport sender;
        SendResult result;
        try
        {
            // The address says which door: http:// goes to CIDCO's web portal,
            // anything else to their SFTP intake.
            (sender, result) = await Task.Run(() => CidcoTransports.Connect(
                address,
                _username.Text.Trim(),
                _password.Text,
                _company.Text.Trim(),
                _folder.Text.Trim(),
                timeout: null,
                privateKeyPath: _keyPath.Text.Trim()));
        }
        catch (Exception error)
        {
            // Anything unexpected has to come back to the architect and give
            // them their button back. Being stranded on "Connecting..." for
            // ever is the one outcome with no way out of it.
            _link.Record(
                SendResult.Failed($"Could not use that address - {error.Message}", TransferOutcome.Unreachable),
                DateTimeOffset.Now);
            ShowLinkState();
            Log(false, $"Could not use \"{_ip.Text.Trim()}\" - {error.Message}");
            _connect.Enabled = true;
            return;
        }

        _transport = result.Ok ? sender : null;
        _connectedTo = sender.Describe;
        _link.Record(result, DateTimeOffset.Now);
        ShowLinkState();
        Log(result.Ok, result.Message);

        if (result.Ok)
        {
            // Remember everything except the password, so the next run is a
            // matter of typing the password and pressing Connect.
            _settings.DesignatedIp = _ip.Text.Trim();
            _settings.Username = _username.Text.Trim();
            _settings.CompanyId = _company.Text.Trim();
            _settings.CsvFolder = _folder.Text.Trim();
            _settings.PrivateKeyPath = _keyPath.Text.Trim();

            // An SFTP intake found on a port worth remembering; the portal
            // carries its port in the address already.
            // Only rewrite the address when the agent found the port itself,
            // and even then keep the folder: dropping it would silently turn a
            // plain SFTP destination back into a CIDCO one on the next run.
            if (sender is CidcoSender found && !found.IsPlainSftp)
            {
                _settings.Port = found.Port;
                _ip.Text = found.Port == ServerAddress.StandardPort
                    ? found.Host
                    : $"{found.Host}:{found.Port}";
                _settings.DesignatedIp = _ip.Text;
            }

            _settings.Save(_db);
        }

        _connect.Enabled = true;
        RefreshLocal();
    }

    private void SendSelected()
    {
        if (_local.SelectedItems.Count == 0)
        {
            Log(false, "Select a file on the left first.");
            return;
        }
        if (_local.SelectedItems[0].Tag is not string path)
        {
            Log(false, "There is nothing to send in that row.");
            return;
        }
        _ = SendAsync(new FileInfo(path));
    }

    private async Task SendAsync(FileInfo? file, bool scheduled = false)
    {
        var now = DateTimeOffset.Now;

        if (scheduled)
        {
            // Nobody is watching, so the tick decides for itself whether this
            // is a moment worth trying: not while waiting out a backoff, and
            // not at all while something needs a person.
            if (!_link.ShouldTry(now)) return;

            // Automatic sending takes the newest export in the folder. If the
            // monitoring software has not written since the last send, that
            // newest file is the one already delivered — and sending it again
            // would file the same readings under a fresh timestamp, which
            // CIDCO cannot tell from genuinely new data. So the tick waits.
            file ??= ExportPicker.Newest(_settings.CsvFolder);
            if (file is null)
            {
                Log(false, $"Nothing to send — no .csv in {(string.IsNullOrWhiteSpace(_settings.CsvFolder) ? "(no folder set)" : _settings.CsvFolder)}.");
                return;
            }

            var fingerprint = ExportPicker.Fingerprint(file);
            if (_db.GetSetting(SettingsKeys.LastSentExport) == fingerprint)
            {
                Log(false,
                    $"{file.Name} has not changed since it was last sent — nothing new to send. " +
                    "The next reading goes as soon as it is written.");
                return;
            }
        }
        else if (!_link.Healthy && _link.ConsecutiveFailures == 0)
        {
            Log(false, "Connect to CIDCO first.");
            return;
        }

        if (_sending) return; // a send is already in flight
        _sending = true;

        try
        {
            var sender = _transport ?? Sender();
            var result = await Task.Run(() => sender.SendAndRecord(_db, file));

            var wasDown = !_link.Healthy && _link.ConsecutiveFailures > 0;
            _link.Record(result, DateTimeOffset.Now);

            // Remember the export only once CIDCO has taken it. Recording it
            // on a failed send would mean a reading that never arrived is
            // never retried.
            if (result.Ok && file is not null)
            {
                file.Refresh();
                if (file.Exists) _db.SetSetting(SettingsKeys.LastSentExport, ExportPicker.Fingerprint(file));
            }

            // Only say "back" when there was something to come back from.
            if (result.Ok && wasDown) Log(true, "CIDCO is reachable again — sending resumed.");

            LogTick(result, scheduled);
            ShowLinkState();

            AddHistoryRow(new TransferRecord
            {
                FileName = result.FileName.Length > 0 ? result.FileName : file?.Name ?? "",
                Accepted = result.Ok,
                Message = result.Message,
                SentAt = result.SentAt,
                Outcome = result.Outcome,
            });
        }
        finally
        {
            _sending = false;
        }
    }

    /// <summary>
    /// Logs a tick's result without turning an outage into a wall of identical
    /// lines. The first failure is reported in full; the ones after it only
    /// when the wait between attempts changes.
    /// </summary>
    private void LogTick(SendResult result, bool scheduled)
    {
        if (result.Ok || !scheduled)
        {
            Log(result.Ok, result.Message);
            return;
        }

        if (result.Outcome == TransferOutcome.NothingToSend) return;   // nothing happened

        if (_link.ConsecutiveFailures <= 1 || _link.ConsecutiveFailures % 4 == 0)
            Log(false, result.Message);
    }

    /// <summary>
    /// Sets how soon the next tick comes.
    ///
    /// While the link is up that is the schedule the architect chose. While it
    /// is down it is the backoff instead, because a three-hourly schedule that
    /// waits three hours to notice CIDCO is back is no use to anyone — the
    /// retry has to be able to outpace the schedule.
    /// </summary>
    private void ReArmTimer()
    {
        var seconds = _link.Healthy || _link.Blocked
            ? _settings.IntervalSeconds
            : (int)Math.Ceiling(_link.CurrentBackoff.TotalSeconds);

        _timer.Interval = Math.Max(1, seconds) * 1000;

        if (_timer.Enabled)
        {
            _scheduleText.Text = _link.Healthy
                ? $"Sending automatically every {Schedule.Describe(_settings.IntervalSeconds)}"
                : $"Retrying every {Schedule.Describe(seconds)} until CIDCO answers";
        }
    }

    /// <summary>Puts the link's state on the status line, in its own colour.</summary>
    private void ShowLinkState()
    {
        _state.Text = _link.Describe(_connectedTo);
        _state.ForeColor = _link.Healthy && _link.NeedsAttention is null ? Theme.Good : Theme.Bad;
    }

    private void ToggleAuto()
    {
        if (_timer.Enabled)
        {
            _timer.Stop();
            _auto.Text = "Start automatic sending";
            _scheduleText.Text = $"Automatic sending is off · {Schedule.Describe(_settings.IntervalSeconds)}";
            Log(true, "Automatic sending stopped.");
            return;
        }

        if (!_link.Healthy)
        {
            Log(false, "Connect to CIDCO before starting the schedule.");
            return;
        }

        var every = Schedule.Describe(_settings.IntervalSeconds);
        ReArmTimer();
        _timer.Start();
        _auto.Text = "Stop automatic sending";
        _scheduleText.Text = $"Sending automatically every {every}";
        Log(true, $"Automatic sending started — every {every}.");

        _ = SendAsync(null, scheduled: true);
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);

        // Now the panes have a real width, so an even split is a legal one.
        if (_panes is { Width: > 0 } panes)
        {
            var half = panes.Width / 2;
            var lowest = panes.Panel1MinSize;
            var highest = panes.Width - panes.Panel2MinSize;
            if (highest > lowest) panes.SplitterDistance = Math.Clamp(half, lowest, highest);

            // Only once the position is valid can the minimums be raised to
            // something that keeps both panes usable.
            if (panes.Width > 640)
            {
                panes.Panel1MinSize = 300;
                panes.Panel2MinSize = 300;
            }
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _timer.Stop();
        _timer.Dispose();
        base.OnFormClosed(e);
    }
}
