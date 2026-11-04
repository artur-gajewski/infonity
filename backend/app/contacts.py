"""Conservative, source-backed lookup for a named contact's email address."""
import re

EMAIL = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")


def contact_target(query):
    if not re.match(
        r"(?i)^(?:please\s+)?(?:give|show|find|tell|provide|list|what|can you|could you|"
        r"i need|i want|contact\s+(?:info|details)|e-?mail)\b", query.strip(),
    ):
        return None
    patterns = (
        r"(?:contact\s+(?:info(?:rmation)?|details)|email(?:\s+addresses?)?|e-mail(?:\s+addresses?)?)\s+(?:for|of)\s+(.+?)\s*[?.!]*$",
        r"(?:what(?:'s| is)|give me|show me)\s+(.+?)(?:'s|’s)\s+(?:email(?:\s+address)?|contact\s+(?:info(?:rmation)?|details))\s*[?.!]*$",
    )
    for pattern in patterns:
        match = re.search(pattern, query, re.I)
        if match:
            return match[1].strip().rstrip("?.!")
    return None


def contact_key(name):
    # Spacing/punctuation and the common Operations abbreviation do not change identity.
    name = re.sub(r"\boperations\b", "ops", name.casefold())
    return "".join(re.findall(r"[a-z0-9]+", name))


def contact_emails(row, target):
    """Proximity within a document is insufficient evidence of contact ownership."""
    key = contact_key(target)
    addresses = []
    if not key:
        return addresses
    for line in row["value"].splitlines():
        # Be conservative about references to invalid/replaced addresses.
        if re.search(r"(?i)\b(?:not|never|old|former|previous|invalid|outdated|avoid|ignore|fake|wrong|example)\b", EMAIL.sub("", line)):
            continue
        for match in EMAIL.finditer(line):
            address = match.group()
            local_part = address.split("@", 1)[0]
            prefix = line[:match.start()].strip().lstrip("-* ")
            has_label = prefix.endswith((":", "=", "–", "—"))
            if has_label and contact_key(prefix[:-1]) != key:
                continue
            labelled = prefix.endswith((":", "=", "–", "—")) and contact_key(prefix[:-1]) == key
            structured = (
                contact_key(row["subject"]) == key
                and row["predicate"].casefold() in {"email", "email_address", "contact_email"}
            )
            if contact_key(local_part) == key or labelled or structured:
                if address.casefold() not in {a.casefold() for a in addresses}:
                    addresses.append(address)
    return addresses


def contact_answer(query, rows):
    target = contact_target(query)
    if not target:
        return None
    addresses = list(dict.fromkeys(address for row in rows for address in contact_emails(row, target)))
    if not addresses:
        return f"I couldn't verify a direct contact email for {target} in the saved information."
    if len(addresses) == 1:
        return f"The contact email I can verify for {target} is **{addresses[0]}**."
    return f"The contact emails I can verify for {target} are:\n\n" + "\n".join(f"- {address}" for address in addresses)
