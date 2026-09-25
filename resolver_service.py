#!/usr/bin/env python3
"""
resolver_service.py — Endpoint de resolución bajo demanda para donghuaflix.

Recibe (title, ep), busca la serie en las fuentes de donghua-cli, extrae TODOS
los reproductores/ifservidores de la página del episodio (incluidos los <option>
base64 con los dubs) y devuelve la lista ordenada por viveza para el frontend.

Uso:
    pip install donghua-cli fastapi uvicorn
    uvicorn resolver_service:app --host 127.0.0.1 --port 8000

GET /resolve?title=Perfect%20World&ep=12
  -> {"ok": true, "episode": 12, "servers": [{"url": ..., "live": true, "lang": "eng"}, ...]}

Configuración opcional por variables de entorno:
    DHUA_TTL_SERVERS  (default 21600 = 6h)   TTL de la lista de servidores/embeds
    DHUA_TTL_PROBE    (default 600 = 10min)  TTL del probe de viveza
    DHUA_MAX_WORKERS  (default 6)
"""
import base64
import binascii
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi import FastAPI, Query

from donghua_cli.sources import ALL_SOURCES, get_source
from donghua_cli.extractor import VIDEO_HOSTS
from donghua_cli.utils import fetch_html, probe_alive, extract_episode_number

TTL_SERVERS = int(os.environ.get("DHUA_TTL_SERVERS", 21600))
TTL_PROBE = int(os.environ.get("DHUA_TTL_PROBE", 600))
MAX_WORKERS = int(os.environ.get("DHUA_MAX_WORKERS", 6))

# Fuentes excluidas tras verificación manual (25/09/2026): ak y ld
EXCLUDED_SOURCES = {"ak", "ld"}


def active_sources():
    return [s for s in ALL_SOURCES if s.enabled and s.key not in EXCLUDED_SOURCES]


app = FastAPI(title="donghuaflix-resolver")
_SERVERS: dict[str, tuple[float, list[dict]]] = {}
_PROBE: dict[str, tuple[float, bool]] = {}

# Idioma aproximado por etiqueta de <option> (mejor esfuerzo)
LANG_HINTS = [
    (re.compile(r"spanish|español|\bes\b|\besp\b|multi|all[- ]?sub", re.I), "spa"),
    (re.compile(r"indonesia|\bid\b|\bindo\b", re.I), "ind"),
    (re.compile(r"english|\ben\b|\beng\b", re.I), "eng"),
    (re.compile(r"turkish|\btr\b", re.I), "tur"),
    (re.compile(r"portugu", re.I), "por"),
]


def _lang_of(label: str) -> str | None:
    for rx, code in LANG_HINTS:
        if rx.search(label):
            return code
    return None


def collect_embeds(ep_url: str) -> list[dict]:
    """Todos los reproductores de la página de episodio, en forma EMBED
    (lista para <iframe>), con idioma aproximado si el <option> lo indica.
    Misma lógica que donghua_cli.extractor.extract_servers pero sin
    canonicalizar a watch-page (que es forma para mpv, no para web)."""
    out: list[dict] = []
    seen: set[str] = set()

    def add(raw: str, lang: str | None = None) -> None:
        if not raw:
            return
        url = raw.strip()
        if url.startswith("//"):
            url = "https:" + url
        if not url or url in seen:
            return
        seen.add(url)
        out.append({"url": url, "lang": lang})

    try:
        tree = fetch_html(ep_url, timeout=8)
    except Exception:
        return out
    html = tree.html or ""

    # <option value="base64(<html con src del server>)">LABEL</option>
    for m in re.finditer(
        r"""<option[^>]*value=["']([A-Za-z0-9+/=]{40,})["'][^>]*>(.*?)</option>""",
        html, re.S,
    ):
        label = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        lang = _lang_of(label)
        try:
            decoded = base64.b64decode(m.group(1)).decode("utf-8", "replace")
        except (ValueError, binascii.Error):
            continue
        for hit in re.finditer(r"""(?:src|href)=["']([^"']+)["']""", decoded):
            src = hit.group(1)
            if any(h in src for h in VIDEO_HOSTS):
                add(src, lang)

    for script in tree.css("script[data-video]"):
        if "dailymotion" in (script.attributes.get("src") or ""):
            vid = script.attributes.get("data-video")
            if vid:
                add(f"https://www.dailymotion.com/embed/video/{vid}", "eng")

    for iframe in tree.css("iframe"):
        src = iframe.attributes.get("src") or iframe.attributes.get("data-src") or ""
        if src and any(h in src for h in VIDEO_HOSTS):
            add(src)

    return out


