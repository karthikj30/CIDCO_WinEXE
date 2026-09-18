"""The CIDCO AQI Agent setup wizard.

A small stepped dialog, in the shape of an ordinary Windows installer:

    1. Login as ...........  Administrator or Architect
    2. CSV folder .........  where the automation picks the export up
    3. Schedule ...........  how often it is sent
    4. Install ............  writes the settings and finishes

Only the architect side is installed by this program — the administrator side
is CIDCO's own web portal, and the wizard says so rather than pretending to
install something.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, ttk

from . import __version__, config, schedule

WINDOW = "CIDCO AQI Agent 1.0 Setup"
ACCENT = "#6d28d9"
BANNER_BG = "#ede9fe"


class SetupWizard(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(WINDOW)
        self.geometry("560x380")
        self.resizable(False, False)
        self.configure(bg="white")

        self.settings = config.load()
        self.role = tk.StringVar(value=self.settings.role or "architect")
        self.csv_folder = tk.StringVar(value=self.settings.csv_folder)
        self.interval_label = tk.StringVar(value=schedule.label_for(self.settings.interval_seconds))
        self.status = tk.StringVar(value="")

        self.step = 0
        self._build()
        self._render()

    # -- chrome -----------------------------------------------------------
    def _build(self) -> None:
        banner = tk.Frame(self, bg=BANNER_BG, width=150)
        banner.pack(side="left", fill="y")
        banner.pack_propagate(False)
        tk.Label(banner, text="CIDCO", bg=BANNER_BG, fg=ACCENT, font=("Segoe UI", 20, "bold")).pack(pady=(46, 0))
        tk.Label(banner, text="AQI Agent", bg=BANNER_BG, fg="#4c1d95", font=("Segoe UI", 11)).pack()
        tk.Label(banner, text="SFTP file transfer", bg=BANNER_BG, fg="#6b7280", font=("Segoe UI", 8)).pack(pady=(6, 0))
        tk.Label(banner, text=f"v{__version__}", bg=BANNER_BG, fg="#9ca3af", font=("Segoe UI", 8)).pack(side="bottom", pady=12)

        self.body = tk.Frame(self, bg="white")
        self.body.pack(side="top", fill="both", expand=True, padx=20, pady=(20, 0))

        footer = tk.Frame(self, bg="white")
        footer.pack(side="bottom", fill="x", padx=20, pady=14)
        self.btn_cancel = ttk.Button(footer, text="Cancel", command=self.destroy)
        self.btn_cancel.pack(side="right")
        self.btn_next = ttk.Button(footer, text="Next >", command=self._next)
        self.btn_next.pack(side="right", padx=6)
        self.btn_back = ttk.Button(footer, text="< Back", command=self._back)
        self.btn_back.pack(side="right")

    def _clear(self) -> None:
        for child in self.body.winfo_children():
            child.destroy()

    def _heading(self, title: str, subtitle: str) -> None:
        tk.Label(self.body, text=title, bg="white", font=("Segoe UI", 13, "bold"), anchor="w").pack(fill="x")
        tk.Label(
            self.body, text=subtitle, bg="white", fg="#6b7280", font=("Segoe UI", 9),
            anchor="w", justify="left", wraplength=360,
        ).pack(fill="x", pady=(4, 14))

    # -- steps ------------------------------------------------------------
    def _steps(self) -> list[str]:
        """The screens, named — not bound methods, which never compare identical."""
        if self.role.get() == "admin":
            return ["role", "admin"]
        return ["role", "folder", "schedule", "install"]

    def _current(self) -> str:
        steps = self._steps()
        self.step = max(0, min(self.step, len(steps) - 1))
        return steps[self.step]

    def _render(self) -> None:
        self._clear()
        screen = self._current()
        {
            "role": self._step_role,
            "admin": self._step_admin,
            "folder": self._step_folder,
            "schedule": self._step_schedule,
            "install": self._step_install,
        }[screen]()
        self.btn_back.state(["!disabled"] if self.step > 0 else ["disabled"])

    def _step_role(self) -> None:
        self._heading("Who is this computer for?", "The agent installs the architect side. CIDCO officers use the web portal instead.")
        for value, label, hint in (
            ("architect", "Architect", "Send AQI readings to CIDCO automatically from this PC."),
            ("admin", "Administrator (CIDCO)", "Review submitted data on the CIDCO web portal."),
        ):
            row = tk.Frame(self.body, bg="white")
            row.pack(fill="x", pady=3)
            tk.Radiobutton(
                row, text=label, value=value, variable=self.role, bg="white",
                font=("Segoe UI", 10), anchor="w", command=self._render,
            ).pack(anchor="w")
            tk.Label(row, text=hint, bg="white", fg="#9ca3af", font=("Segoe UI", 8), anchor="w").pack(anchor="w", padx=24)
        self.btn_next.config(text="Next >")

    def _step_admin(self) -> None:
        self._heading(
            "Nothing to install",
            "The administrator side is CIDCO's web portal — open it in a browser and sign in with your "
            "officer account. This installer only sets up the architect's sending agent.",
        )
        tk.Label(self.body, text="CIDCO portal:", bg="white", font=("Segoe UI", 9)).pack(anchor="w")
        entry = ttk.Entry(self.body, width=52)
        entry.insert(0, "http://<cidco-host>:3000/")
        entry.state(["readonly"])
        entry.pack(anchor="w", pady=(2, 0))
        self.btn_next.config(text="Finish")

    def _step_folder(self) -> None:
        self._heading(
            "Where is the AQI export saved?",
            "Pick the folder your monitoring software writes its CSV into. The agent takes the newest "
            "file from here every time it runs, and CIDCO checks this path on every transfer.",
        )
        row = tk.Frame(self.body, bg="white")
        row.pack(fill="x")
        ttk.Entry(row, textvariable=self.csv_folder, width=42).pack(side="left")
        ttk.Button(row, text="Browse…", command=self._browse).pack(side="left", padx=6)
        tk.Label(
            self.body, textvariable=self.status, bg="white", fg="#b91c1c",
            font=("Segoe UI", 8), anchor="w",
        ).pack(fill="x", pady=(8, 0))
        tk.Label(
            self.body, text="Example:  C:\\CIDCO\\exports", bg="white", fg="#9ca3af",
            font=("Segoe UI", 8), anchor="w",
        ).pack(fill="x", pady=(10, 0))
        self.btn_next.config(text="Next >")

    def _browse(self) -> None:
        chosen = filedialog.askdirectory(title="Select the folder your AQI CSV is exported to")
        if chosen:
            self.csv_folder.set(chosen)
            self.status.set("")

    def _step_schedule(self) -> None:
        self._heading(
            "How often should it send?",
            "The agent runs in the background and sends the newest CSV on this schedule. You can change "
            "it later in the agent itself.",
        )
        ttk.Combobox(
            self.body, textvariable=self.interval_label, values=schedule.LABELS,
            state="readonly", width=30,
        ).pack(anchor="w")
        tk.Label(
            self.body,
            text="Short intervals are useful while testing; every 1–3 hours suits a live station.",
            bg="white", fg="#9ca3af", font=("Segoe UI", 8), anchor="w", wraplength=360, justify="left",
        ).pack(fill="x", pady=(10, 0))
        self.btn_next.config(text="Next >")

    def _step_install(self) -> None:
        self._heading("Ready to install", "The settings below are written to this PC. Nothing is sent to CIDCO yet.")
        summary = tk.Frame(self.body, bg="#f8fafc", bd=1, relief="solid")
        summary.pack(fill="x")
        for label, value in (
            ("Install for", "Architect"),
            ("CSV folder", self.csv_folder.get() or "(not set)"),
            ("Schedule", self.interval_label.get()),
        ):
            line = tk.Frame(summary, bg="#f8fafc")
            line.pack(fill="x", padx=10, pady=3)
            tk.Label(line, text=label, bg="#f8fafc", fg="#6b7280", font=("Segoe UI", 8), width=12, anchor="w").pack(side="left")
            tk.Label(line, text=value, bg="#f8fafc", font=("Consolas", 8), anchor="w").pack(side="left", fill="x", expand=True)

        self.progress = ttk.Progressbar(self.body, mode="determinate", maximum=100, length=360)
        self.progress.pack(anchor="w", pady=(16, 4))
        self.install_status = tk.Label(self.body, text="", bg="white", fg="#6b7280", font=("Segoe UI", 8), anchor="w")
        self.install_status.pack(fill="x")
        self.btn_next.config(text="Install")

    # -- navigation -------------------------------------------------------
    def _back(self) -> None:
        self.step -= 1
        self._render()

    def _next(self) -> None:
        current = self._current()

        if current == "admin":
            self.destroy()
            return

        if current == "folder":
            folder = self.csv_folder.get().strip()
            if not folder:
                self.status.set("Choose the folder your AQI CSV is exported to.")
                return
            if not Path(folder).is_dir():
                self.status.set("That folder does not exist on this PC.")
                return
            self.status.set("")

        if current == "install":
            self._install()
            return

        self.step += 1
        self._render()

    def _install(self) -> None:
        """Walks the progress bar, then writes the settings.

        Driven by self.after rather than a worker thread: there is nothing slow
        to do here, and tkinter may only be touched from its own thread.
        """
        self.btn_next.state(["disabled"])
        self.btn_back.state(["disabled"])

        steps = [
            (20, "Creating the agent folder\u2026"),
            (50, "Writing your settings\u2026"),
            (75, "Registering the schedule\u2026"),
            (100, "Finishing up\u2026"),
        ]

        def advance(index: int = 0) -> None:
            if index < len(steps):
                pct, message = steps[index]
                self.progress["value"] = pct
                self.install_status.config(text=message)
                self.after(350, lambda: advance(index + 1))
                return
            self._finish()

        advance()

    def _finish(self) -> None:
        self.settings.role = "architect"
        self.settings.csv_folder = self.csv_folder.get().strip()
        self.settings.interval_seconds = schedule.seconds_for(self.interval_label.get())
        self.settings.installed_at = datetime.now().isoformat(timespec="seconds")

        try:
            saved = config.save(self.settings)
        except OSError as error:
            self.install_status.config(text=f"Could not save the settings: {error}", fg="#b91c1c")
            self.btn_next.state(["!disabled"])
            self.btn_back.state(["!disabled"])
            return

        self.install_status.config(text=f"Installed. Settings saved to {saved}", fg="#047857")
        self.btn_next.config(text="Finish", command=self.destroy)
        self.btn_next.state(["!disabled"])
        self.btn_cancel.state(["disabled"])


def main() -> int:
    SetupWizard().mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
