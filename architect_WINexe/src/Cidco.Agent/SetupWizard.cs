using System.Runtime.Versioning;
using Cidco.Core;
using Cidco.Ui;

namespace Cidco.Agent;

/// <summary>
/// A small stepped dialog, in the shape of an ordinary Windows installer:
///
///     1. Log in as .........  Administrator or Architect
///     2. CSV folder ........  where the automation picks the export up
///     3. Schedule ..........  how often it is sent
///     4. Install ...........  unpacks the agent and writes the settings
///
/// Only the architect side is installed here — the administrator side is
/// CIDCO's own web portal, and the wizard says so rather than pretending to
/// install something.
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class SetupWizard : Form
{
    private readonly SetupFlow _flow = new();
    private bool _installed;
    private string _installedExe = "";

    private readonly Panel _body = new();
    private readonly Button _next = new();
    private readonly Button _back = new();
    private readonly Button _cancel = new();

    // Carried between steps.
    private readonly string _installFolder = Installer.DefaultInstallFolder();
    private bool _desktopShortcut = true;
    private bool _startMenuShortcut = true;
    private bool _runAtLogin;
    private bool _launchWhenDone = true;

    // Live controls on the install step.
    private ProgressBar? _progress;
    private Label? _status;

    public SetupWizard()
    {
        Text = "CIDCO AQI Agent 1.0 Setup";
        ClientSize = new Size(600, 410);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Theme.Surface;
        Font = Theme.Body;

        BuildChrome();
        Render();
    }

    // -- chrome ------------------------------------------------------------

    private void BuildChrome()
    {
        var banner = new Panel
        {
            Dock = DockStyle.Left,
            Width = 160,
            BackColor = Theme.BannerBg,
        };
        banner.Controls.Add(new Label
        {
            Text = "CIDCO",
            ForeColor = Theme.Accent,
            Font = new Font("Segoe UI", 20F, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(18, 46),
        });
        banner.Controls.Add(new Label
        {
            Text = "AQI Agent",
            ForeColor = Theme.AccentDark,
            Font = new Font("Segoe UI", 11F),
            AutoSize = true,
            Location = new Point(20, 88),
        });
        banner.Controls.Add(new Label
        {
            Text = "SFTP file transfer",
            ForeColor = Theme.Muted,
            Font = Theme.Small,
            AutoSize = true,
            Location = new Point(20, 112),
        });
        // Pinned to the bottom of the banner rather than a fixed y, which the
        // footer was cropping.
        banner.Controls.Add(new Label
        {
            Text = "v" + WindowsIntegration.Version,
            ForeColor = Theme.Faint,
            Font = Theme.Small,
            Dock = DockStyle.Bottom,
            TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(20, 0, 0, 0),
            Height = 28,
        });
        Controls.Add(banner);

        var footer = new Panel { Dock = DockStyle.Bottom, Height = 56, BackColor = Theme.Surface };

        _cancel.Text = "Cancel";
        _cancel.Size = new Size(88, 28);
        _cancel.Location = new Point(496, 14);
        _cancel.Click += (_, _) => Close();

        _next.Text = "Next >";
        _next.Size = new Size(88, 28);
        _next.Location = new Point(400, 14);
        _next.Click += (_, _) => OnNext();

        _back.Text = "< Back";
        _back.Size = new Size(88, 28);
        _back.Location = new Point(306, 14);
        _back.Click += (_, _) => OnBack();

        footer.Controls.AddRange(new Control[] { _back, _next, _cancel });
        Controls.Add(footer);

        _body.Dock = DockStyle.Fill;
        _body.BackColor = Theme.Surface;
        _body.Padding = new Padding(24, 20, 24, 8);
        Controls.Add(_body);
        _body.BringToFront();
    }

    private void Render()
    {
        _body.SuspendLayout();
        foreach (Control child in _body.Controls) child.Dispose();
        _body.Controls.Clear();
        _progress = null;
        _status = null;

        switch (_flow.Current)
        {
            case SetupStep.Role: BuildRoleStep(); break;
            case SetupStep.Admin: BuildAdminStep(); break;
            case SetupStep.Folder: BuildFolderStep(); break;
            case SetupStep.Schedule: BuildScheduleStep(); break;
            case SetupStep.Install: BuildInstallStep(); break;
        }

        _next.Text = _flow.NextButtonText;
        _back.Enabled = _flow.CanGoBack && !_installed;
        _body.ResumeLayout();
    }

    private int Heading(string title, string subtitle)
    {
        _body.Controls.Add(new Label
        {
            Text = title,
            Font = Theme.Heading,
            AutoSize = true,
            Location = new Point(24, 20),
        });
        var sub = new Label
        {
            Text = subtitle,
            ForeColor = Theme.Muted,
            Font = Theme.Body,
            Location = new Point(24, 50),
            Size = new Size(390, 46),
        };
        _body.Controls.Add(sub);
        return 104;
    }

    // -- steps -------------------------------------------------------------

    private void BuildRoleStep()
    {
        var y = Heading(
            "Who is this computer for?",
            "The agent installs the architect side. CIDCO officers use the web portal instead.");

        foreach (var (value, label, hint) in new[]
                 {
                     ("architect", "Architect", "Send AQI readings to CIDCO automatically from this PC."),
                     ("admin", "Administrator (CIDCO)", "Review submitted data on the CIDCO web portal."),
                 })
        {
            var radio = new RadioButton
            {
                Text = label,
                Checked = _flow.Role == value,
                Font = new Font("Segoe UI", 10F),
                Location = new Point(24, y),
                AutoSize = true,
                Tag = value,
            };
            radio.CheckedChanged += (sender, _) =>
            {
                if (sender is RadioButton { Checked: true, Tag: string chosen })
                {
                    _flow.Role = chosen;
                    Render();
                }
            };
            _body.Controls.Add(radio);

            _body.Controls.Add(new Label
            {
                Text = hint,
                ForeColor = Theme.Faint,
                Font = Theme.Small,
                Location = new Point(44, y + 22),
                Size = new Size(380, 18),
            });
            y += 54;
        }

    }

    private void BuildAdminStep()
    {
        var y = Heading(
            "Nothing to install",
            "The administrator side is CIDCO's web portal \u2014 open it in a browser and sign in with " +
            "your officer account. This installer only sets up the architect's sending agent.");

        _body.Controls.Add(new Label
        {
            Text = "CIDCO portal:",
            Font = Theme.Body,
            Location = new Point(24, y),
            AutoSize = true,
        });
        _body.Controls.Add(new TextBox
        {
            Text = "http://<cidco-host>:3000/",
            ReadOnly = true,
            Location = new Point(24, y + 22),
            Width = 340,
            Font = Theme.Mono,
        });

    }

    private void BuildFolderStep()
    {
        var y = Heading(
            "Where is the AQI export saved?",
            "Pick the folder your monitoring software writes its CSV into. The agent takes the newest " +
            "file from here every time it runs, renames it to your company id and the " +
            "time, and sends that.");

        var box = new TextBox
        {
            Text = _flow.CsvFolder,
            Location = new Point(24, y),
            Width = 290,
            Font = Theme.Body,
        };
        box.TextChanged += (_, _) => _flow.CsvFolder = box.Text;
        _body.Controls.Add(box);

        var browse = new Button
        {
            Text = "Browse\u2026",
            Location = new Point(322, y - 1),
            Size = new Size(88, 26),
        };
        browse.Click += (_, _) =>
        {
            using var dialog = new FolderBrowserDialog
            {
                Description = "Select the folder your AQI CSV is exported to",
                UseDescriptionForTitle = true,
            };
            if (Directory.Exists(_flow.CsvFolder)) dialog.SelectedPath = _flow.CsvFolder;
            if (dialog.ShowDialog(this) == DialogResult.OK)
            {
                _flow.CsvFolder = dialog.SelectedPath;
                box.Text = _flow.CsvFolder;
                SetStatus("");
            }
        };
        _body.Controls.Add(browse);

        _status = new Label
        {
            Text = "",
            ForeColor = Theme.Bad,
            Font = Theme.Small,
            Location = new Point(24, y + 30),
            Size = new Size(390, 18),
        };
        _body.Controls.Add(_status);

        _body.Controls.Add(new Label
        {
            Text = @"Example:  C:\CIDCO\exports",
            ForeColor = Theme.Faint,
            Font = Theme.Small,
            Location = new Point(24, y + 54),
            AutoSize = true,
        });

    }

    private void BuildScheduleStep()
    {
        var y = Heading(
            "How often should it send?",
            "The agent runs in the background and sends the newest CSV on this schedule. You can " +
            "change it later in the agent itself.");

        var picker = new ComboBox
        {
            DropDownStyle = ComboBoxStyle.DropDownList,
            Location = new Point(24, y),
            Width = 240,
            Font = Theme.Body,
        };
        picker.Items.AddRange(Schedule.Labels);
        picker.SelectedItem = _flow.IntervalLabel;
        if (picker.SelectedIndex < 0) picker.SelectedIndex = picker.Items.Count - 1;
        picker.SelectedIndexChanged += (_, _) =>
            _flow.IntervalLabel = picker.SelectedItem?.ToString() ?? _flow.IntervalLabel;
        _body.Controls.Add(picker);

        _body.Controls.Add(new Label
        {
            Text = "Short intervals are useful while testing; every 1\u20133 hours suits a live station.",
            ForeColor = Theme.Faint,
            Font = Theme.Small,
            Location = new Point(24, y + 32),
            Size = new Size(390, 32),
        });

    }

    private void BuildInstallStep()
    {
        var y = Heading("Ready to install", "Review the settings, then install. Nothing is sent to CIDCO yet.");

        var summary = new Panel
        {
            Location = new Point(24, y - 8),
            Size = new Size(390, 74),
            BackColor = Theme.PanelBg,
            BorderStyle = BorderStyle.FixedSingle,
        };
        var line = 6;
        foreach (var (label, value) in new[]
                 {
                     ("Install for", "Architect"),
                     ("CSV folder", _flow.CsvFolder.Length > 0 ? _flow.CsvFolder : "(not set)"),
                     ("Schedule", _flow.IntervalLabel),
                 })
        {
            summary.Controls.Add(new Label
            {
                Text = label,
                ForeColor = Theme.Muted,
                Font = Theme.Small,
                Location = new Point(10, line),
                Size = new Size(76, 16),
            });
            summary.Controls.Add(new Label
            {
                Text = value,
                Font = Theme.MonoSmall,
                Location = new Point(90, line),
                Size = new Size(292, 16),
                AutoEllipsis = true,
            });
            line += 21;
        }
        _body.Controls.Add(summary);

        var optionsTop = y + 74;
        var desktop = new CheckBox
        {
            Text = "Create a desktop shortcut",
            Checked = _desktopShortcut,
            Location = new Point(24, optionsTop),
            AutoSize = true,
            Font = Theme.Body,
        };
        desktop.CheckedChanged += (_, _) => _desktopShortcut = desktop.Checked;

        var login = new CheckBox
        {
            Text = "Start the agent when I sign in to Windows",
            Checked = _runAtLogin,
            Location = new Point(24, optionsTop + 24),
            AutoSize = true,
            Font = Theme.Body,
        };
        login.CheckedChanged += (_, _) => _runAtLogin = login.Checked;

        _body.Controls.AddRange(new Control[] { desktop, login });

        _progress = new ProgressBar
        {
            Location = new Point(24, optionsTop + 58),
            Size = new Size(390, 16),
            Maximum = 100,
        };
        _body.Controls.Add(_progress);

        _status = new Label
        {
            Text = "",
            ForeColor = Theme.Muted,
            Font = Theme.Small,
            Location = new Point(24, optionsTop + 80),
            Size = new Size(390, 32),
        };
        _body.Controls.Add(_status);

    }

    // -- navigation --------------------------------------------------------

    private void SetStatus(string message, bool bad = true)
    {
        if (_status is null) return;
        _status.Text = message;
        _status.ForeColor = bad ? Theme.Bad : Theme.Good;
    }

    private void OnBack()
    {
        if (_installed) return;
        _flow.GoBack();
        Render();
    }

    private void OnNext()
    {
        if (_installed)
        {
            Finish();
            return;
        }

        switch (_flow.Current)
        {
            case SetupStep.Admin:
                Close();
                return;

            case SetupStep.Install:
                _ = RunInstall();
                return;
        }

        if (!_flow.TryAdvance())
        {
            SetStatus(_flow.Status);
            return;
        }

        SetStatus("");
        Render();
    }

    private async Task RunInstall()
    {
        _next.Enabled = false;
        _back.Enabled = false;

        var settings = _flow.ToSettings();

        var options = new Installer.Options
        {
            InstallFolder = _installFolder,
            DesktopShortcut = _desktopShortcut,
            StartMenuShortcut = _startMenuShortcut,
            RunAtLogin = _runAtLogin,
        };

        var steps = 0;
        var progress = new Progress<string>(message =>
        {
            steps++;
            if (_progress is not null) _progress.Value = Math.Min(100, steps * 16);
            SetStatus(message, bad: false);
        });

        try
        {
            // Off the UI thread: unpacking and the registry both touch disk.
            _installedExe = await Task.Run(() => Installer.Install(options, settings, progress));
        }
        catch (Exception error)
        {
            if (_progress is not null) _progress.Value = 0;
            SetStatus(error.Message);
            _next.Enabled = true;
            _back.Enabled = true;
            return;
        }

        if (_progress is not null) _progress.Value = 100;
        _installed = true;
        SetStatus($"Installed to {Path.GetDirectoryName(_installedExe)}", bad: false);

        var launch = new CheckBox
        {
            Text = "Open the CIDCO AQI Agent now",
            Checked = _launchWhenDone,
            Location = new Point(24, _status!.Bottom + 6),
            AutoSize = true,
            Font = Theme.Body,
        };
        launch.CheckedChanged += (_, _) => _launchWhenDone = launch.Checked;
        _body.Controls.Add(launch);

        _next.Text = "Finish";
        _next.Enabled = true;
        _cancel.Enabled = false;
    }

    private void Finish()
    {
        if (_launchWhenDone && File.Exists(_installedExe))
        {
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(_installedExe)
                {
                    UseShellExecute = true,
                    WorkingDirectory = Path.GetDirectoryName(_installedExe)!,
                });
            }
            catch (Exception)
            {
                // The shortcut is still there; not being able to launch now is
                // not worth an error dialog at the very end of a good install.
            }
        }
        Close();
    }
}