def get_servers(ep_url: str) -> list[dict]:
    hit = _SERVERS.get(ep_url)
    if hit and time.time() - hit[0] < TTL_SERVERS:
        return hit[1]
    embeds = collect_embeds(ep_url)
    _SERVERS[ep_url] = (time.time(), embeds)
    return embeds


def is_live(url: str) -> bool:
    hit = _PROBE.get(url)
    if hit and time.time() - hit[0] < TTL_PROBE:
        return hit[1]
    try:
        alive = bool(probe_alive(url))
    except Exception:
        alive = False
    _PROBE[url] = (time.time(), alive)
    return alive


def find_series(title: str) -> dict[str, tuple[str, str]]:
    """Busca la serie en las fuentes habilitadas, en paralelo.
    Devuelve {source_key: (matched_title, series_url)}."""
    import difflib
    found: dict[str, tuple[str, str]] = {}
    with ThreadPoolExecutor(max_workers=5) as pool:
        futs = {pool.submit(s.search, title): s for s in active_sources()}
        for fut, src in futs.items():
            try:
                results = fut.result()
            except Exception:
                continue
            if not results:
                continue
            best = difflib.get_close_matches(
                title.lower(), [t.lower() for t, _ in results], n=1, cutoff=0.55
            )
            if best:
                t, u = next(r for r in results if r[0].lower() == best[0])
                found[src.key] = (t, u)
    return found


def episode_pages(found: dict[str, tuple[str, str]], ep: int) -> list[str]:
    """Páginas de episodio `ep` en cada fuente que tenga la serie."""
    pages: list[str] = []

    def work(key_url: tuple[str, str]) -> str | None:
        key, (_, series_url) = key_url
        src = get_source(key)
        if src is None:
            return None
        try:
            eps = src.get_episodes(series_url)
        except Exception:
            return None
        for title, url in eps:
            if extract_episode_number(title, url) == ep:
                return url
        return None

    with ThreadPoolExecutor(max_workers=len(found) or 1) as pool:
        for r in pool.map(work, found.items()):
            if r:
                pages.append(r)
    return pages


@app.get("/resolve")
def resolve(title: str = Query(...), ep: int = Query(..., ge=1)):
    found = find_series(title)
    if not found:
        return {"ok": False, "error": "serie no encontrada en ninguna fuente"}

    pages = episode_pages(found, ep)
    if not pages:
        return {"ok": False, "error": f"episodio {ep} no encontrado"}

    # Todos los embeds de todas las páginas, en paralelo
    candidates: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(pages), MAX_WORKERS)) as pool:
        for embeds in pool.map(get_servers, pages):
            candidates.extend(embeds)

    # Dedup por URL conservando el idioma
    seen: set[str] = set()
    unique: list[dict] = []
    for c in candidates:
        if c["url"] not in seen:
            seen.add(c["url"])
            unique.append(c)

    # Probe de viveza en paralelo
    with ThreadPoolExecutor(max_workers=min(len(unique), MAX_WORKERS) or 1) as pool:
        lives = list(pool.map(is_live, [c["url"] for c in unique]))

    servers = [
        {**c, "live": live}
        for c, live in zip(unique, lives)
    ]
    servers.sort(key=lambda s: not s["live"])  # vivos primero

    return {
        "ok": True,
        "episode": ep,
        "found_in": list(found.keys()),
        "servers": servers,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/health")
def health():
    return {"ok": True, "sources": [s.key for s in active_sources()]}
