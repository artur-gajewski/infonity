"""Small deterministic command grammar. Unrecognized requests remain ordinary chat."""

import re


def parse_forget(text: str) -> tuple[str, bool] | None:
    match = re.fullmatch(r"\s*(?:forget|delete)\s+(.+?)\s*[.!]?\s*", text, re.I | re.S)
    if not match:
        return None
    topic = match.group(1).strip().rstrip(".!")
    all_memories = bool(
        re.fullmatch(
            r"(?:everything(?:\s+you\s+know)?(?:\s+about\s+me)?|all(?:\s+of)?(?:\s+my)?\s+memories)",
            topic,
            re.I,
        )
    )
    return topic, all_memories


CATEGORIES = {
    "document": "documents", "documents": "documents", "docs": "documents",
    "todo": "todo", "to-do": "todo", "to do": "todo", "todos": "todo",
    "reminder": "reminders", "reminders": "reminders",
    "link": "links", "links": "links",
}


def parse_add(text: str) -> tuple[str, str] | None:
    """Only explicit add/save commands; preserve the supplied content verbatim."""
    categories = "|".join(re.escape(name) for name in CATEGORIES)
    match = re.fullmatch(
        rf"\s*(?:please\s+)?(?:add|save|store)\s+(?:this\s+)?(?:to|in)\s+(?:(?:my|the)\s+)?({categories})(?=$|[\s:—-])(?:\s*[:—-]\s*|\s+)?([\s\S]*)",
        text, re.I,
    )
    if not match:
        return None
    return CATEGORIES[match[1].lower()], match[2].strip()


def parse_fact_request(text: str) -> tuple[str, str] | None:
    """Explicit remember/forget requests concern personal facts, never collections."""
    match = re.fullmatch(
        r"\s*(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(remember|forget)\s+(.+?)\s*",
        text, re.I | re.S,
    )
    return (match[1].lower(), match[2]) if match else None


def requests_document_creation(text: str) -> bool:
    """Document dialogs require a creation request, not just a model's category."""
    return bool(re.match(
        r"\s*(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?"
        r"(?:please\s+)?(?:(?:I\s+(?:want|need|would\s+like))\s+(?:you\s+)?to\s+)?"
        r"(?:add|create|make|write|draft|save|store|put|keep)\b"
        r"[^\n:]*?\b(?:documents?|docs?|notes?)\b",
        text, re.I,
    ) or re.fullmatch(r"\s*(?:a\s+)?new\s+document\s*[.!]?\s*", text, re.I))


def requests_document_listing(text: str) -> bool:
    """Only explicit collection requests may replace an answer with document titles."""
    prefix = (
        r"\s*(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?"
        r"(?:please\s+)?"
    )
    collection = r"(?:(?:all(?:\s+of)?|my|the|saved|uploaded)\s+)*(?:documents|docs|files)\b"
    return bool(re.fullmatch(
        prefix + r"(?:list|show|display)\s+(?:me\s+)?(?:a\s+list\s+of\s+)?"
        + collection + r"(?:\s+(?:about|containing|named|with|for)\s+[^\n]+)?\s*[?.!]?\s*",
        text, re.I,
    ) or re.fullmatch(
        prefix + r"(?:what|which)\s+" + collection
        + r"\s+(?:do\s+I\s+have|have\s+I\s+(?:saved|uploaded))\s*[?.!]?\s*",
        text, re.I,
    ))
