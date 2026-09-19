namespace Cidco.Core;

/// <summary>Which screen the setup wizard is on.</summary>
public enum SetupStep
{
    Role,
    Admin,
    Folder,
    Schedule,
    Install,
}

/// <summary>
/// The decisions the setup wizard makes, with no window attached.
///
/// The wizard itself only draws; which step comes next, and whether the chosen
/// folder is good enough to move on, are decided here so they can be tested
/// without a desktop.
/// </summary>
public sealed class SetupFlow
{
    private int _index;

    public string Role { get; set; } = "architect";
    public string CsvFolder { get; set; } = "";
    public string IntervalLabel { get; set; } = Schedule.LabelFor(Schedule.DefaultSeconds);

    /// <summary>The last thing that stopped the wizard moving on, if anything.</summary>
    public string Status { get; private set; } = "";

    public bool IsAdmin => Role == "admin";

    /// <summary>
    /// The screens in order. Choosing Administrator collapses the wizard to two
    /// steps, because there is nothing to install on that side.
    /// </summary>
    public SetupStep[] Steps => IsAdmin
        ? new[] { SetupStep.Role, SetupStep.Admin }
        : new[] { SetupStep.Role, SetupStep.Folder, SetupStep.Schedule, SetupStep.Install };

    public SetupStep Current
    {
        get
        {
            _index = Math.Clamp(_index, 0, Steps.Length - 1);
            return Steps[_index];
        }
    }

    public int Index => Math.Clamp(_index, 0, Steps.Length - 1);

    public bool CanGoBack => Index > 0;

    /// <summary>What the Next button should say on the current step.</summary>
    public string NextButtonText => Current switch
    {
        SetupStep.Admin => "Finish",
        SetupStep.Install => "Install",
        _ => "Next >",
    };

    /// <summary>
    /// Tries to move to the next screen. False means the wizard stays where it
    /// is and <see cref="Status"/> says why.
    /// </summary>
    public bool TryAdvance(Func<string, bool>? folderExists = null)
    {
        folderExists ??= Directory.Exists;

        if (Current == SetupStep.Folder)
        {
            var folder = CsvFolder.Trim();
            if (folder.Length == 0)
            {
                Status = "Choose the folder your AQI CSV is exported to.";
                return false;
            }
            if (!folderExists(folder))
            {
                Status = "That folder does not exist on this PC.";
                return false;
            }
            CsvFolder = folder;
        }

        Status = "";
        if (_index < Steps.Length - 1) _index++;
        return true;
    }

    public void GoBack()
    {
        if (_index > 0) _index--;
        Status = "";
    }

    /// <summary>Everything the installer needs, once the wizard has been walked.</summary>
    public Settings ToSettings() => new()
    {
        Role = "architect",
        CsvFolder = CsvFolder.Trim(),
        IntervalSeconds = Schedule.SecondsFor(IntervalLabel),
        Username = Settings.Defaults.Username,
        CompanyId = Settings.Defaults.CompanyId,
        Port = Settings.Defaults.Port,
    };
}
