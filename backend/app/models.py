from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
from datetime import datetime, timezone


class Memory(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    category: Literal["general", "documents", "todo", "reminders", "links"] = "general"
    title: str = Field("", max_length=300)
    completed: bool = False
    task_status: str = Field("todo", min_length=1, max_length=100)
    subject: str = Field("user", min_length=1, max_length=120)
    predicate: str = Field(min_length=1, max_length=120)
    value: str = Field(max_length=20000)
    type: Literal["fact", "preference", "episodic", "instruction"] = "fact"
    scope: str = Field("general", min_length=1, max_length=120)
    confidence: float = Field(1, ge=0, le=1)
    importance: float = Field(0.5, ge=0, le=1)
    evidence: str = Field("", max_length=20000)
    sensitivity: Literal["ordinary", "sensitive", "secret"] = "ordinary"
    valid_from: str | None = None
    valid_until: str | None = None

    @field_validator("valid_from", "valid_until")
    @classmethod
    def timestamp(cls, value):
        if value is None:
            return None
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("Timestamp requires a timezone")
        return parsed.astimezone(timezone.utc).isoformat()

    @model_validator(mode="after")
    def valid_interval(self):
        if not self.value and not (self.category == "documents" and self.title):
            raise ValueError("Content is required except for a titled document")
        if "task_status" in self.model_fields_set:
            self.completed = self.task_status.casefold() in {"done", "complete", "completed", "finished"}
        elif "completed" in self.model_fields_set:
            self.task_status = "done" if self.completed else "todo"
        if (self.valid_from and self.valid_until
                and datetime.fromisoformat(self.valid_until) <= datetime.fromisoformat(self.valid_from)):
            raise ValueError("valid_until must be after valid_from")
        return self


class Extracted(Memory):
    origin: Literal["explicit", "inferred"] = "inferred"
    correction: bool = False
    ambiguous: bool = False


class Extraction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    memories: list[Extracted] = Field(default_factory=list, max_length=12)


class ChatRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    message: str = Field(min_length=1, max_length=20000)
    conversation_id: str | None = None


class ForgetRequest(BaseModel):
    topic: str = Field("", max_length=500)
    all: bool = False
    delete_history: bool = False


class MemoryEdit(BaseModel):
    memory: Memory
    version: int = Field(ge=1)
    state: Literal["active", "retracted"] = "active"


class Verification(BaseModel):
    model_config = ConfigDict(extra="forbid")
    supported: list[bool]


class Intent(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    action: Literal["chat", "add", "list", "update", "delete", "clarify"]
    category: Literal["general", "documents", "todo", "reminders", "links"] | None = None
    content: str = Field("", max_length=20000)
    title: str | None = Field(None, max_length=300)
    completed: bool | None = None
    task_status: str | None = Field(None, min_length=1, max_length=100)
    target_ids: list[str] = Field(default_factory=list, max_length=100)
    query: str = Field("", max_length=500)
    question: str = Field("", max_length=1000)
    all: bool = False

    @model_validator(mode="after")
    def valid_action(self):
        if self.action == "add" and (not self.category or (not self.content and self.category != "documents")):
            raise ValueError("Adding requires a category and content")
        if self.action == "update" and (len(self.target_ids) != 1 or (not self.content and not self.category and self.title is None and self.completed is None and self.task_status is None)):
            raise ValueError("Updating requires one item and replacement content or category")
        if self.action == "delete" and not self.target_ids and not self.all:
            raise ValueError("Deleting requires an item or an explicit request to clear a category")
        if self.all and self.action not in ("list", "delete"):
            raise ValueError("Unsupported bulk action")
        return self
