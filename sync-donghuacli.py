#!/usr/bin/env python3
"""
sync-donghuacli.py — Genera catalog-donghuacli.json (+ índice lite + fichas de
detalle) para donghuaflix, usando donghua-cli como librería de scraping.

El formato de salida sigue el esquema que consume app.js:
  - catalog-donghuacli-index.json   → índice lite/compact (tarjetas + buscador)
  - catalog-donghuacli-details/*.json → {series, seasons, episodes} por título,
      episodes[] con {id, slug, seriesId, seasonId, number, title, servers, updatedAt}
  - catalog-donghuacli.json         → db completo (resumen)

Uso:
    pip install donghua-cli
    python sync-donghuacli.py                # rápido: sin scrapear servidores
    python sync-donghuacli.py --with-servers # lento: un fetch por episodio

Semilla de títulos (en este orden):
    1. dhua-titles.txt (uno por línea, si existe)
    2. los catalog-*-index.json ya existentes en public/data (dedup por título)
"""
import argparse
import base64
import binascii
import json
import re
import sys
import time
import difflib
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


def slugify(title: str) -> str:
    s = title.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


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


def load_seed_titles() -> list[str]:
    if TITLES_FILE.exists():
        titles = [l.strip() for l in TITLES_FILE.read_text(encoding="utf-8").splitlines() if l.strip()]
        print(f"[seed] {len(titles)} títulos desde dhua-titles.txt")
        return titles
    titles: list[str] = []
    for f in sorted(DATA_DIR.glob("catalog-*-index.json")):
        if "donghuacli" in f.name:
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
    print(f"[seed] {len(dedup)} títulos únicos desde índices existentes")
    return dedup


def search_all_sources(title: str) -> dict:
    """Busca el título en las fuentes habilitadas (paralelo)."""
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
            best = difflib.get_close_matches(
                title.lower(), [r[0].lower() for r in results], n=1, cutoff=0.55
            )
            if best:
                bt, bu, bcov = next(r for r in results if r[0].lower() == best[0])
                match["sources"][src.key] = {"series_url": bu, "cover": bcov, "matched_title": bt}
    return match


def fetch_episodes(key: str, series_url: str) -> list[tuple[int, str]]:
    """[(numero, url_pagina_episodio), ...] desde una fuente."""
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
    """Servidores iframe de una página de episodio: [{name, url, lang}].
    Misma lógica que donghua_cli.extractor.extract_servers pero conservando
    la forma EMBED (válida para <iframe>), no la watch-page para mpv."""
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
    """Ficha {series, seasons, episodes} en el esquema que lee ensureDetail()."""
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
            "id": ep_id,
            "slug": ep_id,
            "seriesId": slug,
            "seasonId": season_id,
            "number": n,
            "title": f"Episodio {n}",
            "servers": servers,
            "pages": merged[n],   # URLs estables de página (para /resolve bajo demanda)
            "updatedAt": now,
        })
    return {
        "series": {
            "id": slug,
            "slug": slug,
            "title": title,
            "image": cover or "",
            "status": "En Emisión",
            "type": "donghua",
            "synopsis": "",
            "updatedAt": now,
            "sourceUrl": "",
        },
        "seasons": [{"id": season_id, "seriesId": slug, "number": 1, "title": "Temporada 1"}],
        "episodes": episodes,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--with-servers", action="store_true",
                    help="Scrapea también los iframes de cada episodio (lento)")
    args = ap.parse_args()

    t0 = time.time()
    titles = load_seed_titles()
    if not titles:
        print("[error] no hay títulos que scrapear")
        return 1

    DETAILS_DIR.mkdir(parents=True, exist_ok=True)
    index_series: list[dict] = []
    total_eps = 0

    for i, title in enumerate(titles, 1):
        print(f"[{i}/{len(titles)}] {title}")
        match = search_all_sources(title)
        if not match["sources"]:
            print("  -> sin coincidencias")
            continue

        slug = slugify(title)
        cover = next((v["cover"] for v in match["sources"].values() if v.get("cover")), None)

        per_source: dict[str, list[tuple[int, str]]] = {}
        with ThreadPoolExecutor(max_workers=len(match["sources"])) as pool:
            futs = {pool.submit(fetch_episodes, k, v["series_url"]): k
                    for k, v in match["sources"].items()}
            for fut, k in futs.items():
                per_source[k] = fut.result()

        merged: dict[int, dict[str, str]] = {}
        for k, eps in per_source.items():
            for n, url in eps:
                merged.setdefault(n, {})[k] = url
        if not merged:
            print("  -> sin episodios")
            continue

        total_eps += len(merged)
        detail = build_detail(slug, title, cover, merged, args.with_servers)
        (DETAILS_DIR / f"{slug}.json").write_text(
            json.dumps(detail, ensure_ascii=False), encoding="utf-8")

        index_series.append({
            "i": slug, "s": slug, "t": title,
            "p": cover or f"./public/img/posters/{slug}.jpg",
            "g": [], "st": "En Emisión", "ty": "donghua", "y": None,
            "e": len(merged), "pl": len(match["sources"]),
            "u": datetime.now(timezone.utc).isoformat(),
        })
        print(f"  -> {len(merged)} episodios desde {len(merged and match['sources'])} fuente(s)")

    now = datetime.now(timezone.utc)
    index = {
        "meta": {"source": "donghua-cli", "syncedAt": now.isoformat(),
                 "series": len(index_series), "episodes": total_eps,
                 "lite": True, "generatedAt": now.isoformat()},
        "lite": True, "compact": True,
        "imageBase": "https://image.tmdb.org/t/p/w300",
        "detailsBase": "catalog-donghuacli-details",
        "genres": [], "count": len(index_series),
        "series": index_series,
    }
    INDEX_OUT.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")

    db = {"meta": {"version": 1, "source": "donghua-cli (ds/ax/ak/lm/ld)",
                   "syncedAt": now.isoformat(), "series": len(index_series)},
          "series": index_series, "seasons": [], "episodes": [], "genres": []}
    DB_OUT.write_text(json.dumps(db, ensure_ascii=False), encoding="utf-8")

    print(f"[ok] {len(index_series)} series, {total_eps} episodios en {time.time() - t0:.0f}s")
    print(f"[ok] {INDEX_OUT}")
    print(f"[ok] {DETAILS_DIR}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
