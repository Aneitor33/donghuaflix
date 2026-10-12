#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Flyflix Scraper — genera URLs de múltiples servidores embed desde IDs de TMDB.

Fuentes de catálogo:
    --id 969681                    un título por ID
    --titulo "The Office" --tipo tv   búsqueda por nombre (necesita API key)
    --archivo lista.txt            lista de IDs/títulos
    --flyflix                      TODO el catálogo que lista flyflix.net
    --auto N [--fuente tmdb]       top N de TMDB (trending+popular, paginado)

Ejemplos:
    python flyflix_scraper.py --id 969681 --workers 10
    python flyflix_scraper.py --flyflix --workers 20
    python flyflix_scraper.py --auto 500 --fuente tmdb --workers 50
    python flyflix_scraper.py --id 288673 --tipo tv --temporada 2 --episodio 3
"""

import argparse
import csv
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

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


def obtener_catalogo_flyflix():
    """Extrae TODOS los IDs que flyflix.net lista (sitemap + páginas).
    No necesita API key."""
    ids = {}
    fuentes = [
        "https://flyflix.net/sitemap.xml",
        "https://flyflix.net/movies",
        "https://flyflix.net/tv",
        "https://flyflix.net/discover",
    ]
    hdrs = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                           "AppleWebKit/537.36 Chrome/126.0 Safari/537.36")}
    for url in fuentes:
        try:
            r = requests.get(url, headers=hdrs, timeout=20)
            if r.status_code != 200:
                print(f"  ! {url} → HTTP {r.status_code} (¿Cloudflare?)")
                continue
            n = 0
            for tid, sufijo in re.findall(r"/watch/(\d+)(-tv)?", r.text):
                if tid not in ids:
                    ids[tid] = "tv" if sufijo else "movie"
                    n += 1
            print(f"  ✔ {url}: {n} IDs nuevos")
        except Exception as e:
            print(f"  ! Error {url}: {e}")
    return [{"tipo": t, "id": int(i), "season": 1, "episode": 1,
             "origen": "flyflix"} for i, t in ids.items()]


def obtener_catalogo_tmdb(api_key, cantidad=20):
    """Catálogo TMDB con PAGINACIÓN real: 20 resultados/página hasta
    alcanzar 'cantidad' únicos por tipo (máx 100 páginas por lista)."""
    items = []
    vistos = set()
    por_tipo = {"movie": 0, "tv": 0}
    headers = {"Authorization": f"Bearer {api_key}"} if api_key.startswith("ey") else {}
    params = {} if headers else {"api_key": api_key}
    listas = [
        ("movie", "https://api.themoviedb.org/3/trending/movie/week"),
        ("tv", "https://api.themoviedb.org/3/trending/tv/week"),
        ("movie", "https://api.themoviedb.org/3/movie/popular"),
        ("tv", "https://api.themoviedb.org/3/tv/popular"),
    ]
    MAX_PAGINAS = 500   # tope TMDB: 500 páginas x 20 = 10,000 por lista
    for tipo, url in listas:
        page = 1
        while por_tipo[tipo] < cantidad and page <= MAX_PAGINAS:
            try:
                r = None
                for _intento in range(4):
                    r = requests.get(url, params={**params, "language": "es-ES",
                                                  "page": page},
                                     headers=headers, timeout=15)
                    if r.status_code == 429:
                        time.sleep(2 * (_intento + 1))
                        continue
                    break
                r.raise_for_status()
                results = r.json().get("results", [])
                if not results:
                    break
                nuevos = 0
                for res in results:
                    rid = res.get("id")
                    if rid and rid not in vistos:
                        vistos.add(rid)
                        por_tipo[tipo] += 1
                        nombre = res.get("title") or res.get("name") or ""
                        items.append({"tipo": tipo, "id": rid, "nombre": nombre,
                                      "season": 1, "episode": 1,
                                      "origen": "TMDB-auto"})
                        nuevos += 1
                        if por_tipo[tipo] >= cantidad:
                            break
                print(f"  · {tipo} pág {page}: +{nuevos} (total {por_tipo[tipo]})")
                page += 1
                time.sleep(0.3)
            except Exception as e:
                print(f"  ! Error {url} pág {page}: {e}")
                break
    return items


def procesar_item(item, servidores, cfg, check):
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
        969681                 película por ID
        tv:288673:1:5          serie T1E5 por ID
        movie:Spider-Man       película por título
        tv:The Office:2:3      serie por título
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
                    items.append({"tipo": "movie", "id": int(partes[1]),
                                  "origen": f"{path}:{i}"})
                else:
                    items.append({"tipo": "movie", "titulo": partes[1],
                                  "origen": f"{path}:{i}"})
            elif linea.isdigit():
                items.append({"tipo": "movie", "id": int(linea),
                              "origen": f"{path}:{i}"})
            else:
                items.append({"tipo": "movie", "titulo": linea,
                              "origen": f"{path}:{i}"})
        except (IndexError, ValueError):
            print(f"  ! Línea {i} ignorada (formato): {linea}")
    return items


def main():
    ap = argparse.ArgumentParser(description="Scraper de servidores embed TMDB")
    ap.add_argument("--id", type=int, help="TMDB ID directo")
    ap.add_argument("--titulo", help="Título a resolver vía API TMDB")
    ap.add_argument("--tipo", choices=["movie", "tv"], default="movie")
    ap.add_argument("--temporada", "--t", type=int, dest="t")
    ap.add_argument("--episodio", "--e", type=int, dest="e")
    ap.add_argument("--archivo", help="archivo con lista de títulos/IDs")
    ap.add_argument("--auto", type=int, metavar="N",
                    help="catálogo automático: top N películas + top N series")
    ap.add_argument("--flyflix", action="store_true",
                    help="catálogo completo de flyflix.net")
    ap.add_argument("--fuente", choices=["tmdb", "flyflix"], default="tmdb")
    ap.add_argument("--servidores", help="subconjunto: cinesrc,vidlink,...")
    ap.add_argument("--workers", type=int, help="workers paralelos")
    ap.add_argument("--sin-verificar", action="store_true")
    ap.add_argument("--tmdb-key", help="API key de TMDB (o env TMDB_API_KEY)")
    ap.add_argument("--config", default="flyflix_config.yml")
    ap.add_argument("--salida", default="flyflix_scraped.json")
    args = ap.parse_args()

    cfg = cargar_config(args.config)
    workers = args.workers or cfg.get("workers", 10)
    check = cfg.get("verificar_urls", True) and not args.sin_verificar

    todos = cfg.get("servidores", [])
    if args.servidores:
        elegidos = {s.strip() for s in args.servidores.split(",")}
        servidores = [s for s in todos if s["nombre"] in elegidos]
        if not servidores:
            sys.exit(f"Ningún servidor coincide: {elegidos}")
    else:
        servidores = [s for s in todos if s.get("activo", True)]
    print(f"✔ Servidores activos: {', '.join(s['nombre'] for s in servidores)}")

    items = []
    api_key = (args.tmdb_key or cfg.get("tmdb_api_key")
               or os.environ.get("TMDB_API_KEY", ""))
    if args.flyflix or (args.auto and args.fuente == "flyflix"):
        print("▶ Extrayendo catálogo completo de flyflix.net...")
        items = obtener_catalogo_flyflix()
        print(f"✔ {len(items)} títulos del catálogo flyflix")
    elif args.auto:
        if not api_key:
            sys.exit("Modo --auto requiere TMDB_API_KEY (secret de GitHub o --tmdb-key)")
        print(f"▶ Obteniendo catálogo TMDB paginado (top {args.auto} de cada tipo)...")
        items = obtener_catalogo_tmdb(api_key, args.auto)
        print(f"✔ {len(items)} títulos únicos del catálogo TMDB")
    elif args.archivo:
        items = leer_archivo(args.archivo)
    elif args.id:
        items = [{"tipo": args.tipo, "id": args.id,
                  "season": args.t, "episode": args.e, "origen": "CLI"}]
    elif args.titulo:
        items = [{"tipo": args.tipo, "titulo": args.titulo,
                  "season": args.t, "episode": args.e, "origen": "CLI"}]
    else:
        ap.error("usa --id, --titulo, --archivo, --flyflix o --auto")

    for it in items:
        if "titulo" in it:
            tid, nombre = resolver_tmdb(it["titulo"], it["tipo"], api_key)
            it["id"] = tid
            it["nombre"] = nombre
            print(f"✔ '{it['titulo']}' → {nombre} (ID {tid})")

    print(f"▶ Procesando {len(items)} ítem(s) con {workers} workers "
          f"({'con' if check else 'sin'} verificación HTTP)...")
    resultados = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futuros = {ex.submit(procesar_item, it, servidores, cfg, check): it
                   for it in items}
        for fut in as_completed(futuros):
            r = fut.result()
            resultados.append(r)
            ok = sum(1 for u in r["servers"]
                     if not check or (u.get("http_status") or 0) < 400)
            print(f"  [{r['tipo']}] ID {r['id']}: {ok}/{len(r['servers'])} servidores OK")

    resultados.sort(key=lambda r: r.get("origen", ""))
    out = Path(args.salida)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(resultados, indent=2, ensure_ascii=False),
                   encoding="utf-8")

    csv_path = out.with_suffix(".csv")
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["tipo", "tmdb_id", "temporada", "episodio", "servidor",
                    "url", "http_status", "verificado"])
        for r in resultados:
            for u in r["servers"]:
                w.writerow([r["tipo"], r["id"], r.get("season", ""),
                            r.get("episode", ""), u["servidor"], u["url"],
                            u.get("http_status", ""), u["verificado_por_nosotros"]])

    print(f"\n✔ JSON: {out.resolve()}")
    print(f"✔ CSV : {csv_path.resolve()}")


if __name__ == "__main__":
    main()
