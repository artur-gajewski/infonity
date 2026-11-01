"""Transactional memory lifecycle. Personal values never enter the event log."""

import json
import re
from uuid import uuid4
from datetime import datetime, timezone, timedelta
from pathlib import Path
from .models import Memory, Extraction
from .commands import parse_fact_request


class Conflict(Exception):
    pass


class Missing(Exception):
    pass


def uid():
    return str(uuid4())


def now():
    return datetime.now(timezone.utc).isoformat()


def terms(text):
    return set(re.findall(r"[\w]+", text.lower().replace("_", " ")))


def text_of(m):
    return " ".join(str(m[k]) for k in ("subject", "predicate", "value", "scope", "category", "title"))


def secret(text):
    return bool(
        re.search(
            r"(?i)(password|passwd|api.?key|secret.?key|access.?token|private.?key|bearer\s+[\w-]+|sk-[a-z0-9]{12})",
            text,
        )
    )


def contextual_records(db, memory):
    """Same contextual key, with overlapping validity intervals.

    An unbounded new assertion is a current assertion; an explicitly bounded
    historical interval keeps its open historical start.
    """
    start = memory.valid_from or (now() if not memory.valid_until else None)
    end = memory.valid_until
    rows = db.execute(
        "SELECT * FROM memories WHERE subject=? AND predicate=? AND scope=? AND category=? AND state='active'",
        (memory.subject, memory.predicate, memory.scope, memory.category),
    ).fetchall()
    return [
        r
        for r in rows
        if not (start and r["valid_until"] and r["valid_until"] <= start)
        and not (end and r["valid_from"] and end <= r["valid_from"])
    ]


