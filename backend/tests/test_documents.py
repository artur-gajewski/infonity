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


def pdf_with_late_link_text(rotated=False):
    """PDF exporters often draw hyperlink labels after all surrounding text."""
    from io import BytesIO
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    page = writer.add_blank_page(width=650, height=800)
    font = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Courier"),
    })
    page[NameObject("/Resources")] = DictionaryObject({
        NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)}),
    })
    lines = [
        (700, "People Operations ", "peopleops@acme.example"),
        (680, "Send medical certificates to ", "payroll@acme.example"),
        (660, "Occupational nurse: Alex Nurse, ", "alex.nurse@health.example"),
    ]
    def draw(x, y, text):
        return f"BT /F1 10 Tf {x} {y} Td ({text}) Tj ET\n"
    operators = "".join(draw(40, y, prefix) for y, prefix, _ in lines)
    operators += draw(40, 740, "Unrelated sidebar above the procedure.")
    operators += "".join(draw(40 + len(prefix) * 6, y, email) for y, prefix, email in lines)
    if rotated:
        operators += "BT /F1 10 Tf 0 1 -1 0 500 150 Tm (Rotated note.) Tj ET\n"
    stream = DecodedStreamObject()
    stream.set_data(operators.encode())
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def test_pdf_preserves_inline_email_relationships_and_visual_order():
    import re
    sections = extract_document("procedure.pdf", pdf_with_late_link_text())
    text = "\n".join(section.value for section in sections)
    normalized = re.sub(r"\s+", " ", text)
    assert "People Operations peopleops@acme.example" in normalized
    assert "Send medical certificates to payroll@acme.example" in normalized
    assert "Occupational nurse: Alex Nurse, alex.nurse@health.example" in normalized
    assert normalized.index("Unrelated sidebar") < normalized.index("People Operations")


def test_pdf_layout_does_not_silently_drop_rotated_text():
    sections = extract_document("rotated.pdf", pdf_with_late_link_text(rotated=True))
    assert "Rotated note." in "\n".join(section.value for section in sections)
