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


def effective_timeline(timeline: list[dict], segments: list[dict]) -> list[dict]:
    """Merge display-time capture with end-exclusive visual overrides."""
    captured = sorted(timeline, key=lambda event: event["at"])
    segments = sorted(segments, key=lambda segment: segment["start_seconds"])
    if not captured:
        captured = [{"at": 0, "item_type": "sermon", "files": []}]
    boundaries = {float(event["at"]) for event in captured}
    for segment in segments:
        start, end = segment["start_seconds"], segment["end_seconds"]
        boundaries.update((start, end))
        if segment["kind"] == "montage":
            dwell = segment.get("dwell_seconds") or 5
            point = start + dwell
            while point < end:
                boundaries.add(round(point, 6))
                point += dwell
    result = []
    for at in sorted(boundaries):
        active = next((s for s in segments if s["start_seconds"] <= at < s["end_seconds"]), None)
        if active:
            ids = active.get("file_ids") or []
            index = int((at - active["start_seconds"]) / (active.get("dwell_seconds") or 5) + 1e-7)
            file_id = ids[index % len(ids)] if ids else None
            event = {
                "at": at,
                "plan_item_id": f"visual:{active['id']}",
                "visual": active,
                "files": ([{"file_id": file_id}] if file_id else []),
                "slide_offset": 0,
            }
        else:
            event = {
                **next((e for e in reversed(captured) if e["at"] <= at), captured[0]),
                "at": at,
            }
        # Ignore captured changes during an override unless the visual changes.
        if (
            result
            and active
            and result[-1].get("visual") == active
            and result[-1].get("files") == event["files"]
        ):
            continue
        result.append(event)
    return result
