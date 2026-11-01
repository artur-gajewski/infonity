"""Validated local actions shared with the memory API's application services."""

import re
from .models import Intent, Memory, MemoryEdit
from .memory import Conflict


LABELS = {"general": "memory", "documents": "Documents", "todo": "Todo", "reminders": "Reminders", "links": "Links"}


def normalized(text):
    return " ".join(text.casefold().split())


def display_item(row):
    if row["category"] == "documents":
        return row["title"] or row["value"].split("\n", 1)[0][:120] or "Untitled document"
    text = f"{row['title']}: {row['value']}" if row["title"] and row["value"] else row["title"] or row["value"]
    status = row.get("task_status", "done" if row.get("completed") else "todo")
    return f"{text} [{status}]" if row["category"] in ("todo", "reminders") and status != "todo" else text


def listing_query(query, message):
    # Keep an actual subject/name filter, but not one inferred solely from
    # a trailing explanation of why the user is making the request.
    without_purpose = re.sub(
        r"\b(?:for (?:a )?test|as a test|just testing|to check (?:that )?it works)\s*[.!?]*\s*$",
        "", message, flags=re.I,
    )
    if without_purpose != message and query and not re.search(
        r"(?<!\w)" + re.escape(normalized(query)) + r"(?!\w)", normalized(without_purpose),
    ):
        return ""
    return query


