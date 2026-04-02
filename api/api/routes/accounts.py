"""Account listing and detail endpoints."""

from fastapi import APIRouter, Depends, Query

from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.schemas import AccountDetailResponse, AccountListResponse, ResponseModel, UpdateAccountRequest
from api.services.account_service import get_account_detail, list_accounts, update_account

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("")
def get_accounts(
    user: User = Depends(get_current_active_user),
    search: str | None = Query(default=None),
    industries: str | None = Query(default=None, description="Comma-separated industries"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
) -> ResponseModel[AccountListResponse]:
    industries_list = [s.strip() for s in industries.split(",") if s.strip()] if industries else None

    result = list_accounts(
        search=search,
        industries=industries_list,
        page=page,
        page_size=page_size,
    )
    return ResponseModel(data=result)


@router.get("/{account_id}")
def get_account(
    account_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[AccountDetailResponse]:
    result = get_account_detail(account_id)
    if not result:
        raise BotApiException(404, "ERR_NOT_FOUND", "Account not found.")
    return ResponseModel(data=result)


@router.patch("/{account_id}")
def patch_account(
    account_id: str,
    data: UpdateAccountRequest,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[AccountDetailResponse]:
    result = update_account(account_id, data.model_dump(exclude_none=True))
    if not result:
        raise BotApiException(404, "ERR_NOT_FOUND", "Account not found.")
    return ResponseModel(data=result)
