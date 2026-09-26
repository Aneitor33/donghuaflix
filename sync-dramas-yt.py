#!/usr/bin/env python3
"""
sync-dramasyt.py — Catálogo "DramasYT" SOLO desde el apartado SERIES de
https://www.youtube.com/@youkuspanish

FILOSOFÍA (simple, a prueba de líos):
  1. Solo el tab "Series" del canal (fallback: playlists). Nada de sondear
     vídeos sueltos ni otros canales.
  2. Nombre de la serie = título de la playlist limpio (sin "| YOUKU", sin
     marcadores). Si TMDB lo conoce, se usa el nombre oficial en español.
  3. Nº de episodio = el que pone el título del video (EP12, Capítulo1,
     Episodios 05, EP01-02 -> 1...). Sin número -> posición en la lista.
  4. EPISODIOS REPETIDOS -> se quitan (se guarda el primero). NADA se fusiona
     entre playlists: si dos playlists limpian al mismo nombre, la segunda
     se ignora entera.
  5. En la web, el título largo de YouTube NO se usa: serie = nombre limpio,
     episodio = "Episodio N".

Uso:
    python sync-dramas-yt.py                 # sync completo
    python sync-dramas-yt.py --fresh         # desde cero
    python sync-dramas-yt.py --max-series 5  # prueba
    python sync-dramas-yt.py --solo-nicho    # (opcional) solo wuxia/xianxia
"""
import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import threading
import time
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
POSTERS_DIR = ROOT / "public" / "img" / "posters-dramasyt"

CHANNEL_HANDLE = "@youkuspanish"
CHANNEL_NAME = "YOUKU Spanish"
MIN_EPISODES = 2          # el tab Series está curado por el canal; con 2 basta
MIN_DUR = 1200            # videos <20 min = promo/avance/clip (series Y películas)

# ── Títulos ──────────────────────────────────────────────────────────
EP_NUM_RX = re.compile(
    r"(?:ep|eps|episodio|episodios|cap|caps|cap[ií]tulo|cap[ií]tulos)"
    r"\s*#?\.?\s*(\d{1,4})(?:\s*[-–]\s*\d{1,4})?", re.I)
CH_TAG_RX = re.compile(
    r"(?:youku|iqiyi|wetv|mangotv|tencent|viki)(?:\s*(?:spanish|espa[ñn]ol|"
    r"tv|channel|original|oficial|internacional|premiere(?:\s+en\s+la?\s*app)?))?"
    r"(?:\s*-?\s*estreno\s+en\s+la\s*app)?$", re.I)
LEAD_MARKER_RX = re.compile(
    r"^(?:【[^】]*】|\[[^\]]{0,30}\]|\([^)]{0,30}\)|"
    r"(?:espsub|sub\s*esp(?:a[ñn]ol)?|subtitulad[oa]|doblado(?:\s+esp)?|"
    r"dub(?:\s+latino)?|audio\s+latino|multi\s*sub)\b)\s*[|\-–—:·]?\s*", re.I)
PLAYLIST_DROP_RX = re.compile(
    r"obt[eé]n\s+la\s+app|app\s+ahora|suscr[ií]bete|descarga(?:r)?\s+(?:la\s+)?app|"
    r"\bclip\b|shorts|tr[aá]iler|\bost\b|pel[ií]cula|mini\s*dramas|"
    r"momentos\s+destacados|versi[oó]n\s+pel[ií]cula|versiones\s+completas|"
    r"estreno\s+en\s+la\s+app|la\s+mejor\s+lista|lista\s+para\s+usted", re.I)

DROP_VIDEO_RX = re.compile(
    r"trailer|avance|teaser|promo|making|behind|recap|resumen|app\s*ahora|"
    r"obt[eé]n|descarga", re.I)
SPANISH_RX = re.compile(
    r"sub\s*esp|espa[ñn]ol|doblado|latino|castellano|esp\s*sub|esp\]|"
    r"(?<![a-z])esp(?![a-z])", re.I)
ACTOR_LIST_RX = re.compile(
    r"^[A-ZÁÉÍÓÚÑ][\wáéíóúñü'\-]*(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñü'\-]*)*"
    r"(?:\s*(?:/|,|，|×)\s*[A-ZÁÉÍÓÚÑ][\wáéíóúñü'\-]*(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñü'\-]*)*)+$")

