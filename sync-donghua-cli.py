#!/usr/bin/env python3
"""
sync-donghua-cli.py — Catálogo "donghuacli" para donghuaflix usando donghua-cli.

MODOS:
  --crawl-sites   Descubre series (y FRAGMENTOS: posts tipo "Episodes 57 To 60") en las
                  webs de donghua-cli, los AGRUPA por título (exacto + difuso, sin mezclar
                  temporadas) y UNE sus episodios por número para series completas.
  --servers-only  Rellena e.servers en fichas ya existentes (retomable).
  (sin flags)     Modo semilla (dhua-titles.txt / tus índices).

CHECKPOINT: estado guardado tras cada serie; al re-ejecutar salta lo hecho. --fresh = de cero.

Por qué el merge de fragmentos: estas webs publican series largas en varios posts
(p.ej. "Against the Sky Supreme" 1-346 + posts de 347+). donghua-cli solo lee la lista
de UN post, así que sin fusionar la serie queda incompleta.
"""
import argparse
import base64
import binascii
import difflib
import json
import re
import sys
import threading
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import unquote

from donghua_cli.sources import ALL_SOURCES, get_source
from donghua_cli.extractor import VIDEO_HOSTS
from donghua_cli.utils import fetch_html, extract_episode_number

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "public" / "data"
DETAILS_DIR = DATA_DIR / "catalog-donghuacli-details"
INDEX_OUT = DATA_DIR / "catalog-donghuacli-index.json"
DB_OUT = DATA_DIR / "catalog-donghuacli.json"
STATE_FILE = DATA_DIR / "catalog-donghuacli-state.json"
TITLES_FILE = ROOT / "dhua-titles.txt"

DONGHUA_INDEX_HINTS = ("donghualife", "donghuasub", "donghuaworld")

# Fuentes EXCLUIDAS tras verificación manual (25/09/2026):
#   ak (AnimeKhor)      -> no ofrece multisub completo
#   ld (LuciferDonghua) -> solo inglés
EXCLUDED_SOURCES = {"ak", "ld"}


def active_sources():
    """Fuentes habilitadas menos las excluidas."""
    return [s for s in ALL_SOURCES if s.enabled and s.key not in EXCLUDED_SOURCES]

HOST_NAMES = [
    ("dailymotion.com", "Dailymotion"),
    ("streamtape.com", "Streamtape"),
    ("mixdrop", "Mixdrop"),
    ("mp4upload.com", "MP4Upload"),
    ("ok.ru", "OK.ru"),
    ("dood.", "Doodstream"),
    ("youtube.com", "YouTube"),
    ("rumble.com", "Rumble"),
    ("vk.com", "VK"),
]
LANG_HINTS = [
    (re.compile(r"spanish|español|\bes\b|\besp\b|multi|all[- ]?sub", re.I), "spa"),
    (re.compile(r"indonesia|\bid\b|\bindo\b", re.I), "ind"),
    (re.compile(r"english|\ben\b|\beng\b", re.I), "eng"),
    (re.compile(r"turkish|\btr\b", re.I), "tur"),
    (re.compile(r"portugu", re.I), "por"),
]

EP_URL_RX = re.compile(r"(?:^|[-_/])(?:episode|ep)[-_ ]?\d+", re.I)
BAD_SUB_RX = re.compile(
    r"english sub(?:titles?|bed)?$|subtitles? english( indonesian)?$|subbed$|dub(?:bed)?$|"
    r"sub indo(?!.*multi)|indonesian sub(?!.*multi)|indo sub(?!.*multi)", re.I)
MULTI_RX = re.compile(r"multi|espa?ñol|spanish", re.I)
SITE_TAG_RX = re.compile(
    r"\s*[|\-–—]\s*(DonghuaStream|AnimeXin|AnimeKhor|LMAnime|LuciferDonghua)\b.*$", re.I)
# "… Episodes 57 To 60 Subtitles English Indonesia" / "… Episode 102 English Subtitles"
FRAG_BATCH_RX = re.compile(r"\s+episodes?\s+\d+\s*(?:to|[-–])\s*\d+.*$", re.I)
FRAG_SINGLE_RX = re.compile(
    r"\s+(?:episode|ep)\s+\d+\s+(?:english sub(?:titles?|bed)?|subtitles? english(?: indonesian)?|"
    r"sub indo|multi[- ]?sub[^\n]*)?$", re.I)
