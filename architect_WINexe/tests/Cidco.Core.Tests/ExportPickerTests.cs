using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

public class ExportPickerTests : IDisposable
{
    private readonly string _folder;

    public ExportPickerTests()
    {
        _folder = Path.Combine(Path.GetTempPath(), "cidco-exports-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_folder);
    }

    public void Dispose()
    {
        try { Directory.Delete(_folder, recursive: true); } catch (IOException) { }
    }

    private string Write(string name, TimeSpan? age = null)
    {
        var path = Path.Combine(_folder, name);
        File.WriteAllText(path, AqiCsv.HeaderRow() + "\nCIDCO-KHR-012\n");
        if (age is not null) File.SetLastWriteTimeUtc(path, DateTime.UtcNow - age.Value);
        return path;
    }

    [Fact]
    public void An_empty_folder_yields_nothing() => Assert.Null(ExportPicker.Newest(_folder));

    [Fact]
    public void A_missing_folder_yields_nothing() =>
        Assert.Null(ExportPicker.Newest(Path.Combine(_folder, "nope")));

    [Fact]
    public void An_empty_path_yields_nothing() => Assert.Null(ExportPicker.Newest(""));

    [Fact]
    public void The_newest_csv_wins()
    {
        Write("old.csv", TimeSpan.FromMinutes(10));
        Write("new.csv");
        Assert.Equal("new.csv", ExportPicker.Newest(_folder)!.Name);
    }

    [Fact]
    public void Files_that_are_not_readings_are_ignored()
    {
        Write("notes.txt");
        Write("~lock.tmp");
        Assert.Null(ExportPicker.Newest(_folder));
    }

    [Fact]
    public void A_spreadsheet_is_not_an_export()
    {
        // Every upload is renamed to .csv, so an .xlsx would arrive as a
        // binary file wearing a .csv name: accepted by type, rejected by
        // columns. Better never to pick it up.
        Write("readings.xlsx");
        Assert.Null(ExportPicker.Newest(_folder));
    }

    [Fact]
    public void The_local_pane_lists_newest_first()
    {
        Write("old.csv", TimeSpan.FromMinutes(10));
        Write("new.csv");
        Write("notes.txt");
        Assert.Equal(new[] { "new.csv", "old.csv" }, ExportPicker.List(_folder).Select(f => f.Name));
    }

    [Fact]
    public void The_local_pane_of_a_missing_folder_is_empty() =>
        Assert.Empty(ExportPicker.List(Path.Combine(_folder, "nope")));
}

public class AqiCsvTests
{
    [Fact]
    public void The_published_columns_are_all_present_in_order() =>
        Assert.Equal(new[]
        {
            "Project / Site ID",
            "AQI Monitoring Station / Device ID",
            "OEM / Model",
            "Date & Time of Reading",
            "AQI Value",
            "PM2.5",
            "PM10",
            "NO₂",
            "SO₂",
            "CO",
            "O₃",
            "Temperature",
            "Humidity",
            "Other applicable environmental parameters",
            "Data Source / Integration Method",
            "Data Receipt Timestamp",
        }, AqiCsv.Columns);

    [Theory]
    [InlineData("readings.csv", true)]
    [InlineData("READINGS.CSV", true)]
    [InlineData("readings.xlsx", false)]
    [InlineData("notes.txt", false)]
    [InlineData("readings.csv.bak", false)]
    public void Only_a_csv_is_sendable(string name, bool accepted) =>
        Assert.Equal(accepted, AqiCsv.IsAccepted(name));
}

/// <summary>
/// What automatic sending picks out of a folder with many files in it.
///
/// The architect names a folder, not a file, so on every tick the agent has to
/// decide by itself which export is the reading. It takes the most recently
/// written one — and, because a folder full of files is the normal case rather
/// than the exception, it has to make that choice the same way every time.
/// </summary>
public class NewestExportTests : IDisposable
{
    private readonly string _folder;

    public NewestExportTests()
    {
        _folder = Path.Combine(Path.GetTempPath(), "cidco-newest-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_folder);
    }

    public void Dispose()
    {
        try { Directory.Delete(_folder, recursive: true); } catch (IOException) { }
    }

    private FileInfo Write(string name, TimeSpan age, string body = "x")
    {
        var path = Path.Combine(_folder, name);
        File.WriteAllText(path, body);
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow - age);
        return new FileInfo(path);
    }

