"""Potential listing and detail endpoints."""

from fastapi import APIRouter, Depends, Query

from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.schemas import CreatePotentialRequest, PotentialDetailResponse, PotentialListResponse, ResponseModel, UpdatePotentialRequest
from api.services.potential_service import create_potential, get_potential_detail, list_potentials, update_potential

router = APIRouter(prefix="/potentials", tags=["potentials"])


@router.get("")
def get_potentials(
    user: User = Depends(get_current_active_user),
    stages: str | None = Query(default=None, description="Comma-separated stages"),
    services: str | None = Query(default=None, description="Comma-separated services"),
    owners: str | None = Query(default=None, description="Comma-separated owner names"),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
) -> ResponseModel[PotentialListResponse]:
    stages_list = [s.strip() for s in stages.split(",") if s.strip()] if stages else None
    services_list = [s.strip() for s in services.split(",") if s.strip()] if services else None
    owners_list = [s.strip() for s in owners.split(",") if s.strip()] if owners else None

    result = list_potentials(
        stages=stages_list,
        services=services_list,
        owners=owners_list,
        search=search,
        page=page,
        page_size=page_size,
        owner_user_id=user.user_id,
    )
    return ResponseModel(data=result)


@router.post("")
def post_potential(
    data: CreatePotentialRequest,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[PotentialDetailResponse]:
    result = create_potential(data, user)
    return ResponseModel(data=result)


@router.get("/{potential_id}")
def get_potential(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[PotentialDetailResponse]:
    result = get_potential_detail(potential_id)
    if not result:
        raise BotApiException(404, "ERR_NOT_FOUND", "Potential not found.")
    return ResponseModel(data=result)


@router.patch("/{potential_id}")
def patch_potential(
    potential_id: str,
    data: UpdatePotentialRequest,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[PotentialDetailResponse]:
    result = update_potential(potential_id, data.model_dump(exclude_none=True), user_id=user.user_id)
    if not result:
        raise BotApiException(404, "ERR_NOT_FOUND", "Potential not found.")
    return ResponseModel(data=result)
