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
    public void An_xlsx_export_counts_too()
    {
        Write("readings.xlsx");
        Assert.Equal("readings.xlsx", ExportPicker.Newest(_folder)!.Name);
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
    [InlineData("readings.xlsx", true)]
    [InlineData("notes.txt", false)]
    [InlineData("readings.csv.bak", false)]
    public void Only_a_csv_or_xlsx_is_sendable(string name, bool accepted) =>
        Assert.Equal(accepted, AqiCsv.IsAccepted(name));
}
