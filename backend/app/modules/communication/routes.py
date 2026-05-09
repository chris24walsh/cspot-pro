from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.models import User
from app.modules.identity.auth import CurrentUser, require_permission
from app.modules.communication.models import Message, MessageParticipant, MessageThread
from app.modules.communication.schemas import (
    MessageCreate,
    MessageRead,
    MessageThreadCreate,
    MessageThreadDetail,
    MessageThreadRead,
)
from app.modules.identity.models import User

router = APIRouter()


def get_thread_or_404(session: Session, thread_id: str) -> MessageThread:
    thread = session.get(MessageThread, thread_id)
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message thread not found")
    return thread


def message_to_read(session: Session, message: Message) -> MessageRead:
    sender = session.get(User, message.sender_id) if message.sender_id else None
    return MessageRead(
        id=message.id,
        thread_id=message.thread_id,
        sender_id=message.sender_id,
        sender_name=sender.name if sender else None,
        body=message.body,
        created_at=message.created_at,
    )


def thread_to_read(session: Session, thread: MessageThread) -> MessageThreadRead:
    creator = session.get(User, thread.creator_id) if thread.creator_id else None
    participant_count = session.scalar(
        select(func.count(MessageParticipant.id)).where(MessageParticipant.thread_id == thread.id)
    )
    messages = session.scalars(
        select(Message).where(Message.thread_id == thread.id).order_by(Message.created_at)
    ).all()
    latest_message = messages[-1].body if messages else None
    return MessageThreadRead(
        id=thread.id,
        subject=thread.subject,
        creator_id=thread.creator_id,
        creator_name=creator.name if creator else None,
        participant_count=participant_count or 0,
        message_count=len(messages),
        latest_message=latest_message,
        created_at=thread.created_at,
    )


@router.get("/threads", response_model=list[MessageThreadRead])
def list_threads(
    _current_user: User = Depends(require_permission("messages:read")),
    session: Session = Depends(get_session),
) -> list[MessageThreadRead]:
    threads = session.scalars(select(MessageThread).order_by(MessageThread.created_at.desc())).all()
    return [thread_to_read(session, thread) for thread in threads]


@router.post("/threads", response_model=MessageThreadDetail, status_code=status.HTTP_201_CREATED)
def create_thread(
    payload: MessageThreadCreate,
    _current_user: User = Depends(require_permission("messages:write")),
    session: Session = Depends(get_session),
) -> MessageThreadDetail:
    thread = MessageThread(subject=payload.subject, creator_id=payload.creator_id)
    session.add(thread)
    session.flush()

    participant_ids = set(payload.participant_ids)
    if payload.creator_id:
        participant_ids.add(payload.creator_id)
    for participant_id in participant_ids:
        session.add(MessageParticipant(thread_id=thread.id, user_id=participant_id))

    session.add(Message(thread_id=thread.id, sender_id=payload.creator_id, body=payload.body))
    session.commit()
    session.refresh(thread)
    return get_thread(thread.id, session)


@router.get("/threads/{thread_id}", response_model=MessageThreadDetail)
def get_thread(
    thread_id: str,
    _current_user: User = Depends(require_permission("messages:read")),
    session: Session = Depends(get_session),
) -> MessageThreadDetail:
    thread = get_thread_or_404(session, thread_id)
    summary = thread_to_read(session, thread)
    messages = session.scalars(
        select(Message).where(Message.thread_id == thread.id).order_by(Message.created_at)
    ).all()
    return MessageThreadDetail(**summary.model_dump(), messages=[message_to_read(session, msg) for msg in messages])


@router.post(
    "/threads/{thread_id}/messages",
    response_model=MessageRead,
    status_code=status.HTTP_201_CREATED,
)
def create_message(
    thread_id: str,
    payload: MessageCreate,
    _current_user: User = Depends(require_permission("messages:write")),
    session: Session = Depends(get_session),
) -> MessageRead:
    get_thread_or_404(session, thread_id)
    message = Message(thread_id=thread_id, sender_id=payload.sender_id, body=payload.body)
    session.add(message)
    session.commit()
    session.refresh(message)
    return message_to_read(session, message)


@router.delete("/threads/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_thread(
    thread_id: str,
    _current_user: User = Depends(require_permission("messages:delete")),
    session: Session = Depends(get_session),
) -> Response:
    thread = get_thread_or_404(session, thread_id)
    session.delete(thread)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
