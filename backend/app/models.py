"""Import all ORM models so metadata/migrations see the full domain."""

from app.modules.communication.models import Message, MessageParticipant, MessageThread
from app.modules.identity.models import Role, SocialLogin, User, UserRole
from app.modules.imports.models import ImportProvider, ImportRun
from app.modules.library.models import (
    BibleBook,
    BibleVerse,
    BibleVersion,
    FileCategory,
    ItemFile,
    PlanResource,
    Resource,
    StoredFile,
)
from app.modules.music.models import LyricsImport, OnSongSection, Song, SongPart
from app.modules.people.models import Instrument, TeamAssignment, UserInstrument
from app.modules.planning.models import (
    DefaultItem,
    HistoryEntry,
    ItemNote,
    Plan,
    PlanCache,
    PlanItem,
    PlanNote,
    PlanType,
)
from app.modules.presentation.models import PresentationPosition, PresentationSession

__all__ = [
    "BibleBook",
    "BibleVerse",
    "BibleVersion",
    "DefaultItem",
    "FileCategory",
    "HistoryEntry",
    "ImportProvider",
    "ImportRun",
    "Instrument",
    "ItemFile",
    "ItemNote",
    "LyricsImport",
    "Message",
    "MessageParticipant",
    "MessageThread",
    "OnSongSection",
    "Plan",
    "PlanCache",
    "PlanItem",
    "PlanNote",
    "PlanResource",
    "PlanType",
    "PresentationPosition",
    "PresentationSession",
    "Resource",
    "Role",
    "SocialLogin",
    "Song",
    "SongPart",
    "StoredFile",
    "TeamAssignment",
    "User",
    "UserInstrument",
    "UserRole",
]
