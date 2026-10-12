#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Flyflix Tester — captura servidores de video, iframes, m3u8/mp4 y
estructura de temporadas/episodios de flyflix.net

Uso:
    pip install playwright && playwright install chromium
    python flyflix_tester.py
    python flyflix_tester.py --headless        # modo sin ventana (puede fallar Cloudflare)
    python flyflix_tester.py --url https://flyflix.net/watch/969681
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Casos de prueba reales extraídos del sitemap de flyflix.net
# ---------------------------------------------------------------------------
TEST_CASES = [
    {
        "tipo": "movie",
        "nombre": "Spider-Man: Brand New Day",
        "url": "https://flyflix.net/watch/969681",
        "tmdb_id": 969681,
    },
    {
        "tipo": "tv",
        "nombre": "Carrie (serie)",
        "url": "https://flyflix.net/watch/288673-tv",
        "tmdb_id": 288673,
        # temporada/episodio a seleccionar durante el test
        "season": 1,
        "episode": 1,
    },
]

VIDEO_HINTS = re.compile(
    r"(embed|iframe|player|m3u8|\.mp4|\.mkv|vidsrc|vidlink|vidmoly|"
    r"streamtape|dood|mixdrop|filemoon|autoembed|moviesapi|smashy)",
    re.IGNORECASE,
)


def sniff_factory(hits: set):
    """Intercepta todo el tráfico y guarda URLs que huelan a video."""
    def _handler(route):
        url = route.request.url
        if VIDEO_HINTS.search(url) and "flyflix.net" not in url:
            hits.add(url)
        route.continue_()
    return _handler


def extraer_temporadas_episodios(page):
    """Intenta leer del DOM los selectores/botones de season/episode."""
    data = {"seasons": [], "episodes": [], "season_seleccionada": None,
            "episode_seleccionado": None}

    # 1) <select> de temporadas
    try:
        for sel in page.locator("select").all():
            name = (sel.get_attribute("name") or "").lower()
            aria = (sel.get_attribute("aria-label") or "").lower()
            if "season" in name or "season" in aria or "temporada" in aria:
                opts = [(o.get_attribute("value"), o.inner_text().strip())
                        for o in sel.locator("option").all()]
                data["seasons"] = [{"value": v, "texto": t} for v, t in opts]
    except Exception:
        pass

    # 2) Botones/enlaces con patrón SxxEyy o "Episode N"
    try:
        pat = re.compile(r"(s\d{1,2}\s*e\d{1,3}|episode\s*\d+|ep\.?\s*\d+)", re.I)
        for el in page.locator("a, button, li, div[role='button']").all():
            try:
                txt = (el.inner_text() or "").strip()
            except Exception:
                continue
            if pat.search(txt) and len(txt) < 60:
                data["episodes"].append(txt)
        data["episodes"] = sorted(set(data["episodes"]))[:60]
    except Exception:
        pass

    # 3) URLs internas que mencionen season/episode (rutas tipo ?s=1&e=3)
    try:
        for fr in page.frames:
            m = re.search(r"[?&](s(eason)?=(\d+)).*?[?&]e(pisode)?=(\d+)", fr.url)
            if m:
                data["season_seleccionada"] = int(m.group(3))
                data["episode_seleccionado"] = int(m.group(5))
    except Exception:
        pass

    return data


