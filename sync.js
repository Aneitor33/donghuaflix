import {syncAll} from './scraper.js';
const db=await syncAll({onProgress:m=>console.log(m)});console.log(`OK: ${db.series.length} series · ${db.seasons.length} temporadas · ${db.episodes.length} episodios · ${db.movies.length} películas`);