LANG_SUFFIX_RX = re.compile(
    r"\s+(?:english sub(?:titles?|bed)?|subtitles? english(?: indonesian)?|multi[- ]?sub[^|]*)$", re.I)
# cola basura de slugs: zhutianjiep16, zichuanep26, immortalityyep12
JUNK_TAIL_RX = re.compile(r"(?:chapter|ch|ep|e|p|pt|part)\d+$")

_progress_lock = threading.Lock()
_progress = {"n": 0, "hits": 0}


def slugify(title: str) -> str:
    s = title.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def norm_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]", "", title.lower())


def series_key2(title: str) -> str:
    """Clave de agrupación: norm_key sin colas basura de fragmento (ep16, p12...)."""
    k = norm_key(title)
    prev = None
    while prev != k:
        prev = k
        k = JUNK_TAIL_RX.sub("", k)
    return k


def season_tail(k: str) -> str:
    m = re.search(r"(?:season|s)(\d{1,2})$", k)
    return m.group(1) if m else ""


def host_name(url: str) -> str:
    u = url.lower()
    for key, name in HOST_NAMES:
        if key in u:
            return name
    m = re.search(r"https?://(?:www\.)?([^/]+)", u)
    return m.group(1) if m else "Servidor"


def lang_of(label: str):
    for rx, code in LANG_HINTS:
        if rx.search(label or ""):
            return code
    return None


# ─────────────────────────────────────────────────────────────────────
# ESTADO / CHECKPOINT
# ─────────────────────────────────────────────────────────────────────

def load_state(fresh: bool) -> dict:
    if not fresh and STATE_FILE.exists():
        try:
            st = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            if isinstance(st, dict) and "done" in st:
                print(f"[state] retomando: {len(st['done'])} grupos ya hechos")
                return st
        except Exception:
            pass
    return {"done": [], "entries": []}


def save_state(st: dict) -> None:
    STATE_FILE.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")


# ─────────────────────────────────────────────────────────────────────
# DESCUBRIMIENTO
# ─────────────────────────────────────────────────────────────────────

def _listing_items(tree, src):
    items = []
    nodes = []
    for sel in src.search_selectors:
        nodes = tree.css(sel)
        if nodes:
            break
    if not nodes:
        nodes = tree.css("div.bsx, article.bs, div.bs")
    if not nodes:
        nodes = tree.css("a")
    for node in nodes:
        a = node if node.tag == "a" else node.css_first("a")
        if not a:
            continue
        href = a.attributes.get("href", "") or ""
        if not src._is_series_link(href):
            continue
        title = (a.attributes.get("title") or a.text(strip=True) or "").strip()
        if len(title) < 2:
            continue
        cover = None
        if node.tag != "a":
            img = node.css_first("img")
            if img is not None:
                cover = (img.attributes.get("data-src")
                         or img.attributes.get("data-lazy-src")
                         or img.attributes.get("src"))
        items.append((title, href, cover))
    return items


def _paginated_listing(src, path, max_pages):
    base = src.base_url.rstrip("/")
    out, seen = [], set()
    for page in range(1, max_pages + 1):
        url = f"{base}{path}" if page == 1 else f"{base}{path}page/{page}/"
        try:
            tree = fetch_html(url, timeout=src.episode_timeout)
        except Exception:
            break
        items = _listing_items(tree, src)
        if not items:
            break
        new = 0
        for t, u, c in items:
            if u not in seen:
                seen.add(u)
                out.append((t, u, c))
                new += 1
        if new == 0:
            break
    return out


def crawl_source_sitemap(src):
    base = src.base_url.rstrip("/")
    found_urls: dict[str, None] = {}

    def locs(html):
        return re.findall(r"<loc>\s*(https?://[^<]+?)\s*</loc>", html or "")

    for path in ("/wp-sitemap.xml", "/sitemap_index.xml", "/sitemap.xml"):
        try:
            tree = fetch_html(base + path, timeout=src.episode_timeout)
        except Exception:
            continue
        found = locs(tree.html or "")
        if not found:
            continue
        subs = [u for u in found if u.endswith(".xml")]
        for u in found:
            if src._is_series_link(u):
                found_urls.setdefault(u, None)
        for sub in subs:
            try:
                t2 = fetch_html(sub, timeout=src.episode_timeout)
            except Exception:
                continue
            for u in locs(t2.html or ""):
                if src._is_series_link(u):
                    found_urls.setdefault(u, None)
        if found_urls:
            break
    out = []
    for u in sorted(found_urls):
        title = unquote(u.rstrip("/").split("/")[-1]).replace("-", " ").title()
        out.append((title, u, None))
    return out


