import asyncio
import json
from sqlmodel import select
from app.core.db import engine
from sqlmodel.ext.asyncio.session import AsyncSession
from app.models.document import DocumentImage

async def main():
    async with AsyncSession(engine) as sess:
        res = await sess.execute(select(DocumentImage))
        rows = res.scalars().all()
        data = [
            {
                "id": str(r.id),
                "pdf_caption": r.pdf_caption,
                "model_caption": r.model_caption,
                "document_id": str(r.document_id)
            }
            for r in rows
        ]
        print(json.dumps(data, indent=2))

if __name__ == "__main__":
    asyncio.run(main())
