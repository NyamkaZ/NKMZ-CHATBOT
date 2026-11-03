"""
Usage (inside backend container or with PYTHONPATH):
  python scripts/create_admin.py --email admin@example.com --password admin123
"""
import argparse
import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.core.database import AsyncSessionLocal
from app.core.security import get_password_hash
from app.models.user import User, UserRole
from sqlalchemy import select


async def main(email: str, password: str, name: str):
    async with AsyncSessionLocal() as db:
        existing = await db.execute(select(User).where(User.email == email))
        if existing.scalar_one_or_none():
            print(f"User {email} already exists")
            return
        user = User(
            email=email,
            hashed_password=get_password_hash(password),
            full_name=name,
            role=UserRole.ADMIN,
            is_guest=False,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        print(f"Admin created: {email}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", default="admin@example.com")
    parser.add_argument("--password", default="admin123")
    parser.add_argument("--name", default="Admin")
    args = parser.parse_args()
    asyncio.run(main(args.email, args.password, args.name))
