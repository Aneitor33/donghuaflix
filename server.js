import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import cron from 'node-cron';
import {loadDb} from './db.js';
import {syncAll} from './scraper.js';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();const PORT=process.env.PORT||3000;const SYNC_TOKEN=process.env.SYNC_TOKEN||'';const CRON=process.env.SYNC_CRON||'0 */6 * * *';
app.use(express.json({limit:'100kb'}));app.use(express.static(path.resolve(__dirname,'../public')));
let syncing=false;
const authorize=(req,res)=>{if(!SYNC_TOKEN)return true;const supplied=req.headers.authorization?.replace(/^Bearer\s+/i,'')||req.query.token;if(supplied!==SYNC_TOKEN){res.status(401).json({error:'No autorizado'});return false}return true};
async function runSync(){if(syncing)return null;syncing=true;try{return await syncAll({onProgress:m=>console.log('[sync]',m)})}finally{syncing=false}}
app.get('/api/health',async(_req,res)=>{const db=await loadDb();res.json({ok:true,version:db.meta.version,syncedAt:db.meta.syncedAt,sync:db.meta.lastSync,counts:{series:db.series.length,seasons:db.seasons.length,episodes:db.episodes.length,movies:db.movies.length}})});
app.get('/api/catalog',async(_req,res)=>res.json(await loadDb()));
app.get('/api/search',async(req,res)=>{const q=String(req.query.q||'').trim().toLowerCase();const db=await loadDb();if(!q)return res.json([]);const out=db.series.filter(s=>[s.title,s.originalTitle,s.synopsis,...(s.genres||[])].join(' ').toLowerCase().includes(q)).slice(0,60);res.json(out)});
app.post('/api/sync',async(req,res)=>{if(!authorize(req,res))return;if(syncing)return res.status(409).json({error:'Ya hay una sincronización en curso'});try{const db=await runSync();res.json({ok:true,syncedAt:db.meta.syncedAt,counts:{series:db.series.length,seasons:db.seasons.length,episodes:db.episodes.length,movies:db.movies.length}})}catch(e){res.status(500).json({error:e.message})}});
cron.schedule(CRON,()=>{console.log('[cron] sincronización automática');runSync().catch(e=>console.error('[cron]',e.message))});
app.get('*',(_req,res)=>res.sendFile(path.resolve(__dirname,'../public/index.html')));
app.listen(PORT,()=>console.log(`DonghuaFlix en http://localhost:${PORT} · sync ${CRON}`));