# ── Nicho (opcional, --solo-nicho) ───────────────────────────────────
NICHE_TMDB = {"Acción y Aventura", "Ciencia ficción y fantasía", "Guerra y Política"}
NICHE_STRONG_RX = re.compile(
    r"cultivo|cultivador|inmortal|ascensi[oó]n|secta|xianxia|wuxia|jianghu|"
    r"pugilista|artes marciales|marcial|kung fu|shaolin|wushu|espadach[ií]n|"
    r"demonio|diablo|fantasma|hechic|bruj|magia|tribulaci|templo|monje|"
    r"emperador|emperatriz|dinast[ií]a|palacio|imperial|guerrer|asesin|venganza", re.I)


def is_niche(title, synopsis="", tmdb_genres=None):
    if set(tmdb_genres or []) & NICHE_TMDB:
        return True
    return bool(NICHE_STRONG_RX.search(f"{title} {synopsis or ''}"))


# ── Helpers ──────────────────────────────────────────────────────────
def slugify(title: str) -> str:
    s = title.lower().strip()
    s = re.sub(r"[^a-z0-9áéíóúñü]+", "-", s)
    s = re.sub(r"[áéíóú]", lambda m: "aeiou"["áéíóú".index(m.group())], s)
    s = s.replace("ñ", "n").replace("ü", "u")
    return s.strip("-")


