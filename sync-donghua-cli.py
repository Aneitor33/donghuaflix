#!/usr/bin/env python3
"""
sync-donghua-cli.py — Catálogo "donghuacli" para donghuaflix usando donghua-cli.

MODOS:
  --crawl-sites            Descubre series en las webs de donghua-cli (sitemap+A-Z+portada),
                           limpia títulos, descarta inglés/indonesio (sin "multi"), y genera
                           catálogo + fichas con lista de episodios (sin servidores).
  --servers-only           NO descubre nada: recorre las fichas ya generadas y rellena
                           e.servers con los iframes detectados. Retomable (salta episodios
                           que ya tienen servidores).
  (sin flags)              Modo semilla con dhua-titles.txt / tus índices de donghua.

CHECKPOINT / RETOMAR:
  - Guarda estado tras cada serie (catalog-donghuacli-state.json).
  - Al re-ejecutar, salta las series ya hechas. Usa --fresh para forzar de cero.
  - El workflow commitea aunque falle (if: always()), así el progreso sobrevive.

Uso típico:
  python sync-donghua-cli.py --crawl-sites --workers 8            # catálogo completo
  python sync-donghua-cli.py --servers-only --workers 8           # rellenar servidores
  python sync-donghua-cli.py --crawl-sites --max-series 30        # prueba
  python sync-donghua-cli.py --crawl-sites --fresh                # rehacer desde cero
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
STATE_FILE = DATA_DIR / "catalog-donghuacli-state.json"
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

# URL de episodio (no de serie): /episode-102, /ep-3, etc.
EP_URL_RX = re.compile(r"(?:^|[-_/])(?:episode|ep)[-_ ]?\d+", re.I)
# Título que anuncia subs que NO nos sirven (salvo que diga multi/español)
BAD_SUB_RX = re.compile(
    r"english subtitles?$|english sub$|subtitles? english( indonesian)?$|"
    r"sub indo(?!.*multi)|indonesian sub(?!.*multi)|indo sub(?!.*multi)", re.I)
MULTI_RX = re.compile(r"multi|espa?ñol|spanish", re.I)
SITE_TAG_RX = re.compile(
    r"\s*[|\-–—]\s*(DonghuaStream|AnimeXin|AnimeKhor|LMAnime|LuciferDonghua)\b.*$", re.I)
EP_TITLE_RX = re.compile(
    r"\s+(?:episode|ep)\s*\d+\s*(?:english subtitles?|subtitles? english(?: indonesian)?|"
    r"sub indo|multi[- ]?sub[^\n]*)?$", re.I)
LANG_SUFFIX_RX = re.compile(
    r"\s+(?:english subtitles?|subtitles? english(?: indonesian)?|multi[- ]?sub[^|]*)$", re.I)

_progress_lock = threading.Lock()
_progress = {"n": 0, "hits": 0}


def slugify(title: str) -> str:
    s = title.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def norm_key(title: str) -> str:
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
# ESTADO / CHECKPOINT
# ─────────────────────────────────────────────────────────────────────

def load_state(fresh: bool) -> dict:
    if not fresh and STATE_FILE.exists():
        try:
            st = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            if isinstance(st, dict) and "done" in st:
                print(f"[state] retomando: {len(st['done'])} series ya hechas")
                return st
        except Exception:
            pass
    return {"done": [], "entries": []}


def save_state(st: dict) -> None:
    STATE_FILE.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")


# ─────────────────────────────────────────────────────────────────────
# DESCUBRIMIENTO (sitemap + A-Z + portada paginada)
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
    """Recorre /page/N/ de una ruta de listado y devuelve [(t,u,c), ...] sin duplicados."""
    base = src.base_url.rstrip("/")
    out, seen, = [], set()
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
            break  # página repetida: fin de la paginación
    return out


def crawl_source_sitemap(src):
    base = src.base_url.rstrip("/")
    series_urls = {}

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
            if src._is_series_link(u) and not EP_URL_RX.search(u):
                series_urls[u] = None
        for sub in subs:
            try:
                t2 = fetch_html(sub, timeout=src.episode_timeout)
            except Exception:
                continue
            for u in locs(t2.html or ""):
                if src._is_series_link(u) and not EP_URL_RX.search(u):
                    series_urls.setdefault(u, None)
        if series_urls:
            break
    return [(u.rstrip("/").split("/")[-1].replace("-", " ").title(), u, None)
            for u in sorted(series_urls)]


def keep_item(title: str, url: str) -> bool:
    """¿Nos interesa esta entrada? Descarta páginas de episodio y subs eng/indo puros."""
    if EP_URL_RX.search(url):
        return False
    if MULTI_RX.search(title):
        return True
    if BAD_SUB_RX.search(title):
        return False
    return True


def clean_discovered_title(t: str) -> str:
    t = SITE_TAG_RX.sub("", t)
    t = EP_TITLE_RX.sub("", t)
    t = LANG_SUFFIX_RX.sub("", t)
    return t.strip(" -|–—").strip()


def discover_series(max_pages: int, max_series: int) -> list[dict]:
    pool: dict[str, dict] = {}
    for src in [s for s in ALL_SOURCES if s.enabled]:
        by_url: dict[str, tuple] = {}
        n_sitemap = 0
        for it in crawl_source_sitemap(src):
            by_url.setdefault(it[1], it)
        n_sitemap = len(by_url)
        for path in ("/anime-list/", "/az-list/", "/"):
            for it in _paginated_listing(src, path, max_pages):
                by_url.setdefault(it[1], it)
        kept = 0
        for t, u, c in by_url.values():
            if not keep_item(t, u):
                continue
            ct = clean_discovered_title(t) or t
            k = norm_key(ct)
            if not k:
                continue
            e = pool.setdefault(k, {"title": ct, "urls": {}, "cover": c})
            e["urls"][src.key] = u
            if c and not e["cover"]:
                e["cover"] = c
            kept += 1
        print(f"[crawl] {src.key} ({src.name}): {kept} series válidas "
              f"(sitemap {n_sitemap} URLs, total {len(by_url)})")
    series_list = list(pool.values())
    series_list.sort(key=lambda e: e["title"].lower())
    if max_series and max_series > 0:
        series_list = series_list[:max_series]
    return series_list


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
    import difflib
    match = {"title": title, "sources": {}}
    with ThreadPoolExecutor(max_workers=5) as pool:
        futs = {pool.submit(s.search_with_covers, title): s for s in ALL_SOURCES if s.enabled}
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

def fetch_episodes(key: str, series_url: str) -> list[tuple[int, str]]:
    src = get_source(key)
    if src is None:
        return []
    try:
        eps = src.get_episodes(series_url)
    except Exception:
        return []
    out = []
    for title, url in eps:
        n = extract_episode_number(title, url)
        if n != 999999:
            out.append((n, url))
    return out


def fix_episode_numbers(merged: dict[int, dict[str, str]]) -> dict[int, dict[str, str]]:
    """Si la numeración no empieza en 1, renumera 1..N en orden (los posts sueltos
    de algunas webs numeran raro). Si ya hay un 1 coherente, se respeta."""
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


def _bump(hit: bool, total: int):
    with _progress_lock:
        _progress["n"] += 1
        if hit:
            _progress["hits"] += 1
        return _progress["n"], _progress["hits"]


def _emit(slug, title, cover, merged, with_servers):
    detail = build_detail(slug, title, cover, merged, with_servers)
    (DETAILS_DIR / f"{slug}.json").write_text(json.dumps(detail, ensure_ascii=False), encoding="utf-8")
    return {
        "i": slug, "s": slug, "t": title,
        "p": cover or f"./public/img/posters/{slug}.jpg",
        "g": [], "st": "En Emisión", "ty": "donghua", "y": None,
        "e": len(merged), "pl": len(next(iter(merged.values()))) if merged else 0,
        "u": datetime.now(timezone.utc).isoformat(),
    }


def process_crawl_entry(entry, total, with_servers, st):
    title = entry["title"]
    key = norm_key(title)
    if key in st["done"]:
        n_done, _ = _bump(True, total)
        return "SKIP"
    merged: dict[int, dict[str, str]] = {}
    with ThreadPoolExecutor(max_workers=len(entry["urls"])) as pool:
        futs = {pool.submit(fetch_episodes, k, u): k for k, u in entry["urls"].items()}
        for fut, k in futs.items():
            for n, url in fut.result():
                merged.setdefault(n, {})[k] = url
    n_done, hits = _bump(bool(merged), total)
    if not merged:
        print(f"[{n_done}/{total}] {title} -> sin episodios")
        st["done"].append(key)
        return None
    merged = fix_episode_numbers(merged)
    print(f"[{n_done}/{total}] {title} -> {len(merged)} episodios "
          f"({len(entry['urls'])} fuentes) [{hits} hits]")
    return _emit(slugify(title), title, entry.get("cover"), merged, with_servers)


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
            for n, url in fut.result():
                merged.setdefault(n, {})[k] = url
    n_done, hits = _bump(bool(merged), total)
    if not merged:
        print(f"[{n_done}/{total}] {title} -> sin episodios")
        return None
    merged = fix_episode_numbers(merged)
    cover = next((v["cover"] for v in match["sources"].values() if v.get("cover")), None)
    print(f"[{n_done}/{total}] {title} -> {len(merged)} episodios ({len(match['sources'])} fuentes) [{hits} hits]")
    return _emit(slugify(title), title, cover, merged, with_servers)


# ─────────────────────────────────────────────────────────────────────
# --servers-only: rellenar servidores en fichas existentes
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
                print(f"[servers] {i}/{total} fichas ({done_eps} episodios con servidores)")
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
    ap.add_argument("--servers-only", action="store_true",
                    help="Solo rellenar servidores en fichas ya existentes (retomable)")
    ap.add_argument("--fresh", action="store_true",
                    help="Ignora el estado guardado y empieza de cero")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--max-pages", type=int, default=300)
    ap.add_argument("--max-series", type=int, default=0)
    ap.add_argument("--with-servers", action="store_true",
                    help="Scrapea iframes durante el crawl (lento; mejor usa --servers-only después)")
    args = ap.parse_args()

    t0 = time.time()
    DETAILS_DIR.mkdir(parents=True, exist_ok=True)

    if args.servers_only:
        return backfill_servers(args.workers)

    st = load_state(args.fresh)
    done_set = set(st["done"])
    entries: list[dict] = list(st["entries"])
    flush_counter = {"i": 0}

    def stash(entry, key):
        if entry:
            entries.append(entry)
            st["entries"].append(entry)
        if key:
            st["done"].append(key)
        flush_counter["i"] += 1
        if flush_counter["i"] % 10 == 0:
            save_state(st)

    if args.crawl_sites:
        print(f"[modo] crawl-sites: descubriendo en {sum(1 for s in ALL_SOURCES if s.enabled)} fuentes")
        series = discover_series(args.max_pages, args.max_series)
        todo = [s for s in series if norm_key(s["title"]) not in done_set]
        print(f"[start] {len(series)} series únicas ({len(todo)} pendientes), workers={args.workers}")
        total = len(todo)
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futs = {pool.submit(process_crawl_entry, s, total, args.with_servers, st): s for s in todo}
            for fut, s in futs.items():
                try:
                    r = fut.result()
                except Exception as e:
                    print(f"  [warn] error procesando {s['title']}: {e}")
                    continue
                if r == "SKIP":
                    continue
                if r:
                    stash(r, norm_key(s["title"]))
                else:
                    stash(None, norm_key(s["title"]))
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
