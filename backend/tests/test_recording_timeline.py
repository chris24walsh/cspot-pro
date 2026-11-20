from app.modules.broadcast.recording_timeline import display_timeline
from app.modules.broadcast.recording_trim import trimmed_timeline
from app.modules.broadcast.recording_video import timed_events


def test_display_timeline_shared_by_trim_and_video():
    captured = [
        {"at": 10, "slide_offset": 1},
        {"at": 2, "slide_offset": 0},
        {"at": 20, "slide_offset": 2},
    ]
    display = display_timeline(captured, "automatic-sermon")
    assert [event["at"] for event in display] == [0, 11.5, 21.5]
    assert captured[0]["at"] == 10
    assert [
        (event["slide_offset"], duration) for event, duration in timed_events(display, 30, 0)
    ] == [(0, 11.5), (1, 10), (2, 8.5)]
    assert [event["at"] for event in trimmed_timeline(display, 11, 30, 0)] == [0, 0.5, 10.5]
    assert display_timeline(display, "trimmed-sermon") == display
    assert display_timeline([], "automatic-sermon") == []
