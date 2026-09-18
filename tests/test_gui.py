"""Walks both windows the way a user would, without a person at the keyboard.

Needs tkinter and a display, so every test here skips where neither is
available (the usual CI container). On a desktop, or under Xvfb:

    xvfb-run -a python -m unittest discover -s tests -v

The windows are driven with update() rather than mainloop(), which is why the
agent hands work back to the main thread through a queue instead of calling
after() from a worker — the latter raises "main thread is not in main loop".
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import tkinter

    tkinter.Tk().destroy()
    HAVE_DISPLAY = True
except Exception:  # noqa: BLE001 - no tkinter, or no display
    HAVE_DISPLAY = False

needs_display = unittest.skipUnless(HAVE_DISPLAY, "needs tkinter and a display")


@needs_display
class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.exports = tempfile.mkdtemp()
        self.previous = os.environ.get("CIDCO_AGENT_HOME")
        os.environ["CIDCO_AGENT_HOME"] = self.home

        from cidco.installer import SetupWizard

        self.wizard = SetupWizard()
        self.wizard.update()

    def tearDown(self):
        try:
            self.wizard.destroy()
        except Exception:  # noqa: BLE001
            pass
        if self.previous is None:
            os.environ.pop("CIDCO_AGENT_HOME", None)
        else:
            os.environ["CIDCO_AGENT_HOME"] = self.previous

    def test_it_opens_on_the_role_question(self):
        self.assertEqual(self.wizard._current(), "role")

    def test_the_administrator_branch_installs_nothing(self):
        self.wizard.role.set("admin")
        self.wizard._render()
        self.wizard.update()
        self.assertEqual(self.wizard._steps(), ["role", "admin"])

    def test_the_architect_branch_asks_folder_then_schedule(self):
        self.assertEqual(self.wizard._steps(), ["role", "folder", "schedule", "install"])

    def test_it_will_not_move_past_a_folder_that_is_not_there(self):
        self.wizard._next()  # onto the folder step
        self.wizard.update()
        self.assertEqual(self.wizard._current(), "folder")

        self.wizard._next()
        self.assertEqual(self.wizard._current(), "folder")
        self.assertIn("Choose the folder", self.wizard.status.get())

        self.wizard.csv_folder.set(os.path.join(self.exports, "missing"))
        self.wizard._next()
        self.assertEqual(self.wizard._current(), "folder")
        self.assertIn("does not exist", self.wizard.status.get())

        self.wizard.csv_folder.set(self.exports)
        self.wizard._next()
        self.wizard.update()
        self.assertEqual(self.wizard._current(), "schedule")
        self.assertEqual(self.wizard.status.get(), "")

    def test_installing_writes_the_choices_to_disk(self):
        from cidco import config

        self.wizard._next()
        self.wizard.csv_folder.set(self.exports)
        self.wizard._next()
        self.wizard.interval_label.set("Every 30 minutes")
        self.wizard._next()
        self.wizard.update()
        self.assertEqual(self.wizard._current(), "install")

        self.wizard._next()  # press Install
        deadline = time.time() + 10
        while time.time() < deadline and "Installed" not in self.wizard.install_status.cget("text"):
            self.wizard.update()
            time.sleep(0.05)

        self.assertIn("Installed", self.wizard.install_status.cget("text"))
        self.assertEqual(self.wizard.progress["value"], 100)
        self.assertEqual(self.wizard.btn_next.cget("text"), "Finish")

        saved = config.load()
        self.assertEqual(saved.csv_folder, self.exports)
        self.assertEqual(saved.interval_seconds, 1800)
        self.assertEqual(saved.role, "architect")


@needs_display
class AgentWindowTests(unittest.TestCase):
    """The window itself, with no CIDCO server to talk to."""

    def setUp(self):
        from cidco import config

        self.home = tempfile.mkdtemp()
        self.exports = tempfile.mkdtemp()
        self.previous = os.environ.get("CIDCO_AGENT_HOME")
        os.environ["CIDCO_AGENT_HOME"] = self.home
        config.save(
            config.Settings(csv_folder=self.exports, interval_seconds=5, company_id="ABCD123")
        )

        from cidco.agent import AgentWindow

        self.agent = AgentWindow()
        self.agent.update()

    def tearDown(self):
        try:
            self.agent.destroy()
        except Exception:  # noqa: BLE001
            pass
        if self.previous is None:
            os.environ.pop("CIDCO_AGENT_HOME", None)
        else:
            os.environ["CIDCO_AGENT_HOME"] = self.previous

    def _log_text(self) -> str:
        return self.agent.log.get("1.0", "end")

    def test_it_starts_with_what_the_installer_chose(self):
        self.assertEqual(self.agent.folder.get(), self.exports)
        self.assertEqual(self.agent.company.get(), "ABCD123")
        self.assertEqual(self.agent.username.get(), "cidco@example.com")
        self.assertEqual(self.agent.port.get(), "2222")

    def test_the_local_pane_lists_the_export_folder(self):
        Path(self.exports, "readings.csv").write_text("Project / Site ID\n", encoding="utf-8")
        Path(self.exports, "notes.txt").write_text("ignore me", encoding="utf-8")
        self.agent._refresh_local()
        self.agent.update()
        names = [self.agent.local.item(i, "text") for i in self.agent.local.get_children()]
        self.assertEqual(names, ["readings.csv"])

    def test_connecting_without_a_password_is_refused_before_dialling_out(self):
        self.agent._connect()
        self.agent.update()
        self.assertIn("Enter the CIDCO password", self._log_text())
        self.assertFalse(self.agent.connected)

    def test_it_will_not_send_before_connecting(self):
        self.agent._send_async(None)
        self.agent.update()
        self.assertIn("Connect to CIDCO first", self._log_text())

    def test_the_schedule_cannot_start_before_connecting(self):
        self.agent._toggle_auto()
        self.agent.update()
        self.assertIsNone(self.agent.timer)
        self.assertIn("Connect to CIDCO before starting", self._log_text())

    def test_the_schedule_starts_and_stops(self):
        self.agent.connected = True  # stand in for a successful Connect
        self.agent._toggle_auto()
        self.agent.update()
        self.assertIsNotNone(self.agent.timer)
        self.assertIn("every 5 seconds", self.agent.schedule_text.get())
        self.assertEqual(self.agent.btn_auto.cget("text"), "Stop automatic sending")

        self.agent._toggle_auto()
        self.agent.update()
        self.assertIsNone(self.agent.timer)
        self.assertIn("off", self.agent.schedule_text.get())
        self.assertEqual(self.agent.btn_auto.cget("text"), "Start automatic sending")


if __name__ == "__main__":
    unittest.main()