def clean_discovered_title(t: str) -> str:
    t = unquote(t)
    t = SITE_TAG_RX.sub("", t)
    t = FRAG_BATCH_RX.sub("", t)
    t = FRAG_SINGLE_RX.sub("", t)
    t = LANG_SUFFIX_RX.sub("", t)
    return t.strip(" -|–—").strip()


def keep_item(title: str) -> bool:
    """Filtro de idioma sobre el título YA LIMPIO: fuera inglés/indonesio puro."""
    if MULTI_RX.search(title):
        return True
    if BAD_SUB_RX.search(title):
        return False
    return True


def discover_series(max_pages: int, max_series: int) -> list[dict]:
    """Devuelve la lista de GRUPOS (series fusionadas con sus fragmentos)."""
    pool: dict[str, dict] = {}
    for src in active_sources():
        by_url: dict[str, tuple] = {}
        for it in crawl_source_sitemap(src):
            by_url.setdefault(it[1], it)
        n_sitemap = len(by_url)
        for path in ("/anime-list/", "/az-list/", "/"):
            for it in _paginated_listing(src, path, max_pages):
                by_url.setdefault(it[1], it)
        kept = 0
        for t, u, c in by_url.values():
            ct = clean_discovered_title(t)
            if not ct or not keep_item(ct):
                continue
            k = norm_key(ct)
            if not k:
                continue
            e = pool.setdefault(k, {"titles": set(), "urls": {}, "cover": c})
            e["titles"].add(ct)
            e["urls"].setdefault(src.key, u)   # 1ª URL por fuente: preferimos página de serie
            if c and not e["cover"]:
                e["cover"] = c
            kept += 1
        print(f"[crawl] {src.key} ({src.name}): {kept} entradas válidas "
              f"(sitemap {n_sitemap} URLs, total {len(by_url)})", flush=True)
    groups = merge_fragments(pool.values())
    groups.sort(key=lambda g: g["title"].lower())
    if max_series and max_series > 0:
        groups = groups[:max_series]
    return groups


def merge_fragments(entries) -> list[dict]:
    """Agrupa entradas en series: 1) clave exacta, 2) contención/difusa dentro del
    mismo bucket de prefijo y MISMA temporada (nunca mezcla Season 1 con Season 2)."""
    by_key: dict[str, dict] = {}
    order: list[dict] = []
    for e in entries:
        best = min(e["titles"], key=len)
        k2 = series_key2(best)
        g = by_key.get(k2)
        if not g:
            g = {"key": k2, "tail": season_tail(k2), "titles": set(e["titles"]),
                 "urls": dict(e["urls"]), "cover": e.get("cover")}
            by_key[k2] = g
            order.append(g)
        else:
            g["titles"] |= e["titles"]
            for k, u in e["urls"].items():
                g["urls"].setdefault(k, u)
            if e.get("cover") and not g["cover"]:
                g["cover"] = e["cover"]
    # pase difuso: une grupos parecidos (nunca entre temporadas distintas)
    merged_idx: set[int] = set()
    for i in range(len(order)):
        if i in merged_idx:
            continue
        a = order[i]
        for j in range(i + 1, len(order)):
            if j in merged_idx:
                continue
            b = order[j]
            if a["tail"] != b["tail"] or a["key"][:4] != b["key"][:4]:
                continue
            if len(a["key"]) < 5 or len(b["key"]) < 5:
                continue
            contains = (a["key"] in b["key"] or b["key"] in a["key"])
            similar = difflib.SequenceMatcher(None, a["key"], b["key"]).ratio() >= 0.85
            if contains or similar:
                a["titles"] |= b["titles"]
                for k, u in b["urls"].items():
                    a["urls"].setdefault(k, u)
                if b.get("cover") and not a["cover"]:
                    a["cover"] = b["cover"]
                merged_idx.add(j)
    groups = []
    for i, g in enumerate(order):
        if i in merged_idx:
            continue
        g["title"] = min(g["titles"], key=len)   # título canónico = el más corto
        groups.append(g)
    return groups


# ─────────────────────────────────────────────────────────────────────
# MODO SEMILLA
# ─────────────────────────────────────────────────────────────────────

