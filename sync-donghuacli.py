#!/usr/bin/env python3
"""
sync-donghua-cli.py — Genera catalog-donghuacli.json (+ índice lite + fichas de
detalle) para donghuaflix, usando donghua-cli como librería de scraping.

DOS MODOS:

  A) --crawl-sites  (RECOMENDADO — el que pediste)
     Descubre TODAS las series directamente desde las webs que usa donghua-cli
     (DonghuaStream, AnimeXin, AnimeKhor, LMAnime, LuciferDonghua) listando sus
     páginas A-Z y sitemaps WordPress. No usa tus catálogos para nada.

  B) (por defecto, sin flags)
     Modo semilla: busca los títulos de dhua-titles.txt o de tus índices de
     donghua existentes.

Uso:
    pip install -r requirements.txt
    python sync-donghua-cli.py --crawl-sites                    # crawl completo
    python sync-donghua-cli.py --crawl-sites --max-series 30    # prueba rápida
    python sync-donghua-cli.py --crawl-sites --workers 12
    python sync-donghua-cli.py                                  # modo semilla

Salida (lo que consume app.js):
    public/data/catalog-donghuacli-index.json    → índice lite/compact
    public/data/catalog-donghuacli-details/*.json → {series, seasons, episodes}
    public/data/catalog-donghuacli.json          → db resumen
"""
import argparse
import base64
import binascii
import json
import re
import sys
import threading
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from donghua_cli.sources import ALL_SOURCES, get_source
from donghua_cli.extractor import VIDEO_HOSTS
from donghua_cli.utils import fetch_html, extract_episode_number

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "public" / "data"
DETAILS_DIR = DATA_DIR / "catalog-donghuacli-details"
INDEX_OUT = DATA_DIR / "catalog-donghuacli-index.json"
DB_OUT = DATA_DIR / "catalog-donghuacli.json"
TITLES_FILE = ROOT / "dhua-titles.txt"

DONGHUA_INDEX_HINTS = ("donghualife", "donghuasub", "donghuaworld")

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
    (re.compile(r"spanish|español|\bes\b|\besp\b", re.I), "spa"),
    (re.compile(r"indonesia|\bid\b|\bindo\b", re.I), "ind"),
    (re.compile(r"english|\ben\b|\beng\b", re.I), "eng"),
    (re.compile(r"turkish|\btr\b", re.I), "tur"),
    (re.compile(r"portugu", re.I), "por"),
]

_progress_lock = threading.Lock()
_progress = {"n": 0, "hits": 0}


def slugify(title: str) -> str:
    s = title.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def norm_key(title: str) -> str:
    """Clave para fusionar el MISMO título entre fuentes (ignora mayús./símbolos)."""
    return re.sub(r"[^a-z0-9]", "", title.lower())


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
# MODO A: CRAWL COMPLETO DE LAS WEBS DE DONGHUA-CLI
# ─────────────────────────────────────────────────────────────────────

def _listing_items(tree, src) -> list[tuple[str, str, str | None]]:
    """Extrae (title, url, cover) de tarjetas de listado (mismo tema WP que el search)."""
    items: list[tuple[str, str, str | None]] = []
    nodes: list = []
    for sel in src.search_selectors:
        nodes = tree.css(sel)
        if nodes:
            break
    if not nodes:
        nodes = tree.css("a")
    for node in nodes:
        a = node if node.tag == "a" else node.css_first("a")
        if not a:
            continue
        href = a.attributes.get("href", "") or ""
        if not src._is_series_link(href):
            continue
        title = a.attributes.get("title") or a.text(strip=True)
        if not title or len(title) < 2:
            continue
        cover = None
        if node.tag != "a":
            img = node.css_first("img")
            if img is not None:
                cover = (img.attributes.get("data-src")
                         or img.attributes.get("data-lazy-src")
                         or img.attributes.get("src"))
        items.append((title.strip(), href, cover))
    return items


def crawl_source_az(src, max_pages: int) -> list[tuple[str, str, str | None]]:
    """Lista A-Z del tema AniStream: /anime-list/ (o /az-list/) con paginación."""
    base = src.base_url.rstrip("/")
    out: list[tuple[str, str, str | None]] = []
    seen: set[str] = set()
    for path in ("/anime-list/", "/az-list/"):
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
                break  # página sin novedades = fin del listado
        if out:
            return out  # esta ruta funcionó; no probamos la siguiente
    return out


def crawl_source_sitemap(src) -> list[tuple[str, str, None]]:
    """Sitemap WordPress: /wp-sitemap.xml → sub-sitemaps de posts → URLs de series."""
    base = src.base_url.rstrip("/")
    series_urls: set[str] = set()

    def locs(html: str) -> list[str]:
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
        direct = [u for u in found if src._is_series_link(u)]
        series_urls.update(direct)
        for sub in subs:
            try:
                t2 = fetch_html(sub, timeout=src.episode_timeout)
            except Exception:
                continue
            for u in locs(t2.html or ""):
                if src._is_series_link(u):
                    series_urls.add(u)
        if series_urls:
            break
    return [(u.rstrip("/").split("/")[-1].replace("-", " ").title(), u, None)
            for u in sorted(series_urls)]