def resolve_named_targets(memory, intent, message):
    """Exact quoted names override a model's guessed id, never a fuzzy match."""
    quoted = re.findall(r'["“]([^"”]+)["”]|(?<!\w)\'([^\'\n]+)\'(?!\w)', message)
    literal_names = [" ".join((a or b).split()) for a, b in quoted]
    names = [normalized(name) for name in literal_names]
    rows = memory.list(category=intent.category or "")
    if not names:
        # Also detect a shared explicit title in an unquoted request.
        names = [normalized(name) for r in rows
                 for name in [r["title"] or (r["value"] if len(r["value"]) <= 300 and not re.search(r"https?://", r["value"]) else "")]
                 if name and re.search(r"(?<!\w)" + re.escape(normalized(name)) + r"(?!\w)", normalized(message))]
        if names:
            names = [name for name in names if len(name) == max(map(len, names))]
    if not names:
        return None, None
    matches = [r for r in rows if normalized(r["title"]) in names or normalized(r["value"]) in names or normalized(display_item(r)) in names
               or any(normalized(url) in names for url in re.findall(r"https?://\S+", r["value"]))]
    if not literal_names:
        literal_names = [" ".join(match.group().split()) for name in names
                         if (match := re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", message, re.I))]
    exact_matches = [row for row in matches if any(
        " ".join(value.split()) in literal_names
        for value in (row["title"], row["value"], display_item(row), *re.findall(r"https?://\S+", row["value"]))
    )]
    if exact_matches:
        matches = exact_matches
    if not matches:
        return [], "I couldn't find that exact name. Which item do you mean?"
    if len(matches) > 1:
        choices = "\n".join(f"• {display_item(r)[:500]}" for r in matches[:10])
        return [], "More than one item has that name. Which one do you mean?\n" + choices
    return matches, None


def available_items(memory, message):
    # Bound the prompt, but prefer relevant matches over the newest entries.
    matches = memory.list(query=message)
    rows = {r["id"]: r for r in [*matches, *memory.list()]}
    return list(rows.values())[:100]


def item_previews(rows):
    budget = 12000
    result = []
    for row in rows:
        if budget < 200:
            break
        value = row["value"][:min(2000, budget)]
        result.append({"id": row["id"], "category": row["category"], "title": row["title"],
                       "value": value, "completed": bool(row["completed"]), "task_status": row["task_status"], "truncated": len(value) < len(row["value"])})
        budget -= len(value) + len(row["title"]) + 120
    return result


def execute(memory, intent: Intent, offered, message_id, message, context):
    """Return an application-written result; never execute model-selected URLs/code."""
    # A bare, explicitly named deletion must not inherit a guessed category
    # or an unnecessary clarification from the interpreter.
    bare_delete = re.fullmatch(
        r"\s*(?:please\s+)?(?:delete|remove|erase)\s+(\"[^\"]+\"|'[^']+'|[^\s\"']+)\s*", message, re.I,
    )
    if intent.action in ("delete", "clarify") and bare_delete and normalized(bare_delete[1].strip("\"'")) not in {
        "all", "everything", "memories", "documents", "todos", "tasks", "reminders", "links",
    }:
        intent = intent.model_copy(update={"action": "delete", "category": None, "all": False, "target_ids": []})
    if intent.action == "delete":
        # The interpreter is fallible: obvious explanations, negations, and
        # save requests containing quoted commands must never become deletion.
        if re.search(r"\bhow (?:do|can|would|should|to)\b|\b(?:don't|dont|do not|never)\b", message, re.I) or re.match(
            r"\s*(?:please\s+)?(?:save|store|add|keep)\b", message, re.I,
        ):
            return {"answer": "I haven't deleted anything. Which saved item, if any, would you like me to remove?", "items": []}
    if intent.action == "clarify":
        return {"answer": intent.question or "Which item do you mean?", "items": []}
    if intent.action == "list":
        query = listing_query(intent.query, message)
        completion_filter = intent.completed if re.search(
            r"\b(done|completed?|finished?|open|pending|incomplete|unfinished)\b", message, re.I,
        ) else None
        status_filter = intent.task_status
        if not status_filter or normalized(status_filter) not in normalized(message) or (normalized(status_filter) == "todo" and "status" not in message.lower()):
            status_filter = None
        if status_filter and normalized(query) == normalized(status_filter):
            query = ""
        rows = memory.list(query=query, category=intent.category or "")
        if status_filter:
            rows = [r for r in rows if normalized(r["task_status"]) == normalized(status_filter)]
        if completion_filter is not None:
            rows = [r for r in rows if r["completed"] == completion_filter]
        label = LABELS.get(intent.category, "saved items")
        fallback = False
        if not rows and query:
            rows = memory.list(category=intent.category or "")
            if status_filter:
                rows = [r for r in rows if normalized(r["task_status"]) == normalized(status_filter)]
            if completion_filter is not None:
                rows = [r for r in rows if r["completed"] == completion_filter]
            fallback = bool(rows)
        if not rows:
            answer = f"You don't have any matching items in {label}."
        else:
            heading = (f"No items in {label} match “{query}”. Here are your saved items instead:\n"
                       if fallback else f"Here's what's in {label}:\n")
            answer = heading + "\n".join(f"• {display_item(r)}" for r in rows[:50])
            if len(rows) > 50:
                answer += f"\nShowing 50 of {len(rows)} items. You can see all of them in the Memory library."
        return {"answer": answer, "items": rows[:50]}
    if intent.action == "add":
        # A request supplying only a document name has no document body.
        named_document = re.fullmatch(
            r'\s*(?:please\s+)?(?:add|create|make)\s+(?:(?:a|the)\s+)?(?:new\s+)?document\s+(?:called|named|titled)\s+["“]([^"”]+)["”]\s*[.!]?\s*',
            message, re.I,
        )
        if intent.category == "documents" and named_document:
            intent = intent.model_copy(update={"title": named_document[1], "content": ""})
        # The model can select a span, but cannot invent content to save.
        normalize = lambda text: " ".join(text.casefold().split())
        sources = [message, *(m["content"] for m in context[-8:])]
        if not any(normalize(intent.content) in normalize(s) for s in sources) or (
            intent.title and not any(normalize(intent.title) in normalize(s) for s in sources)
        ):
            return {"answer": "What exact content would you like me to save?", "items": []}
        if intent.category == "documents":
            return {
                "answer": "Enter the document details in the dialog, then choose Create document.",
                "items": [],
                "document_draft": {"title": intent.title or "", "body": intent.content},
            }
        saved = memory.create(Memory(
            category=intent.category, predicate="item", value=intent.content, title=intent.title or "",
            evidence=message,
        ), source=message_id, approved=True)
        answer = f"Added to {LABELS[intent.category]}: {display_item(saved)}"
        if intent.category == "reminders":
            answer += "\nSaved as a reminder note; notifications aren't scheduled."
        return {"answer": answer, "items": [saved], "saved": [saved["id"]]}
    snapshot = {r["id"]: r for r in offered}
    if intent.action == "delete" and not intent.all:
        named, question = resolve_named_targets(memory, intent, message)
        if question:
            return {"answer": question, "items": []}
        if named:
            # These rows were selected by literal user-supplied names, not ids
            # invented by the model. Capture their current versions as usual.
            snapshot.update({r["id"]: r for r in named})
            intent = intent.model_copy(update={"target_ids": [r["id"] for r in named]})
    if intent.action == "delete" and len(intent.target_ids) > 1 and not intent.all and not re.search(
        r"\b(both|these|those|all|items|tasks|todos|reminders|links|documents|notes)\b|\band\b", message, re.I,
    ):
        return {"answer": "More than one item matches. Which one would you like to remove?", "items": []}
    if intent.all:
        if not re.search(r"\b(all|everything|clear|empty|wipe)\b", message, re.I):
            return {"answer": "Which items would you like to delete?", "items": []}
        targets = memory.list(category=intent.category or "")
    else:
        if not intent.target_ids or any(ident not in snapshot for ident in intent.target_ids):
            return {"answer": "I couldn't identify that item. Which one do you mean?", "items": []}
        targets = []
        for ident in dict.fromkeys(intent.target_ids):
            row = memory.get(ident)
            if row["state"] != "active" or row["version"] != snapshot[ident]["version"]:
                raise Conflict("That item changed. Please try your request again.")
            if intent.category and intent.action == "delete" and row["category"] != intent.category:
                raise Conflict("That item belongs to a different category.")
            targets.append(row)
    if intent.action == "delete":
        if not targets:
            return {"answer": "There are no matching items to delete.", "items": []}
        return memory.request_delete(targets, message_id)
    if intent.action == "update":
        old = targets[0]
        if len(old["value"]) > 2000 and intent.content == old["value"][:2000].strip():
            return {"answer": "Should I move the full item, or replace its content?", "items": []}
        data = Memory.model_validate({k: v for k, v in old.items() if k in Memory.model_fields})
        completion = intent.completed
        if (intent.content or intent.title) and not re.search(
            r"\b(done|completed?|finished?|incomplete|unfinished|reopen|uncheck|unmark)\b", message, re.I,
        ):
            completion = None  # A text edit must not copy/reset the current status.
        if re.search(r"\b(move|title|rename|label|description|content|text|wording)\b", message, re.I):
            completion = None
        if old["category"] in ("todo", "reminders") and re.match(r"\s*(?:please\s+)?(?:mark|update|set|check|uncheck|unmark|reopen|complete|finish)\b", message, re.I):
            if re.search(r"\b(not done|incomplete|unfinished|reopen|uncheck|unmark)\b", message, re.I):
                completion = False
            elif re.search(r"\b(done|completed?|finished?|check)\b", message, re.I):
                completion = True
        requested_status = None
        status_command = re.match(r"\s*(?:please\s+)?(?:mark|set|update)\s+(.+?)\s+as\s+(.+?)\s*$", message, re.I | re.S)
        if status_command and not re.search(r"\b(title|name|label|description|content|text|wording)\b", status_command[1], re.I):
            requested_status = status_command[2].strip().rstrip(".!?").strip().strip('"“”')
        if requested_status is None and intent.task_status and not (intent.content or intent.title):
            if normalized(intent.task_status) in normalized(message) and not re.search(r"\bmove\b", message, re.I):
                requested_status = intent.task_status
        if requested_status is None and completion is not None:
            requested_status = "done" if completion else "todo"
        if requested_status is not None:
            if old["category"] not in ("todo", "reminders"):
                return {"answer": "Only todos and reminders have task statuses.", "items": []}
            if re.search(r"\b(?:don't|dont|do not|never)\s+(?:mark|update|set|complete|finish|check)\b", message, re.I):
                return {"answer": "I haven't changed the task.", "items": []}
            requested_status = " ".join(requested_status.split())
            if not requested_status or len(requested_status) > 100:
                return {"answer": "What short status label would you like to use?", "items": []}
            if old["task_status"] == requested_status:
                return {"answer": f"Already marked {requested_status}: {old['value']}", "items": [old]}
            data.task_status = requested_status
            data.completed = requested_status.casefold() in {"done", "complete", "completed", "finished"}
            data.evidence = message
            saved = memory.edit(old["id"], MemoryEdit(memory=data, version=old["version"]))
            with memory.db.connect() as db:
                db.execute("INSERT OR IGNORE INTO memory_sources VALUES(?,?)", (saved["id"], message_id))
            return {"answer": f"Marked {requested_status}: {old['value']}", "items": [saved], "saved": [saved["id"]]}
        title = intent.title
        content = intent.content
        title_requested = bool(re.search(r"\b(title|name|rename|label|called)\b", message, re.I))
        if title and not content and not title_requested:
            # A generic text change edits content, not hidden title metadata.
            content, title = title, None
        if intent.category and intent.category != old["category"] and re.search(r"\bmove\b", message, re.I):
            if content and old["value"].startswith(content):
                content = ""  # Preserve the complete item when moving a preview.
        if old["category"] == "links" and (intent.category in (None, "links")) and re.search(r"https?://\S+", old["value"]):
            if content and not re.search(r"https?://\S+", content):
                if title_requested:
                    title = title if title is not None else content
                    content = ""
                else:
                    return {"answer": "That would remove the URL. Do you want to change the title or replace the link?", "items": []}
        if title is not None:
            if title and normalized(title) not in normalized(message):
                return {"answer": "What title would you like to use?", "items": []}
            data.title = title
        data.value = content or old["value"]
        data.evidence = message
        data.category = intent.category or data.category
        saved = memory.edit(old["id"], MemoryEdit(memory=data, version=old["version"]))
        with memory.db.connect() as db:
            db.execute("INSERT OR IGNORE INTO memory_sources VALUES(?,?)", (saved["id"], message_id))
        return {"answer": f"Updated in {LABELS[saved['category']]}: {display_item(saved)}", "items": [saved], "saved": [saved["id"]]}
    raise ValueError("Unsupported action")
