// Exercise the actual compiled Worker and Durable Object in Cloudflare's local runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve('wrangler/package.json'))('miniflare');

test('Runtime Cloudflare: login obrigatório, interface, SQLite, concorrência e rollback',async () => {
  const {publicKey,privateKey} = await generateKeyPair('RS256');
  const key = await exportJWK(publicKey);
  key.kid = 'runtime-test';
  const issuer = 'https://test.cloudflareaccess.com';
  const email = 'owner@example.com';
  const token = await new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:key.kid}).setSubject('runtime-user').setIssuer(issuer).setAudience('runtime-test').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const script = readFileSync('dist/worker.js','utf8');
  const paths = [...script.matchAll(/from "\.\/([^"\n]+)"/g)].map(m=>m[1]);
  const modules = [{type:'ESModule',path:resolve('dist/worker.js')},...paths.map(p=>({type:'Text',path:resolve('dist',p)}))];
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules,compatibilityDate:'2026-10-04',compatibilityFlags:['nodejs_compat'],
    durableObjects:{PCM_WORKSPACE:{className:'PCMWorkspace',useSQLite:true}},
    bindings:{WORKSPACE_ID:'runtime-test',ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'runtime-test',ALLOWED_EMAIL:email},
    outboundService:async request => {
      assert.equal(request.url,issuer+'/cdn-cgi/access/certs');
      return Response.json({keys:[key]});
    }
  }));
  try {
    const call = async (path,method='GET',data,extra={}) => mf.dispatchFetch('https://pcm.example'+path,{
      method,headers:{'Cf-Access-Jwt-Assertion':token,'Content-Type':'application/json','X-PCM-Client':'local',...extra},body:data===undefined?undefined:JSON.stringify(data)
    });
    for(const path of ['/','/app.js','/excel-export.js','/api/state','/api/backup']) assert.equal((await mf.dispatchFetch('https://pcm.example'+path)).status,401);
    const excelAsset = await call('/excel-export.js');
    assert.equal(excelAsset.status,200);
    assert.match(await excelAsset.text(),/globalThis.PCMExcel/);
    const page = await call('/');
    assert.equal(page.status,200);
    assert.match(await page.text(),/Central de manutenção/);
    assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
    assert.equal((await call('/api/state','GET',undefined,{'Cf-Access-Jwt-Assertion':'fake'})).status,401);
    assert.equal((await call('/api/clear-demo','POST',{confirmation:'LIMPAR DEMONSTRAÇÃO'},{Origin:'https://evil.example'})).status,403);
    assert.equal((await call('/api/clear-demo','POST',{confirmation:'LIMPAR DEMONSTRAÇÃO'})).status,200);
    const technician = await (await call('/api/team','POST',{name:'Produtividade runtime',hours_day:8,productivity_rate:50})).json();
    assert.ok(technician.id);
    assert.equal((await (await call('/api/metrics?start=2026-10-01&end=2026-10-04')).json()).weekly_capacity,20);
    const productivityBackup = await (await call('/api/backup')).json();
    assert.equal(productivityBackup.data.team[0].productivity_rate,50);
    assert.equal((await call(`/api/team/${technician.id}`,'PUT',{...productivityBackup.data.team[0],productivity_rate:0})).status,200);
    assert.equal((await (await call('/api/metrics?start=2026-10-01&end=2026-10-04')).json()).weekly_capacity,0);
    assert.equal((await call('/api/restore','POST',productivityBackup)).status,200);
    assert.equal((await (await call('/api/state')).json()).team[0].productivity_rate,50);
    const asset = await (await call('/api/assets','POST',{tag:'RT-1',name:'Esteira runtime',area:'A'})).json();
    assert.ok(asset.id);
    const plan = await (await call('/api/plans','POST',{name:'Inspeção',asset_id:asset.id,next_date:'2026-10-01',interval_days:7})).json();
    const concurrent = await Promise.all([1,2].map(()=>call(`/api/plans/${plan.id}/generate`,'POST',{expected_date:'2026-10-01'})));
    assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,400]);
    const before = await (await call('/api/state')).json();
    assert.equal(before.orders.length,1);
    assert.equal(before.storage,'cloudflare');
    const backup = await (await call('/api/backup')).json();
    backup.data.orders[0].asset_id = 9999;
    assert.equal((await call('/api/restore','POST',backup)).status,400);
    assert.deepEqual(await (await call('/api/state')).json(),before);
    const oversized = await mf.dispatchFetch('https://pcm.example/api/restore',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':token,'X-PCM-Client':'local','Content-Type':'application/json'},body:' '.repeat(5000001)});
    assert.equal(oversized.status,413);
    const badJson = await mf.dispatchFetch('https://pcm.example/api/assets',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':token,'X-PCM-Client':'local','Content-Type':'application/json'},body:'{invalid'});
    assert.equal(badJson.status,400);
  } finally { await mf.dispose(); }
});
