using System.Drawing;

namespace Cidco.Ui;

/// <summary>
/// The look both windows share, so the installer and the agent are recognisably
/// the same program. Matches the violet the CIDCO web portal uses.
/// </summary>
internal static class Theme
{
    public static readonly Color Accent = Color.FromArgb(109, 40, 217);
    public static readonly Color AccentDark = Color.FromArgb(76, 29, 149);
    public static readonly Color BannerBg = Color.FromArgb(237, 233, 254);
    public static readonly Color Surface = Color.White;
    public static readonly Color PanelBg = Color.FromArgb(248, 250, 252);
    public static readonly Color Border = Color.FromArgb(226, 232, 240);
    public static readonly Color Muted = Color.FromArgb(107, 114, 128);
    public static readonly Color Faint = Color.FromArgb(156, 163, 175);
    public static readonly Color Good = Color.FromArgb(4, 120, 87);
    public static readonly Color Bad = Color.FromArgb(185, 28, 28);

    public static readonly Color LogBg = Color.FromArgb(15, 23, 42);
    public static readonly Color LogGood = Color.FromArgb(110, 231, 183);
    public static readonly Color LogBad = Color.FromArgb(252, 165, 165);

    public static readonly Font Heading = new("Segoe UI", 13F, FontStyle.Bold);
    public static readonly Font Body = new("Segoe UI", 9F);
    public static readonly Font Small = new("Segoe UI", 8F);
    public static readonly Font Strong = new("Segoe UI", 9F, FontStyle.Bold);
    public static readonly Font Mono = new("Consolas", 9F);
    public static readonly Font MonoSmall = new("Consolas", 8F);

    public static string HumanSize(long bytes) =>
        bytes < 1024 ? $"{bytes} B" : $"{bytes / 1024.0:0.#} KB";
}