def discover_series(max_pages: int, max_series: int) -> list[dict]:
    """Descubre todas las series de todas las fuentes y las fusiona por título."""
    pool: dict[str, dict] = {}

    def add(src, items):
        for t, u, c in items:
            k = norm_key(t)
            if not k:
                continue
            e = pool.setdefault(k, {"title": t, "urls": {}, "cover": c})
            e["urls"][src.key] = u
            if c and not e["cover"]:
                e["cover"] = c

    for src in [s for s in ALL_SOURCES if s.enabled]:
        items = crawl_source_az(src, max_pages)
        fuente = "A-Z"
        if not items:
            items = crawl_source_sitemap(src)
            fuente = "sitemap"
        print(f"[crawl] {src.key} ({src.name}): {len(items)} series vía {fuente}")
        add(src, items)

    series_list = list(pool.values())
    series_list.sort(key=lambda e: e["title"].lower())
    if max_series and max_series > 0:
        series_list = series_list[:max_series]
    return series_list


# ─────────────────────────────────────────────────────────────────────
# MODO B: SEMILLA DE TÍTULOS (tus catálogos / dhua-titles.txt)
# ─────────────────────────────────────────────────────────────────────

def load_seed_titles() -> list[str]:
    if TITLES_FILE.exists():
        titles = [l.strip() for l in TITLES_FILE.read_text(encoding="utf-8").splitlines() if l.strip()]
        print(f"[seed] {len(titles)} títulos desde dhua-titles.txt")
        return titles
    titles: list[str] = []
    for f in sorted(DATA_DIR.glob("catalog-*-index.json")):
        name = f.name
        if "donghuacli" in name:
            continue
        if not any(h in name for h in DONGHUA_INDEX_HINTS):
            continue
        try:
            idx = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        for item in idx.get("series", []):
            t = item.get("t")
            if t:
                titles.append(t)
    dedup = sorted(set(titles))
    print(f"[seed] {len(dedup)} títulos únicos desde índices de donghua")
    return dedup


def search_all_sources(title: str) -> dict:
    match = {"title": title, "sources": {}}
    with ThreadPoolExecutor(max_workers=5) as pool:
        futs = {pool.submit(s.search_with_covers, title): s for s in ALL_SOURCES if s.enabled}
        for fut, src in futs.items():
            try:
                results = fut.result()
            except Exception as e:
                print(f"  [warn] búsqueda falló en {src.key}: {e}")
                continue
            if not results:
                continue
            import difflib
            best = difflib.get_close_matches(
                title.lower(), [r[0].lower() for r in results], n=1, cutoff=0.55
            )
            if best:
                bt, bu, bcov = next(r for r in results if r[0].lower() == best[0])
                match["sources"][src.key] = {"series_url": bu, "cover": bcov, "matched_title": bt}
    return match


# ─────────────────────────────────────────────────────────────────────
# PROCESAMIENTO COMÚN (episodios + detalle + entrada de índice)
# ─────────────────────────────────────────────────────────────────────

def fetch_episodes(key: str, series_url: str) -> list[tuple[int, str]]:
    src = get_source(key)
    if src is None:
        return []
    try:
        eps = src.get_episodes(series_url)
    except Exception as e:
        print(f"  [warn] episodios fallaron en {key}: {e}")
        return []
    out = []
    for title, url in eps:
        n = extract_episode_number(title, url)
        if n != 999999:
            out.append((n, url))
    return out


def collect_embeds(ep_url: str) -> list[dict]:
    """Servidores iframe de una página de episodio: [{name, url, lang}]."""
    out: list[dict] = []
    seen: set[str] = set()

    def add(raw: str, lang=None) -> None:
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

    for m in re.finditer(
        r"""<option[^>]*value=["']([A-Za-z0-9+/=]{40,})["'][^>]*>(.*?)</option>""", html, re.S
    ):
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


def build_detail(slug: str, title: str, cover, merged: dict[int, dict[str, str]],
                 with_servers: bool) -> dict:
    season_id = f"{slug}-s1"
    now = datetime.now(timezone.utc).isoformat()
    episodes = []
    for n in sorted(merged):
        ep_id = f"{slug}-ep-{n}"
        servers: list[dict] = []
        if with_servers:
            for key, page in merged[n].items():
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


def _bump_progress(hit: bool, total: int) -> tuple[int, int]:
    with _progress_lock:
        _progress["n"] += 1
        if hit:
            _progress["hits"] += 1
        return _progress["n"], _progress["hits"]


