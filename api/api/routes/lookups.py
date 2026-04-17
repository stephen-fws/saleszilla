"""Master data lookups — services, sub-services, stages, industries."""

from fastapi import APIRouter, Depends

from core.auth import get_current_active_user
from core.database import get_session
from core.models import LookupService, LookupSubservice, LookupPotentialStage, User
from core.schemas import ResponseModel
from sqlalchemy import select, text

router = APIRouter(tags=["lookups"])


@router.get("/lookups")
def get_lookups(
    _user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    with get_session() as session:
        # Services (active only)
        svc_rows = session.execute(
            select(LookupService).where(LookupService.active == 1).order_by(LookupService.service)
        ).scalars().all()
        services = [{"id": s.id, "name": s.service} for s in svc_rows]

        # Sub-services grouped by service_id
        sub_rows = session.execute(
            select(LookupSubservice).order_by(LookupSubservice.name)
        ).scalars().all()
        sub_services: dict[int, list[str]] = {}
        for ss in sub_rows:
            sub_services.setdefault(ss.service_id, []).append(ss.name)

        # Build service → sub-service map keyed by service name
        svc_id_to_name = {s.id: s.service for s in svc_rows}
        sub_service_map: dict[str, list[str]] = {}
        for svc_id, names in sub_services.items():
            svc_name = svc_id_to_name.get(svc_id)
            if svc_name:
                sub_service_map[svc_name] = sorted(names)

        # Stages
        stage_rows = session.execute(
            select(LookupPotentialStage).order_by(LookupPotentialStage.stage_name)
        ).scalars().all()
        stages = [s.stage_name for s in stage_rows]

        # Industries (distinct from CompanyEnrichmentData)
        industry_rows = session.execute(
            text("SELECT DISTINCT Industry FROM CompanyEnrichmentData WHERE Industry IS NOT NULL AND Industry != '' ORDER BY Industry")
        ).all()
        industries = [r[0] for r in industry_rows]

    return ResponseModel(data={
        "services": services,
        "sub_service_map": sub_service_map,
        "stages": stages,
        "industries": industries,
    })
