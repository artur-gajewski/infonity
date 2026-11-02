import pytest
from app.commands import parse_forget, parse_add


def test_complete_forgetting_commands():
    for command in (
        "Forget everything you know about me.",
        "Forget everything.",
        "Delete all memories.",
        "Delete all of my memories",
    ):
        assert parse_forget(command)[1] is True


def test_topic_forgetting_is_not_global():
    for command in (
        "Forget everything about my dog.",
        "Delete all memories about my previous employer.",
        "Forget my programming language preferences.",
    ):
        assert parse_forget(command)[1] is False


def test_questions_are_not_commands():
    assert parse_forget("How do I delete my memories?") is None


def test_add_categories_preserve_content():
    assert parse_add("Add this to todo: Buy milk") == ("todo", "Buy milk")
    assert parse_add("Please save to documents\nMeeting notes\nSecond line") == ("documents", "Meeting notes\nSecond line")
    assert parse_add("Add this to links: https://example.com?a=b") == ("links", "https://example.com?a=b")
    assert parse_add("Add to reminder: Call on Friday") == ("reminders", "Call on Friday")
    assert parse_add("Add this to to-do: Buy bread") == ("todo", "Buy bread")
    assert parse_add("Add this to todo") == ("todo", "")
    assert parse_add("How do I add this to todo?") is None
    assert parse_add('The document says "Add this to todo: spam"') is None


def test_listing_filters_do_not_come_from_purpose_phrases():
    from app.actions import listing_query
    assert listing_query("test", "Show me links for test") == ""
    assert listing_query("test", "Show test links just testing") == "test"
    assert listing_query("test", "Show links containing test") == "test"
    assert listing_query("test automation", "Show links for test automation") == "test automation"


@pytest.mark.parametrize("message", [
    'Create a document called "JEE" with content "Project notes"',
    'add a new document called "JEE"',
    "Save these notes in documents: Meeting moved to Tuesday",
    "Add this to documents: Project notes",
    "Could you please create a document about my car?",
    "I would like to create a new document",
    "New document",
])
def test_document_creation_requires_a_request(message):
    from app.commands import requests_document_creation
    assert requests_document_creation(message)


@pytest.mark.parametrize("message", [
    "My car is gray Tesla.", "My document is about my car.",
    "How do I create a document?", "Don't create a document",
    'My note says "create a document"',
])
def test_statements_and_explanations_do_not_request_documents(message):
    from app.commands import requests_document_creation
    assert not requests_document_creation(message)


@pytest.mark.parametrize("message", [
    "List my documents", "Show documents", "Could you please show me my uploaded files?",
    "List all of my saved documents", "Show documents about sick leave",
    "Which documents do I have?", "What files have I uploaded?",
    "Please display a list of my docs",
])
def test_explicit_document_listing(message):
    from app.commands import requests_document_listing
    assert requests_document_listing(message)


@pytest.mark.parametrize("message", [
    "Who should i contact at nitor if i'm sick?",
    "What does my document say about sick leave?",
    "Show me what the document says about sick leave",
    "List the contacts in my uploaded document",
    "Summarize my uploaded PDF", "Explain how to list my documents",
    "Don't list my documents", 'My note says "list my documents"',
    "Show me the email address from my documents",
])
def test_document_content_requests_are_not_collection_lists(message):
    from app.commands import requests_document_listing
    assert not requests_document_listing(message)