class MemoryService:
    def __init__(self, db, provider, settings):
        self.db, self.provider, self.settings = db, provider, settings

    def get(self, ident):
        with self.db.connect() as db:
            row = db.execute("SELECT * FROM memories WHERE id=?", (ident,)).fetchone()
            if not row:
                raise Missing("Memory not found")
            m = dict(row)
            m["completed"] = bool(m["completed"])
            m["sources"] = [
                dict(r)
                for r in db.execute(
                    """SELECT s.message_id,m.conversation_id,m.content FROM memory_sources s LEFT JOIN messages m ON m.id=s.message_id WHERE memory_id=?""",
                    (ident,),
                )
            ]
            m["links"] = [
                dict(r)
                for r in db.execute(
                    "SELECT * FROM memory_links WHERE source_id=? OR target_id=?",
                    (ident, ident),
                )
            ]
            return m

    def list(self, query="", state="active", kind="", scope="", category=""):
        with self.db.connect() as db:
            rows = [
                {**dict(r), "completed": bool(r["completed"])}
                for r in db.execute("SELECT * FROM memories ORDER BY created_at DESC")
            ]
        return [
            r
            for r in rows
            if (not state or r["state"] == state)
            and (not category or r["category"] == category)
            and (not kind or r["type"] == kind)
            and (not scope or r["scope"] == scope)
            and (not query or terms(query) & terms(text_of(r)))
        ]

    def _save(
        self,
        db,
        memory,
        origin,
        source=None,
        correction=False,
        approved=False,
        force_new=False,
        replacing_id=None,
    ):
        data = memory.model_dump()
        if secret(text_of(data)) or memory.sensitivity == "secret":
            raise ValueError("Secrets cannot be stored as memories")
        if memory.sensitivity == "sensitive" and not approved:
            raise ValueError("Sensitive memories require explicit approval")
        if source:
            message = db.execute(
                "SELECT * FROM messages WHERE id=?", (source,)
            ).fetchone()
            if not message or message["excluded"] or message["role"] != "user":
                raise Conflict("Source is excluded or unavailable")
        existing = [
            r for r in contextual_records(db, memory) if r["id"] != replacing_id
        ]
        for old in existing:
            if not force_new and old["value"].casefold() == memory.value.casefold() and (memory.category == "general" or (old["title"].casefold() == memory.title.casefold() and old["task_status"] == memory.task_status)):
                if source:
                    db.execute(
                        "INSERT OR IGNORE INTO memory_sources VALUES(?,?)",
                        (old["id"], source),
                    )
                return old["id"]
        if existing and not correction and memory.category == "general":
            raise Conflict("A different value already exists; approval is required")
        ident = uid()
        columns = list(data) + ["id", "origin"]
        db.execute(
            f"INSERT INTO memories ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
            [*data.values(), ident, origin],
        )
        if source:
            db.execute("INSERT INTO memory_sources VALUES(?,?)", (ident, source))
        db.execute(
            "INSERT INTO memory_events(memory_id,kind,version) VALUES(?,?,1)",
            (ident, "created"),
        )
        if correction:
            for old in existing:
                db.execute(
                    "UPDATE memories SET state='superseded',version=version+1,modified_at=? WHERE id=? AND version=?",
                    (now(), old["id"], old["version"]),
                )
                db.execute(
                    "INSERT INTO memory_events(memory_id,kind,version) VALUES(?,?,?)",
                    (old["id"], "superseded", old["version"] + 1),
                )
                db.execute(
                    "INSERT INTO memory_links VALUES(?,?,?)",
                    (old["id"], ident, "superseded_by"),
                )
        return ident

    def create(
        self, memory, origin="explicit", source=None, correction=False, approved=False
    ):
        with self.db.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            ident = self._save(db, memory, origin, source, correction, approved)
        return self.get(ident)

    def edit(self, ident, edit):
        with self.db.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT * FROM memories WHERE id=?", (ident,)).fetchone()
            if not old:
                raise Missing("Memory not found")
            if old["version"] != edit.version:
                raise Conflict("Memory changed; reload before editing")
            if edit.state == "retracted":
                db.execute(
                    "UPDATE memories SET state='retracted',version=version+1,modified_at=? WHERE id=?",
                    (now(), ident),
                )
                db.execute(
                    "INSERT INTO memory_events(memory_id,kind,version) VALUES(?,?,?)",
                    (ident, "retracted", old["version"] + 1),
                )
                result = ident
            else:
                result = self._save(
                    db,
                    edit.memory,
                    "explicit",
                    correction=False,
                    approved=True,
                    force_new=True,
                    replacing_id=ident,
                )
                if result != ident:
                    db.execute(
                        "UPDATE memories SET state='superseded',version=version+1,modified_at=? WHERE id=?",
                        (now(), ident),
                    )
                    db.execute(
                        "INSERT INTO memory_links VALUES(?,?,?)",
                        (ident, result, "edited_to"),
                    )
                    db.execute(
                        "INSERT OR IGNORE INTO memory_sources SELECT ?,message_id FROM memory_sources WHERE memory_id=?",
                        (result, ident),
                    )
                    db.execute(
                        "INSERT INTO memory_events(memory_id,kind,version) VALUES(?,?,?)",
                        (ident, "edited", old["version"] + 1),
                    )
        return self.get(result)

    def candidates(self):
        with self.db.connect() as db:
            return [
                {
                    **dict(r),
                    "payload": json.loads(r["payload"]),
                    "conflicts": json.loads(r["conflicts"]),
                }
                for r in db.execute(
                    "SELECT c.*,m.content AS source_evidence FROM memory_candidates c LEFT JOIN messages m ON m.id=c.message_id WHERE status='pending' ORDER BY c.created_at DESC"
                )
            ]

    def decide(self, ident, approve):
        with self.db.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM memory_candidates WHERE id=?", (ident,)
            ).fetchone()
            if not row:
                raise Missing("Candidate not found")
            if row["status"] != "pending":
                raise Conflict("Candidate already reviewed")
            memory_id = None
            if approve:
                payload = json.loads(row["payload"])
                memory = Memory.model_validate(
                    {k: v for k, v in payload.items() if k in Memory.model_fields}
                )
                current = [
                    r["id"]
                    for r in contextual_records(db, memory)
                    if r["value"].casefold() != memory.value.casefold()
                ]
                if sorted(current) != sorted(json.loads(row["conflicts"])):
                    raise Conflict(
                        "Conflicting memories changed; review a new suggestion"
                    )
                memory_id = self._save(
                    db,
                    memory,
                    payload["origin"],
                    row["message_id"],
                    correction=bool(current),
                    approved=True,
                )
            # Reviewed payload need not keep a second copy of personal data.
            db.execute("DELETE FROM memory_candidates WHERE id=?", (ident,))
        return {"approved": approve, "memory_id": memory_id}

    def save_pending(self):
        """Apply existing suggestions when switching to automatic saving."""
        with self.db.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for row in db.execute("SELECT * FROM memory_candidates WHERE status='pending' ORDER BY created_at,rowid").fetchall():
                payload = json.loads(row["payload"])
                if payload.get("ambiguous"):
                    continue
                data = Memory.model_validate({k: v for k, v in payload.items() if k in Memory.model_fields})
                try:
                    self._save(db, data, payload.get("origin", "inferred"), row["message_id"], approved=True)
                except (Conflict, ValueError):
                    # Stale conflicts and unavailable sources cannot override newer facts.
                    continue
                db.execute("DELETE FROM memory_candidates WHERE id=?", (row["id"],))

    async def extract(self, message_id, context):
        if not self.settings.extraction_enabled:
            return {"saved": [], "suggested": 0, "warning": None}
        try:
            with self.db.connect() as db:
                row = db.execute(
                    "SELECT * FROM messages WHERE id=?", (message_id,)
                ).fetchone()
            if not row or row["excluded"]:
                return {"saved": [], "suggested": 0, "warning": None}
            content = row["content"]
            if secret(content):
                return {
                    "saved": [],
                    "suggested": 0,
                    "warning": "Secret-like content was excluded from memory extraction.",
                }
            prompt = Path(self.settings.extraction_prompt).read_text()
            raw = await self.provider.extract(
                prompt, [*context[-8:], {"role": "user", "content": content}]
            )
            output = Extraction.model_validate(raw)
            fact_request = parse_fact_request(content)
            if fact_request and fact_request[0] == "remember":
                for item in output.memories:
                    item.category = "general"
                    item.title = ""
                    item.type = "fact"
            supported = (
                await self.provider.verify(
                    content, [m.model_dump() for m in output.memories]
                )
                if output.memories
                else []
            )
            if len(supported) != len(output.memories):
                raise ValueError("Incomplete source verification")
            saved = []
            suggested = 0
            with self.db.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                fresh = db.execute(
                    "SELECT excluded FROM messages WHERE id=?", (message_id,)
                ).fetchone()
                if not fresh or fresh["excluded"]:
                    return {"saved": [], "suggested": 0, "warning": None}
                for item, grounded in zip(output.memories, supported):
                    if grounded is not True:
                        continue
                    # Exact source span and value grounding; never accept unsupported model assertions.
                    if (
                        not item.evidence
                        or item.evidence not in content
                        or item.value.casefold() not in item.evidence.casefold()
                    ):
                        continue
                    if (
                        secret(text_of(item.model_dump()))
                        or item.sensitivity == "secret"
                    ):
                        continue
                    if re.search(
                        r"(?i)\b(diagnos\w*|medication|salary|bank|medical|religion|political|sexual|address|phone|email)\b",
                        content,
                    ):
                        item.sensitivity = "sensitive"
                    explicit = bool(
                        re.search(
                            r"(?i)\b(remember|from now on|always respond|always use)\b",
                            content,
                        )
                    )
                    correction = item.correction and bool(
                        re.search(
                            r"(?i)\b(actually|instead|nowadays|now|no longer|correction)\b",
                            content,
                        )
                    )
                    conflicts = [
                        r["id"]
                        for r in contextual_records(db, item)
                        if r["value"].casefold() != item.value.casefold()
                    ]
                    data = Memory.model_validate(
                        {
                            k: v
                            for k, v in item.model_dump().items()
                            if k in Memory.model_fields
                        }
                    )
                    if self.settings.auto_save_memories:
                        if not item.ambiguous:
                            saved.append(self._save(
                                db, data, "explicit" if explicit else "inferred",
                                message_id, correction=bool(conflicts), approved=True,
                            ))
                        continue
                    if (
                        (explicit or correction)
                        and not item.ambiguous
                        and item.sensitivity == "ordinary"
                        and (not conflicts or correction)
                    ):
                        saved.append(
                            self._save(db, data, "explicit", message_id, correction)
                        )
                    elif self.settings.implicit_suggestions or explicit or correction:
                        payload = item.model_dump()
                        duplicate = db.execute(
                            "SELECT 1 FROM memory_candidates WHERE message_id=? AND payload=?",
                            (message_id, json.dumps(payload)),
                        ).fetchone()
                        if not duplicate:
                            db.execute(
                                "INSERT INTO memory_candidates(id,message_id,payload,conflicts) VALUES(?,?,?,?)",
                                (
                                    uid(),
                                    message_id,
                                    json.dumps(payload),
                                    json.dumps(conflicts),
                                ),
                            )
                            suggested += 1
            return {"saved": saved, "suggested": suggested, "warning": None}
        except Exception:
            return {
                "saved": [],
                "suggested": 0,
                "warning": "Memory extraction unavailable; this message was not added to memory.",
            }

    def request_delete(self, targets, message_id):
        if not targets:
            return {"answer": "There are no matching items to delete.", "items": []}
        ident = uid()
        text = f"Delete {len(targets)} item{'s' if len(targets) != 1 else ''}?\n"
        previews = []
        for row in targets[:10]:
            limit = 160 if row["category"] == "documents" else 2000
            body = " ".join(row["value"].split()) if row["category"] == "documents" else row["value"]
            preview = body[:limit] + ("…" if len(body) > limit else "")
            title = f"{row['title']}: " if row["title"] else ""
            previews.append(f"• {row['category'].capitalize()}: {title}{preview}")
        text += "\n".join(previews)
        if len(targets) > 10:
            text += f"\n…and {len(targets) - 10} more."
        text += "\nThis also removes linked versions and excludes earlier chats from AI context."
        with self.db.connect() as db:
            source = db.execute("SELECT conversation_id FROM messages WHERE id=?", (message_id,)).fetchone()
            if not source:
                raise Missing("Source conversation not found")
            epoch = db.execute("SELECT value FROM settings WHERE key='privacy_epoch'").fetchone()
            db.execute("DELETE FROM pending_deletions WHERE expires_at<=?", (now(),))
            db.execute("DELETE FROM pending_deletions WHERE conversation_id=?", (source[0],))
            db.execute("INSERT INTO pending_deletions VALUES(?,?,?,?,?)", (
                ident, source[0], json.dumps([{ "id": r["id"], "version": r["version"], "state": r["state"] } for r in targets]),
                epoch[0] if epoch else "", (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
            ))
        return {"answer": text + "\nPlease confirm the deletion, or cancel to keep the items.", "items": [],
                "confirmation": {"id": ident, "text": text}}

    def confirm_delete(self, ident, confirmed):
        with self.db.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            request = db.execute("SELECT * FROM pending_deletions WHERE id=?", (ident,)).fetchone()
            if not request:
                raise Missing("This deletion request is no longer available")
            if not confirmed:
                db.execute("DELETE FROM pending_deletions WHERE id=?", (ident,))
                db.execute("INSERT INTO messages(id,conversation_id,role,content) VALUES(?,?,?,?)",
                           (uid(), request["conversation_id"], "assistant", "Deletion cancelled."))
                return {"deleted": 0, "answer": "Deletion cancelled."}
            epoch = db.execute("SELECT value FROM settings WHERE key='privacy_epoch'").fetchone()
            if request["expires_at"] <= now() or request["privacy_epoch"] != (epoch[0] if epoch else ""):
                raise Conflict("This deletion request expired or the library changed. Please ask again.")
            targets = json.loads(request["targets"])
            for target in targets:
                current = db.execute("SELECT state,version FROM memories WHERE id=?", (target["id"],)).fetchone()
                if not current or current["state"] != target["state"] or current["version"] != target["version"]:
                    raise Conflict("An item changed after the deletion request. Please ask again.")
            result = self._delete(db, [r["id"] for r in targets])
            db.execute("DELETE FROM pending_deletions WHERE id=?", (ident,))
            answer = f"Deleted {len(targets)} item{'s' if len(targets) != 1 else ''}."
            db.execute("INSERT INTO messages(id,conversation_id,role,content,excluded) VALUES(?,?,?,?,1)",
                       (uid(), request["conversation_id"], "assistant", answer))
        return {**result, "answer": answer}

    def delete(self, ids, delete_history=False):
        with self.db.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            return self._delete(db, ids, delete_history)

    def _delete(self, db, ids, delete_history=False):
        # Conservatively exclude all retained messages and clear candidates, including indirect paraphrases.
        # Exclusion is content-free and survives restart. Raw history is never replayed after forgetting.
        db.execute("UPDATE messages SET excluded=1")
        db.execute("DELETE FROM memory_candidates")
        linked = set(ids)
        pending = list(ids)
        while pending:
            ident = pending.pop()
            for link in db.execute(
                "SELECT source_id,target_id FROM memory_links WHERE source_id=? OR target_id=?",
                (ident, ident),
            ):
                for related in link:
                    if related not in linked:
                        linked.add(related)
                        pending.append(related)
        for ident in linked:
            db.execute("DELETE FROM memories WHERE id=?", (ident,))
        db.execute(
            "INSERT OR REPLACE INTO settings VALUES('privacy_epoch',?)", (uid(),)
        )
        if delete_history:
            db.execute("DELETE FROM conversations")
        return {"deleted": len(linked), "history_deleted": delete_history}


    def forget(self, topic="", all=False, delete_history=False):
        return self.delete([r["id"] for r in self.forget_targets(topic, all)], delete_history)

    def forget_targets(self, topic="", all=False, category=""):
        if not all and not terms(topic):
            raise ValueError("Supply a topic or all=true")
        rows = self.list(state="", category=category)
        stop = {
            "my",
            "me",
            "about",
            "all",
            "everything",
            "the",
            "a",
            "an",
            "of",
            "you",
            "know",
            "favorite",
            "favourite",
            "preferred",
            "preferences",
            "preference",
            "forget",
            "delete",
            "memories",
        }
        query = terms(topic) - stop
        if not all and not query:
            raise ValueError("Please provide a specific topic")
        return [r for r in rows if all or query <= terms(text_of(r))]

    def consolidate(self):
        # Conservative: merge only identical structured claims. Semantic neighbors remain suggestions.
        rows = self.list()
        groups = {}
        merged = 0
        suggestions = []
        with self.db.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for row in rows:
                key = tuple(
                    row[k].casefold()
                    for k in (
                        "subject",
                        "predicate",
                        "value",
                        "scope",
                        "type",
                        "sensitivity",
                        "category",
                        "title",
                    )
                ) + (row["valid_from"], row["valid_until"], row["completed"], row["task_status"])
                if key in groups:
                    target = groups[key]
                    db.execute(
                        "INSERT OR IGNORE INTO memory_sources SELECT ?,message_id FROM memory_sources WHERE memory_id=?",
                        (target, row["id"]),
                    )
                    for link in db.execute(
                        "SELECT * FROM memory_links WHERE source_id=? OR target_id=?",
                        (row["id"], row["id"]),
                    ).fetchall():
                        source_id = (
                            target
                            if link["source_id"] == row["id"]
                            else link["source_id"]
                        )
                        target_id = (
                            target
                            if link["target_id"] == row["id"]
                            else link["target_id"]
                        )
                        if source_id != target_id:
                            db.execute(
                                "INSERT OR IGNORE INTO memory_links VALUES(?,?,?)",
                                (source_id, target_id, link["kind"]),
                            )
                    db.execute(
                        "INSERT OR IGNORE INTO message_memories SELECT message_id,? FROM message_memories WHERE memory_id=?",
                        (target, row["id"]),
                    )
                    db.execute(
                        "INSERT INTO memory_events(memory_id,kind,version) SELECT id,?,version FROM memories WHERE id=?",
                        ("consolidated_duplicate", target),
                    )
                    db.execute("DELETE FROM memories WHERE id=?", (row["id"],))
                    merged += 1
                else:
                    groups[key] = row["id"]
            for i, a in enumerate(rows):
                for b in rows[i + 1 :]:
                    if a["scope"] != b["scope"] or a["category"] != b["category"]:
                        continue
                    overlap = terms(text_of(a)) & terms(text_of(b))
                    union = terms(text_of(a)) | terms(text_of(b))
                    if (
                        len(overlap) / max(1, len(union)) > 0.55
                        and a["value"] != b["value"]
                    ):
                        suggestions.append(
                            {
                                "ids": [a["id"], b["id"]],
                                "reason": "Related claims; review before merging or replacing.",
                            }
                        )
            embedded = db.execute(
                """SELECT a.memory_id AS a,b.memory_id AS b,vec_distance_cosine(a.embedding,b.embedding) AS distance FROM memory_embeddings a JOIN memory_embeddings b ON a.memory_id<b.memory_id AND a.model=b.model AND a.model_version=b.model_version JOIN memories ma ON ma.id=a.memory_id JOIN memories mb ON mb.id=b.memory_id WHERE ma.scope=mb.scope AND ma.state='active' AND mb.state='active' AND length(a.embedding)=length(b.embedding) ORDER BY distance LIMIT 50"""
            ).fetchall()
            for pair in embedded:
                if pair["distance"] < 0.15 and not any(
                    set(x["ids"]) == {pair["a"], pair["b"]} for x in suggestions
                ):
                    suggestions.append(
                        {
                            "ids": [pair["a"], pair["b"]],
                            "reason": "Semantically similar; review contextual differences before merging.",
                        }
                    )
            for row in rows:
                if row["valid_until"] and row["valid_until"] < now():
                    suggestions.append(
                        {
                            "ids": [row["id"]],
                            "reason": "Temporal validity has expired; review or retract.",
                        }
                    )
        return {"merged": merged, "suggestions": suggestions}
