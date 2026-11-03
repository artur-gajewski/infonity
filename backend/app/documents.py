"""Bounded local document extraction into ordinary, searchable memories."""
from io import BytesIO
from pathlib import PurePosixPath
from pypdf import PdfReader
from .models import Memory

MAX_UPLOAD = 8 * 1024 * 1024
MAX_TEXT = 500_000
CHUNK_SIZE = 1600


def extract_document(filename, content):
    name = PurePosixPath(filename.replace("\\", "/")).name
    if not name or len(name) > 240:
        raise ValueError("Choose a filename of at most 240 characters")
    extension = PurePosixPath(name).suffix.lower()
    if extension not in {".pdf", ".txt", ".md"}:
        raise ValueError("Choose a PDF, TXT, or Markdown (.md) file")
    if not content or len(content) > MAX_UPLOAD:
        raise ValueError("Choose a nonempty file up to 8 MiB")
    if extension == ".pdf":
        try:
            reader = PdfReader(BytesIO(content))
            if reader.is_encrypted:
                raise ValueError()
            if len(reader.pages) > 500:
                raise ValueError()
            pages = []
            size = 0
            for page in reader.pages:
                text = page.extract_text() or ""
                size += len(text)
                if size > MAX_TEXT:
                    raise ValueError()
                pages.append(text)
            text = "\n\n".join(pages)
        except Exception:
            raise ValueError("Unable to read PDF. Use an unencrypted, text-based PDF up to 500 pages and 500,000 characters") from None
    else:
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise ValueError("Text and Markdown files must use UTF-8 encoding") from None
    text = text.replace("\x00", "").strip()
    if not text:
        raise ValueError("No readable text found. Scanned PDFs require OCR before uploading")
    if len(text) > MAX_TEXT:
        raise ValueError("Extracted text exceeds 500,000 characters")
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        if end < len(text):
            boundary = text.rfind(" ", start + (end - start) // 2, end)
            if boundary > start:
                end = boundary
        chunks.append(text[start:end])
        start = end
        while start < len(text) and text[start].isspace():
            start += 1
    return [Memory(category="documents", subject="document", predicate="content",
                   title=name if len(chunks) == 1 else f"{name} (part {i + 1}/{len(chunks)})",
                   value=chunk) for i, chunk in enumerate(chunks)]
