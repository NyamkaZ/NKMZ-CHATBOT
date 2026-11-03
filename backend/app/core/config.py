from functools import lru_cache
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App
    PROJECT_NAME: str = "AI Chatbot Platform"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"

    # Security
    SECRET_KEY: str = "change-me-in-production-use-openssl-rand-hex-32"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    ALGORITHM: str = "HS256"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://chatbot:chatbot_secret@localhost:5432/chatbot"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Ollama — primary model: Qwen3 8B (thinking-capable)
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen3:8b"
    OLLAMA_EMBED_MODEL: str = "nomic-embed-text"
    OLLAMA_TEMPERATURE: float = 0.7
    OLLAMA_TOP_P: float = 0.9
    OLLAMA_NUM_PREDICT: int = 4096
    OLLAMA_CONTEXT_LENGTH: int = 16384
    # Qwen3 thinking: auto | think | no_think | off (alias of no_think)
    QWEN_THINKING_MODE: str = "no_think"

    # Limits
    DAILY_MESSAGE_LIMIT: int = 30
    PRO_DAILY_MESSAGE_LIMIT: int = 200
    PREMIUM_DAILY_MESSAGE_LIMIT: int = 1000
    RATE_LIMIT_PER_MINUTE: int = 10

    # Stripe (optional — demo checkout when unset)
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PRO_PRICE_ID: str = ""
    STRIPE_PREMIUM_PRICE_ID: str = ""
    STRIPE_PRO_PRICE_USD: float = 9.99
    STRIPE_PREMIUM_PRICE_USD: float = 19.99
    FRONTEND_URL: str = "http://localhost:3000"
    GUEST_MESSAGE_LIMIT: int = 1  # only first message allowed as guest
    MAX_HISTORY_MESSAGES: int = 40  # truncate older turns for context
    # When true, API enqueues jobs; run generation_worker process
    USE_GENERATION_WORKER: bool = False

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000"

    # RAG
    CHROMA_PERSIST_DIR: str = "./knowledge_base/chroma"
    RAG_TOP_K: int = 5

    # Bots (optional)
    TELEGRAM_BOT_TOKEN: str = ""
    DISCORD_BOT_TOKEN: str = ""
    FACEBOOK_PAGE_ACCESS_TOKEN: str = ""
    FACEBOOK_VERIFY_TOKEN: str = "chatbot_verify"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