def load_seed_titles() -> list[str]:
    if TITLES_FILE.exists():
        titles = [l.strip() for l in TITLES_FILE.read_text(encoding="utf-8").splitlines() if l.strip()]
        print(f"[seed] {len(titles)} títulos desde dhua-titles.txt")
        return titles
    titles = []
    for f in sorted(DATA_DIR.glob("catalog-*-index.json")):
        name = f.name
        if "donghuacli" in name or not any(h in name for h in DONGHUA_INDEX_HINTS):
            continue
        try:
            idx = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        titles += [i["t"] for i in idx.get("series", []) if i.get("t")]
    dedup = sorted(set(titles))
    print(f"[seed] {len(dedup)} títulos únicos desde índices de donghua")
    return dedup


def search_all_sources(title: str) -> dict:
    match = {"title": title, "sources": {}}
    with ThreadPoolExecutor(max_workers=5) as pool:
        futs = {pool.submit(s.search_with_covers, title): s for s in active_sources()}
        for fut, src in futs.items():
            try:
                results = fut.result()
            except Exception:
                continue
            if not results:
                continue
            best = difflib.get_close_matches(title.lower(), [r[0].lower() for r in results], n=1, cutoff=0.55)
            if best:
                bt, bu, bcov = next(r for r in results if r[0].lower() == best[0])
                match["sources"][src.key] = {"series_url": bu, "cover": bcov}
    return match


# ─────────────────────────────────────────────────────────────────────
# EPISODIOS / SERVIDORES / FICHAS
# ─────────────────────────────────────────────────────────────────────

def fetch_episodes(key: str, url: str) -> list[tuple[int, str, str]]:
    """[(numero, url_pagina_episodio, source_key), ...]"""
    src = get_source(key)
    if src is None:
        return []
    try:
        eps = src.get_episodes(url)
    except Exception:
        return []
    out = []
    for title, u in eps:
        n = extract_episode_number(title, u)
        if n != 999999:
            out.append((n, u, key))
    # si la URL ES un episodio, añadirlo directamente (los posts sueltos a veces
    # no tienen eplister completo, pero su propia página sí es un episodio)
    n_self = extract_episode_number("", url)
    if n_self != 999999 and n_self not in [n for n, _, _ in out]:
        out.append((n_self, url, key))
    return out


def has_gaps(merged: dict[int, dict[str, str]]) -> bool:
    if not merged:
        return True
    nums = set(merged)
    mx = max(nums)
    if mx > 2000:
        return False
    return any(i not in nums for i in range(1, mx + 1))


def collect_group_episodes(group: dict) -> dict[int, dict[str, str]]:
    """Une episodios de todas las URLs del grupo. Páginas de serie primero;
    fragmentos (posts de episodios) solo hasta cubrir los huecos de la numeración."""
    def sort_key(kv):
        key, url = kv
        frag = 1 if EP_URL_RX.search(url) else 0
        n = extract_episode_number("", url)
        return (frag, n if n != 999999 else 0)

    merged: dict[int, dict[str, str]] = {}
    frags_fetched = 0
    for key, url in sorted(group["urls"].items(), key=sort_key):
        is_frag = EP_URL_RX.search(url) is not None
        if is_frag:
            if not has_gaps(merged):
                break                       # la serie ya está completa 1..max
            frags_fetched += 1
            if frags_fetched > 400:         # red de seguridad
                break
        for n, u, k in fetch_episodes(key, url):
            merged.setdefault(n, {}).setdefault(k, u)
    return merged


def fix_episode_numbers(merged: dict[int, dict[str, str]]) -> dict[int, dict[str, str]]:
    nums = sorted(merged)
    if not nums:
        return merged
    if 1 in nums and max(nums) <= len(nums) * 3:
        return merged
    return {i + 1: u for i, (_, u) in enumerate(sorted(merged.items()))}


def collect_embeds(ep_url: str) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()

    def add(raw, lang=None):
        if not raw:
            return
        url = raw.strip()
        if url.startswith("//"):
            url = "https:" + url
        if not url or url in seen:
            return
        seen.add(url)
        out.append({"name": host_name(url), "url": url, "lang": lang})

    try:
        tree = fetch_html(ep_url, timeout=8)
    except Exception:
        return out
    html = tree.html or ""
    for m in re.finditer(r"""<option[^>]*value=["']([A-Za-z0-9+/=]{40,})["'][^>]*>(.*?)</option>""", html, re.S):
        lang = lang_of(re.sub(r"<[^>]+>", "", m.group(2)).strip())
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