    [Fact]
    public void Out_of_a_crowded_folder_the_last_modified_one_goes()
    {
        Write("monday.csv", TimeSpan.FromDays(3));
        Write("tuesday.csv", TimeSpan.FromDays(2));
        Write("latest.csv", TimeSpan.FromMinutes(1));
        Write("wednesday.csv", TimeSpan.FromDays(1));

        Assert.Equal("latest.csv", ExportPicker.Newest(_folder)!.Name);
    }

    [Fact]
    public void The_name_has_no_say_in_it()
    {
        // Not alphabetical, not "latest", not the one that looks newest.
        Write("zzz-old.csv", TimeSpan.FromDays(5));
        Write("aaa-new.csv", TimeSpan.FromMinutes(2));

        Assert.Equal("aaa-new.csv", ExportPicker.Newest(_folder)!.Name);
    }

    [Fact]
    public void A_file_rewritten_in_place_becomes_the_newest_again()
    {
        // The everyday case: monitoring software overwriting one export.
        Write("readings.csv", TimeSpan.FromDays(1));
        Write("other.csv", TimeSpan.FromHours(1));
        Assert.Equal("other.csv", ExportPicker.Newest(_folder)!.Name);

        Write("readings.csv", TimeSpan.Zero);
        Assert.Equal("readings.csv", ExportPicker.Newest(_folder)!.Name);
    }

    [Fact]
    public void Files_that_are_not_csvs_are_never_the_newest()
    {
        Write("readings.csv", TimeSpan.FromHours(4));
        Write("notes.txt", TimeSpan.Zero);
        Write("~lock.tmp", TimeSpan.Zero);
        Write("report.xlsx", TimeSpan.Zero);

        Assert.Equal("readings.csv", ExportPicker.Newest(_folder)!.Name);
    }

    [Fact]
    public void A_tie_is_broken_the_same_way_every_time()
    {
        // Two exports written in the same clock tick. Left to the filesystem
        // the order is arbitrary, so the agent could send a different one on
        // each run with nothing having changed.
        var at = TimeSpan.FromMinutes(5);
        Write("alpha.csv", at);
        Write("beta.csv", at);
        Write("gamma.csv", at);

        var first = ExportPicker.Newest(_folder)!.Name;
        for (var i = 0; i < 5; i++) Assert.Equal(first, ExportPicker.Newest(_folder)!.Name);
    }

    [Fact]
    public void The_listing_agrees_with_the_choice()
    {
        // The local pane shows newest first; whatever is at the top of it is
        // what an unattended tick would send. If those two disagreed the
        // architect would be watching one file and the agent sending another.
        Write("old.csv", TimeSpan.FromDays(2));
        Write("newest.csv", TimeSpan.FromSeconds(30));
        Write("middle.csv", TimeSpan.FromHours(6));

        Assert.Equal(ExportPicker.List(_folder)[0].Name, ExportPicker.Newest(_folder)!.Name);
    }

    // --- not sending the same reading twice --------------------------------

    [Fact]
    public void An_untouched_file_keeps_the_same_fingerprint()
    {
        var file = Write("readings.csv", TimeSpan.FromMinutes(10));
        Assert.Equal(ExportPicker.Fingerprint(file), ExportPicker.Fingerprint(new FileInfo(file.FullName)));
    }

    [Fact]
    public void Rewriting_the_same_name_changes_the_fingerprint()
    {
        var before = ExportPicker.Fingerprint(Write("readings.csv", TimeSpan.FromHours(3)));
        var after = ExportPicker.Fingerprint(Write("readings.csv", TimeSpan.Zero));
        Assert.NotEqual(before, after);
    }

    [Fact]
    public void A_file_rewritten_within_the_same_second_still_differs()
    {
        // Write time alone would call these two the same reading.
        var at = TimeSpan.FromMinutes(1);
        var before = ExportPicker.Fingerprint(Write("readings.csv", at, "one row"));
        var after = ExportPicker.Fingerprint(Write("readings.csv", at, "two rows, longer"));
        Assert.NotEqual(before, after);
    }

    [Fact]
    public void Two_different_exports_never_share_a_fingerprint()
    {
        var a = Write("morning.csv", TimeSpan.FromHours(2));
        var b = Write("evening.csv", TimeSpan.FromHours(2));
        Assert.NotEqual(ExportPicker.Fingerprint(a), ExportPicker.Fingerprint(b));
    }
}
