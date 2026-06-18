from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated
from uuid import UUID
import os
import json
from pydantic import BaseModel

from app.core.db import get_db
from app.core.tenancy import RequestContext, get_required_context
from app.core.rbac import Role
from app.models.org import OrgMembership
from app.models.prompt import OrgPrompt

router = APIRouter(prefix="/api/organizations", tags=["prompts"])

class BulkPromptUpdate(BaseModel):
    prompts: dict[str, dict[str, str]]

@router.get("/{org_id}/prompts")
async def get_org_prompts(
    org_id: UUID,
    ctx: Annotated[RequestContext, Depends(get_required_context)],
    session: AsyncSession = Depends(get_db),
):
    if ctx.role != Role.SUPER_ADMIN:
        mr = await session.execute(
            select(OrgMembership).where(
                OrgMembership.user_id == ctx.user_id,
                OrgMembership.org_id == org_id,
            ),
        )
        membership = mr.scalars().first()
        if not membership or membership.role != "tenant_admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Super admin or org admin required")

    try:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        chat_json_path = os.path.join(current_dir, '..', 'prompts', 'chat.json')
        with open(chat_json_path, 'r', encoding='utf-8') as f:
            output = json.load(f)
    except Exception:
        output = {}

    result = await session.execute(
        select(OrgPrompt).where(OrgPrompt.org_id == org_id)
    )
    prompts = result.scalars().all()
    
    for p in prompts:
        if p.workflow not in output:
            output[p.workflow] = {}
        output[p.workflow][p.slot] = p.template

    return {"success": True, "data": output}

@router.put("/{org_id}/prompts")
async def update_org_prompts(
    org_id: UUID,
    body: BulkPromptUpdate,
    ctx: Annotated[RequestContext, Depends(get_required_context)],
    session: AsyncSession = Depends(get_db),
):
    if ctx.role != Role.SUPER_ADMIN:
        mr = await session.execute(
            select(OrgMembership).where(
                OrgMembership.user_id == ctx.user_id,
                OrgMembership.org_id == org_id,
            ),
        )
        membership = mr.scalars().first()
        if not membership or membership.role != "tenant_admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Super admin or org admin required")

    result = await session.execute(
        select(OrgPrompt).where(OrgPrompt.org_id == org_id)
    )
    existing_prompts = {
        (p.workflow, p.slot): p for p in result.scalars().all()
    }

    for workflow, slots in body.prompts.items():
        for slot, template in slots.items():
            key = (workflow, slot)
            if key in existing_prompts:
                existing_prompts[key].template = template
            else:
                new_prompt = OrgPrompt(
                    org_id=org_id,
                    workflow=workflow,
                    slot=slot,
                    template=template
                )
                session.add(new_prompt)
    await session.flush()
    return {"success": True}

@router.post("/{org_id}/prompts/reset")
async def reset_org_prompts(
    org_id: UUID,
    ctx: Annotated[RequestContext, Depends(get_required_context)],
    session: AsyncSession = Depends(get_db),
    workflow: str | None = None,
    slot: str | None = None,
):
    if ctx.role != Role.SUPER_ADMIN:
        mr = await session.execute(
            select(OrgMembership).where(
                OrgMembership.user_id == ctx.user_id,
                OrgMembership.org_id == org_id,
            ),
        )
        membership = mr.scalars().first()
        if not membership or membership.role != "tenant_admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Super admin or org admin required")

    query = select(OrgPrompt).where(OrgPrompt.org_id == org_id)
    if workflow and slot:
        query = query.where(OrgPrompt.workflow == workflow, OrgPrompt.slot == slot)
    
    result = await session.execute(query)
    for p in result.scalars().all():
        await session.delete(p)
    await session.flush()

    try:
        import os
        import json
        current_dir = os.path.dirname(os.path.abspath(__file__))
        chat_json_path = os.path.join(current_dir, '..', 'prompts', 'chat.json')
        chat_json_path = os.path.abspath(chat_json_path)
        with open(chat_json_path, 'r', encoding='utf-8') as f:
            chat_prompts = json.load(f)
        
        for w, slots in chat_prompts.items():
            if workflow and w != workflow:
                continue
            for s, template in slots.items():
                if slot and s != slot:
                    continue
                prompt = OrgPrompt(
                    org_id=org_id,
                    workflow=w,
                    slot=s,
                    template=template
                )
                session.add(prompt)
        await session.flush()
    except Exception as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to reset prompts: {e}")

    try:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        chat_json_path = os.path.join(current_dir, '..', 'prompts', 'chat.json')
        with open(chat_json_path, 'r', encoding='utf-8') as f:
            output = json.load(f)
    except Exception:
        output = {}

    result = await session.execute(
        select(OrgPrompt).where(OrgPrompt.org_id == org_id)
    )
    prompts = result.scalars().all()
    
    for p in prompts:
        if p.workflow not in output:
            output[p.workflow] = {}
        output[p.workflow][p.slot] = p.template

    return {"success": True, "data": output}