def build_detail(slug, title, cover, merged, with_servers):
    season_id = f"{slug}-s1"
    now = datetime.now(timezone.utc).isoformat()
    episodes = []
    for n in sorted(merged):
        ep_id = f"{slug}-ep-{n}"
        servers: list[dict] = []
        if with_servers:
            for _key, page in (merged[n] or {}).items():
                for srv in collect_embeds(page):
                    if not any(s["url"] == srv["url"] for s in servers):
                        servers.append(srv)
        episodes.append({
            "id": ep_id, "slug": ep_id, "seriesId": slug, "seasonId": season_id,
            "number": n, "title": f"Episodio {n}", "servers": servers,
            "pages": merged[n], "updatedAt": now,
        })
    return {
        "series": {"id": slug, "slug": slug, "title": title, "image": cover or "",
                   "status": "En Emisión", "type": "donghua", "synopsis": "",
                   "updatedAt": now, "sourceUrl": ""},
        "seasons": [{"id": season_id, "seriesId": slug, "number": 1, "title": "Temporada 1"}],
        "episodes": episodes,
    }


def _bump(hit: bool, total: int):
    with _progress_lock:
        _progress["n"] += 1
        if hit:
            _progress["hits"] += 1
        return _progress["n"], _progress["hits"]


def _emit(slug, title, cover, merged, with_servers):
    detail = build_detail(slug, title, cover, merged, with_servers)
    # preservar servidores ya rellenados (evita perder el trabajo del modo --servers-only
    # cuando el crawl regenera la ficha, p.ej. tras excluir fuentes)
    fp = DETAILS_DIR / f"{slug}.json"
    if fp.exists():
        try:
            old_srv = {ep.get("number"): ep.get("servers")
                       for ep in json.loads(fp.read_text(encoding="utf-8")).get("episodes", [])}
            for ep in detail["episodes"]:
                s = old_srv.get(ep["number"])
                if s and not ep["servers"]:
                    ep["servers"] = s
        except Exception:
            pass
    fp.write_text(json.dumps(detail, ensure_ascii=False), encoding="utf-8")
    return {
        "i": slug, "s": slug, "t": title,
        "p": cover or f"./public/img/posters/{slug}.jpg",
        "g": [], "st": "En Emisión", "ty": "donghua", "y": None,
        "e": len(merged), "pl": len(next(iter(merged.values()))) if merged else 0,
        "u": datetime.now(timezone.utc).isoformat(),
    }


def process_group(group, total, with_servers, st):
    title = group["title"]
    gkey = f"{group['key']}:{group['tail']}"
    if gkey in st["done"]:
        _bump(True, total)
        return "SKIP"
    merged = collect_group_episodes(group)
    n_done, hits = _bump(bool(merged), total)
    if not merged:
        print(f"[{n_done}/{total}] {title} -> sin episodios", flush=True)
        st["done"].append(gkey)
        return None
    merged = fix_episode_numbers(merged)
    print(f"[{n_done}/{total}] {title} -> {len(merged)} episodios "
          f"({len(group['urls'])} URLs) [{hits} hits]", flush=True)
    return _emit(slugify(title), title, group.get("cover"), merged, with_servers)


def process_seed_title(title, total, with_servers):
    match = search_all_sources(title)
    if not match["sources"]:
        n_done, _ = _bump(False, total)
        print(f"[{n_done}/{total}] {title} -> sin coincidencias")
        return None
    merged: dict[int, dict[str, str]] = {}
    with ThreadPoolExecutor(max_workers=len(match["sources"])) as pool:
        futs = {pool.submit(fetch_episodes, k, v["series_url"]): k for k, v in match["sources"].items()}
        for fut, k in futs.items():
            for n, u, kk in fut.result():
                merged.setdefault(n, {}).setdefault(kk, u)
    n_done, hits = _bump(bool(merged), total)
    if not merged:
        print(f"[{n_done}/{total}] {title} -> sin episodios")
        return None
    merged = fix_episode_numbers(merged)
    cover = next((v["cover"] for v in match["sources"].values() if v.get("cover")), None)
    print(f"[{n_done}/{total}] {title} -> {len(merged)} episodios ({len(match['sources'])} fuentes) [{hits} hits]")
    return _emit(slugify(title), title, cover, merged, with_servers)