def clean_series_name(t: str) -> str:
    """Nombre de serie desde el título de la playlist/video:
    sin marcadores, sin '| YOUKU', sin actores, sin géneros, sin EP."""
    t = urllib.parse.unquote(t or "")
    # nombre entre corchetes -> ESPSUB [Palabra de Honor] EP18 -> Palabra de Honor
    m = re.search(r"\[([^\]]{2,70})\]", t)
    if m and not SPANISH_RX.search(m.group(1)) and not re.search(r"\d", m.group(1)):
        return m.group(1).strip()
    # quitar marcadores iniciales: 【Doblado ESP】 / ESPSUB / [Sub Español] ...
    prev = None
    while prev != t:
        prev = t
        t = LEAD_MARKER_RX.sub("", t).strip()
    # cortar en el marcador de episodio (todo lo que sigue es título del capítulo)
    m = EP_NUM_RX.search(t)
    if m:
        t = t[:m.start()]
    # segmentos separados por | : quitar canal, actores, frases de género/idioma
    parts = [p.strip() for p in re.split(r"[|｜]", t) if p.strip()]
    kept = []
    for p in parts:
        if CH_TAG_RX.fullmatch(p):
            continue
        if ACTOR_LIST_RX.fullmatch(p):
            continue
        if SPANISH_RX.fullmatch(p) or DROP_VIDEO_RX.search(p):
            continue
        kept.append(p)
    t = " ".join(kept) if kept else t
    # quitar sufijos de género tipo "Drama de Wuxia con Traje Antiguo" al final
    t = re.sub(r"[\s\-|·]*(?:drama|wuxia|xianxia|traje antiguo|aventura|acci[oó]n|"
               r"fantas[ií]a|romance|misterio|suspenso|comed(?:ia|y))"
               r"(?:[\s/\-\|,]+(?:de|con|y|en)?[\s/\-\|,]*[a-záéíóúñü]+)*\s*$",
               "", t, flags=re.I).strip()
    t = re.sub(r"[\s\-|·]*suscr[ií]bete.*$", "", t, flags=re.I | re.S)
    t = re.sub(r"[《》]", " ", t)
    t = re.sub(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+", " ", t)
    t = re.sub(r"\s+", " ", t)
    return t.strip(" -|·•—–")


def parse_ep_number(title: str):
    m = EP_NUM_RX.search(title or "")
    return int(m.group(1)) if m else None


def run_ytdlp(url: str, timeout: int = 300):
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


def crop_2_3_box(w: int, h: int):
    target = 2 / 3
    if w / h > target:
        nw = int(h * target)
        x = (w - nw) // 2
        return (x, 0, x + nw, h)
    nh = int(w / target)
    y = (h - nh) // 2
    return (0, y, w, y + nh)


def local_poster_from_yt(video_id: str, slug: str):
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
    for name in ("maxresdefault", "sddefault", "hqdefault"):
        u = f"https://i.ytimg.com/vi/{video_id}/{name}.jpg"
        try:
            req = urllib.request.Request(u, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
            if urllib.request.urlopen(req, timeout=8).status == 200:
                return u
        except Exception:
            continue
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


# ── TMDB ─────────────────────────────────────────────────────────────
TMDB_IMG = "https://image.tmdb.org/t/p/w780"
_tmdb_key = None


def tmdb_get(path: str, **params):
    if not _tmdb_key:
        return None
    params["api_key"] = _tmdb_key
    url = "https://api.themoviedb.org/3" + path + "?" + urllib.parse.urlencode(params)
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
    key = norm_title(title)
    if key in cache:
        return cache[key] or None
    out = None
    res = tmdb_get("/search/tv", query=title, language="es-ES", include_adult="false")
    if res and res.get("results"):
        nt = norm_title(title)
        best, best_ratio = None, 0.0
        for r in res["results"][:5]:
            oc = r.get("origin_country") or []
            if oc and "CN" not in oc:
                continue          # no es un drama chino -> match falso (p.ej. "My Girl" USA)
            for cand in (r.get("name"), r.get("original_name")):
                if not cand:
                    continue
                ratio = difflib.SequenceMatcher(None, nt, norm_title(cand)).ratio()
                if ratio > best_ratio:
                    best_ratio, best = ratio, r
        if best and best_ratio >= 0.5:
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


# ── Estado ───────────────────────────────────────────────────────────
def load_state(fresh: bool) -> dict:
    if STATE_FILE.exists():
        try:
            old = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            if isinstance(old, dict):
                if not fresh and "done" in old:
                    print(f"[state] retomando: {len(old['done'])} playlists ya hechas")
                    return old
                # --fresh vacía también la caché de TMDB: los matches se recalculan
                # con las reglas nuevas (evita falsos positivos cacheados de runs viejos).
        except Exception:
            pass
    return {"done": [], "entries": []}


def save_state(st: dict) -> None:
    STATE_FILE.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")


# ── Procesado ────────────────────────────────────────────────────────
_lock = threading.Lock()
_prog = {"n": 0, "hits": 0}


def infer_genres(title: str, synopsis: str = "") -> list:
    text = f"{title} {synopsis or ''}".lower()
    out = []
    rules = [
        (r"cultivo|cultivador|inmortal|ascensi[oó]n|secta|xianxia|tribulaci", "Cultivo"),
        (r"wuxia|jianghu|pugilista|artes marciales|marcial|kung fu|shaolin|wushu|espada|sable|espadach[ií]n", "Artes Marciales"),
        (r"demonio|diablo|fantasma|esp[ií]ritu|monstruo|dios|diosa|deidad|celestial|divin|magia|hechic|bruj", "Fantasía"),
        (r"emperador|emperatriz|dinast[ií]a|palacio|realeza|consorte|concubina|imperial", "Histórico"),
        (r"romance|amor|amar|matrimonio|espos|amante", "Romance"),
        (r"asesin|venganza|vengar|guerr", "Acción"),
        (r"detective|misterio|investig|crimen|forense", "Misterio"),
        (r"comed|humor", "Comedia"),
    ]
    for rx, g in rules:
        if re.search(rx, text, re.I) and g not in out:
            out.append(g)
    return out[:4]


def build_detail(slug, title, poster, synopsis, source_url, eps, ch_name, year,
                 type_="drama", status="En Emisión"):
    season_id = f"{slug}-s1"
    now = datetime.now(timezone.utc).isoformat()
    return {
        "series": {"id": slug, "slug": slug, "title": title, "image": poster or "",
                   "status": status, "type": type_, "synopsis": synopsis,
                   "year": year, "updatedAt": now, "sourceUrl": source_url or "",
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


MOVIE_PL_RX = re.compile(r"pel[ií]cula", re.I)
MOVIE_PL_EXCLUDE_RX = re.compile(
    r"clip|tr[aá]iler|shorts|descarga|suscr[ií]bete|obt[eé]n\s+la\s+app|"
    r"momentos\s+destacados", re.I)
EMOJI_RX = re.compile(
    "[\U0001F000-\U0001FAFF\U00002700-\U000027BF\U000024C2-\U0001F251"
    "\u200d\ufe0f\u2190-\u21FF\u2B00-\u2BFF\uFE00-\uFE0F]+")
MOVIE_WORDS_RX = re.compile(
    r"(?i)\b(?:pel[ií]cula|complet[ao]s?|full\s*movie|movie|hd|4k|sub|subtitulad[ao]s?|"
    r"doblad[ao]s?|espa[ñn]ol(?:\s*latino)?|latino|castellano|audio\s*latino|"
    r"multi\s*sub|versi[oó]n|wuxia|xianxia|traje|antiguo)\b")


def clean_movie_title(t: str) -> str:
    """Nombre de película desde el título del video (sin marketing ni idiomas)."""
    t = urllib.parse.unquote(t or "")
    prev = None
    while prev != t:
        prev = t
        t = LEAD_MARKER_RX.sub("", t).strip()
    parts = [pp.strip() for pp in re.split(r"[|｜]", t) if pp.strip()]
    kept = []
    for pp in parts:
        if CH_TAG_RX.fullmatch(pp):
            continue
        if ACTOR_LIST_RX.fullmatch(pp):
            continue
        if DROP_VIDEO_RX.search(pp):
            continue
        kept.append(pp)
    t = " ".join(kept) if kept else t
    t = MOVIE_WORDS_RX.sub(" ", t)
    t = re.sub(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"
               r"\u3040-\u30ff\uac00-\ud7af]+", " ", t)
    t = EMOJI_RX.sub(" ", t)
    t = re.sub(r"\[\s*\]|\(\s*\)|【\s*】", " ", t)   # corchetes vacíos
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"(?:\s+(?:de|del|en|y|con|para|al))+\s*$", "", t, flags=re.I)  # conectores colgando
    return t.strip(" -|·•—–🎬")


def process_movie_playlist(data, pl, total, st):
    """Cada VIDEO de la playlist = UNA película: ficha propia, portada de YT,
    tipo 'movie', 1 episodio (la película entera). Repetidas -> fuera."""
    entries = [e for e in (data.get("entries") or []) if e and e.get("id")]
    entries = [e for e in entries if not DROP_VIDEO_RX.search(e.get("title") or "")]
    entries = [e for e in entries if not e.get("duration") or e["duration"] >= MIN_DUR]
    vcache = st.setdefault("vid_cache", {})
    added = 0
    for e in entries:
        title = clean_movie_title(e.get("title") or "")
        if not title or len(title) < 3:
            continue
        slug = slugify(title)
        fp = DETAILS_DIR / f"{slug}.json"
        if fp.exists() or any(x["s"] == slug for x in st["entries"]):
            continue                              # película repetida -> fuera
        vid = e["id"]
        if vid in vcache:
            synopsis = vcache[vid]
        else:
            synopsis = clean_synopsis(run_ytdlp_video_desc(vid))
            vcache[vid] = synopsis
        poster = local_poster_from_yt(vid, slug) or best_thumb(vid)
        detail = build_detail(slug, title, poster, synopsis, f"https://www.youtube.com/watch?v={vid}",
                              [(1, vid)], CHANNEL_NAME, None,
                              type_="movie", status="Finalizada")
        fp.write_text(json.dumps(detail, ensure_ascii=False), encoding="utf-8")
        st["entries"] = list({**{x["s"]: x for x in st["entries"]},
                              slug: {"i": slug, "s": slug, "t": title, "p": poster,
                                     "st": "Finalizada", "ty": "movie", "y": None,
                                     "e": 1, "pl": 1,
                                     "u": datetime.now(timezone.utc).isoformat()}}.values())
        added += 1
        with _lock:
            _prog["hits"] += 1
            hits = _prog["hits"]
        print(f"    🎬 {title} [{hits}]", flush=True)
    print(f"[playlist películas] {pl['title'][:50]} -> {added} películas añadidas "
          f"(de {len(entries)} videos)", flush=True)
    return "MOVIES"     # señal para no hacer stash de entry de serie


def process_playlist(pl, total, st, solo_nicho):
    pl_id = pl["id"]
    if pl_id in st["done"]:
        with _lock:
            _prog["n"] += 1
        return "SKIP"
    data = run_ytdlp(pl["url"])
    with _lock:
        _prog["n"] += 1
        n_done = _prog["n"]
    if not data:
        print(f"[{n_done}/{total}] {pl['title'][:60]} -> sin datos", flush=True)
        st["done"].append(pl_id)
        return None

    raw_name = data.get("title") or pl["title"] or ""
    if MOVIE_PL_RX.search(raw_name) and not MOVIE_PL_EXCLUDE_RX.search(raw_name):
        st["done"].append(pl_id)
        return process_movie_playlist(data, pl, total, st)   # cada video = 1 película
    if PLAYLIST_DROP_RX.search(raw_name):
        st["done"].append(pl_id)
        return None                      # promos/clips/compilaciones: fuera
    name = clean_series_name(raw_name)
    if not name or len(name) < 3 or PLAYLIST_DROP_RX.search(name):
        st["done"].append(pl_id)
        return None

    entries = [e for e in (data.get("entries") or []) if e and e.get("id")]
    entries = [e for e in entries if not DROP_VIDEO_RX.search(e.get("title") or "")]
    entries = [e for e in entries if not e.get("duration") or e["duration"] >= MIN_DUR]
    if len(entries) < MIN_EPISODES:
        st["done"].append(pl_id)
        return None

    # numeración: del título si lo tiene; si no, posición. REPETIDOS -> se quitan.
    seen: set[int] = set()
    eps: list[tuple[int, str]] = []
    pos = 0
    for e in entries:
        n = parse_ep_number(e.get("title") or "")
        if n is None:
            pos += 1
            n = pos
        if n in seen:
            continue                      # repetido -> fuera
        seen.add(n)
        eps.append((n, e["id"]))
    eps.sort(key=lambda x: x[0])
    if len(eps) < MIN_EPISODES:
        st["done"].append(pl_id)
        return None

    # TMDB: nombre oficial es-ES + poster + sinopsis + géneros + año.
    # IMPORTANTE: el slug se calcula SOLO desde el nombre limpio de YouTube;
    # TMDB nunca roba el slug (evita que un promo de 3 videos secuestre la
    # serie real, como pasó con "Moviendo los Hilos Ao Ruipeng Suscríbete").
    title, poster, synopsis, year = name, None, "", None
    tmdb_genres = None
    tmdb_data = tmdb_enrich(name, st.setdefault("tmdb_cache", {})) if _tmdb_key else None
    if tmdb_data:
        tmdb_genres = list(tmdb_data.get("genres") or [])
        if tmdb_data.get("title"):
            ratio = difflib.SequenceMatcher(
                None, norm_title(name), norm_title(tmdb_data["title"])).ratio()
            if ratio >= 0.7:
                title = tmdb_data["title"]     # nombre oficial SOLO si es el mismo título
        synopsis = (tmdb_data.get("overview") or "")[:600]
        poster = tmdb_data.get("poster")
        year = tmdb_data.get("year")
    if not synopsis and entries:
        synopsis = clean_synopsis(run_ytdlp_video_desc(entries[0]["id"]))
    if solo_nicho and not is_niche(title, synopsis, tmdb_genres):
        st["done"].append(pl_id)
        return None

    slug = slugify(title)
    if not poster and entries:
        poster = local_poster_from_yt(entries[0]["id"], slug) or best_thumb(entries[0]["id"])

    # NADA se fusiona: si la serie ya existe (mismo slug), se ignora esta playlist
    fp = DETAILS_DIR / f"{slug}.json"
    if fp.exists():
        print(f"[{n_done}/{total}] {title} -> YA EXISTE, playlist duplicada ignorada", flush=True)
        st["done"].append(pl_id)
        return None

    detail = build_detail(slug, title, poster, synopsis, pl["url"], eps, CHANNEL_NAME, year)
    fp.write_text(json.dumps(detail, ensure_ascii=False), encoding="utf-8")

    with _lock:
        _prog["hits"] += 1
        hits = _prog["hits"]
    print(f"[{n_done}/{total}] {title} -> {len(eps)} episodios [{hits} series]", flush=True)

    return {"i": slug, "s": slug, "t": title, "p": poster,
            "st": "En Emisión", "ty": "drama", "y": year,
            "e": len(eps), "pl": 1, "u": datetime.now(timezone.utc).isoformat()}


def list_channel_series():
    """Tab 'Series' del canal; fallback a 'playlists' si yt-dlp no lo soporta."""
    for tab in ("series", "playlists"):
        data = run_ytdlp(f"https://www.youtube.com/{CHANNEL_HANDLE}/{tab}", timeout=600)
        if not data:
            continue
        out = []
        for e in (data.get("entries") or []):
            if not e:
                continue
            url = e.get("url") or ""
            if url and not url.startswith("http"):
                url = f"https://www.youtube.com/playlist?list={url}"
            if url:
                out.append({"id": e.get("id") or url, "title": e.get("title") or "", "url": url})
        if out:
            print(f"[channel] tab /{tab}: {len(out)} playlists", flush=True)
            return out
    return []


def write_outputs(entries, t0):
    entries = sorted(entries, key=lambda x: x["t"].lower())
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
    index = {"meta": {"source": "YOUKU Spanish (Series)", "syncedAt": now,
                      "series": len(entries), "episodes": total_eps,
                      "lite": True, "generatedAt": now},
             "lite": True, "compact": True,
             "detailsBase": "catalog-dramasyt-details",
             "genres": genres_master, "count": len(entries), "series": entries}
    INDEX_OUT.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    db = {"meta": {"version": 2, "source": "dramasyt-youku-series",
                   "syncedAt": now, "series": len(entries)},
          "series": entries, "seasons": [], "episodes": [], "genres": []}
    DB_OUT.write_text(json.dumps(db, ensure_ascii=False), encoding="utf-8")
    print(f"[ok] {len(entries)} series, {total_eps} episodios en {time.time() - t0:.0f}s")
    print(f"[ok] {INDEX_OUT}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--max-series", type=int, default=0)
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--solo-nicho", action="store_true",
                    help="Solo wuxia/xianxia/cultivo (por defecto NO se filtra)")
    ap.add_argument("--tmdb-key", default=os.environ.get("TMDB_API_KEY", ""))
    args = ap.parse_args()

    global _tmdb_key
    _tmdb_key = (args.tmdb_key or "").strip() or None
    if _tmdb_key:
        print(f"[tmdb] enriquecimiento activo (key ...{_tmdb_key[-4:]})")

    t0 = time.time()
    DETAILS_DIR.mkdir(parents=True, exist_ok=True)
    st = load_state(args.fresh)

    # Precargar en el índice TODAS las fichas ya existentes en disco. Así lo que
    # este run se salte (YA EXISTE) sigue en el catálogo y la limpieza de --fresh
    # no lo borra. El índice = unión de (fichas en disco) + (lo procesado hoy).
    pre = 0
    for fpx in sorted(DETAILS_DIR.glob("*.json")):
        try:
            d = json.loads(fpx.read_text(encoding="utf-8"))
        except Exception:
            continue
        s = d.get("series") or {}
        slug = s.get("slug") or fpx.stem
        if any(x["s"] == slug for x in st["entries"]):
            continue
        typ = s.get("type") or "drama"
        st["entries"].append({
            "i": slug, "s": slug,
            "t": s.get("title") or slug,
            "p": s.get("image") or None,
            "st": s.get("status") or ("Finalizada" if typ == "movie" else "En Emisión"),
            "ty": typ, "y": s.get("year"),
            "e": len(d.get("episodes") or []), "pl": 1,
            "u": s.get("updatedAt") or datetime.now(timezone.utc).isoformat(),
        })
        pre += 1
    if pre:
        print(f"[state] {pre} fichas existentes precargadas en el índice", flush=True)

    playlists = list_channel_series()
    if not playlists:
        print("[error] no se pudo listar el apartado Series del canal")
        return 1
    if args.max_series and args.max_series > 0:
        playlists = playlists[:args.max_series]

    total = len(playlists)

    def stash(entry, pl_id):
        if entry:
            # FUSIONAR con lo existente (series y películas conviven en st["entries"]);
            # nunca sobreescribir: eso borraba las películas añadidas por su procesador.
            existing = {x["s"]: x for x in st["entries"]}
            existing[entry["s"]] = entry
            st["entries"] = list(existing.values())
        if pl_id:
            st["done"].append(pl_id)
        save_state(st)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(process_playlist, pl, total, st, args.solo_nicho): pl
                for pl in playlists}
        for fut, pl in futs.items():
            try:
                r = fut.result()
            except Exception as e:
                print(f"  [warn] {pl['title'][:50]}: {e}", flush=True)
                continue
            if r == "SKIP":
                continue
            if r == "MOVIES":
                st["done"].append(pl["id"])
                save_state(st)
                continue
            stash(r if r else None, pl["id"])

    save_state(st)
    by_slug = {e["s"]: e for e in st["entries"]}
    write_outputs(list(by_slug.values()), t0)

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
