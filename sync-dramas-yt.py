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
    {"name": "WeTV Spanish",             "handle": "@WeTVSpanish",          "filter": True},
    {"name": "iQIYI Spanish",            "handle": "@iQIYISpanish",         "filter": True},
    {"name": "Huace Croton TV Español",  "handle": "@HuaceCrotonTVEspanol", "filter": True},
    {"name": "YOUKU Spanish",            "handle": "@YOUKUSpanish",         "filter": True},
    {"name": "MangoTV Spanish",          "handle": "@MangoTVSpanish",       "filter": True},
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
    r"bienvenid|presentaci|lo mejor|top\s*\d", re.I)
# Frases de marketing dentro de los títulos
MARKETING_RX = re.compile(
    r"\b(todos los (episodios|cap[ií]tulos)|episodios?\s+completos?|"
    r"serie completa|temporada completa|completas?|en espa[ñn]ol|sub espa[ñn]ol|"
    r"subtitulad[oa]|audio latino|latino|castellano|full hd|hd|4k|"
    r"nueva temporada)\b", re.I)
# Emojis y símbolos decorativos
EMOJI_RX = re.compile(
    "[\U0001F000-\U0001FAFF\U00002700-\U000027BF\U000024C2-\U0001F251"
    "\u200d\ufe0f\u2190-\u21FF\u2B00-\u2BFF\uFE00-\uFE0F]+")
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


def slugify(title: str) -> str:
    s = title.lower().strip()
    s = re.sub(r"[^a-z0-9áéíóúñü]+", "-", s)
    s = re.sub(r"[áéíóú]", lambda m: "aeiou"["áéíóú".index(m.group())], s)
    s = s.replace("ñ", "n").replace("ü", "u")
    return s.strip("-")


def clean_title(t: str) -> str:
    """Quita etiquetas de idioma y promo: 【SUB ESPAÑOL】, [Doblado ESP], ESPSUB..."""
    t = re.sub(r"【[^】]*】", " ", t or "")
    # 《...》: conserva el contenido si es latino (título oficial), lo borra si es CJK
    t = re.sub(r"《([^》]*)》",
               lambda m: (" " if re.search(r"[\u3400-\u4dbf\u4e00-\u9fff]", m.group(1))
                          else f" {m.group(1)} "), t or "")
    t = re.sub(r"\[([^\]]{0,50})\]",
               lambda m: " " if SPANISH_RX.search(m.group(1)) else m.group(0), t)
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


def run_ytdlp(url: str):
    """Ejecuta yt-dlp en modo JSON. None si falla."""
    try:
        r = subprocess.run(
            ["yt-dlp", "-J", "--flat-playlist", "--no-warnings",
             "--ignore-errors", "--socket-timeout", "20", url],
            capture_output=True, text=True, timeout=180)
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


def build_episode_pairs(entries):
    """[(número, video_id)] ordenado: por número parseado del título cuando TODOS
    lo tienen y son únicos (corrige playlists subidas en orden inverso); si no,
    numeración secuencial 1..N respetando el orden de la playlist."""
    parsed = [(parse_ep_number(e.get("title") or ""), e["id"]) for e in entries]
    nums = [n for n, _ in parsed]
    if all(n is not None for n in nums) and len(set(nums)) == len(nums):
        return sorted(parsed, key=lambda x: x[0])
    return [(i + 1, vid) for i, (_n, vid) in enumerate(parsed)]


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
    poster = best_thumb(first_id)
    slug = slugify(title)
    year = None
    genres_kws = infer_genres(title, synopsis)

    # Enriquecimiento TMDB: géneros oficiales (es-ES) + sinopsis/poster/año verificados.
    # Cultivo/Artes Marciales por keywords siempre se añaden (TMDB no tiene esos géneros).
    if _tmdb_key:
        tmdb_data = tmdb_enrich(title, st.setdefault("tmdb_cache", {}))
        if tmdb_data:
            official = list(tmdb_data.get("genres") or [])
            for g in ("Cultivo", "Artes Marciales"):
                if g in genres_kws and g not in official:
                    official.append(g)
            genres_kws = official
            if len(tmdb_data.get("overview") or "") > len(synopsis or ""):
                synopsis = tmdb_data["overview"][:600]
            if tmdb_data.get("poster"):
                poster = tmdb_data["poster"]
            year = tmdb_data.get("year")
            # El título CANÓNICO es el de TMDB (español, limpio); el de YouTube
            # solo es un fallback. Esto arregla de raíz los títulos sucios.
            if tmdb_data.get("title"):
                title = tmdb_data["title"]
                slug = slugify(title)

    detail = build_detail(slug, title, poster, synopsis, pl["url"], eps, ch["name"])
    (DETAILS_DIR / f"{slug}.json").write_text(
        json.dumps(detail, ensure_ascii=False), encoding="utf-8")

    with _progress_lock:
        _progress["hits"] += 1
        hits = _progress["hits"]
    print(f"[{n_done}/{total}] {title} -> {len(eps)} episodios "
          f"({ch['name']}) [{hits} series]", flush=True)

    return {"i": slug, "s": slug, "t": title, "p": poster,
            "g_names": genres_kws,
            "st": "En Emisión", "ty": "drama", "y": year,
            "e": len(eps), "pl": 1, "u": datetime.now(timezone.utc).isoformat()}


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

    save_state(st)
    write_outputs(list(by_slug.values()), t0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
