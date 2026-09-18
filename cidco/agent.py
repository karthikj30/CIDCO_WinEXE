"""The CIDCO AQI Agent — the window the architect works in.

Laid out like WinSCP: connection details along the top, the architect's own
folder on the left, what CIDCO has taken on the right, and a transfer log
underneath. The schedule chosen during setup runs in the background and sends
the newest CSV on its own.
"""

from __future__ import annotations

import queue
import sys
import threading
from datetime import datetime
from pathlib import Path

import tkinter as tk
from tkinter import ttk

from . import __version__, config, schedule
from .sender import ACCEPTED_SUFFIXES, CidcoSender

ACCENT = "#6d28d9"
DEFAULTS = {
    "designated_ip": "127.0.0.1",
    "port": 2222,
    "username": "cidco@example.com",
    "company_id": "ABCD123",
}


def human_size(n: int) -> str:
    return f"{n} B" if n < 1024 else f"{n / 1024:.1f} KB"


class AgentWindow(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(f"CIDCO AQI Agent {__version__} — SFTP file transfer")
        self.geometry("980x640")
        self.minsize(860, 560)

        self.settings = config.load()
        self.connected = False
        self.sending = threading.Lock()
        self.timer: str | None = None
        self.local_paths: dict[str, Path] = {}
        # Workers never touch the widgets; they post what they found here and
        # the main thread — the only one allowed near tkinter — drains it.
        self.from_workers: queue.Queue = queue.Queue()
        self.poller: str | None = None
        self.closing = False

        self.ip = tk.StringVar(value=self.settings.designated_ip or DEFAULTS["designated_ip"])
        self.port = tk.StringVar(value=str(self.settings.port or DEFAULTS["port"]))
        self.folder = tk.StringVar(value=self.settings.csv_folder)
        self.username = tk.StringVar(value=self.settings.username or DEFAULTS["username"])
        self.password = tk.StringVar()
        self.company = tk.StringVar(value=self.settings.company_id or DEFAULTS["company_id"])
        self.state_text = tk.StringVar(value="Not connected")
        self.schedule_text = tk.StringVar(
            value=f"Automatic sending is off · {schedule.describe(self.settings.interval_seconds)}"
        )

        self._build()
        self._refresh_local()
        self._drain()
        self.protocol("WM_DELETE_WINDOW", self.destroy)
        if not config.is_installed():
            self._log(False, "No setup found — run CIDCO_Setup first so the export folder and schedule are known.")

    # -- layout -----------------------------------------------------------
    def _build(self) -> None:
        connect = ttk.LabelFrame(self, text=" Connect to CIDCO ")
        connect.pack(fill="x", padx=10, pady=(10, 6))

        grid = ttk.Frame(connect)
        grid.pack(fill="x", padx=8, pady=8)
        fields = (
            ("Designated IP", self.ip, 18, False),
            ("Port", self.port, 6, False),
            ("User ID", self.username, 20, False),
            ("Password", self.password, 16, True),
            ("Company ID", self.company, 12, False),
        )
        for col, (label, var, width, secret) in enumerate(fields):
            cell = ttk.Frame(grid)
            cell.grid(row=0, column=col, padx=(0, 10), sticky="w")
            ttk.Label(cell, text=label, font=("Segoe UI", 8)).pack(anchor="w")
            ttk.Entry(cell, textvariable=var, width=width, show="•" if secret else "").pack(anchor="w")

        path_cell = ttk.Frame(grid)
        path_cell.grid(row=1, column=0, columnspan=4, pady=(8, 0), sticky="we")
        ttk.Label(path_cell, text="File path (set during setup — CIDCO checks it every time)", font=("Segoe UI", 8)).pack(anchor="w")
        ttk.Entry(path_cell, textvariable=self.folder, width=64).pack(anchor="w")

        buttons = ttk.Frame(grid)
        buttons.grid(row=1, column=4, pady=(8, 0), sticky="e")
        self.btn_connect = ttk.Button(buttons, text="Connect", command=self._connect)
        self.btn_connect.pack(side="left")

        status = ttk.Frame(self)
        status.pack(fill="x", padx=12)
        self.lbl_state = ttk.Label(status, textvariable=self.state_text, font=("Segoe UI", 9, "bold"))
        self.lbl_state.pack(side="left")
        ttk.Label(status, textvariable=self.schedule_text, font=("Segoe UI", 8)).pack(side="right")

        panes = ttk.Frame(self)
        panes.pack(fill="both", expand=True, padx=10, pady=8)
        panes.columnconfigure(0, weight=1)
        panes.columnconfigure(1, weight=1)
        panes.rowconfigure(0, weight=1)

        left = ttk.LabelFrame(panes, text=" This computer ")
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 5))
        self.local = ttk.Treeview(left, columns=("size", "changed"), show="tree headings", height=12)
        self.local.heading("#0", text="Name")
        self.local.heading("size", text="Size")
        self.local.heading("changed", text="Modified")
        self.local.column("#0", width=230)
        self.local.column("size", width=80, anchor="e")
        self.local.column("changed", width=130)
        self.local.pack(fill="both", expand=True, padx=6, pady=6)
        local_bar = ttk.Frame(left)
        local_bar.pack(fill="x", padx=6, pady=(0, 6))
        ttk.Button(local_bar, text="Refresh", command=self._refresh_local).pack(side="left")
        ttk.Button(local_bar, text="Send selected →", command=self._send_selected).pack(side="left", padx=6)

        right = ttk.LabelFrame(panes, text=" CIDCO ")
        right.grid(row=0, column=1, sticky="nsew", padx=(5, 0))
        self.remote = ttk.Treeview(right, columns=("when", "result"), show="tree headings", height=12)
        self.remote.heading("#0", text="Sent")
        self.remote.heading("when", text="When")
        self.remote.heading("result", text="Result")
        self.remote.column("#0", width=200)
        self.remote.column("when", width=120)
        self.remote.column("result", width=120)
        self.remote.pack(fill="both", expand=True, padx=6, pady=6)
        remote_bar = ttk.Frame(right)
        remote_bar.pack(fill="x", padx=6, pady=(0, 6))
        self.btn_send_now = ttk.Button(remote_bar, text="Send now", command=lambda: self._send_async(None))
        self.btn_send_now.pack(side="left")
        self.btn_auto = ttk.Button(remote_bar, text="Start automatic sending", command=self._toggle_auto)
        self.btn_auto.pack(side="left", padx=6)

        log_frame = ttk.LabelFrame(self, text=" Transfer log ")
        log_frame.pack(fill="both", padx=10, pady=(0, 10))
        self.log = tk.Text(log_frame, height=8, bg="#0f172a", fg="#e2e8f0", font=("Consolas", 9), wrap="none")
        self.log.pack(fill="both", expand=True, padx=6, pady=6)
        self.log.tag_config("ok", foreground="#6ee7b7")
        self.log.tag_config("bad", foreground="#fca5a5")
        self.log.configure(state="disabled")

    # -- helpers ----------------------------------------------------------
    def _ui(self, action) -> None:
        """Hands a UI update to the main thread. Safe to call from a worker."""
        self.from_workers.put(action)

    def _drain(self) -> None:
        """Runs whatever the workers posted, then looks again in a moment."""
        while True:
            try:
                action = self.from_workers.get_nowait()
            except queue.Empty:
                break
            try:
                action()
            except Exception as error:  # noqa: BLE001 - a bad update must not kill the poller
                self._log(False, f"Internal error: {error}")
        if not self.closing:
            self.poller = self.after(100, self._drain)

    def _log(self, ok: bool, message: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", f"{datetime.now():%H:%M:%S}  {message}\n", "ok" if ok else "bad")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _sender(self) -> CidcoSender:
        return CidcoSender(
            host=self.ip.get().strip(),
            port=int(self.port.get().strip() or DEFAULTS["port"]),
            username=self.username.get().strip(),
            password=self.password.get(),
            company_id=self.company.get().strip(),
            csv_folder=self.folder.get().strip(),
        )

    def _refresh_local(self) -> None:
        self.local.delete(*self.local.get_children())
        self.local_paths.clear()
        folder = Path(self.folder.get().strip() or ".")
        if not folder.is_dir():
            self.local.insert("", "end", text="(folder not found)", values=("", ""))
            return
        files = sorted(
            (p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in ACCEPTED_SUFFIXES),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not files:
            self.local.insert("", "end", text="(no .csv files yet)", values=("", ""))
            return
        for path in files:
            stat = path.stat()
            item = self.local.insert(
                "", "end", text=path.name,
                values=(human_size(stat.st_size), f"{datetime.fromtimestamp(stat.st_mtime):%d/%m %H:%M}"),
            )
            self.local_paths[item] = path

    # -- actions ----------------------------------------------------------
    def _connect(self) -> None:
        if not self.password.get():
            self._log(False, "Enter the CIDCO password before connecting.")
            return
        self.btn_connect.state(["disabled"])
        self.state_text.set("Connecting…")

        sender = self._sender()

        def run() -> None:
            result = sender.check_connection()
            self._ui(lambda: self._connected(sender, result))

        threading.Thread(target=run, daemon=True).start()

    def _connected(self, sender: CidcoSender, result) -> None:
        """Back on Tk's thread with the answer CIDCO gave."""
        self.connected = result.ok
        self.state_text.set(
            f"Connected · {sender.company_id} → {sender.host}:{sender.port}"
            if result.ok
            else "Not connected"
        )
        self._log(result.ok, result.message)
        if result.ok:
            # Remember everything except the password, so the next run is a
            # matter of typing the password and pressing Connect.
            self.settings.designated_ip = sender.host
            self.settings.port = sender.port
            self.settings.username = sender.username
            self.settings.company_id = sender.company_id
            self.settings.csv_folder = sender.csv_folder
            config.save(self.settings)
        self.btn_connect.state(["!disabled"])
        self._refresh_local()

    def _send_selected(self) -> None:
        chosen = self.local.selection()
        if not chosen:
            self._log(False, "Select a file on the left first.")
            return
        self._send_async(self.local_paths.get(chosen[0]))

    def _send_async(self, path: Path | None) -> None:
        if not self.connected:
            self._log(False, "Connect to CIDCO first.")
            return
        if not self.sending.acquire(blocking=False):
            return  # a send is already in flight

        sender = self._sender()

        def run() -> None:
            try:
                result = sender.send(path)
            finally:
                self.sending.release()
            self._ui(lambda: self._sent(path, result))

        threading.Thread(target=run, daemon=True).start()

    def _sent(self, path: Path | None, result) -> None:
        self._log(result.ok, result.message)
        self.remote.insert(
            "", 0,
            text=result.file_name or (path.name if path else "—"),
            values=(f"{datetime.now():%d/%m %H:%M:%S}", "Accepted" if result.ok else "Refused"),
        )

    def _toggle_auto(self) -> None:
        if self.timer:
            self.after_cancel(self.timer)
            self.timer = None
            self.btn_auto.config(text="Start automatic sending")
            self.schedule_text.set(
                f"Automatic sending is off · {schedule.describe(self.settings.interval_seconds)}"
            )
            self._log(True, "Automatic sending stopped.")
            return

        if not self.connected:
            self._log(False, "Connect to CIDCO before starting the schedule.")
            return

        every = schedule.describe(self.settings.interval_seconds)
        self.btn_auto.config(text="Stop automatic sending")
        self.schedule_text.set(f"Sending automatically every {every}")
        self._log(True, f"Automatic sending started — every {every}.")
        self._tick()

    def _tick(self) -> None:
        self._send_async(None)
        self.timer = self.after(max(1, self.settings.interval_seconds) * 1000, self._tick)


    def destroy(self) -> None:
        """Stops the timers first, so nothing fires at a window that is gone."""
        self.closing = True
        for handle in (self.poller, self.timer):
            if handle:
                try:
                    self.after_cancel(handle)
                except Exception:  # noqa: BLE001
                    pass
        self.poller = self.timer = None
        super().destroy()


def main() -> int:
    AgentWindow().mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
