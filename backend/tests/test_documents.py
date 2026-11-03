import pytest

from app.documents import CHUNK_SIZE, MAX_TEXT, extract_document


def test_extract_text_at_limit():
    text = "x" * 500_000
    assert MAX_TEXT == len(text)
    sections = extract_document("large.md", text.encode())
    assert "".join(section.value for section in sections) == text
    assert all(len(section.value) <= CHUNK_SIZE for section in sections)


def test_extract_text_above_limit():
    with pytest.raises(ValueError, match="Extracted text exceeds 500,000 characters"):
        extract_document("large.md", b"x" * 500_001)


def test_chunk_boundaries_preserve_words_and_skip_whitespace():
    text = "a" * 900 + " \n\t\u2003" + "b" * 900 + " " + "c" * 900
    sections = extract_document("notes.md", text.encode())
    assert [section.value for section in sections] == ["a" * 900, "b" * 900, "c" * 900]
