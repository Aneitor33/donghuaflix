import fs from 'node:fs/promises';
import path from 'node:path';
export const DATA_DIR=path.resolve('data');
export const DB_FILE=path.join(DATA_DIR,'db.json');
export const emptyDb=()=>({meta:{version:2,source:'https://donghualife.com/',syncedAt:null,lastSync:{status:'never',startedAt:null,finishedAt:null,error:null}},series:[],seasons:[],episodes:[],movies:[],genres:[]});
export async function loadDb(){try{return JSON.parse(await fs.readFile(DB_FILE,'utf8'))}catch{const db=emptyDb();await saveDb(db);return db}}
export async function saveDb(db){await fs.mkdir(DATA_DIR,{recursive:true});const tmp=DB_FILE+'.tmp';await fs.writeFile(tmp,JSON.stringify(db,null,2));await fs.rename(tmp,DB_FILE)}
export function upsert(arr,item,key='id'){const i=arr.findIndex(x=>x[key]===item[key]);if(i<0)arr.push(item);else arr[i]={...arr[i],...item};}
