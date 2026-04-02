"""Chat message persistence."""

from datetime import datetime, timezone

from sqlalchemy import select

from core.database import get_session
from core.models import CXChatMessage
from core.schemas import ChatMessageItem


def list_messages(user_id: str, limit: int = 50) -> list[ChatMessageItem]:
    with get_session() as session:
        stmt = select(CXChatMessage).where(
            CXChatMessage.user_id == user_id,
            CXChatMessage.is_active == True,
        ).order_by(CXChatMessage.created_time.asc()).limit(limit)
        return [
            ChatMessageItem(id=m.id, role=m.role, content=m.content, created_time=m.created_time)
            for m in session.execute(stmt).scalars().all()
        ]


def save_message(user_id: str, role: str, content: str) -> ChatMessageItem:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        msg = CXChatMessage(
            user_id=user_id, role=role, content=content,
            created_time=now, updated_time=now, is_active=True,
        )
        session.add(msg)
        session.flush()
        session.refresh(msg)
        return ChatMessageItem(id=msg.id, role=msg.role, content=msg.content, created_time=msg.created_time)


def clear_history(user_id: str) -> int:
    """Soft-delete all chat messages for a user. Returns count."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        stmt = select(CXChatMessage).where(
            CXChatMessage.user_id == user_id,
            CXChatMessage.is_active == True,
        )
        messages = session.execute(stmt).scalars().all()
        count = 0
        for m in messages:
            m.is_active = False
            m.updated_time = now
            session.add(m)
            count += 1
    return count
