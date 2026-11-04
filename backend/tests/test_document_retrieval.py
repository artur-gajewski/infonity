import pytest
from app.models import Memory
from app.retrieval import context_json
from conftest import source


def section(memory, number, value, **kwargs):
    return memory.create(Memory(
        category="documents", subject="document", predicate="content",
        title=f"Sick leave and occupational health.pdf (part {number}/4)",
        value=value, **kwargs,
    ), approved=True)


async def test_sickness_question_retains_contacts_with_default_budget(services):
    db, provider, memory, retrieval, settings = services
    provider.fail = True  # Lexical retrieval must work without embeddings.
    section(memory, 1, "What to do when sick. Notify the following stakeholders about your sick leave:\n" + "General background. " * 50)
    contacts = section(memory, 2,
        "Customer contact or team leader; Key Account Manager; Face-to-Face supervisor; People Operations. "
        "Send certificates to People Operations. Report sick leave hours in the time system. "
        + "Other procedural details. " * 40)
    section(memory, 3, "Nurse chat provides health assessments. " + "Service details. " * 65)
    tail = section(memory, 4, "Bring a travel insurance card when travelling.")
    unrelated = memory.create(Memory(predicate="preferred_programming_language", value="TimeTracker"))
    for predicate in ("preferred_contact_for_sick_certificate", "preferred_contact_for_sick_certificates"):
        memory.create(Memory(predicate=predicate, value="People Operations"))
    found, warning = await retrieval.search("Who should I contact if I'm sick?")
    assert warning
    assert contacts["id"] in {r["id"] for r in found}
    assert tail["id"] not in {r["id"] for r in found}
    assert unrelated["id"] not in {r["id"] for r in found}
    assert len(context_json(found)) <= settings.memory_tokens * 4
    assert len(found) <= settings.memory_limit


@pytest.mark.parametrize("neighbor_fields", [
    {"sensitivity": "sensitive"},
    {"valid_until": "2000-01-01T00:00:00Z"},
    {"valid_from": "2100-01-01T00:00:00Z"},
    {"scope": "other"},
])
async def test_neighbor_expansion_preserves_eligibility(services, neighbor_fields):
    db, provider, memory, retrieval, settings = services
    provider.fail = True
    anchor = section(memory, 1, "Notify the stakeholders when sick.")
    excluded = section(memory, 2, "Confidential stakeholder list.", **neighbor_fields)
    found, _ = await retrieval.search("sick")
    assert anchor["id"] in {r["id"] for r in found}
    assert excluded["id"] not in {r["id"] for r in found}


@pytest.mark.parametrize("text,predicate,value", [
    ("How about PeopleOps?", "preferred_contact_for_sick_certificate", "PeopleOps"),
    ("In documentation it says to contact PeopleOps.", "preferred_contact_for_sick_certificates", "PeopleOps"),
    ("Remember that wellbeing seminars can be reported as Meetings in TimeTracker.", "preferred_programming_language", "TimeTracker"),
])
async def test_extraction_rejects_bad_relations_even_if_verifier_accepts(services, text, predicate, value):
    db, provider, memory, retrieval, settings = services
    settings.auto_save_memories = True
    provider.result = {"memories": [{"predicate": predicate, "value": value, "evidence": text}]}
    result = await memory.extract(source(db, text), [])
    assert not result["saved"]
    assert not memory.list()
    assert not memory.candidates()


async def test_asserted_procedure_retains_organizational_subject(services):
    db, provider, memory, retrieval, settings = services
    settings.auto_save_memories = True
    text = "Acme requires sick certificates to be sent to PeopleOps."
    provider.result = {"memories": [{
        "subject": "Acme", "predicate": "sick_certificate_recipient",
        "value": "PeopleOps", "type": "fact", "evidence": text,
    }]}
    result = await memory.extract(source(db, text), [])
    assert result["saved"]
    row = memory.list()[0]
    assert row["subject"] == "Acme"
    assert row["predicate"] == "sick_certificate_recipient"


async def test_legacy_bad_summaries_do_not_override_documents(services):
    db, provider, memory, retrieval, settings = services
    provider.fail = True
    original = memory.create(Memory(
        predicate="preferred_contact_for_sick_certificate", value="PeopleOps",
        evidence="How about PeopleOps?",
    ))
    document = section(memory, 1, "When sick, contact your team leader, supervisor and PeopleOps.")
    found, _ = await retrieval.search("Who should I contact if I'm sick?")
    assert document["id"] in {r["id"] for r in found}
    assert original["id"] not in {r["id"] for r in found}
    assert memory.get(original["id"])["state"] == "active"  # Retrieval never rewrites history.


async def test_question_does_not_discard_separate_asserted_preference(services):
    db, provider, memory, retrieval, settings = services
    settings.auto_save_memories = True
    text = "I prefer Clojure. What should I learn next?"
    provider.result = {"memories": [{
        "predicate": "preferred_programming_language", "value": "Clojure",
        "evidence": "I prefer Clojure.", "type": "preference",
    }]}
    assert (await memory.extract(source(db, text), []))["saved"]


async def test_explicit_filename_lookup_works_without_semantic_search(services):
    db, provider, memory, retrieval, settings = services
    provider.fail = True
    document = section(memory, 1, "Contact the appropriate team.")
    found, _ = await retrieval.search("Summarize Sick leave and occupational health.pdf")
    assert document["id"] in {row["id"] for row in found}
