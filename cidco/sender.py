"""Sending the CSV to CIDCO over SFTP.

The agent signs in with the one CIDCO username and password, and names its
company in the upload path:

    /<companyId>/<the folder the CSV was taken from>/<file>.csv

CIDCO validates all three — company id, the address it arrived from, and that
folder — against the company it registered, before storing a single reading.
"""

from __future__ import annotations

import posixpath
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import paramiko

# The AQI columns CIDCO reads, in the order CIDCO published them. CIDCO's
# importer also accepts the plain spellings (PM 2.5, NO2, O3, Timestamp…), so a
# sheet that already exists does not have to be renamed to be accepted.
CSV_COLUMNS = [
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
]

ACCEPTED_SUFFIXES = (".csv", ".xlsx")


def normalise_path(value: str) -> str:
    """Windows and POSIX spellings of the same folder must compare equal."""
    if not value:
        return ""
    collapsed = value.strip().replace("\\", "/").rstrip("/")
    return collapsed or "/"


def remote_path(company_id: str, csv_folder: str, file_name: str) -> str:
    """Mirrors the server's own rule, so the two cannot disagree.

    "C:/CIDCO/exports" + "readings.csv" -> "/ABCD123/C:/CIDCO/exports/readings.csv"
    """
    company = company_id.strip().strip("/")
    source = normalise_path(csv_folder).lstrip("/")
    name = posixpath.basename(file_name.replace("\\", "/"))
    parts = [p for p in (company, source, name) if p]
    return "/" + "/".join(parts)


def newest_export(folder: str) -> Path | None:
    """The most recently written .csv (or .xlsx) in the export folder."""
    directory = Path(folder)
    if not directory.is_dir():
        return None
    candidates = [
        p for p in directory.iterdir() if p.is_file() and p.suffix.lower() in ACCEPTED_SUFFIXES
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


@dataclass
class SendResult:
    ok: bool
    message: str
    file_name: str = ""
    remote: str = ""
    sent_at: datetime = None  # type: ignore[assignment]


class CidcoSender:
    """One SFTP conversation with CIDCO."""

    def __init__(
        self,
        host: str,
        port: int,
        username: str,
        password: str,
        company_id: str,
        csv_folder: str,
        timeout: int = 20,
    ) -> None:
        self.host = host
        self.port = int(port)
        self.username = username
        self.password = password
        self.company_id = company_id
        self.csv_folder = csv_folder
        self.timeout = timeout

    def _client(self) -> paramiko.SSHClient:
        client = paramiko.SSHClient()
        # CIDCO's host key is not distributed with the agent, so trust on first
        # use. The credentials, not the host key, are what authorise the upload.
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=self.host,
            port=self.port,
            username=self.username,
            password=self.password,
            look_for_keys=False,
            allow_agent=False,
            timeout=self.timeout,
        )
        return client

    def check_connection(self) -> SendResult:
        """Proves the credentials work, without sending anything."""
        try:
            client = self._client()
        except paramiko.AuthenticationException:
            return SendResult(False, "That username and password were refused by CIDCO.")
        except Exception as error:  # noqa: BLE001 - surfaced to the user verbatim
            return SendResult(False, f"Could not reach CIDCO at {self.host}:{self.port} — {error}")
        client.close()
        return SendResult(True, f"Connected to CIDCO at {self.host}:{self.port}.")

    def send(self, file_path: Path | None = None) -> SendResult:
        """Sends one file — the newest export unless one is named."""
        source = Path(file_path) if file_path else newest_export(self.csv_folder)
        if source is None:
            return SendResult(False, f"No .csv found in {self.csv_folder}")
        if not source.is_file():
            return SendResult(False, f"{source} is not a file")
        if source.suffix.lower() not in ACCEPTED_SUFFIXES:
            return SendResult(False, f"{source.name} is not a .csv or .xlsx file")

        target = remote_path(self.company_id, self.csv_folder, source.name)
        try:
            client = self._client()
        except paramiko.AuthenticationException:
            return SendResult(False, "That username and password were refused by CIDCO.")
        except Exception as error:  # noqa: BLE001
            return SendResult(False, f"Could not reach CIDCO at {self.host}:{self.port} — {error}")

        try:
            sftp = client.open_sftp()
            try:
                with source.open("rb") as handle:
                    sftp.putfo(handle, target)
            finally:
                sftp.close()
        except Exception as error:  # noqa: BLE001
            return SendResult(False, f"{source.name} — CIDCO refused the transfer ({error})")
        finally:
            client.close()

        return SendResult(
            True,
            f"{source.name} sent to CIDCO",
            file_name=source.name,
            remote=target,
            sent_at=datetime.now(),
        )
