#!/usr/bin/env python3
"""
sync-donghuacli.py — Genera catalog-donghuacli.json (+ índice lite) para donghuaflix
usando donghua-cli como librería de scraping.

Uso:
    pip install donghua-cli
    python sync-donghuacli.py

Fuentes de títulos (en este orden):
    1. dhua-titles.txt              (uno por línea, si existe)
    2. los catalog-*-index.json ya existentes en public/data (dedup por título)

Salida:
    public/data/catalog-donghuacli.json        (db completo, con URLs de página de episodio ESTABLES)
    public/data/catalog-donghuacli-index.json  (índice lite/compact, formato donghuaflix)
    public/data/catalog-donghuacli-details/    (un JSON por serie, con su lista de episodios y servidores por fuente)
"""
import json
import re
import sys
import time
import difflib
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from donghua_cli.sources import ALL_SOURCES
from donghua_cli.utils import extract_episode_number

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "public" / "data"
DETAILS_DIR = DATA_DIR / "catalog-donghuacli-details"
INDEX_OUT = DATA_DIR / "catalog-donghuacli-index.json"
DB_OUT = DATA_DIR / "catalog-donghuacli.json"
TITLES_FILE = ROOT / "dhua-titles.txt"

SOURCE_LABEL = {s.key: s.name for s in ALL_SOURCES}
# Fuentes que sabemos traen subs en español (ver conversación): ds, ax, ak
SPANISH_SOURCES = {"ds", "ax", "ak"}


def slugify(title: str) -> str:
    s = title.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def load_seed_titles() -> list[str]:
    """Títulos a scrapear: dhua-titles.txt o los índices ya existentes."""
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
    """Busca el título en las 5 fuentes en paralelo. Devuelve match por fuente."""
    match = {"title": title, "sources": {}}  # key -> {"series_url":..., "cover":...}
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
    """Lista de episodios de una fuente: [(numero, url_pagina_episodio), ...]"""
    from donghua_cli.sources import get_source
    src = get_source(key)
    if src is None:
        return []
    try:
        eps = src.get_episodes(series_url)  # [(title, url), ...]
    except Exception as e:
        print(f"  [warn] episodios fallaron en {key}: {e}")
        return []
    out = []
    for title, url in eps:
        n = extract_episode_number(title, url)
        if n != 999999:
            out.append((n, url))
    return out


def main() -> int:
    t0 = time.time()
    titles = load_seed_titles()
    if not titles:
        print("[error] no hay títulos que scrapear")
        return 1

    DETAILS_DIR.mkdir(parents=True, exist_ok=True)
    db = {"meta": {"version": 1, "source": "donghua-cli (ds/ax/ak/lm/ld)",
                   "syncedAt": None, "lastSync": {"status": "running"}},
          "series": [], "seasons": [], "episodes": [], "genres": []}
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

        # Episodios por fuente, en paralelo
        per_source: dict[str, list[tuple[int, str]]] = {}
        with ThreadPoolExecutor(max_workers=len(match["sources"])) as pool:
            futs = {pool.submit(fetch_episodes, k, v["series_url"]): k
                    for k, v in match["sources"].items()}
            for fut, k in futs.items():
                per_source[k] = fut.result()

        # Merge por número de episodio
        merged: dict[int, dict[str, str]] = {}  # ep -> {source_key: ep_page_url}
        for k, eps in per_source.items():
            for n, url in eps:
                merged.setdefault(n, {})[k] = url
        if not merged:
            print("  -> sin episodios")
            continue

        total_eps += len(merged)
        series_rec = {
            "id": slug,
            "title": title,
            "type": "donghua",
            "cover": cover,
            "sources": {k: v["series_url"] for k, v in match["sources"].items()},
            "episodes": [
                {"n": n, "pages": merged[n]} for n in sorted(merged)
            ],
        }
        db["series"].append(series_rec)

        # Detalle individual (lo consume /resolve sin re-scrapear la serie entera)
        (DETAILS_DIR / f"{slug}.json").write_text(
            json.dumps(series_rec, ensure_ascii=False), encoding="utf-8")

        # Entrada del índice lite (formato donghuaflix)
        index_series.append({
            "i": slug, "s": slug, "t": title,
            "p": cover or f"./public/img/posters/{slug}.jpg",
            "g": [], "pl": len(match["sources"]), "ty": "donghua",
            "u": datetime.now(timezone.utc).isoformat(),
        })

    now = datetime.now(timezone.utc)
    db["meta"]["syncedAt"] = now.isoformat()
    db["meta"]["lastSync"] = {"status": "success", "startedAt": now.isoformat(),
                              "finishedAt": now.isoformat(), "error": None}
    DB_OUT.write_text(json.dumps(db, ensure_ascii=False), encoding="utf-8")

    index = {"meta": {"source": "donghua-cli", "syncedAt": now.isoformat(),
                      "series": len(index_series), "episodes": total_eps,
                      "lite": True, "generatedAt": now.isoformat()},
             "lite": True, "compact": True,
             "imageBase": "https://image.tmdb.org/t/p/w300",
             "detailsBase": "catalog-donghuacli-details",
             "genres": [], "count": len(index_series),
             "series": index_series}
    INDEX_OUT.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")

    print(f"[ok] {len(index_series)} series, {total_eps} episodios "
          f"en {time.time() - t0:.0f}s")
    print(f"[ok] {DB_OUT}")
    print(f"[ok] {INDEX_OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
