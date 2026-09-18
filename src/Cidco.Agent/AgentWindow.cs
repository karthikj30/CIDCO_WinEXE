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

    private bool _connected;
    private bool _sending;

    private readonly TextBox _ip = new();
    private readonly TextBox _username = new();
    private readonly TextBox _password = new();
    private readonly TextBox _company = new();
    private readonly TextBox _folder = new();

    private readonly Button _connect = new();
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

        _timer.Tick += (_, _) => _ = SendAsync(null, scheduled: true);
    }

    // -- layout ------------------------------------------------------------

    private void Build()
    {
        var connect = new GroupBox
        {
            Text = " Connect to CIDCO ",
            Dock = DockStyle.Top,
            Height = 116,
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
            Text = "File path (set during setup — CIDCO checks it on every transfer)",
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
        // The port is shown only when it is not CIDCO's usual one, so the
        // common case is a bare address and the unusual one is still visible.
        _ip.Text = _settings.PortOrDefault == ServerAddress.StandardPort
            ? _settings.IpOrDefault
            : $"{_settings.IpOrDefault}:{_settings.PortOrDefault}";
        _username.Text = _settings.UsernameOrDefault;
        _company.Text = _settings.CompanyIdOrDefault;
        _folder.Text = _settings.CsvFolder;
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
            _folder.Text.Trim());
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
            row.Accepted ? "Accepted" : "Refused",
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
        if (_password.Text.Length == 0)
        {
            Log(false, "Enter the CIDCO password before connecting.");
            return;
        }

        if (!ServerAddress.TryParse(_ip.Text, out var address, out var problem))
        {
            Log(false, problem);
            return;
        }

        _connect.Enabled = false;
        _state.Text = "Connecting\u2026";

        // Only an address was given, so let the sender look for the intake.
        var (sender, result) = await Task.Run(() => CidcoSender.FindIntake(
            address,
            _username.Text.Trim(),
            _password.Text,
            _company.Text.Trim(),
            _folder.Text.Trim()));

        _connected = result.Ok;
        _state.Text = result.Ok
            ? $"Connected · {sender.CompanyId} → {sender.Host}:{sender.Port}"
            : "Not connected";
        _state.ForeColor = result.Ok ? Theme.Good : Theme.Bad;
        Log(result.Ok, result.Message);

        if (result.Ok)
        {
            // Remember everything except the password, so the next run is a
            // matter of typing the password and pressing Connect.
            _settings.DesignatedIp = sender.Host;
            _settings.Port = sender.Port;
            _settings.Username = sender.Username;
            _settings.CompanyId = sender.CompanyId;
            _settings.CsvFolder = sender.CsvFolder;
            _settings.Save(_db);

            // Show the port back only when it was not the usual one, so the
            // field keeps reading as a plain address in the common case.
            _ip.Text = sender.Port == ServerAddress.StandardPort
                ? sender.Host
                : $"{sender.Host}:{sender.Port}";
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
        if (!_connected)
        {
            // A scheduled tick that cannot connect should say so once, not
            // fill the log with the same line every few seconds.
            if (!scheduled) Log(false, "Connect to CIDCO first.");
            return;
        }
        if (_sending) return; // a send is already in flight
        _sending = true;

        try
        {
            var sender = Sender();
            var result = await Task.Run(() => sender.SendAndRecord(_db, file));

            Log(result.Ok, result.Message);
            AddHistoryRow(new TransferRecord
            {
                FileName = result.FileName.Length > 0 ? result.FileName : file?.Name ?? "",
                Accepted = result.Ok,
                Message = result.Message,
                SentAt = result.SentAt,
            });
        }
        finally
        {
            _sending = false;
        }
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

        if (!_connected)
        {
            Log(false, "Connect to CIDCO before starting the schedule.");
            return;
        }

        var every = Schedule.Describe(_settings.IntervalSeconds);
        _timer.Interval = Math.Max(1, _settings.IntervalSeconds) * 1000;
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
