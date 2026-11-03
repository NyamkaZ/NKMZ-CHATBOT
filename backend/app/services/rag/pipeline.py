"""
RAG pipeline: chunk → embed (Ollama) → ChromaDB + keyword fallback.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import List, Optional, Dict, Any

import httpx
import structlog

from app.core.config import settings

logger = structlog.get_logger()

EMBED_BATCH_SIZE = 32
KEYWORD_SCAN_LIMIT = 2000
FAQ_MIN_OVERLAP = 2

_chroma_client = None
_collection = None


def _get_chroma():
    global _chroma_client, _collection
    if _chroma_client is None:
        import chromadb
        from chromadb.config import Settings as ChromaSettings

        Path(settings.CHROMA_PERSIST_DIR).mkdir(parents=True, exist_ok=True)
        _chroma_client = chromadb.PersistentClient(
            path=settings.CHROMA_PERSIST_DIR,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        _collection = _chroma_client.get_or_create_collection(
            name="knowledge_base",
            metadata={"hnsw:space": "cosine"},
        )
    return _chroma_client, _collection


async def _embed_ollama(texts: List[str]) -> Optional[List[List[float]]]:
    """Batch embed via /api/embed; fall back to legacy /api/embeddings one by one."""
    base = settings.OLLAMA_BASE_URL.rstrip("/")
    model = settings.OLLAMA_EMBED_MODEL
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            out: List[List[float]] = []
            batch_ok = True
            for i in range(0, len(texts), EMBED_BATCH_SIZE):
                batch = texts[i : i + EMBED_BATCH_SIZE]
                r = await client.post(f"{base}/api/embed", json={"model": model, "input": batch})
                embs = r.json().get("embeddings") if r.status_code < 400 else None
                if not embs or len(embs) != len(batch):
                    batch_ok = False
                    break
                out.extend(embs)
            if batch_ok:
                return out

            # Legacy Ollama (< 0.3): one request per text
            out = []
            for text in texts:
                r = await client.post(f"{base}/api/embeddings", json={"model": model, "prompt": text})
                if r.status_code >= 400:
                    return None
                emb = r.json().get("embedding")
                if not emb:
                    return None
                out.append(emb)
            return out
    except Exception as e:
        logger.warning("ollama_embed_failed", error=str(e))
        return None


async def embed_texts(texts: List[str]) -> Optional[List[List[float]]]:
    if not texts:
        return []
    return await _embed_ollama(texts)


def chunk_text(text: str, chunk_size: int = 350, overlap: int = 40) -> List[str]:
    blocks = re.split(r"\n\s*\n", text.strip())
    # A document without blank lines would otherwise become one huge block:
    # fall back to single newlines, then sentences.
    if len(blocks) == 1 and len(text.split()) > chunk_size:
        blocks = [b for b in text.splitlines() if b.strip()]
        if len(blocks) == 1:
            blocks = re.split(r"(?<=[.!?])\s+", text.strip())
        merged, buf = [], []
        for blk in blocks:
            if buf and len(" ".join(buf + [blk]).split()) > chunk_size:
                merged.append(" ".join(buf))
                buf = []
            buf.append(blk.strip())
        if buf:
            merged.append(" ".join(buf))
        blocks = merged
    chunks: List[str] = []
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        words = block.split()
        if len(words) <= chunk_size:
            chunks.append(block)
            continue
        step = max(1, chunk_size - overlap)
        for i in range(0, len(words), step):
            piece = " ".join(words[i : i + chunk_size]).strip()
            if piece:
                chunks.append(piece)
    if not chunks and text.strip():
        chunks = [text.strip()[:2000]]
    return chunks


def _keyword_score(query: str, doc: str) -> float:
    q = set(re.findall(r"\w+", query.lower()))
    d = set(re.findall(r"\w+", doc.lower()))
    if not q or not d:
        return 0.0
    score = len(q & d) / max(len(q), 1)
    if query.strip().lower() in doc.lower():
        score += 1.0
    return score


def _keyword_search(query: str, top_k: int) -> List[Dict[str, Any]]:
    try:
        _, collection = _get_chroma()
        if collection.count() == 0:
            return []
        raw = collection.get(include=["documents", "metadatas"], limit=KEYWORD_SCAN_LIMIT)
        docs = raw.get("documents") or []
        metas = raw.get("metadatas") or []
        scored = []
        for i, doc in enumerate(docs):
            if not doc:
                continue
            score = _keyword_score(query, doc)
            if score > 0:
                scored.append(
                    {
                        "content": doc,
                        "metadata": metas[i] if i < len(metas) else {},
                        "distance": 1.0 - min(score, 1.0),
                        "score": score,
                    }
                )
        scored.sort(key=lambda x: x["score"], reverse=True)
        hits = scored[:top_k]
        logger.info("rag_keyword_hits", query=query[:80], hits=len(hits))
        return hits
    except Exception as e:
        logger.warning("rag_keyword_failed", error=str(e))
        return []


async def index_document(doc_id: str, text: str, metadata: Optional[Dict] = None) -> int:
    _, collection = _get_chroma()
    chunks = chunk_text(text)
    if not chunks:
        return 0

    embeddings = await embed_texts(chunks)
    ids = [f"{doc_id}_{i}" for i in range(len(chunks))]
    metadatas = [{"doc_id": doc_id, **(metadata or {})} for _ in chunks]

    try:
        existing = collection.get(where={"doc_id": doc_id})
        if existing and existing.get("ids"):
            collection.delete(ids=existing["ids"])
    except Exception:
        pass

    if embeddings and len(embeddings) == len(chunks):
        collection.add(ids=ids, embeddings=embeddings, documents=chunks, metadatas=metadatas)
        logger.info("document_indexed", doc_id=doc_id, chunks=len(chunks), mode="embedding")
    else:
        dim = 768
        placeholders = [[0.0] * dim for _ in chunks]
        collection.add(ids=ids, embeddings=placeholders, documents=chunks, metadatas=metadatas)
        logger.warning("document_indexed_keyword_only", doc_id=doc_id, chunks=len(chunks))
    return len(chunks)


async def query_knowledge(query: str, top_k: int = None) -> List[Dict[str, Any]]:
    top_k = top_k or settings.RAG_TOP_K
    try:
        _, collection = _get_chroma()
        count = collection.count()
        if count == 0:
            logger.info("rag_empty_collection", query=query[:80])
            return []

        q_emb = await embed_texts([query])
        if q_emb and len(q_emb) == 1:
            try:
                results = collection.query(query_embeddings=q_emb, n_results=min(top_k, count))
                hits = []
                docs = (results.get("documents") or [[]])[0]
                metas = (results.get("metadatas") or [[]])[0]
                dists = (results.get("distances") or [[]])[0]
                for i, doc in enumerate(docs):
                    if not doc:
                        continue
                    hits.append(
                        {
                            "content": doc,
                            "metadata": metas[i] if i < len(metas) else {},
                            "distance": dists[i] if i < len(dists) else None,
                        }
                    )
                if hits:
                    logger.info("rag_query_ok", query=query[:80], hits=len(hits), mode="embedding")
                    return hits
            except Exception as e:
                logger.warning("rag_vector_query_failed", error=str(e))

        return _keyword_search(query, top_k)
    except Exception as e:
        logger.warning("rag_query_failed", error=str(e))
        return _keyword_search(query, top_k or 5)


def build_rag_context(hits: List[Dict[str, Any]]) -> str:
    if not hits:
        return ""
    parts = [
        "Use ONLY the knowledge base below when it answers the question. "
        "Reply in the same language as the user.\nKnowledge base:"
    ]
    for i, h in enumerate(hits, 1):
        parts.append(f"[{i}] {h['content']}")
    return "\n\n".join(parts)


def extract_faq_answer(hits, query: str = ""):
    if not hits:
        return None
    q = (query or "").strip()
    if not q or len(q) < 3:
        return None
    ql = q.lower()
    if ql in ("hi", "hello", "hey", "sain", "сайн уу", "sain uu", "test"):
        return None

    def tokens(s):
        return set(re.findall(r"[A-Za-z0-9]+|[\u0400-\u04FF]+", (s or "").lower()))

    qt = tokens(q)
    if not qt:
        return None

    best_text, best_ov = None, 0
    for h in hits:
        text = (h.get("content") or "").strip()
        if not text:
            continue
        ov = len(qt & tokens(text))
        if ql in text.lower():
            ov += 3
        if ov > best_ov:
            best_ov = ov
            best_text = text

    # Require at least FAQ_MIN_OVERLAP shared words before skipping the LLM.
    if not best_text or best_ov < FAQ_MIN_OVERLAP:
        return None

    # Хариулт: байвал түүнийг авна, байхгүй бол бүтэн chunk
    ans = best_text
    for sep in ("Хариулт:", "Хариулт :", "Answer:", "Answer :"):
        if sep in best_text:
            ans = best_text.split(sep, 1)[-1].strip()
            break

    try:
        logger.info("rag_direct_answer", overlap=best_ov, preview=ans[:100])
    except Exception:
        pass
    return ans.strip() if ans else None
