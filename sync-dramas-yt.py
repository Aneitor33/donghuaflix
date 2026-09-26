#!/usr/bin/env python3
"""
sync-dramas-yt.py — Catálogo "DramasYT" para donghuaflix desde canales OFICIALES
de YouTube en español (WeTV, iQIYI, Huace, YOUKU, MangoTV).

QUÉ HACE:
  1. Lista las playlists (series) de cada canal.
  2. Filtra las que lleven marcador de español (【SUB ESPAÑOL】, Doblado ESP, ESPSUB...).
  3. Cada video de la playlist = un episodio, servido por el embed oficial de YouTube
     (funciona en el <iframe> de donghuaflix sin resolver ni anti-hotlink).
  4. Portada = miniatura oficial de YouTube (i.ytimg.com — la mejor que exista).
  5. Sinopsis = descripción del primer episodio, limpiada de promos/hashtags.

REQUISITO: yt-dlp (está en requirements.txt)

Uso:
    python sync-dramas-yt.py                  # sync incremental (retomable)
    python sync-dramas-yt.py --fresh          # de cero
    python sync-dramas-yt.py --max-series 20  # prueba
"""
import argparse
import json
import re
import subprocess
import sys
import threading
import time
import difflib
import os
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "public" / "data"
DETAILS_DIR = DATA_DIR / "catalog-dramasyt-details"
INDEX_OUT = DATA_DIR / "catalog-dramasyt-index.json"
DB_OUT = DATA_DIR / "catalog-dramasyt.json"
STATE_FILE = DATA_DIR / "catalog-dramasyt-state.json"

# ── Canales oficiales en español ─────────────────────────────────────
# filter=True → solo playlists cuyo título indique subs/doblaje en español.
CHANNELS = [
    {"name": "iQIYI Spanish", "handle": "@iQIYISpanish", "filter": True},
    {"name": "YOUKU Spanish", "handle": "@YOUKUSpanish", "filter": True},
]

SPANISH_RX = re.compile(
    r"sub\s*esp|espa[ñn]ol|doblado|latino|castellano|esp\s*sub|esp\]|"
    r"(?<![a-z])esp(?![a-z])", re.I)
TITLE_RANGE_RX = re.compile(
    r"[\s\|·\-]*(?:episodios?|eps?|caps?|cap[íi]tulos?)\.?\s*\d+\s*"
    r"(?:[-–]\s*\d+)?\s*(?:completos?|full)?[\s\|·\-]*$", re.I)
# rangos sueltos en CUALQUIER parte del título: "EP01-10", "Cap 1-40"...
RANGE_ANYWHERE_RX = re.compile(
    r"\s+(?:ep|eps|episodios?|caps?|cap[íi]tulos?)\.?\s*\d{1,4}\s*[-–]\s*\d{1,4}\b", re.I)
# rango huérfano al final tras quitar el CJK ("第1-40集" -> " 1-40")
ORPHAN_RANGE_RX = re.compile(r"\s+\d{1,4}\s*[-–]\s*\d{1,4}\s*$")
DROP_VIDEO_RX = re.compile(r"trailer|avance|teaser|promo|making|behind|recap", re.I)
# Playlists que NO son series (compilaciones de estrenos, clips, highlights)
PROMO_PL_RX = re.compile(
    r"estreno|próxim|proxim|novedad|trailer|promo|clip|momentos|highlights|recap|"
    r"escenas|recopilaci[oó]n|preview|extra\b|avance|behind|making|official|"
    r"resumen|recap|app ahora|obt[eé]n|descarga|bienvenid|presentaci|"
    r"lo mejor|top\s*\d", re.I)
# Frases de marketing dentro de los títulos
MARKETING_RX = re.compile(
    r"\b(todos los (episodios|cap[ií]tulos)|episodios?\s+completos?|"
    r"serie completa|temporada completa|complet[ao]s?|en espa[ñn]ol|sub espa[ñn]ol|"
    r"subtitulad[oa]|audio latino|latino|castellano|full hd|hd|4k|"
    r"nueva temporada)\b", re.I)
# Emojis y símbolos decorativos
EMOJI_RX = re.compile(
    "[\U0001F000-\U0001FAFF\U00002700-\U000027BF\U000024C2-\U0001F251"
    "\u200d\ufe0f\u2190-\u21FF\u2B00-\u2BFF\uFE00-\uFE0F]+")
# Filtro de nicho: SOLO wuxia/xianxia/cultivo/marcial/fantasía (nada de
# románticas modernas/urbanas). Se acepta si hay señales de nicho por
# palabras clave del título/sinopsis o por géneros TMDB de nicho.
NICHE_TMDB = {"Acción y Aventura", "Ciencia ficción y fantasía", "Guerra y Política"}
NICHE_RX = re.compile(
    r"cultivo|cultivador|inmortal|secta|xianxia|wuxia|jianghu|pugilista|"
    r"artes marciales|marcial|kung fu|shaolin|wushu|espada|sable|espadach[ií]n|"
    r"demonio|diablo|fantasma|esp[ií]ritu|monstruo|dios|diosa|deidad|celestial|"
    r"divin|magia|hechic|bruj|emperador|emperatriz|dinast[ií]a|palacio|realeza|"
    r"rey|reina|pr[ií]ncipe|princesa|consorte|concubina|imperial|general|"
    r"guerrer|asesin|venganza|templo|monje|tao[ií]smo|bud[io]smo", re.I)