def probar_caso(browser, caso, headless, espera_ms=9000):
    print(f"\n{'='*70}\n[TEST] {caso['tipo'].upper()} — {caso['nombre']}\n       {caso['url']}\n{'='*70}")

    context = browser.new_context(
        viewport={"width": 1366, "height": 900},
        user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36"),
        locale="es-ES",
    )
    page = context.new_page()

    hits = set()
    page.route("**/*", sniff_factory(hits))
    page.on("frameattached",
            lambda f: hits.add(f.url) if str(f.url).startswith("http") else None)

    resultado = {"caso": caso, "timestamp": datetime.now(timezone.utc).isoformat(),
                 "ok": False, "servers": [], "iframes": [], "red_video": [],
                 "temporadas_episodios": {}, "errores": []}

    try:
        page.goto(caso["url"], wait_until="domcontentloaded", timeout=60000)

        # Esperar a que el player aparezca (iframe, video o botón play)
        try:
            page.wait_for_selector(
                "iframe, video, [class*='player'], [id*='player'], button:has-text('Play')",
                timeout=25000,
            )
        except Exception:
            resultado["errores"].append(
                "Player no visible en 25s (¿Cloudflare challenge o sitio caído?)")

        page.wait_for_timeout(espera_ms)

        # Para series: intentar seleccionar temporada/episodio de prueba
        if caso["tipo"] == "tv" and caso.get("season"):
            seleccionar_episodio(page, caso, hits, resultado)

        # Recolectar iframes del DOM
        for fr in page.frames:
            u = str(fr.url)
            if u.startswith("http") and "flyflix" not in u:
                resultado["iframes"].append(u)

        resultado["red_video"] = sorted(hits)
        resultado["servers"] = sorted({
            re.sub(r"^(https?://[^/]+).*", r"\1", u) for u in hits
        })
        resultado["temporadas_episodios"] = extraer_temporadas_episodios(page)
        resultado["ok"] = bool(resultado["iframes"] or resultado["red_video"])

        page.screenshot(path=f"shot_{caso['tipo']}_{caso['tmdb_id']}.png",
                        full_page=False)

    except Exception as e:
        resultado["errores"].append(f"{type(e).__name__}: {e}")
    finally:
        context.close()

    # Resumen en consola
    print(f"  Servidores detectados : {len(resultado['servers'])}")
    for s in resultado["servers"]:
        print(f"    - {s}")
    print(f"  Iframes               : {len(resultado['iframes'])}")
    for u in resultado["iframes"][:10]:
        print(f"    - {u}")
    print(f"  Peticiones de video   : {len(resultado['red_video'])}")
    for u in resultado["red_video"][:10]:
        print(f"    - {u}")
    if caso["tipo"] == "tv":
        te = resultado["temporadas_episodios"]
        print(f"  Temporadas            : {len(te['seasons'])} | Episodios listados: {len(te['episodes'])}")
        print(f"  Selección detectada   : S{te['season_seleccionada']}E{te['episode_seleccionado']}")
    if resultado["errores"]:
        print("  Errores:")
        for e in resultado["errores"]:
            print(f"    ! {e}")
    return resultado


def seleccionar_episodio(page, caso, hits, resultado):
    s, e = caso["season"], caso.get("episode", 1)
    print(f"\n  >> Intentando seleccionar temporada {s}, episodio {e}...")

    # Estrategia A: select de temporada
    try:
        selects = page.locator("select")
        for i in range(selects.count()):
            sel = selects.nth(i)
            if "season" in ((sel.get_attribute("aria-label") or "") +
                            (sel.get_attribute("name") or "")).lower():
                sel.select_option(value=str(s), index=0, label=None) if False else None
                try:
                    sel.select_option(label=re.compile(str(s)))
                except Exception:
                    sel.select_option(index=s - 1)
                page.wait_for_timeout(2500)
                print("     ✔ Temporada cambiada vía <select>")
                break
    except Exception as ex:
        print(f"     (sin <select> de temporada: {type(ex).__name__})")

    # Estrategia B: click en botón/enlace del episodio
    try:
        target = page.get_by_role("button", name=re.compile(rf"^(E{e}\\b|Episode {e}\\b|0?{e}$)"), exact=False)
        if target.count() == 0:
            target = page.get_by_text(re.compile(rf"\\b(E{e}|Episode {e})\\b"), exact=False)
        if target.count() > 0:
            target.first.click()
            page.wait_for_timeout(4000)
            print(f"     ✔ Episodio {e} clickeado")
    except Exception as ex:
        print(f"     (click en episodio falló: {type(ex).__name__})")

    # Capturar la URL del iframe del player tras el cambio
    for fr in page.frames:
        u = str(fr.url)
        if u.startswith("http") and "flyflix" not in u:
            hits.add(u)


def main():
    ap = argparse.ArgumentParser(description="Tester de servidores flyflix.net")
    ap.add_argument("--headless", action="store_true",
                    help="sin ventana (puede bloquearlo Cloudflare)")
    ap.add_argument("--url", help="probar una sola URL en lugar de los casos por defecto")
    ap.add_argument("--espera", type=int, default=9000, help="ms de espera tras cargar")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    casos = TEST_CASES
    if args.url:
        m = re.search(r"/watch/(\d+)(-tv)?", args.url)
        casos = [{
            "tipo": "tv" if (m and m.group(2)) else "movie",
            "nombre": args.url,
            "url": args.url,
            "tmdb_id": int(m.group(1)) if m else 0,
            "season": 1, "episode": 1,
        }]

    resultados = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=args.headless,
            args=["--disable-blink-features=AutomationControlled"],
        )
        for caso in casos:
            resultados.append(probar_caso(browser, caso, args.headless, args.espera))
        browser.close()

    out = Path("flyflix_test_results.json")
    out.write_text(json.dumps(resultados, indent=2, ensure_ascii=False),
                   encoding="utf-8")
    print(f"\n{'='*70}\nResultados guardados en: {out.resolve()}")
    ok = sum(1 for r in resultados if r["ok"])
    print(f"Casos con video detectado: {ok}/{len(resultados)}")
    sys.exit(0 if ok == len(resultados) else 1)


if __name__ == "__main__":
    main()
