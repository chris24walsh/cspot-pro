"""Canonical display times for recorded presentation events.

Stored live events use capture time; trimmed recordings already use display time.
Consumers of recording_read receive display times in chronological order.
"""


def display_timeline(timeline: list[dict], source: str | None) -> list[dict]:
    ordered = sorted(timeline, key=lambda event: event["at"])
    delay = 0 if source == "trimmed-sermon" else 1.5
    return [
        {**event, "at": 0 if index == 0 else max(0, float(event["at"]) + delay)}
        for index, event in enumerate(ordered)
    ]