SCAN_MIN_DUR = 900    # el sondeo de vídeos sueltos exige >15 min

MIN_DUR = 600         # segundos (10 min): por debajo = promo/clip/avance
MIN_EPISODES = 5    # mínimo de episodios para considerar una playlist una serie
CLIPS_PL_RATIO = 0.6  # si >60% de los videos con duración son cortos = playlist de clips
EP_RX = re.compile(
    r"(?:^|[\s\|·\-])(?:ep|eps|episode|episodio|cap[íi]tulo|cap)\s*\.?\s*0*(\d{1,4})",
    re.I)

_progress_lock = threading.Lock()
_progress = {"n": 0, "hits": 0}


# ── Enriquecimiento TMDB (opcional; --tmdb-key o env TMDB_API_KEY) ────
TMDB_IMG = "https://image.tmdb.org/t/p/w780"
_tmdb_key = None          # se fija en main()


def tmdb_get(path: str, **params):
    if not _tmdb_key:
        return None
    params["api_key"] = _tmdb_key
    url = ("https://api.themoviedb.org/3" + path + "?"
           + urllib.parse.urlencode(params))
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def norm_title(t: str) -> str:
    t = (t or "").lower()
    t = re.sub(r"[^a-z0-9áéíóúñü ]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def tmdb_enrich(title: str, cache: dict):
    """Busca la serie en TMDB (es-ES). Devuelve dict con genres/overview/poster/year
    o None si no hay match fiable. Resultados cacheados por título normalizado."""
    key = norm_title(title)
    if key in cache:
        return cache[key] or None
    out = None
    res = tmdb_get("/search/tv", query=title, language="es-ES", include_adult="false")
    if res and res.get("results"):
        nt = norm_title(title)
        best, best_ratio = None, 0.0
        for r in res["results"][:5]:
            for cand in (r.get("name"), r.get("original_name")):
                if not cand:
                    continue
                ratio = difflib.SequenceMatcher(None, nt, norm_title(cand)).ratio()
                if ratio > best_ratio:
                    best_ratio, best = ratio, r
        if best and best_ratio >= 0.45:
            det = tmdb_get(f"/tv/{best['id']}", language="es-ES")
            if det:
                out = {
                    "title": best.get("name") or best.get("original_name") or "",
                    "genres": [g["name"] for g in det.get("genres", [])],
                    "overview": (det.get("overview") or "").strip(),
                    "poster": (TMDB_IMG + det["poster_path"]) if det.get("poster_path") else None,
                    "year": (det.get("first_air_date") or "")[:4] or None,
                }
    cache[key] = out or {}
    return out


# Inferencia de género por palabras clave del título/sinopsis (heurística;
# editable: añade/quita reglas libremente). Una serie puede tener varios géneros.
GENRE_RULES = [
    (r"cultivo|cultivador|inmortal|ascensi[oó]n|secta|xianxia|tribulaci|nucleo dorado|qi\b", "Cultivo"),
    (r"wuxia|jianghu|pugilista|artes marciales|marcial|kung fu|shaolin|wushu|espada|sable|espadach[ií]n", "Artes Marciales"),
    (r"demonio|diablo|fantasma|esp[ií]ritu|monstruo|bestia|demon[ií]aco", "Fantasía"),
    (r"dios|diosa|deidad|celestial|divin|inmortalidad|dao\b", "Fantasía"),
    (r"magia|hechic|hechizo|bruj|encantam|hechicer", "Magia"),
    (r"emperador|emperatriz|dinast[ií]a|palacio|realeza|rey|reina|pr[ií]ncipe|princesa|consorte|concubina|imperial|general", "Histórico"),
    (r"romance|amor|amar|beso|matrimonio|casar|espos|novi|coraz[oó]n|amante", "Romance"),
    (r"asesin|venganza|vengar|traici[oó]n|justice|justicia", "Acción"),
    (r"guerr|batalla|ej[eé]rcito|soldado|campe[oó]n", "Acción"),
    (r"comed|divertid|humor|risa", "Comedia"),
    (r"ceo|empresa|oficina|moderno|urbano|contempor[aá]neo|ciudad", "Drama"),
    (r"detective|misterio|investig|crimen|criminal|sherlock", "Misterio"),
]


def infer_genres(title: str, synopsis: str = "") -> list:
    text = f"{title} {synopsis or ''}".lower()
    out = []
    for rx, g in GENRE_RULES:
        if re.search(rx, text, re.I) and g not in out:
            out.append(g)
    return out[:4]


NICHE_STRONG_RX = re.compile(
    r"cultivo|cultivador|inmortal|ascensi[oó]n|secta|xianxia|wuxia|jianghu|"
    r"pugilista|artes marciales|marcial|kung fu|shaolin|wushu|espadach[ií]n|"
    r"demonio|diablo|fantasma|hechic|bruj|magia|tribulaci|templo|monje|"
    r"emperador|emperatriz|dinast[ií]a|palacio|imperial|guerrer|asesin|venganza", re.I)


def is_niche(title: str, synopsis: str = "", tmdb_genres=None) -> bool:
    """¿Pertenece al nicho wuxia/xianxia/cultivo/fantasía?
    Solo keywords FUERTES (un 'príncipe' suelto en la sinopsis no basta)
    o géneros TMDB de nicho."""
    if set(tmdb_genres or []) & NICHE_TMDB:
        return True
    if NICHE_STRONG_RX.search(title or ""):
        return True
    return bool(NICHE_STRONG_RX.search(synopsis or ""))


def slugify(title: str) -> str:
    s = title.lower().strip()
    s = re.sub(r"[^a-z0-9áéíóúñü]+", "-", s)
    s = re.sub(r"[áéíóú]", lambda m: "aeiou"["áéíóú".index(m.group())], s)
    s = s.replace("ñ", "n").replace("ü", "u")
    return s.strip("-")


# Segmentos que NO aportan nombre de serie (separados por | en el título):
# marcadores de episodio, idioma, calidad, canal, actores, etc.
APP_PROMO_RX = re.compile(r"app\s*ahora|obt[eé]n|descarga", re.I)
# "Serie EP11 Título del capítulo ..." -> cortar TODO desde el EP: lo que sigue
# al número de episodio es el título del capítulo, no de la serie.
EP_CUT_RX = re.compile(
    r"(?:^|[\s|·\-])(?:ep|eps|cap|caps|episodio|episodios|cap[ií]tulo|cap[ií]tulos)"
    r"\s*#?\.?\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?", re.I)
GRATIS_RX = re.compile(r"\s+gratis\b.*$", re.I | re.S)

SEG_EP_RX = re.compile(
    r"(?:(?:ep|eps|episodio|episodios|cap|caps|cap[ií]tulo|cap[ií]tulos|parte?)"
    r"\.?\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?(?:\s*(?:completo?s?|full))?|"
    r"\d{1,4}\s*[-–]\s*\d{1,4}\s*(?:completo?s?|full)?|"
    r"(?:sub|subtitulad[oa]|doblado|dub|audio|multi)\s*"
    r"(?:esp|espa[ñn]ol|latino|castellano|sub)?|"
    r"espa[ñn]ol|latino|castellano|multi\s*sub|completo?s?|full|hd|4k|full\s*hd|"
    r"resumen|recap|official(?:\s+channel)?|trailer|avance|"
    r"obt[eé]n la app|descarga(?:r)?\s*(?:la)?\s*app|"
    r"season\s*\d{1,2}|temporada\s*\d{1,2}|"
    r"[A-ZÁÉÍÓÚÑ][\wáéíóúñü'\-]*(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñü'\-]*)*"
    r"(?:\s*(?:/|,)\s*[A-ZÁÉÍÓÚÑ][\wáéíóúñü'\-]*(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñü'\-]*)*)+|"
    r"(?:protagonistas?|cast|reparto|starring|con)\s*:.*|"
    r"(?:youku|wetv|iqiyi|mangotv|huace|croton|tencent|viki|yoyo|dramas\s*chinos)"
    r"(?:\s+(?:spanish|espa[ñn]ol|tv|channel|original|oficial))*)", re.I)


def clean_title(t: str) -> str:
    """Quita etiquetas de idioma y promo: 【SUB ESPAÑOL】, [Doblado ESP], ESPSUB..."""
    t = re.sub(r"【[^】]*】", " ", t or "")
    # 《...》: conserva el contenido si es latino (título oficial), lo borra si es CJK
    t = re.sub(r"《([^》]*)》",
               lambda m: (" " if re.search(r"[\u3400-\u4dbf\u4e00-\u9fff]", m.group(1))
                          else f" {m.group(1)} "), t)

    # Separar "][", "] Protagonistas:" -> para que el split por | los vea
    t = re.sub(r"\]\s*(?=\[|protagonistas?:|cast:|reparto:|starring:)", "] | ", t, flags=re.I)

    # Proteger corchetes (pueden contener |) con placeholders
    stash = []
    def _stash(m):
        stash.append(m.group(0))
        return f"\x00{len(stash) - 1}\x00"
    t = re.sub(r"\[[^\]]{0,160}\]", _stash, t)

    # LIMPIEZA POR SEGMENTOS: "Nombre | EP19 | Sub Español | YOUKU" -> solo el nombre.
    parts = re.split(r"[|｜•]", t)
    kept = []
    for pseg in parts:
        pseg = pseg.strip(" -·•\t")
        if not pseg:
            continue
        if "\x00" in pseg:
            # segmento con corchetes protegidos: JAMÁS tirar el placeholder
            # (es el título real); solo quitar marcadores sueltos junto a él
            pseg2 = re.sub(r"(?i)\s*\b(?:completo?s?|full|resumen|recap|hd|4k)\b\s*", " ", pseg)
            pseg2 = pseg2.strip(" -·•\t")
            if pseg2:
                kept.append(pseg2)
            continue
        if SEG_EP_RX.fullmatch(pseg):
            continue                                  # segmento puro marcador
        kept.append(pseg)
    if kept:
        t = " ".join(kept)

    # Restaurar corchetes, limpiando su interior de marcadores
    def _unstash(m):
        inner = stash[int(m.group(1))][1:-1]
        if SPANISH_RX.search(inner) or APP_PROMO_RX.search(inner):
            return " "
        inner = MARKETING_RX.sub(" ", inner)
        inner = SPANISH_RX.sub(" ", inner)
        inner = re.sub(r"(?i)\b(?:resumen|recap)\b", " ", inner)
        inner = re.sub(r"\s+", " ", inner).strip(" -|·•")
        return f" {inner} " if inner else " "
    t = re.sub(r"\x00(\d+)\x00", _unstash, t)
    def _bracket(m):
        inner = m.group(1)
        if SPANISH_RX.search(inner) or APP_PROMO_RX.search(inner):
            return " "
        inner = MARKETING_RX.sub(" ", inner)
        inner = SPANISH_RX.sub(" ", inner)
        inner = re.sub(r"\s+", " ", inner).strip(" -|·•")
        return f" {inner} " if inner else " "
    t = re.sub(r"\[([^\]]{0,80})\]", _bracket, t)
    # 0) Cortar en el primer marcador de episodio ("Serie EP11 Un amor..."
    #    -> "Serie"). Sin esto, cada episodio queda como serie distinta.
    m = EP_CUT_RX.search(t)
    if m:
        t = t[:m.start()]
    t = GRATIS_RX.sub("", t)

    # 1) frases de marketing ANTES que los marcadores sueltos (evita que
    #    "sub\s*esp" se coma medio "Español" dejando "añol")
    t = MARKETING_RX.sub(" ", t)
    t = SPANISH_RX.sub(" ", t)
    t = TITLE_RANGE_RX.sub("", t)
    t = EMOJI_RX.sub(" ", t)
    t = re.sub(r"\(\s*\)", " ", t)          # paréntesis vacíos tras quitar marcas
    # restos CJK sueltos ("多语言", "完整版"...): fuera
    t = re.sub(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+", " ", t)
    # 2) tras quitar CJK pueden quedar rangos huérfanos ("第1-40集" -> " 1-40")
    t = RANGE_ANYWHERE_RX.sub(" ", t)
    t = ORPHAN_RANGE_RX.sub("", t)
    t = TITLE_RANGE_RX.sub("", t)
    t = re.sub(r"\s+", " ", t)
    return t.strip(" -|·•")


def run_ytdlp(url: str, timeout: int = 180):
    """Ejecuta yt-dlp en modo JSON. None si falla."""
    try:
        r = subprocess.run(
            ["yt-dlp", "-J", "--flat-playlist", "--no-warnings",
             "--ignore-errors", "--socket-timeout", "20", url],
            capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0 or not r.stdout.strip():
            return None
        return json.loads(r.stdout)
    except Exception:
        return None


def run_ytdlp_video_desc(video_id: str) -> str:
    """Descripción completa de UN video (para la sinopsis)."""
    try:
        r = subprocess.run(
            ["yt-dlp", "-J", "--no-playlist", "--no-warnings",
             "--skip-download", "--socket-timeout", "20",
             f"https://www.youtube.com/watch?v={video_id}"],
            capture_output=True, text=True, timeout=120)
        if r.returncode != 0 or not r.stdout.strip():
            return ""
        return (json.loads(r.stdout).get("description") or "")
    except Exception:
        return ""


def clean_synopsis(desc: str) -> str:
    """Primera parte útil de la descripción: sin links, hashtags ni bloques promo."""
    if not desc:
        return ""
    out = []
    for line in desc.splitlines():
        line = line.strip()
        if not line:
            if out:
                break
            continue
        low = line.lower()
        if (line.startswith(("►", "▶", "#", "http")) or "http" in low
                or low.startswith(("subscribe", "suscríbete", "suscribete"))
                or len(line) < 25):
            if out:
                break
            continue
        out.append(line)
        if sum(len(x) for x in out) > 600:
            break
    return " ".join(out)[:600].strip()


POSTERS_DIR = ROOT / "public" / "img" / "posters-dramasyt"


def crop_2_3_box(w: int, h: int):
    """Caja de recorte centrada con proporción 2:3 (vertical, estilo póster)."""
    target = 2 / 3
    if w / h > target:          # demasiado ancha -> recortar lados
        nw = int(h * target)
        x = (w - nw) // 2
        return (x, 0, x + nw, h)
    nh = int(w / target)        # demasiado alta -> recortar arriba/abajo
    y = (h - nh) // 2
    return (0, y, w, y + nh)


def local_poster_from_yt(video_id: str, slug: str) -> str | None:
    """Descarga la mejor miniatura de YouTube y la recorta a vertical 2:3,
    guardada en ./public/img/posters-dramasyt/. None si falla."""
    try:
        from PIL import Image
        import io
        data = None
        for name in ("maxresdefault", "sddefault", "hqdefault"):
            u = f"https://i.ytimg.com/vi/{video_id}/{name}.jpg"
            try:
                req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=15) as r:
                    if r.status == 200:
                        data = r.read()
                        break
            except Exception:
                continue
        if not data:
            return None
        img = Image.open(io.BytesIO(data)).convert("RGB")
        img = img.crop(crop_2_3_box(*img.size))
        POSTERS_DIR.mkdir(parents=True, exist_ok=True)
        fp = POSTERS_DIR / f"{slug}.jpg"
        img.save(fp, "JPEG", quality=85)
        return f"./public/img/posters-dramasyt/{slug}.jpg"
    except Exception:
        return None


def best_thumb(video_id: str) -> str:
    """La mejor miniatura disponible del video (maxres → sd → hq)."""
    for name in ("maxresdefault", "sddefault", "hqdefault"):
        u = f"https://i.ytimg.com/vi/{video_id}/{name}.jpg"
        try:
            req = urllib.request.Request(u, method="HEAD",
                                         headers={"User-Agent": "Mozilla/5.0"})
            if urllib.request.urlopen(req, timeout=8).status == 200:
                return u
        except Exception:
            continue
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


def parse_ep_number(title: str):
    m = EP_RX.search(title or "")
    return int(m.group(1)) if m else None


def load_state(fresh: bool) -> dict:
    if STATE_FILE.exists():
        try:
            old = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            if isinstance(old, dict):
                if not fresh and "done" in old:
                    print(f"[state] retomando: {len(old['done'])} series ya hechas")
                    return old
                if fresh and old.get("tmdb_cache"):
                    # --fresh rehace el catálogo pero conserva la caché TMDB
                    return {"done": [], "entries": [], "tmdb_cache": old["tmdb_cache"]}
        except Exception:
            pass
    return {"done": [], "entries": []}


def save_state(st: dict) -> None:
    STATE_FILE.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")


def list_channel_playlists(handle: str):
    data = run_ytdlp(f"https://www.youtube.com/{handle}/playlists")
    if not data:
        return []
    out = []
    for e in (data.get("entries") or []):
        if not e:
            continue
        url = e.get("url") or ""
        if url and not url.startswith("http"):
            url = f"https://www.youtube.com/playlist?list={url}"
        out.append({"id": e.get("id") or url, "title": e.get("title") or "", "url": url})
    return out


def build_detail(slug, title, poster, synopsis, source_url, eps, ch_name):
    season_id = f"{slug}-s1"
    now = datetime.now(timezone.utc).isoformat()
    return {
        "series": {"id": slug, "slug": slug, "title": title, "image": poster or "",
                   "status": "En Emisión", "type": "drama", "synopsis": synopsis,
                   "updatedAt": now, "sourceUrl": source_url or "",
                   "channel": ch_name},
        "seasons": [{"id": season_id, "seriesId": slug, "number": 1, "title": "Temporada 1"}],
        "episodes": [
            {"id": f"{slug}-ep-{n}", "slug": f"{slug}-ep-{n}", "seriesId": slug,
             "seasonId": season_id, "number": n, "title": f"Episodio {n}",
             "servers": [{"name": "YouTube",
                          "url": f"https://www.youtube.com/embed/{vid}"}],
             "updatedAt": now}
            for n, vid in eps
        ],
    }


def upsert_series(slug, title, poster, synopsis, source_url, eps, ch_name):
    """Crea la ficha de una serie o FUSIONA sus episodios con la existente
    (uniendo por número y reordenando). Única vía de escritura: playlists
    duplicadas del mismo canal ya no se sobrescriben entre sí.
    Devuelve (entry | None, añadidos, total_episodios)."""
    fp = DETAILS_DIR / f"{slug}.json"
    now = datetime.now(timezone.utc).isoformat()

    if fp.exists():
        try:
            d = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            return None, 0, 0
        existing = {ep["number"] for ep in d.get("episodes", [])}
        season_id = (d.get("seasons") or [{}])[0].get("id", f"{slug}-s1")
        added = 0
        for n, vid in eps:
            if n in existing:
                continue
            d["episodes"].append({
                "id": f"{slug}-ep-{n}", "slug": f"{slug}-ep-{n}", "seriesId": slug,
                "seasonId": season_id, "number": n, "title": f"Episodio {n}",
                "servers": [{"name": "YouTube",
                             "url": f"https://www.youtube.com/embed/{vid}"}],
                "updatedAt": now})
            added += 1
        if added:
            d["episodes"].sort(key=lambda x: x["number"])
            fp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
        return None, added, len(d.get("episodes", []))

    if len(eps) < MIN_EPISODES:
        return None, 0, 0

    detail = build_detail(slug, title, poster, synopsis, source_url, eps, ch_name)
    fp.write_text(json.dumps(detail, ensure_ascii=False), encoding="utf-8")
    entry = {"i": slug, "s": slug, "t": title, "p": poster,
             "g_names": infer_genres(title, synopsis),
             "st": "En Emisión", "ty": "drama", "y": None,
             "e": len(eps), "pl": 1, "u": now}
    return entry, len(eps), len(eps)


def build_episode_pairs(entries):
    """[(número, video_id)] ordenado: por número parseado del título cuando TODOS
    lo tienen y son únicos (corrige playlists subidas en orden inverso); si no,
    numeración secuencial 1..N respetando el orden de la playlist."""
    parsed = [(parse_ep_number(e.get("title") or ""), e["id"]) for e in entries]
    nums = [n for n, _ in parsed]
    if all(n is not None for n in nums) and len(set(nums)) == len(nums):
        return sorted(parsed, key=lambda x: x[0])
    return [(i + 1, vid) for i, (_n, vid) in enumerate(parsed)]


SEASON_RX = re.compile(r"(?:season|temporada)\s*(\d{1,2})", re.I)


def series_base_from_video(title: str):
    """Nombre de serie + temporada extraídos del título de un video suelto."""
    season = 0
    m = SEASON_RX.search(title or "")
    if m:
        season = int(m.group(1))
    base = clean_title(title)
    base = re.sub(r"\s+(?:season|temporada)\s*\d{1,2}.*$", "", base, flags=re.I)
    return base.strip(" -|·•"), season


def norm_base(t: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (t or "").lower())


def scan_channel_videos(ch):
    """Tab 'Vídeos' del canal: videos >15 min, español, no promo.
    (flat; pagina TODO el canal -> timeout generoso)"""
    data = run_ytdlp(f"https://www.youtube.com/{ch['handle']}/videos", timeout=900)
    if not data:
        return []
    out = []
    for e in (data.get("entries") or []):
        if not e or not e.get("id"):
            continue
        title = e.get("title") or ""
        d = e.get("duration") or 0
        if d and d < SCAN_MIN_DUR:
            continue
        if DROP_VIDEO_RX.search(title) or PROMO_PL_RX.search(title):
            continue
        if ch["filter"] and not SPANISH_RX.search(title):
            continue
        out.append({"id": e["id"], "title": title, "duration": d})
    return out


def group_videos(videos):
    """Agrupa videos sueltos por (nombre base, temporada)."""
    groups = {}
    for v in videos:
        base, season = series_base_from_video(v["title"])
        if not base or len(base) < 3:
            continue
        key = (norm_base(base), season)
        g = groups.setdefault(key, {"base": base, "season": season, "vids": []})
        g["vids"].append(v)
    return list(groups.values())


def merge_scan_group(group, ch, st):
    """Enriquece con TMDB, aplica filtro de nicho y FUSIONA el grupo de videos
    sueltos con la ficha existente (o crea una nueva)."""
    base, season, vids = group["base"], group["season"], group["vids"]
    title = base
    synopsis = ""
    poster = None
    year = None
    tmdb_genres = None
    tmdb_data = tmdb_enrich(base, st.setdefault("tmdb_cache", {})) if _tmdb_key else None
    if tmdb_data:
        tmdb_genres = list(tmdb_data.get("genres") or [])
        if tmdb_data.get("title"):
            title = tmdb_data["title"]
        synopsis = (tmdb_data.get("overview") or "")[:600]
        poster = tmdb_data.get("poster")
        year = tmdb_data.get("year")
    if season and season >= 2 and not re.search(r"(?:season|temporada)\s*\d", title, re.I):
        title = f"{title} Season {season}"

    if not is_niche(title, synopsis or base, tmdb_genres):
        return None, slugify(title), 0, 0

    slug = slugify(title)
    eps = build_episode_pairs(vids)

    if not poster and vids:
        poster_local = local_poster_from_yt(vids[0]["id"], slug)
        poster = poster_local or best_thumb(vids[0]["id"])

    entry, added, total_eps = upsert_series(slug, title, poster, synopsis, "", eps, ch["name"])
    if entry is not None:
        genres_kws = infer_genres(title, synopsis)
        if tmdb_genres:
            for g in ("Cultivo", "Artes Marciales"):
                if g in genres_kws and g not in tmdb_genres:
                    tmdb_genres.append(g)
            genres_kws = tmdb_genres
        entry["g_names"] = genres_kws
        entry["y"] = year
    return entry, slug, added, total_eps


def process_playlist(pl, ch, total, st):
    pl_id = pl["id"]
    if pl_id in st["done"]:
        with _progress_lock:
            _progress["n"] += 1
        return "SKIP"
    data = run_ytdlp(pl["url"])
    with _progress_lock:
        _progress["n"] += 1
        n_done = _progress["n"]
    if not data:
        print(f"[{n_done}/{total}] {ch['name']}: {pl['title'][:60]} -> sin datos", flush=True)
        st["done"].append(pl_id)
        return None

    raw_title = data.get("title") or pl["title"] or ""
    if PROMO_PL_RX.search(raw_title or ""):
        st["done"].append(pl_id)
        return None
    if ch["filter"] and not SPANISH_RX.search(raw_title):
        st["done"].append(pl_id)
        return None

    entries = [e for e in (data.get("entries") or []) if e and e.get("id")]
    entries = [e for e in entries if not DROP_VIDEO_RX.search(e.get("title") or "")]

    # filtro por duración: cortos (<90s) = promos/clips; si casi todos son
    # cortos, la playlist entera es de clips -> descartar
    with_dur = [e for e in entries if (e.get("duration") or 0)]
    if len(with_dur) >= 2:
        short = [e for e in with_dur if e["duration"] < MIN_DUR]
        if len(short) > len(with_dur) * CLIPS_PL_RATIO:
            st["done"].append(pl_id)
            return None
    entries = [e for e in entries if not e.get("duration") or e["duration"] >= MIN_DUR]

    if len(entries) < MIN_EPISODES:
        st["done"].append(pl_id)
        return None

    title = clean_title(raw_title) or clean_title(entries[0].get("title") or "")
    if not title or len(title) < 3:
        st["done"].append(pl_id)
        return None

    eps = build_episode_pairs(entries)

    first_id = entries[0]["id"]
    synopsis = clean_synopsis(run_ytdlp_video_desc(first_id))
    poster = None                      # se decide en la cadena TMDB -> recorte local -> hotlink
    tmdb_genres = None
    slug = slugify(title)
    year = None
    genres_kws = infer_genres(title, synopsis)

    # Enriquecimiento TMDB: géneros oficiales (es-ES) + sinopsis/poster/año verificados.
    # Cultivo/Artes Marciales por keywords siempre se añaden (TMDB no tiene esos géneros).
    poster_local = None
    if _tmdb_key:
        tmdb_data = tmdb_enrich(title, st.setdefault("tmdb_cache", {}))
        if tmdb_data:
            official = list(tmdb_data.get("genres") or [])
            tmdb_genres = official
            for g in ("Cultivo", "Artes Marciales"):
                if g in genres_kws and g not in official:
                    official.append(g)
            genres_kws = official
            if len(tmdb_data.get("overview") or "") > len(synopsis or ""):
                synopsis = tmdb_data["overview"][:600]
            if tmdb_data.get("poster"):
                poster = tmdb_data["poster"]     # vertical 2:3 oficial de TMDB
            year = tmdb_data.get("year")
            # El título CANÓNICO es el de TMDB (español, limpio); el de YouTube
            # solo es un fallback. Esto arregla de raíz los títulos sucios.
            if tmdb_data.get("title"):
                title = tmdb_data["title"]
                slug = slugify(title)

    # Sin póster de TMDB: recortar la miniatura de YouTube a vertical 2:3
    # y guardarla local (si falla, último recurso = hotlink horizontal).
    if not poster:
        poster_local = local_poster_from_yt(first_id, slug)
        if poster_local:
            poster = poster_local
        else:
            poster = best_thumb(first_id)

    # FILTRO DE NICHO: fuera románticas/modernas/urbanas
    if not is_niche(title, synopsis, tmdb_genres):
        st["done"].append(pl_id)
        return None

    entry, added, total_eps = upsert_series(slug, title, poster, synopsis,
                                            pl["url"], eps, ch["name"])
    if entry is not None:
        entry["g_names"] = genres_kws
        entry["y"] = year

    with _progress_lock:
        _progress["hits"] += 1
        hits = _progress["hits"]
    print(f"[{n_done}/{total}] {title} -> {total_eps} episodios "
          f"(+{added}) ({ch['name']}) [{hits} series]", flush=True)

    bs = globals().get("_BY_SLUG")
    if entry is None and added and bs is not None and slug in bs:
        bs[slug]["e"] = total_eps
    return entry


def organize_catalog(by_slug: dict) -> int:
    """Pasada final: fusiona fichas/entradas que representan la MISMA serie
    (título normalizado igual, p.ej. detectada por playlist y por sondeo,
    o en playlists distintas del canal) uniendo episodios por número."""
    buckets = {}
    for slug in list(by_slug.keys()):
        fp = DETAILS_DIR / f"{slug}.json"
        try:
            d = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            continue
        key = norm_base((d.get("series") or {}).get("title", ""))
        if key:
            buckets.setdefault(key, []).append((slug, d))
    merged = 0
    for key, items in buckets.items():
        if len(items) < 2:
            continue
        items.sort(key=lambda x: (-len(x[1].get("episodes", [])),
                                  len((x[1].get("series") or {}).get("title", ""))))
        canon_slug, canon = items[0]
        eps = {ep["number"]: ep for ep in canon.get("episodes", [])}
        season_id = (canon.get("seasons") or [{}])[0].get("id", f"{canon_slug}-s1")
        added = 0
        for slug, d in items[1:]:
            for ep in d.get("episodes", []):
                n = ep.get("number")
                if n is None or n in eps:
                    continue
                ep = dict(ep)
                ep["seriesId"] = canon_slug
                ep["seasonId"] = season_id
                ep["id"] = f"{canon_slug}-ep-{n}"
                ep["slug"] = ep["id"]
                eps[n] = ep
                added += 1
            try:
                (DETAILS_DIR / f"{slug}.json").unlink()
            except Exception:
                pass
            by_slug.pop(slug, None)
            merged += 1
        canon["episodes"] = [eps[n] for n in sorted(eps)]
        (DETAILS_DIR / f"{canon_slug}.json").write_text(
            json.dumps(canon, ensure_ascii=False), encoding="utf-8")
        e = by_slug.get(canon_slug)
        if e:
            e["e"] = len(eps)
    return merged


def write_outputs(entries, t0):
    entries = sorted(entries, key=lambda x: x["t"].lower())
    # Géneros: nombres -> índices sobre la lista maestra (formato lite de la app)
    genres_master = []
    for e in entries:
        idx = []
        for name in e.pop("g_names", []) or []:
            if name not in genres_master:
                genres_master.append(name)
            idx.append(genres_master.index(name))
        e["g"] = idx
    total_eps = sum(e["e"] for e in entries)
    now = datetime.now(timezone.utc).isoformat()
    index = {"meta": {"source": "YouTube oficial (WeTV/iQIYI/Huace/YOUKU/MangoTV)",
                      "syncedAt": now, "series": len(entries), "episodes": total_eps,
                      "lite": True, "generatedAt": now},
             "lite": True, "compact": True,
             "detailsBase": "catalog-dramasyt-details",
             "genres": genres_master, "count": len(entries), "series": entries}
    INDEX_OUT.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    db = {"meta": {"version": 1, "source": "dramas-yt",
                   "syncedAt": now, "series": len(entries)},
          "series": entries, "seasons": [], "episodes": [], "genres": []}
    DB_OUT.write_text(json.dumps(db, ensure_ascii=False), encoding="utf-8")
    print(f"[ok] {len(entries)} series, {total_eps} episodios en {time.time() - t0:.0f}s")
    print(f"[ok] {INDEX_OUT}")
    print(f"[ok] {DETAILS_DIR}/")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--max-series", type=int, default=0)
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--skip-scan", action="store_true",
                    help="No sondear los videos sueltos de los canales (solo playlists)")
    ap.add_argument("--tmdb-key", default=os.environ.get("TMDB_API_KEY", ""),
                    help="API key de TMDB (o env TMDB_API_KEY). Activa géneros oficiales "
                         "en español + sinopsis/poster/año verificados.")
    args = ap.parse_args()

    global _tmdb_key
    _tmdb_key = (args.tmdb_key or "").strip() or None
    if _tmdb_key:
        print(f"[tmdb] enriquecimiento activo (key ...{_tmdb_key[-4:]})")

    t0 = time.time()
    DETAILS_DIR.mkdir(parents=True, exist_ok=True)
    st = load_state(args.fresh)

    tasks = []
    for ch in CHANNELS:
        pls = list_channel_playlists(ch["handle"])
        print(f"[channel] {ch['name']}: {len(pls)} playlists", flush=True)
        tasks += [(pl, ch) for pl in pls]

    if args.max_series and args.max_series > 0:
        tasks = tasks[:args.max_series]
    print(f"[start] {len(tasks)} playlists, workers={args.workers}", flush=True)

    by_slug: dict[str, dict] = {e["s"]: e for e in st["entries"]}
    globals()["_BY_SLUG"] = by_slug
    flush = {"i": 0}

    def stash(entry, pl_id):
        if entry:
            old = by_slug.get(entry["s"])
            if not old or old["e"] < entry["e"]:
                by_slug[entry["s"]] = entry
            st["entries"] = list(by_slug.values())
        if pl_id:
            st["done"].append(pl_id)
        flush["i"] += 1
        if flush["i"] % 10 == 0:
            save_state(st)

    total = len(tasks)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(process_playlist, pl, ch, total, st): (pl, ch) for pl, ch in tasks}
        for fut, (pl, ch) in futs.items():
            try:
                r = fut.result()
            except Exception as e:
                print(f"  [warn] error en {pl['title'][:50]}: {e}")
                continue
            if r == "SKIP":
                continue
            stash(r if r else None, pl["id"])

    # ── SONDE: vídeos sueltos del canal (>15 min) agrupados por serie ──
    # Captura series que los canales NO organizan en playlists.
    if not args.skip_scan:
        for ch in CHANNELS:
            vids = scan_channel_videos(ch)
            groups = group_videos(vids)
            print(f"[scan] {ch['name']}: {len(vids)} vídeos >15min -> "
                  f"{len(groups)} grupos", flush=True)
            with ThreadPoolExecutor(max_workers=args.workers) as pool:
                futs = {pool.submit(merge_scan_group, g, ch, st): g for g in groups}
                for fut, g in futs.items():
                    try:
                        entry, slug, added, total_eps = fut.result()
                    except Exception as e:
                        print(f"  [warn] scan {g['base'][:40]}: {e}", flush=True)
                        continue
                    if entry:
                        by_slug[entry["s"]] = entry
                    elif added and slug in by_slug:
                        by_slug[slug]["e"] = total_eps
        save_state(st)

    # Organización final: fusionar series duplicadas (playlist/sondeo/canales)
    merged = organize_catalog(by_slug)
    if merged:
        print(f"[org] {merged} fichas duplicadas fusionadas")

    save_state(st)
    write_outputs(list(by_slug.values()), t0)

    # Con --fresh: borrar fichas huérfanas (series que ya no están en el índice,
    # p.ej. entradas basura de runs anteriores tipo "X | Episodios 19 Completos").
    if args.fresh:
        keep = {e["s"] for e in by_slug.values()}
        removed = 0
        for fp in DETAILS_DIR.glob("*.json"):
            if fp.stem not in keep:
                fp.unlink()
                removed += 1
        if removed:
            print(f"[clean] {removed} fichas huérfanas eliminadas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
