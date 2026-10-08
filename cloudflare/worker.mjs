import { DurableObject } from 'cloudflare:workers';
import { PCMDatabase, InputError } from './core.mjs';
import { authorize } from './auth.mjs';
// Text modules keep the small interface and API in the same authenticated deployment.
import html from '../public/index.html';
import javascript from '../public/app.js';
import excelJavascript from '../public/excel-export.js';
import ordersImportJavascript from '../public/orders-import.js';
import sparePartsJavascript from '../public/spare-parts.js';
import sparePartsImportJavascript from '../public/spare-parts-import.js';
import css from '../public/style.css';
import kpiTeamCss from '../public/kpi-team.css';

export class PCMWorkspace extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.db = new PCMDatabase(ctx.storage.sql, callback => ctx.storage.transactionSync(callback));
    ctx.blockConcurrencyWhile(async () => { this.db.initialize(); });
  }
  execute(method, route, payload) {
    try { return { status:200,body:this.db.handle(method,route,payload) }; }
    catch (error) {
      if (error instanceof InputError) return { status:error.status,body:{ error:error.message } };
      throw error;
    }
  }
}

const headers = {
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'same-origin',
  'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};
const json = (body, status = 200) => Response.json(body, { status,headers });
async function boundedJson(request) {
  const limit = 5000000;
  if (Number(request.headers.get('Content-Length')) > limit) throw new InputError('Arquivo excede 5 MB.',413);
  if (!request.body) return {};
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done,value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new InputError('Arquivo excede 5 MB.',413); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part,offset); offset += part.length; }
  try { return size ? JSON.parse(new TextDecoder().decode(bytes)) : {}; }
  catch { throw new InputError('JSON inválido.'); }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      const identity = await authorize(request,env,undefined,ctx?.access);
      if (!identity) return json({ error:'Entre com sua conta autorizada pelo Cloudflare Access.' },401);
      if (url.pathname.startsWith('/api/')) {
        if (!['GET','POST','PUT','DELETE'].includes(request.method)) return json({ error:'Método não permitido.' },405);
        let payload = {};
        if (request.method !== 'GET') {
          const origin = request.headers.get('Origin');
          if ((origin && origin !== url.origin) || request.headers.get('X-PCM-Client') !== 'local') return json({ error:'Origem ou cliente não autorizado.' },403);
          if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json({ error:'Envie dados em JSON.' },415);
          payload = await boundedJson(request);
        }
        // Stable workspace ID: the database survives deploys and changes to login details.
        const workspace = env.PCM_WORKSPACE.getByName(env.WORKSPACE_ID);
        const result = await workspace.execute(request.method,url.pathname + url.search,payload);
        return json(result.body,result.status);
      }
      if (!['GET','HEAD'].includes(request.method)) return json({ error:'Método não permitido.' },405);
      const assets = { '/':[html,'text/html'], '/index.html':[html,'text/html'], '/app.js':[javascript,'application/javascript'], '/excel-export.js':[excelJavascript,'application/javascript'], '/orders-import.js':[ordersImportJavascript,'application/javascript'], '/spare-parts.js':[sparePartsJavascript,'application/javascript'], '/spare-parts-import.js':[sparePartsImportJavascript,'application/javascript'], '/style.css':[css,'text/css'], '/kpi-team.css':[kpiTeamCss,'text/css'] };
      if (!Object.hasOwn(assets,url.pathname)) return json({ error:'Não encontrado.' },404);
      const [body,type] = assets[url.pathname];
      return new Response(request.method === 'HEAD' ? null : body,{ headers:{ ...headers,'Content-Type':type + '; charset=utf-8' } });
    } catch (error) {
      if (error instanceof InputError) return json({ error:error.message },error.status);
      console.error(JSON.stringify({ event:'pcm_request_failed',method:request.method,path:url.pathname,error:error.name }));
      return json({ error:'Erro interno. Tente novamente.' },500);
    }
  }
};