# ─────────────────────────────────────────────────────────────────────
# --servers-only
# ─────────────────────────────────────────────────────────────────────

def backfill_servers(workers: int) -> int:
    files = sorted(DETAILS_DIR.glob("*.json"))
    if not files:
        print("[servers] no hay fichas que rellenar")
        return 1
    total = len(files)
    print(f"[servers] rellenando servidores en {total} fichas, workers={workers}")

    def work(fp):
        try:
            d = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            return 0
        changed = filled = 0
        for ep in d.get("episodes", []):
            if ep.get("servers"):
                continue
            servers = []
            for _key, page in (ep.get("pages") or {}).items():
                for srv in collect_embeds(page):
                    if not any(s["url"] == srv["url"] for s in servers):
                        servers.append(srv)
            if servers:
                ep["servers"] = servers
                changed += 1
                filled += len(servers)
        if changed:
            fp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
        return changed

    done_eps = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, ch in enumerate(pool.map(work, files), 1):
            done_eps += ch
            if i % 25 == 0 or i == total:
                print(f"[servers] {i}/{total} fichas ({done_eps} episodios con servidores)", flush=True)
    print(f"[ok] {done_eps} episodios rellenados")
    return 0


# ─────────────────────────────────────────────────────────────────────

def write_outputs(entries, t0):
    entries.sort(key=lambda x: x["t"].lower())
    total_eps = sum(e["e"] for e in entries)
    now = datetime.now(timezone.utc).isoformat()
    index = {
        "meta": {"source": "donghua-cli", "syncedAt": now, "series": len(entries),
                 "episodes": total_eps, "lite": True, "generatedAt": now},
        "lite": True, "compact": True,
        "imageBase": "https://image.tmdb.org/t/p/w300",
        "detailsBase": "catalog-donghuacli-details",
        "genres": [], "count": len(entries),
        "series": entries,
    }
    INDEX_OUT.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    db = {"meta": {"version": 1, "source": "donghua-cli (ds/ax/ak/lm/ld)",
                   "syncedAt": now, "series": len(entries)},
          "series": entries, "seasons": [], "episodes": [], "genres": []}
    DB_OUT.write_text(json.dumps(db, ensure_ascii=False), encoding="utf-8")
    print(f"[ok] {len(entries)} series, {total_eps} episodios en {time.time() - t0:.0f}s")
    print(f"[ok] {INDEX_OUT}")
    print(f"[ok] {DETAILS_DIR}/")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--crawl-sites", action="store_true")
    ap.add_argument("--servers-only", action="store_true")
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--max-pages", type=int, default=300)
    ap.add_argument("--max-series", type=int, default=0)
    ap.add_argument("--with-servers", action="store_true")
    args = ap.parse_args()

    t0 = time.time()
    DETAILS_DIR.mkdir(parents=True, exist_ok=True)

    if args.servers_only:
        return backfill_servers(args.workers)

    st = load_state(args.fresh)
    done_set = set(st["done"])
    entries: list[dict] = list(st["entries"])
    flush_counter = {"i": 0}

    def stash(entry, gkey):
        if entry:
            entries.append(entry)
            st["entries"].append(entry)
        if gkey:
            st["done"].append(gkey)
        flush_counter["i"] += 1
        if flush_counter["i"] % 10 == 0:
            save_state(st)

    if args.crawl_sites:
        print(f"[modo] crawl-sites: descubriendo en {sum(1 for s in active_sources())} fuentes")
        groups = discover_series(args.max_pages, args.max_series)
        todo = [g for g in groups if f"{g['key']}:{g['tail']}" not in done_set]
        print(f"[start] {len(groups)} grupos únicos ({len(todo)} pendientes), workers={args.workers}")
        total = len(todo)
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futs = {pool.submit(process_group, g, total, args.with_servers, st): g for g in todo}
            for fut, g in futs.items():
                gkey = f"{g['key']}:{g['tail']}"
                try:
                    r = fut.result()
                except Exception as e:
                    print(f"  [warn] error en {g['title']}: {e}")
                    continue
                if r == "SKIP":
                    continue
                stash(r if r else None, gkey)
    else:
        titles = load_seed_titles()
        if not titles:
            print("[error] no hay títulos que scrapear")
            return 1
        total = len(titles)
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for e in pool.map(lambda t_: process_seed_title(t_, total, args.with_servers), titles):
                if e:
                    entries.append(e)

    save_state(st)
    write_outputs(entries, t0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
