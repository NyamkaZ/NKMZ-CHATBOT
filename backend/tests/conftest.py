import uuid

import fakeredis.aioredis
import httpx
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.main import app
from app.models import User
from app.models.user import UserRole


@pytest_asyncio.fixture
async def env(monkeypatch, tmp_path):
    from app.services import generation, usage, settings_service
    from app.api.v1.endpoints import stream, auth
    from app.services.rag import pipeline

    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'tests.db').as_posix()}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)

    async def fake_redis():
        return redis

    async def dependency_db():
        async with sessions() as session:
            try:
                yield session
                await session.commit()
            except BaseException:
                await session.rollback()
                raise

    async def no_knowledge(*args, **kwargs):
        return []

    app.dependency_overrides[get_db] = dependency_db
    for module in (generation, usage, settings_service, stream):
        monkeypatch.setattr(module, "get_redis", fake_redis)
    import app.core.redis as redis_module
    monkeypatch.setattr(redis_module, "get_redis", fake_redis)
    monkeypatch.setattr(generation, "AsyncSessionLocal", sessions)
    monkeypatch.setattr(settings_service, "AsyncSessionLocal", sessions)
    monkeypatch.setattr(pipeline, "query_knowledge", no_knowledge)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, sessions, redis
    app.dependency_overrides.clear()
    await redis.aclose()
    await engine.dispose()


async def make_user(sessions, **kwargs):
    async with sessions() as session:
        user = User(id=uuid.uuid4(), role=UserRole.USER, is_guest=False, is_active=True, **kwargs)
        session.add(user)
        await session.commit()
        return user


def headers(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}
