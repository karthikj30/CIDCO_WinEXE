"""Headless tests for everything the two windows rely on.

The tkinter screens themselves need a desktop, so the behaviour they depend on
lives in schedule.py, config.py and sender.py — and that is what is tested here.

    python -m unittest discover -s tests -v
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cidco import config, schedule  # noqa: E402
from cidco.sender import (  # noqa: E402
    ACCEPTED_SUFFIXES,
    CSV_COLUMNS,
    newest_export,
    normalise_path,
    remote_path,
)


class ScheduleTests(unittest.TestCase):
    def test_offers_every_interval_cidco_asked_for(self):
        self.assertEqual(
            [seconds for _, seconds in schedule.INTERVALS],
            [5, 15, 30, 60, 300, 600, 900, 1200, 1800, 2700, 3600, 7200, 10800],
        )

    def test_labels_and_seconds_round_trip(self):
        for label, seconds in schedule.INTERVALS:
            self.assertEqual(schedule.seconds_for(label), seconds)
            self.assertEqual(schedule.label_for(seconds), label)

    def test_unknown_label_falls_back_to_the_default(self):
        self.assertEqual(schedule.seconds_for("Every fortnight"), schedule.DEFAULT_SECONDS)

    def test_describe_reads_naturally(self):
        self.assertEqual(schedule.describe(5), "5 seconds")
        self.assertEqual(schedule.describe(60), "1 minute")
        self.assertEqual(schedule.describe(1800), "30 minutes")
        self.assertEqual(schedule.describe(10800), "3 hours")


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.previous = os.environ.get("CIDCO_AGENT_HOME")
        os.environ["CIDCO_AGENT_HOME"] = self.home

    def tearDown(self):
        if self.previous is None:
            os.environ.pop("CIDCO_AGENT_HOME", None)
        else:
            os.environ["CIDCO_AGENT_HOME"] = self.previous

    def test_a_fresh_machine_reads_as_not_installed(self):
        self.assertFalse(config.is_installed())
        self.assertEqual(config.load().interval_seconds, schedule.DEFAULT_SECONDS)

    def test_what_the_installer_chose_survives_a_restart(self):
        chosen = config.Settings(
            role="architect",
            csv_folder="C:/CIDCO/exports",
            interval_seconds=schedule.seconds_for("Every 30 minutes"),
            designated_ip="10.0.0.9",
            company_id="ABCD123",
            username="cidco@example.com",
        )
        config.save(chosen)

        self.assertTrue(config.is_installed())
        again = config.load()
        self.assertEqual(again.csv_folder, "C:/CIDCO/exports")
        self.assertEqual(again.interval_seconds, 1800)
        self.assertEqual(again.company_id, "ABCD123")
        self.assertEqual(again.designated_ip, "10.0.0.9")

    def test_the_password_is_never_written_to_disk(self):
        config.save(config.Settings(username="cidco@example.com", password="123456"))
        on_disk = config.config_path().read_text(encoding="utf-8")
        self.assertNotIn("123456", on_disk)
        self.assertNotIn("password", on_disk)
        self.assertEqual(config.load().password, "")

    def test_a_corrupt_settings_file_does_not_stop_the_agent(self):
        config.config_path().parent.mkdir(parents=True, exist_ok=True)
        config.config_path().write_text("{ not json", encoding="utf-8")
        self.assertEqual(config.load().interval_seconds, schedule.DEFAULT_SECONDS)


class RemotePathTests(unittest.TestCase):
    """The upload path is how CIDCO learns which company sent the file."""

    def test_windows_folder_becomes_a_company_scoped_path(self):
        self.assertEqual(
            remote_path("ABCD123", "C:\\CIDCO\\exports", "readings.csv"),
            "/ABCD123/C:/CIDCO/exports/readings.csv",
        )

    def test_a_posix_folder_keeps_its_shape(self):
        self.assertEqual(
            remote_path("ABCD123", "/srv/aqi/exports", "readings.csv"),
            "/ABCD123/srv/aqi/exports/readings.csv",
        )

    def test_the_company_and_the_folder_are_always_separated(self):
        # A missing separator here is what silently broke an early build.
        path = remote_path("ABCD123", "C:/CIDCO/exports", "readings.csv")
        self.assertTrue(path.startswith("/ABCD123/"))
        self.assertNotIn("//", path.lstrip("/"))

    def test_only_the_file_name_is_used(self):
        self.assertEqual(
            remote_path("ABCD123", "C:/exports", "C:\\somewhere\\else\\readings.csv"),
            "/ABCD123/C:/exports/readings.csv",
        )

    def test_trailing_slashes_and_spaces_do_not_change_the_path(self):
        self.assertEqual(
            remote_path(" ABCD123 ", "  C:/CIDCO/exports/  ", "readings.csv"),
            "/ABCD123/C:/CIDCO/exports/readings.csv",
        )

    def test_normalise_path_agrees_with_the_server(self):
        self.assertEqual(normalise_path("C:\\CIDCO\\exports\\"), "C:/CIDCO/exports")
        self.assertEqual(normalise_path("/srv/aqi/"), "/srv/aqi")
        self.assertEqual(normalise_path(""), "")


class ExportPickingTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()

    def _write(self, name: str, age_seconds: int = 0) -> Path:
        path = Path(self.folder) / name
        path.write_text("Project / Site ID\nCIDCO-KHR-012\n", encoding="utf-8")
        if age_seconds:
            stamp = time.time() - age_seconds
            os.utime(path, (stamp, stamp))
        return path

    def test_an_empty_folder_yields_nothing(self):
        self.assertIsNone(newest_export(self.folder))

    def test_a_missing_folder_yields_nothing(self):
        self.assertIsNone(newest_export(os.path.join(self.folder, "nope")))

    def test_the_newest_csv_wins(self):
        self._write("old.csv", age_seconds=600)
        newest = self._write("new.csv")
        self.assertEqual(newest_export(self.folder), newest)

    def test_files_that_are_not_readings_are_ignored(self):
        self._write("notes.txt")
        self._write("~lock.tmp")
        self.assertIsNone(newest_export(self.folder))

    def test_both_accepted_suffixes(self):
        self.assertEqual(ACCEPTED_SUFFIXES, (".csv", ".xlsx"))


class CsvColumnTests(unittest.TestCase):
    def test_the_published_aqi_columns_are_all_present_in_order(self):
        self.assertEqual(
            CSV_COLUMNS,
            [
                "Project / Site ID",
                "AQI Monitoring Station / Device ID",
                "OEM / Model",
                "Date & Time of Reading",
                "AQI Value",
                "PM2.5",
                "PM10",
                "NO\u2082",
                "SO\u2082",
                "CO",
                "O\u2083",
                "Temperature",
                "Humidity",
                "Other applicable environmental parameters",
                "Data Source / Integration Method",
                "Data Receipt Timestamp",
            ],
        )


if __name__ == "__main__":
    unittest.main()
