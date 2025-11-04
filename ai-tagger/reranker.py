# ai-tagger/reranker.py
import os
from typing import List

def _openai_client():
    from openai import OpenAI
    base = os.getenv("OPENAI_BASE_URL") or os.getenv("OPENROUTER_BASE_URL")
    key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("No OPENAI_API_KEY/OPENROUTER_API_KEY provided")
    client = OpenAI(api_key=key, base_url=base) if base else OpenAI(api_key=key)
    model = os.getenv("LLM_MODEL", "gpt-4o-mini")
    return client, model

PROMPT = """You are an assistant that turns candidate keywords into FINAL tags for search.
Return a JSON array of 10–20 concise tags (each 1–3 words). Deduplicate synonyms. Prefer technical/domain terms.
Candidates:
{cands}

Output ONLY a JSON array of strings.
"""

def rerank_with_llm(candidates: List[str], topk: int = 20) -> List[str]:
    # small & cheap – only pass candidates
    client, model = _openai_client()
    content = PROMPT.format(cands="\n".join(f"- {c}" for c in candidates))
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role":"user", "content": content}],
        temperature=0.2,
        max_tokens=256,
    )
    txt = (resp.choices[0].message.content or "").strip()
    # best-effort parse
    import json
    try:
        arr = json.loads(txt)
        if isinstance(arr, list):
            arr = [str(x).strip() for x in arr if str(x).strip()]
            return arr[:topk]
    except Exception:
        pass
    # fallback to top candidates
    return candidates[:topk]
