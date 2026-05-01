"""Superadmin-only endpoints. Currently just the user list that feeds the
top-bar impersonation dropdown."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.schemas import ResponseModel
from api.services.user_service import list_all_users

router = APIRouter(tags=["admin"])


class AdminUserItem(BaseModel):
    user_id: str
    name: str
    email: str


def _require_super_admin(user: User) -> None:
    if not getattr(user, "is_super_admin", False):
        raise BotApiException(403, "ERR_NOT_SUPER_ADMIN", "Superadmin access required.")


@router.get("/admin/users")
def list_users_for_impersonation(
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[AdminUserItem]]:
    """List every user in the Users table so the superadmin can pick who to view as.
    No filtering on is_active — we deliberately surface everyone."""
    _require_super_admin(user)
    rows = list_all_users()
    return ResponseModel(data=[
        AdminUserItem(
            user_id=u.user_id,
            name=u.name or "",
            email=u.email or "",
        )
        for u in rows
    ])


@router.get("/users")
def list_users_for_picker(
    _user: User = Depends(get_current_active_user),
) -> ResponseModel[list[AdminUserItem]]:
    """All users — feeds non-admin pickers (e.g. the Reassign Potential
    dropdown). Same shape as /admin/users but no superadmin gate."""
    rows = list_all_users()
    return ResponseModel(data=[
        AdminUserItem(
            user_id=u.user_id,
            name=u.name or "",
            email=u.email or "",
        )
        for u in rows
    ])
