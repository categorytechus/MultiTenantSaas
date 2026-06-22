from datetime import datetime
from typing import Any
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text as sa_text

from app.core.db import get_db
from app.core.rbac import authorize
from app.core.tenancy import get_optional_tenant_context, RequestContext

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

@router.get("/license")
async def get_license_info(
    ctx: RequestContext = Depends(get_optional_tenant_context),
) -> Any:
    """Return the private deployment license info (if applicable)."""
    from app.core.config import settings
    from app.core.rbac import Role
    
    # Only show license info to super admins
    if not ctx.role or ctx.role != Role.SUPER_ADMIN:
        return {"is_private_deployment": False}
        
    if not settings.CLIENT_JWT_LICENSE_TOKEN:
        return {"is_private_deployment": False}
        
    try:
        from app.core.licensing import verify_license
        from datetime import datetime, timezone
        payload = verify_license()
        
        exp = payload.get("exp")
        nbf = payload.get("nbf")
        
        return {
            "is_private_deployment": True,
            "expires_at": datetime.fromtimestamp(exp, tz=timezone.utc).isoformat() if exp else None,
            "valid_from": datetime.fromtimestamp(nbf, tz=timezone.utc).isoformat() if nbf else None,
            "features": payload.get("features", []),
        }
    except Exception as e:
        return {"is_private_deployment": True, "error": str(e)}

@router.get("/stats")
async def get_dashboard_stats(
    start_date: str | None = None,
    end_date: str | None = None,
    timeframe: str = Query("Daily", description="Hourly, Daily, Weekly, Monthly"),
    ctx: RequestContext = authorize("documents:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    # timeframe mapping
    tf_map = {
        "hourly": "hour",
        "daily": "day",
        "weekly": "week",
        "monthly": "month"
    }
    trunc_val = tf_map.get(timeframe.lower(), "day")

    params = {}
    
    org_filter = ""
    if ctx.org_id:
        params["org_id"] = str(ctx.org_id)
        org_filter = "WHERE org_id = CAST(:org_id AS uuid)"
    else:
        org_filter = "WHERE 1=1"

    date_filter = ""
    if start_date:
        date_filter += " AND created_at >= CAST(:start AS timestamptz)"
        params["start"] = start_date
    if end_date:
        date_filter += " AND created_at <= CAST(:end AS timestamptz)"
        params["end"] = end_date

    # Aggregation query for the chart
    chart_query = f"""
        SELECT 
            date_trunc('{trunc_val}', created_at) AS trunc_date,
            COUNT(*) as total_documents,
            COUNT(*) FILTER (WHERE status = 'ready') as success_count,
            COUNT(*) FILTER (WHERE status = 'failed' OR status = 'error') as error_count
        FROM documents
        {org_filter} {date_filter}
        GROUP BY trunc_date
        ORDER BY trunc_date ASC
    """
    
    chart_res = await session.execute(sa_text(chart_query), params)
    
    chart_data = []
    for row in chart_res.mappings():
        dt: datetime = row["trunc_date"]
        if not dt:
            continue
            
        # Format the name based on the timeframe
        if trunc_val == "hour":
            name = f"{dt.strftime('%b')} {dt.day}, {dt.hour:02d}:00"
        elif trunc_val == "month":
            name = dt.strftime("%b %Y")
        else:
            name = f"{dt.strftime('%b')} {dt.day}"

        chart_data.append({
            "name": name,
            "total_documents": row["total_documents"],
            "success_count": row["success_count"],
            "error_count": row["error_count"],
        })

    # Total metrics query
    total_query = f"""
        SELECT 
            COUNT(*) as total_documents,
            COUNT(*) FILTER (WHERE status = 'ready') as success_count,
            COUNT(*) FILTER (WHERE status = 'failed' OR status = 'error') as error_count
        FROM documents
        {org_filter} {date_filter}
    """
    
    total_res = await session.execute(sa_text(total_query), params)
    total_row = total_res.mappings().first()

    total_documents = total_row["total_documents"] if total_row else 0
    success_count = total_row["success_count"] if total_row else 0
    error_count = total_row["error_count"] if total_row else 0

    if total_documents > 0:
        success_rate = round((success_count / total_documents) * 100, 1)
    else:
        success_rate = 100.0

    return {
        "success": True,
        "data": {
            "chart_data": chart_data,
            "totals": {
                "total_documents": total_documents,
                "success_count": success_count,
                "error_count": error_count,
                "success_rate": f"{success_rate}%",
            }
        }
    }
