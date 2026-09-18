"""How often the agent sends the CSV.

The choices the installer offers, in one place, so the installer wizard and
the agent's status line can never drift apart.
"""

from __future__ import annotations

# (label shown in the installer, seconds)
INTERVALS: list[tuple[str, int]] = [
    ("Every 5 seconds", 5),
    ("Every 15 seconds", 15),
    ("Every 30 seconds", 30),
    ("Every 1 minute", 60),
    ("Every 5 minutes", 5 * 60),
    ("Every 10 minutes", 10 * 60),
    ("Every 15 minutes", 15 * 60),
    ("Every 20 minutes", 20 * 60),
    ("Every 30 minutes", 30 * 60),
    ("Every 45 minutes", 45 * 60),
    ("Every 1 hour", 60 * 60),
    ("Every 2 hours", 2 * 60 * 60),
    ("Every 3 hours", 3 * 60 * 60),
]

DEFAULT_SECONDS = 3 * 60 * 60

LABELS = [label for label, _ in INTERVALS]


def seconds_for(label: str) -> int:
    """Seconds behind an installer label; falls back to the 3-hour default."""
    for text, seconds in INTERVALS:
        if text == label:
            return seconds
    return DEFAULT_SECONDS


def label_for(seconds: int) -> str:
    """The label for a stored interval, for showing it back to the user."""
    for text, value in INTERVALS:
        if value == seconds:
            return text
    return f"Every {seconds} seconds"


def describe(seconds: int) -> str:
    """A short human reading of an interval, e.g. '3 hours'."""
    if seconds < 60:
        return f"{seconds} seconds"
    if seconds < 3600:
        minutes = seconds // 60
        return f"{minutes} minute{'s' if minutes != 1 else ''}"
    hours = seconds // 3600
    return f"{hours} hour{'s' if hours != 1 else ''}"
