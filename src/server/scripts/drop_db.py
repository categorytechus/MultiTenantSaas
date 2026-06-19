import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from app.core.db import engine
from sqlalchemy import text

async def drop_schema():
    async with engine.begin() as conn:
        print("Dropping schema...")
        await conn.execute(text('DROP SCHEMA public CASCADE;'))
        await conn.execute(text('CREATE SCHEMA public;'))
        try:
            await conn.execute(text('GRANT ALL ON SCHEMA public TO postgres;'))
            await conn.execute(text('GRANT ALL ON SCHEMA public TO public;'))
        except Exception as e:
            print(f"Skipped granting permissions to postgres user: {e}")
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS vector;'))
        print("Schema dropped and recreated, vector extension enabled.")

if __name__ == "__main__":
    asyncio.run(drop_schema())
