using Cidco.Core;
using Xunit;

namespace Cidco.Core.Tests;

/// <summary>
/// The CSV shipped in sample/ is what an architect copies to get started, so it
/// has to stay in step with the columns CIDCO reads.
/// </summary>
public class SampleFileTests
{
    private static string SamplePath()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "CidcoAgent.sln")))
            dir = dir.Parent;
        return dir is null ? "" : Path.Combine(dir.FullName, "sample", "readings.csv");
    }

    [Fact]
    public void The_sample_is_where_the_README_says_it_is() =>
        Assert.True(File.Exists(SamplePath()), $"sample/readings.csv not found (looked at '{SamplePath()}')");

    [Fact]
    public void Its_header_is_exactly_the_columns_CIDCO_reads()
    {
        var header = File.ReadLines(SamplePath()).First().TrimStart('﻿');
        Assert.Equal(AqiCsv.HeaderRow(), header);
    }

    [Fact]
    public void Every_row_has_a_value_for_every_column()
    {
        var lines = File.ReadAllLines(SamplePath()).Where(l => l.Trim().Length > 0).ToList();
        Assert.True(lines.Count > 1, "the sample should carry at least one reading");

        foreach (var row in lines.Skip(1))
            Assert.Equal(AqiCsv.Columns.Count, row.Split(',').Length);
    }

    [Fact]
    public void It_is_a_file_the_agent_would_agree_to_send() =>
        Assert.True(AqiCsv.IsAccepted(SamplePath()));
}
