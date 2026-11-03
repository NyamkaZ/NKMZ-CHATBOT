"""Document upload + indexing for RAG knowledge base."""

import uuid
from typing import Annotated, List, Optional
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, ConfigDict
from datetime import datetime

from app.core.database import get_db
from app.core.config import settings
from app.models.user import User
from app.models.document import Document
from app.api.v1.deps import get_admin_user
from app.services.rag.pipeline import index_document
import structlog

logger = structlog.get_logger()
router = APIRouter(prefix="/documents", tags=["documents"])

UPLOAD_DIR = Path(settings.CHROMA_PERSIST_DIR).parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_TYPES = {
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/pdf",
}
MAX_SIZE = 10 * 1024 * 1024  # 10 MB


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    original_name: str
    content_type: Optional[str]
    file_size: int
    chunk_count: int
    is_indexed: bool
    created_at: datetime


def _extract_text(filename: str, content: bytes, content_type: str | None) -> str:
    """Best-effort text extraction for common formats."""
    name = filename.lower()
    if name.endswith((".txt", ".md", ".csv", ".json", ".log")) or (
        content_type and content_type.startswith("text/")
    ):
        return content.decode("utf-8", errors="replace")
    if name.endswith(".pdf") or content_type == "application/pdf":
        try:
            # Optional dependency; degrade gracefully
            import io
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(content))
            parts = []
            for page in reader.pages:
                parts.append(page.extract_text() or "")
            return "\n".join(parts)
        except Exception as e:
            logger.warning("pdf_extract_failed", error=str(e))
            raise HTTPException(
                400,
                "Could not extract text from PDF. Install pypdf or upload a .txt/.md file.",
            )
    raise HTTPException(
        400,
        "Unsupported file type. Upload .txt, .md, .csv, .json, or .pdf",
    )


@router.post("/upload", response_model=DocumentOut)
async def upload_document(
    file: UploadFile = File(...),
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    user: Annotated[User, Depends(get_admin_user)] = None,
):
    """Only admin can upload / index knowledge base documents."""
    raw = await file.read()
    if len(raw) > MAX_SIZE:
        raise HTTPException(400, "File too large (max 10 MB)")
    if not raw:
        raise HTTPException(400, "Empty file")

    original = file.filename or "document.txt"
    text = _extract_text(original, raw, file.content_type)
    if not text.strip():
        raise HTTPException(400, "No text content found in file")

    doc_id = uuid.uuid4()
    safe_name = f"{doc_id}_{original.replace('/', '_')[:180]}"
    path = UPLOAD_DIR / safe_name
    path.write_bytes(raw)

    doc = Document(
        id=doc_id,
        filename=safe_name,
        original_name=original,
        content_type=file.content_type,
        file_size=len(raw),
        chunk_count=0,
        is_indexed=False,
    )
    db.add(doc)
    await db.flush()

    try:
        chunks = await index_document(
            str(doc_id),
            text,
            metadata={"filename": original, "user_id": str(user.id)},
        )
        doc.chunk_count = chunks
        doc.is_indexed = chunks > 0
    except Exception as e:
        logger.exception("index_failed", error=str(e))
        doc.is_indexed = False
        # still keep the document record
    await db.commit()
    await db.refresh(doc)
    return doc


@router.get("", response_model=List[DocumentOut])
async def list_documents(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_admin_user)],
    limit: int = 50,
):
    result = await db.execute(
        select(Document).order_by(desc(Document.created_at)).limit(limit)
    )
    return result.scalars().all()


@router.delete("/{doc_id}", status_code=204)
async def delete_document(
    doc_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_admin_user)],
):
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    path = UPLOAD_DIR / doc.filename
    if path.exists():
        path.unlink(missing_ok=True)
    await db.delete(doc)
    await db.commit()
