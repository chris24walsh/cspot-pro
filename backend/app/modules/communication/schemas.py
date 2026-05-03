from datetime import datetime

from pydantic import BaseModel


class MessageRead(BaseModel):
    id: str
    thread_id: str
    sender_id: str | None = None
    sender_name: str | None = None
    body: str
    created_at: datetime


class MessageThreadCreate(BaseModel):
    subject: str
    creator_id: str | None = None
    participant_ids: list[str] = []
    body: str


class MessageCreate(BaseModel):
    sender_id: str | None = None
    body: str


class MessageThreadRead(BaseModel):
    id: str
    subject: str
    creator_id: str | None = None
    creator_name: str | None = None
    participant_count: int
    message_count: int
    latest_message: str | None = None
    created_at: datetime


class MessageThreadDetail(MessageThreadRead):
    messages: list[MessageRead]
