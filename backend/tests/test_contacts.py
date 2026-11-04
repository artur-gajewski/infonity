import pytest
from app.contacts import contact_answer, contact_emails, contact_target


def record(value, subject="document", predicate="content"):
    return {"value": value, "subject": subject, "predicate": predicate}


@pytest.mark.parametrize("query,target", [
    ("Give me contact info for people ops", "people ops"),
    ("What's People Operations's email?", "People Operations"),
    ("Show me email addresses for Alex Smith.", "Alex Smith"),
    ("Who should I contact if I'm sick?", None),
    ("I have contact info for PeopleOps but need help drafting a message.", None),
])
def test_explicit_contact_lookup(query, target):
    assert contact_target(query) == target


@pytest.mark.parametrize("source", [
    "Return the assessment to People Operations ( or Ops mailbox at HQ).\n"
    "Occupational healthcare team\n"
    "jane.nurse@health.example\njack.doctor@health.example\npayroll@acme.example",
    "People Operations\nNurse: jane.nurse@health.example\nPayroll: payroll@acme.example",
])
def test_proximity_does_not_establish_team_membership(source):
    rows = [record(source)]
    assert not contact_emails(rows[0], "People Ops")
    answer = contact_answer("Give me contact info for People Ops", rows)
    assert "couldn't verify" in answer
    assert "@" not in answer


@pytest.mark.parametrize("target,source,address", [
    ("People Ops", "peopleops@acme.example\npayroll@acme.example", "peopleops@acme.example"),
    ("People Operations", "People Operations: hr@acme.example", "hr@acme.example"),
    ("Alex Smith", "alex.smith@acme.example", "alex.smith@acme.example"),
])
def test_address_requires_matching_identity_or_explicit_label(target, source, address):
    assert contact_emails(record(source), target) == [address]


def test_structured_contact_preserves_subject():
    assert contact_emails(record("desk@acme.example", "People Operations", "email"), "People Ops") == ["desk@acme.example"]
    assert not contact_emails(record("desk@acme.example", "Occupational nurse", "email"), "People Ops")


def test_invalid_addresses_are_not_used():
    assert not contact_emails(record("Do not use peopleops@acme.example"), "People Ops")
    assert not contact_emails(record("Payroll: peopleops@acme.example"), "People Ops")