def _emit(slug, title, cover, merged, with_servers):
    detail = build_detail(slug, title, cover, merged, with_servers)
    (DETAILS_DIR / f"{slug}.json").write_text(
        json.dumps(detail, ensure_ascii=False), encoding="utf-8")
    return {
        "i": slug, "s": slug, "t": title,
        "p": cover or f"./public/img/posters/{slug}.jpg",
        "g": [], "st": "En Emisión", "ty": "donghua", "y": None,
        "e": len(merged), "pl": len(next(iter(merged.values()))) if merged else 0,
        "u": datetime.now(timezone.utc).isoformat(),
    }


def process_crawl_entry(entry: dict, total: int, with_servers: bool):
    """Una serie descubierta en el crawl (ya con sus URLs por fuente)."""
    title = entry["title"]
    merged: dict[int, dict[str, str]] = {}
    with ThreadPoolExecutor(max_workers=len(entry["urls"])) as pool:
        futs = {pool.submit(fetch_episodes, k, u): k for k, u in entry["urls"].items()}
        for fut, k in futs.items():
            for n, url in fut.result():
                merged.setdefault(n, {})[k] = url

    n_done, hits = _bump_progress(bool(merged), total)
    if not merged:
        print(f"[{n_done}/{total}] {title} -> sin episodios")
        return None
    print(f"[{n_done}/{total}] {title} -> {len(merged)} episodios "
          f"({len(entry['urls'])} fuentes) [{hits} hits]")
    return _emit(slugify(title), title, entry.get("cover"), merged, with_servers)


def process_seed_title(title: str, total: int, with_servers: bool):
    """Un título de la semilla: buscar en las 5 fuentes y luego episodios."""
    match = search_all_sources(title)
    if not match["sources"]:
        n_done, _ = _bump_progress(False, total)
        print(f"[{n_done}/{total}] {title} -> sin coincidencias")
        return None

    merged: dict[int, dict[str, str]] = {}
    with ThreadPoolExecutor(max_workers=len(match["sources"])) as pool:
        futs = {pool.submit(fetch_episodes, k, v["series_url"]): k
                for k, v in match["sources"].items()}
        for fut, k in futs.items():
            for n, url in fut.result():
                merged.setdefault(n, {})[k] = url

    n_done, hits = _bump_progress(bool(merged), total)
    if not merged:
        print(f"[{n_done}/{total}] {title} -> sin episodios")
        return None
    cover = next((v["cover"] for v in match["sources"].values() if v.get("cover")), None)
    print(f"[{n_done}/{total}] {title} -> {len(merged)} episodios "
          f"({len(match['sources'])} fuentes) [{hits} hits]")
    return _emit(slugify(title), title, cover, merged, with_servers)


def write_outputs(entries: list[dict], t0: float) -> None:
    entries.sort(key=lambda x: x["t"].lower())
    total_eps = sum(e["e"] for e in entries)
    now = datetime.now(timezone.utc).isoformat()

    index = {
        "meta": {"source": "donghua-cli", "syncedAt": now,
                 "series": len(entries), "episodes": total_eps,
                 "lite": True, "generatedAt": now},
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

    print(f"[ok] {len(entries)} series ({_progress['hits']} con episodios), "
          f"{total_eps} episodios en {time.time() - t0:.0f}s")
    print(f"[ok] {INDEX_OUT}")
    print(f"[ok] {DETAILS_DIR}/")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--crawl-sites", action="store_true",
                    help="Modo crawl: descubre TODAS las series desde las webs de "
                         "donghua-cli (no usa tus catálogos)")
    ap.add_argument("--workers", type=int, default=6,
                    help="Series procesadas en paralelo (default: 6)")
    ap.add_argument("--max-pages", type=int, default=300,
                    help="Máx. páginas A-Z por fuente (default: 300)")
    ap.add_argument("--max-series", type=int, default=0,
                    help="Limitar N series (0 = sin límite). Útil para pruebas.")
    ap.add_argument("--with-servers", action="store_true",
                    help="Scrapea también los iframes de cada episodio (mucho más lento)")
    args = ap.parse_args()

    t0 = time.time()
    DETAILS_DIR.mkdir(parents=True, exist_ok=True)

    if args.crawl_sites:
        print(f"[modo] crawl-sites: listando A-Z/sitemaps de {sum(1 for s in ALL_SOURCES if s.enabled)} fuentes")
        series = discover_series(args.max_pages, args.max_series)
        if not series:
            print("[error] el crawl no encontró ninguna serie")
            return 1
        total = len(series)
        print(f"[start] {total} series únicas descubiertas, workers={args.workers}")
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            entries = [e for e in pool.map(
                lambda s_: process_crawl_entry(s_, total, args.with_servers), series) if e]
    else:
        titles = load_seed_titles()
        if not titles:
            print("[error] no hay títulos que scrapear")
            return 1
        total = len(titles)
        print(f"[modo] seed: {total} títulos, workers={args.workers}")
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            entries = [e for e in pool.map(
                lambda t_: process_seed_title(t_, total, args.with_servers), titles) if e]

    write_outputs(entries, t0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
