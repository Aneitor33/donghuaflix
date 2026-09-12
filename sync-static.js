import fs from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { SOURCE, fetchHtml, parseSeries, parseSeason, parseEpisode } from './scraper.js';

const clean = s => (s || '').replace(/\s+/g, ' ').trim();
const abs = (href, base = SOURCE) => { try { if (!href || /^javascript:|^mailto:/i.test(href)) return null; return new URL(href, base).href; } catch { return null; } };
const slug = url => { try { return new URL(url).pathname.split('/').filter(Boolean).pop() || ''; } catch { return ''; } };
const sourceUrl = u => new URL(u).origin + new URL(u).pathname;
const unique = a => [...new Set(a.filter(Boolean))];
const sameHost = (u, base) => { try { return new URL(u).hostname === new URL(base).hostname; } catch { return false; } };
const links = ($, selector, base) => unique($(selector).map((_, e) => { const h = abs($(e).attr('href'), base); return h && sameHost(h, base) ? sourceUrl(h) : null; }).get());

const db = { series: [], seasons: [], episodes: [], movies: [], genres: [], meta: { source: SOURCE } };
const upsert = (arr, item) => { const i = arr.findIndex(x => x.id === item.id); if (i >= 0) arr[i] = { ...arr[i], ...item }; else arr.push(item); };
const log = msg => console.log(`[sync] ${msg}`);

async function sync() {
  const seeds = [SOURCE, `${SOURCE}donghuas`, `${SOURCE}en-emision`, `${SOURCE}finalizado`, `${SOURCE}en-pausa`, `${SOURCE}movies`];
  const seriesUrls = new Set();
  const movieUrls = new Set();

  for (const seed of seeds) {
    try {
      const $ = cheerio.load(await fetchHtml(seed));
      links($, 'a[href*="/series/"]', seed).forEach(u => seriesUrls.add(u));
      links($, 'a[href*="/movies/"]', seed).forEach(u => movieUrls.add(u));
      links($, 'a[href*="/movie/"]', seed).forEach(u => movieUrls.add(u));
      log(`fuente OK: ${seed}`);
    } catch (e) { log(`fuente omitida: ${seed} · ${e.message}`); }
  }

  for (const url of seriesUrls) {
    try {
      const series = parseSeries(await fetchHtml(url), url);
      upsert(db.series, series);
      series.genres.forEach(g => { if (!db.genres.includes(g)) db.genres.push(g); });
      log(`serie: ${series.title}`);
      for (const seasonUrl of series.seasonUrls) {
        try {
          const season = parseSeason(await fetchHtml(seasonUrl), seasonUrl);
          season.seriesId = series.id;
          upsert(db.seasons, season);
          for (const epLink of season.episodeLinks) {
            try {
              const ep = parseEpisode(await fetchHtml(epLink.url), epLink.url);
              Object.assign(ep, { seriesId: series.id, seasonId: season.id, number: epLink.number, releaseDate: epLink.releaseDate });
              upsert(db.episodes, ep);
            } catch (e) { log(`episodio omitido: ${epLink.url} · ${e.message}`); }
          }
        } catch (e) { log(`temporada omitida: ${seasonUrl} · ${e.message}`); }
      }
    } catch (e) { log(`serie omitida: ${url} · ${e.message}`); }
  }

  for (const url of movieUrls) {
    try {
      const $ = cheerio.load(await fetchHtml(url));
      const title = clean($('h1').first().text() || $('title').text());
      const image = abs($('meta[property="og:image"]').attr('content') || $('img').first().attr('src'), url);
      upsert(db.movies, { id: slug(url), slug: slug(url), title, sourceUrl: url, image, updatedAt: new Date().toISOString() });
    } catch (e) { log(`película omitida: ${url} · ${e.message}`); }
  }

  db.genres.sort((a,b) => a.localeCompare(b, 'es'));
  db.series.sort((a,b) => String(a.title).localeCompare(String(b.title), 'es'));
  db.meta.syncedAt = new Date().toISOString();
  db.meta.counts = { series: db.series.length, seasons: db.seasons.length, episodes: db.episodes.length, movies: db.movies.length, genres: db.genres.length };
  
  // Guardado en la raíz del proyecto dentro de public/data/
  await fs.mkdir(new URL('./public/data/', import.meta.url), { recursive: true });
  await fs.writeFile(new URL('./public/data/catalog.json', import.meta.url), JSON.stringify(db, null, 2));
  log(`terminado: ${JSON.stringify(db.meta.counts)}`);
}

sync().catch(err => { console.error(err); process.exit(1); });
