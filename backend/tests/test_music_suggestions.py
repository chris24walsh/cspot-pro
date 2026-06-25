import pytest
from fastapi import HTTPException

from app.modules.music.routes import _suggestion_slots


def test_suggestion_slots_accept_explicit_replacement_slots() -> None:
    assert _suggestion_slots(5, ["closer"]) == ["closer"]
    assert _suggestion_slots(5, ["middle", "closer"]) == ["middle", "closer"]


def test_suggestion_slots_default_to_full_set_shape() -> None:
    assert _suggestion_slots(5) == ["opener", "middle", "middle", "middle", "closer"]


def test_suggestion_slots_reject_unknown_slots() -> None:
    with pytest.raises(HTTPException):
        _suggestion_slots(5, ["communion"])
