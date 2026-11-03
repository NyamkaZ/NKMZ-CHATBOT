"""
Dedicated generation worker.
Consumes jobs from Redis list `gen:queue` and runs LLM streaming.

Run:
  python -m app.workers.generation_worker

Or via docker-compose worker service.
Set USE_GENERATION_WORKER=1 on the API so it enqueues instead of running in-process.
"""

import asyncio
import json
import signal
import structlog

from app.core.redis import get_redis, close_redis
from app.services.generation import run_generation

logger = structlog.get_logger()
_shutdown = False


def _handle_signal(*_args):
    global _shutdown
    _shutdown = True
    logger.info("worker_shutdown_requested")


async def process_one(job: dict):
    await run_generation(
        generation_id=job["generation_id"],
        message_id=job["message_id"],
        chat_id=job["chat_id"],
        history=job.get("history") or [],
        system_prompt=job.get("system_prompt"),
        is_first_message=bool(job.get("is_first_message")),
        user_message_content=job.get("user_message_content") or "",
    )


async def main_loop():
    redis = await get_redis()
    logger.info("generation_worker_started")
    while not _shutdown:
        try:
            item = await redis.blpop("gen:queue", timeout=2)
            if not item:
                continue
            _, raw = item
            job = json.loads(raw)
            logger.info(
                "job_received",
                generation_id=job.get("generation_id"),
                chat_id=job.get("chat_id"),
            )
            await process_one(job)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.exception("worker_job_failed", error=str(e))
            await asyncio.sleep(1)
    await close_redis()
    logger.info("generation_worker_stopped")


def main():
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)
    asyncio.run(main_loop())


if __name__ == "__main__":
    main()
