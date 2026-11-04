from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, field_validator
from urllib.parse import urlparse
from zoneinfo import ZoneInfo


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="LOCAL_AI_", env_file=".env", extra="ignore"
    )
    database: str = "data/personal-ai.sqlite3"
    ollama_url: str = "http://127.0.0.1:11434"
    speech_model: str = "data/speech-model"
    timezone: str = "Europe/Helsinki"
    model: str = "qwen3:4b"
    embedding_model: str = "nomic-embed-text"
    memory_limit: int = Field(8, ge=1, le=50)
    memory_tokens: int = Field(1200, ge=100, le=8000)
    auto_save_memories: bool = True
    implicit_suggestions: bool = True
    extraction_enabled: bool = True
    sensitive_retrieval: bool = False
    extraction_timeout: float = Field(90, ge=1, le=600)
    embedding_timeout: float = Field(15, ge=1, le=120)
    extraction_prompt: str = str(Path(__file__).with_name("extraction-v2.txt"))

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (KeyError, ValueError) as exc:
            raise ValueError("Unknown IANA timezone") from exc
        return value

    @field_validator("ollama_url")
    @classmethod
    def local_url(cls, value):
        p = urlparse(value)
        if p.hostname not in ("localhost", "127.0.0.1", "::1") or p.scheme != "http":
            raise ValueError("Ollama must use a local HTTP endpoint")
        return value
