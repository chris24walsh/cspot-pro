from collections.abc import AsyncGenerator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_timeout=5,
    pool_recycle=300,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


async def get_session() -> AsyncGenerator[Session, None]:
    """Provide a request session without scheduling teardown in the worker pool.

    Route handlers use synchronous SQLAlchemy sessions and run in FastAPI's
    worker pool. Making the dependency itself asynchronous ensures its finalizer
    can release a connection even when every worker is occupied by requests
    waiting for that same pool.
    """
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
