#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Flyflix Scraper rápido — genera URLs de múltiples servidores embed
desde IDs de TMDB, con workers paralelos configurables.

Uso:
    python flyflix_scraper.py --id 969681
    python flyflix_scraper.py --id 288673 --tipo tv --temporada 1 --episodio 1
    python flyflix_scraper.py --titulo "The Office" --tipo tv --t 2 --e 3
    python flyflix_scraper.py --archivo lista.txt
    python flyflix_scraper.py --id 969681 --servidores cinesrc,vidlink
    python flyflix_scraper.py --workers 30
    python flyflix_scraper.py --sin-verificar        # no comprueba URLs (más rápido)
"""

import argparse
import csv
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Config por defecto (sobreescrita por flyflix_config.yml si existe)
# ---------------------------------------------------------------------------
DEFAULT_CFG = {
    "workers": 10,
    "verificar_urls": True,
    "timeout_verificacion": 10,
    "tmdb_api_key": "",
    "servidores": [
        {"nombre": "cinesrc", "dominio": "https://cinesrc.st",
         "movie": "/embed/movie/{id}", "tv": "/embed/tv/{id}?s={s}&e={e}",
         "activo": True, "verificado": True},
    ],
}


def cargar_config(ruta="flyflix_config.yml"):
    p = Path(ruta)
    if not p.exists():
        print(f"!! {ruta} no encontrado — uso config mínima (solo cinesrc)")
        return DEFAULT_CFG
    try:
        import yaml
    except ImportError:
        sys.exit("Instala PyYAML:  pip install pyyaml requests")
    cfg = yaml.safe_load(p.read_text(encoding="utf-8"))
    print(f"✔ Config: {len(cfg.get('servidores', []))} servidores | "
          f"workers={cfg.get('workers', 10)} | verificar={cfg.get('verificar_urls', True)}")
    return cfg


def construir_url(srv, tmdb_id, tipo, s=None, e=None):
    tpl = srv["movie" if tipo == "movie" else "tv"]
    url = srv["dominio"] + tpl.replace("{id}", str(tmdb_id))
    if tipo == "tv":
        url = url.replace("{s}", str(s or 1)).replace("{e}", str(e or 1))
    return url


def verificar(url, timeout):
    try:
        r = requests.head(url, timeout=timeout, allow_redirects=True,
                          headers={"User-Agent": "Mozilla/5.0"})
        if r.status_code >= 400:
            r = requests.get(url, timeout=timeout, stream=True,
                             headers={"User-Agent": "Mozilla/5.0"})
        return r.status_code
    except Exception:
        return None


def resolver_tmdb(titulo, tipo, api_key):
    if not api_key:
        sys.exit("Necesitas --tmdb-key o tmdb_api_key en el .yml "
                 "(gratis en themoviedb.org/settings/api)")
    tipo_api = "movie" if tipo == "movie" else "tv"
    r = requests.get(
        f"https://api.themoviedb.org/3/search/{tipo_api}",
        params={"api_key": api_key, "query": titulo, "language": "es-ES"},
        timeout=15)
    r.raise_for_status()
    res = r.json().get("results", [])
    if not res:
        sys.exit(f"Sin resultados TMDB para: {titulo}")
    return res[0]["id"], res[0].get("title") or res[0].get("name")


def procesar_item(item, servidores, cfg, check):
    """Genera (y opcionalmente verifica) las URLs de un título para todos los servidores."""
    urls = []
    for srv in servidores:
        url = construir_url(srv, item["id"], item["tipo"],
                            item.get("season"), item.get("episode"))
        entry = {"servidor": srv["nombre"], "url": url,
                 "verificado_por_nosotros": srv.get("verificado", False)}
        if check:
            entry["http_status"] = verificar(url, cfg["timeout_verificacion"])
        urls.append(entry)
    item["servers"] = urls
    return item


def leer_archivo(path):
    """Formatos por línea:
        969681                          → película
        tv:288673:1:5                   → serie T1 E5
        movie:Spider-Man                → película por título
        tv:The Office:2:3               → serie por título
    """
    items = []
    for i, linea in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        linea = linea.strip()
        if not linea or linea.startswith("#"):
            continue
        partes = linea.split(":")
        try:
            if partes[0].lower() == "tv":
                if partes[1].isdigit():
                    items.append({"tipo": "tv", "id": int(partes[1]),
                                  "season": int(partes[2]), "episode": int(partes[3]),
                                  "origen": f"{path}:{i}"})
                else:
                    items.append({"tipo": "tv", "titulo": partes[1],
                                  "season": int(partes[2]), "episode": int(partes[3]),
                                  "origen": f"{path}:{i}"})
            elif partes[0].lower() == "movie":
                if partes[1].isdigit():
                    items.append({"tipo": "movie", "id": int(partes[1]), "origen": f"{path}:{i}"})
                else:
                    items.append({"tipo": "movie", "titulo": partes[1], "origen": f"{path}:{i}"})
            elif linea.isdigit():
                items.append({"tipo": "movie", "id": int(linea), "origen": f"{path}:{i}"})
            else:
                items.append({"tipo": "movie", "titulo": linea, "origen": f"{path}:{i}"})
        except (IndexError, ValueError):
            print(f"  ! Línea {i} ignorada (formato): {linea}")
    return items


def main():
    ap = argparse.ArgumentParser(description="Scraper rápido de servidores embed TMDB")
    ap.add_argument("--id", type=int, help="TMDB ID directo")
    ap.add_argument("--titulo", help="Título a resolver vía API TMDB")
    ap.add_argument("--tipo", choices=["movie", "tv"], default="movie")
    ap.add_argument("--temporada", "--t", type=int, dest="t")
    ap.add_argument("--episodio", "--e", type=int, dest="e")
    ap.add_argument("--archivo", help="archivo con lista de títulos/IDs")
    ap.add_argument("--servidores", help="subconjunto: cinesrc,vidlink,...")
    ap.add_argument("--workers", type=int, help="workers paralelos (override del .yml)")
    ap.add_argument("--sin-verificar", action="store_true",
                    help="no hacer HEAD checks (más rápido, sin estados HTTP)")
    ap.add_argument("--tmdb-key", help="API key de TMDB (o env TMDB_API_KEY)")
    ap.add_argument("--config", default="flyflix_config.yml")
    ap.add_argument("--salida", default="flyflix_scraped.json")
    args = ap.parse_args()

    cfg = cargar_config(args.config)
    workers = args.workers or cfg.get("workers", 10)
    check = (cfg.get("verificar_urls", True)) and not args.sin_verificar

    # --- Selección de servidores ---
    todos = cfg.get("servidores", [])
    if args.servidores:
        elegidos = {s.strip() for s in args.servidores.split(",")}
        servidores = [s for s in todos if s["nombre"] in elegidos]
        if not servidores:
            sys.exit(f"Ningún servidor coincide: {elegidos}")
    else:
        servidores = [s for s in todos if s.get("activo", True)]
    print(f"✔ Servidores activos: {', '.join(s['nombre'] for s in servidores)}")

    # --- Construir lista de ítems ---
    items = []
    if args.archivo:
        items = leer_archivo(args.archivo)
    elif args.id:
        items = [{"tipo": args.tipo, "id": args.id,
                  "season": args.t, "episode": args.e, "origen": "CLI"}]
    elif args.titulo:
        items = [{"tipo": args.tipo, "titulo": args.titulo,
                  "season": args.t, "episode": args.e, "origen": "CLI"}]
    else:
        ap.error("usa --id, --titulo o --archivo")

    # --- Resolver títulos → IDs TMDB ---
    api_key = (args.tmdb_key or cfg.get("tmdb_api_key")
               or os.environ.get("TMDB_API_KEY", ""))
    for it in items:
        if "titulo" in it:
            tid, nombre = resolver_tmdb(it["titulo"], it["tipo"], api_key)
            it["id"] = tid
            it["nombre"] = nombre
            print(f"✔ '{it['titulo']}' → {nombre} (ID {tid})")

    # --- Procesar en paralelo ---
    print(f"▶ Procesando {len(items)} ítem(s) con {workers} workers "
          f"({'con' if check else 'sin'} verificación HTTP)...")
    resultados = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futuros = {ex.submit(procesar_item, it, servidores, cfg, check): it
                   for it in items}
        for fut in as_completed(futuros):
            r = fut.result()
            resultados.append(r)
            ok = (sum(1 for u in r["servers"]
                      if not check or (u.get("http_status") or 0) < 400))
            print(f"  [{r['tipo']}] ID {r['id']}: {ok}/{len(r['servers'])} servidores OK")

    resultados.sort(key=lambda r: r.get("origen", ""))
    Path(args.salida).write_text(json.dumps(resultados, indent=2, ensure_ascii=False),
                                 encoding="utf-8")

    # CSV resumen
    csv_path = Path(args.salida).with_suffix(".csv")
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["tipo", "tmdb_id", "temporada", "episodio", "servidor",
                    "url", "http_status", "verificado"])
        for r in resultados:
            for u in r["servers"]:
                w.writerow([r["tipo"], r["id"], r.get("season", ""),
                            r.get("episode", ""), u["servidor"], u["url"],
                            u.get("http_status", ""), u["verificado_por_nosotros"]])

    print(f"\n✔ JSON: {Path(args.salida).resolve()}")
    print(f"✔ CSV : {csv_path.resolve()}")


if __name__ == "__main__":
    main()
