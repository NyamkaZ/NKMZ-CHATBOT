"""
RAG pipeline: chunk → embed (Ollama) → ChromaDB + keyword fallback.
"""

from __future__ import annotations

import re
import asyncio
from pathlib import Path
from typing import List, Optional, Dict, Any

import httpx
import structlog

from app.core.config import settings

logger = structlog.get_logger()

KEYWORD_SCAN_LIMIT = 2000  # chunks read by the keyword fallback

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
            settings=ChromaSettings(
                anonymized_telemetry=False,
                chroma_product_telemetry_impl="app.services.rag.telemetry.NoOpTelemetry",
            ),
        )
        _collection = _chroma_client.get_or_create_collection(
            name="knowledge_base",
            metadata={"hnsw:space": "cosine"},
        )
    return _chroma_client, _collection


async def _embed_ollama(texts: List[str]) -> Optional[List[List[float]]]:
    base = settings.OLLAMA_BASE_URL.rstrip("/")
    model = settings.OLLAMA_EMBED_MODEL
    out: List[List[float]] = []
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            for text in texts:
                for payload in (
                    {"model": model, "prompt": text,
                     "keep_alive": settings.OLLAMA_KEEP_ALIVE,
                     "options": {"num_gpu": 0} if settings.RAG_EMBED_ON_CPU else {}},
                ):
                    r = await client.post(f"{base}/api/embeddings", json=payload)
                    if r.status_code >= 400:
                        continue
                    data = r.json()
                    emb = data.get("embedding")
                    if not emb and isinstance(data.get("embeddings"), list) and data["embeddings"]:
                        emb = data["embeddings"][0]
                    if emb:
                        out.append(emb)
                        break
                else:
                    return None
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
    _, collection = await asyncio.to_thread(_get_chroma)
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
        await asyncio.to_thread(collection.add, ids=ids, embeddings=embeddings, documents=chunks, metadatas=metadatas)
        logger.info("document_indexed", doc_id=doc_id, chunks=len(chunks), mode="embedding")
    else:
        dim = 768
        placeholders = [[0.0] * dim for _ in chunks]
        await asyncio.to_thread(collection.add, ids=ids, embeddings=placeholders, documents=chunks, metadatas=metadatas)
        logger.warning("document_indexed_keyword_only", doc_id=doc_id, chunks=len(chunks))
    return len(chunks)


async def delete_indexed_document(doc_id: str) -> None:
    _, collection = await asyncio.to_thread(_get_chroma)
    await asyncio.to_thread(collection.delete, where={"doc_id": doc_id})


async def query_knowledge(query: str, top_k: int = None) -> List[Dict[str, Any]]:
    greeting = re.sub(r"[^\w\s]", "", query.casefold()).strip()
    if greeting in {"hi", "hello", "hey", "сайн уу", "сайн байна уу", "sain uu", "sain baina uu"}:
        return []
    top_k = top_k or settings.RAG_TOP_K
    try:
        _, collection = await asyncio.to_thread(_get_chroma)
        count = await asyncio.to_thread(collection.count)
        if count == 0:
            logger.info("rag_empty_collection", query=query[:80])
            return []

        # Exact FAQ replies need no embedding model load or GPU model swap.
        keyword_hits = await asyncio.to_thread(_keyword_search, query, top_k)
        if extract_faq_answer(keyword_hits, query):
            return keyword_hits

        try:
            q_emb = await asyncio.wait_for(
                embed_texts([query]), timeout=max(0.05, settings.RAG_TIMEOUT_SECONDS * 0.7)
            )
        except asyncio.TimeoutError:
            return keyword_hits
        if q_emb and len(q_emb) == 1:
            try:
                results = await asyncio.to_thread(collection.query, query_embeddings=q_emb, n_results=min(top_k, count))
                hits = []
                docs = (results.get("documents") or [[]])[0]
                metas = (results.get("metadatas") or [[]])[0]
                dists = (results.get("distances") or [[]])[0]
                for i, doc in enumerate(docs):
                    if not doc:
                        continue
                    # Keyword-only placeholder vectors have distance 1 and
                    # must not masquerade as relevant semantic matches.
                    if i < len(dists) and dists[i] >= 0.85:
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

        return keyword_hits
    except Exception as e:
        logger.warning("rag_query_failed", error=str(e))
        return await asyncio.to_thread(_keyword_search, query, top_k or 5)


def build_rag_context(hits: List[Dict[str, Any]]) -> str:
    if not hits:
        return ""
    parts = []
    seen = set()
    remaining = max(0, settings.RAG_MAX_CONTEXT_CHARS)
    for hit in hits:
        text = (hit.get("content") or "").strip()
        if not text or text in seen or remaining <= 0:
            continue
        seen.add(text)
        prefix = f"[{len(parts) + 1}] "
        available = remaining - len(prefix) - 2
        if available < 1:
            break
        excerpt = text[:available]
        parts.append(prefix + excerpt)
        remaining -= len(prefix) + len(excerpt) + 2
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

    best_answer, best_score = None, 0.0
    for h in hits:
        text = (h.get("content") or "").strip()
        if not text:
            continue
        pairs = re.finditer(
            r"(?:Асуулт|Question)\s*:\s*(.*?)\s*(?:Хариулт|Answer)\s*:\s*(.*?)(?=\n\s*(?:Асуулт|Question)\s*:|\n\s*===|\Z)",
            text, re.IGNORECASE | re.DOTALL,
        )
        for pair in pairs:
            question, answer = pair.group(1).strip(), pair.group(2).strip()
            question_tokens = tokens(question)
            overlap = len(qt & question_tokens)
            score = overlap / max(len(qt | question_tokens), 1)
            if qt == question_tokens:
                score = 1.0
            # A shared generic word must never bypass model interpretation.
            if answer and overlap >= 2 and score >= 0.8 and score > best_score:
                best_answer, best_score = answer, score
    return best_answer
