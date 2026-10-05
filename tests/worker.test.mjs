import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { PCMDatabase, validDate } from '../cloudflare/core.mjs';
import { authorize } from '../cloudflare/auth.mjs';

function open(path = ':memory:') {
  const raw = new DatabaseSync(path);
  const sql = { exec(query,...params) { const rows = raw.prepare(query).all(...params); return { toArray:() => rows }; } };
  const transaction = callback => {
    raw.exec('BEGIN IMMEDIATE');
    try { const result = callback(); raw.exec('COMMIT'); return result; }
    catch (error) { raw.exec('ROLLBACK'); throw error; }
  };
  const db = new PCMDatabase(sql,transaction,() => '2026-10-04');
  db.initialize();
  return { db,raw };
}
function setup(t) {
  const {db,raw} = open();
  t.after(() => raw.close());
  db.handle('POST','/api/clear-demo',{confirmation:'LIMPAR DEMONSTRAÇÃO'});
  const create = (table,data) => db.handle('POST','/api/'+table,data).id;
  const asset = create('assets',{tag:'TEST-01',name:'Esteira',area:'Montagem'});
  const tech = create('team',{name:'Técnico'});
  const order = data => create('orders',{title:'Corrigir rolamento',asset_id:asset,type:'Corretiva',requested_date:'2026-10-03',estimated_hours:4,...data});
  const update = (id,data) => db.handle('PUT','/api/orders/'+id,{...db.get('orders',id),...data});
  const metric = extra => db.metrics({start:'2026-10-01',end:'2026-10-04',...extra});
  return {db,create,asset,tech,order,update,metric};
}

test('OS completa preserva fluxo, custos, indicadores e trilha de alterações',t => {
  const {db,tech,order,update,metric} = setup(t);
  const id = order();
  assert.equal(metric().backlog_hours,4);
  update(id,{status:'Em planejamento'});
  update(id,{status:'Programada',scheduled_date:'2026-10-04',assignee_id:tech});
  assert.equal(metric().planned,1);
  assert.equal(metric().adherence,0);
  update(id,{status:'Em execução'});
  update(id,{status:'Concluída',completed_date:'2026-10-04',actual_hours:3,downtime_hours:2,labor_rate:100,material_cost:150,failure:'Travamento',cause:'Desgaste',action:'Troca e teste'});
  for(const [key,value] of Object.entries({backlog_count:0,completed:1,completed_hours:3,cost:450,failures:1,mttr:2,on_time:1,adherence:100,preventive_share:0})) assert.equal(metric()[key],value,key);
  assert.ok(db.state().audit.length >= 7);
  assert.throws(() => update(id,{status:'Aberta',completed_date:''}),/Transição/);
  assert.throws(() => db.handle('DELETE','/api/orders/'+id),/não pode ser excluída/);
});
test('Falhas de validação não alteram OS nem histórico',t => {
  const {db,tech,order,update} = setup(t);
  const id = order();
  const before = db.state();
  assert.throws(() => update(id,{status:'Programada'}));
  assert.throws(() => update(id,{estimated_hours:-1}));
  assert.throws(() => update(id,{requested_date:'2026-10-05'}));
  assert.deepEqual(db.state(),before);
  update(id,{status:'Programada',scheduled_date:'2026-10-04',assignee_id:tech});
  update(id,{status:'Em execução'});
  for(const data of [{},{actual_hours:2},{actual_hours:2,failure:'Falha',cause:'Causa',completed_date:'2026-10-05'}]) assert.throws(() => update(id,{status:'Concluída',completed_date:'2026-10-04',action:'Troca',...data}));
  assert.equal(db.get('orders',id).status,'Em execução');
});
test('Canceladas ficam fora dos indicadores e programação futura não vence',t => {
  const {tech,order,update,metric} = setup(t);
  const id = order();
  assert.throws(() => update(id,{status:'Cancelada'}));
  update(id,{status:'Cancelada',action:'Duplicada'});
  const future = order();
  update(future,{status:'Programada',scheduled_date:'2026-10-06',assignee_id:tech});
  assert.equal(metric().backlog_count,1);
  assert.equal(metric().planned,0);
  assert.equal(metric().adherence,null);
  assert.equal(metric().mttr,null);
});
test('Ocorrência de plano é atômica e duplicação é bloqueada',t => {
  const {db,create,asset,metric} = setup(t);
  const id = create('plans',{name:'Inspeção',asset_id:asset,next_date:'2026-10-03',interval_days:7,hours:2});
  const result = db.handle('POST',`/api/plans/${id}/generate`,{expected_date:'2026-10-03'});
  assert.equal(db.get('orders',result.id).due_date,'2026-10-03');
  assert.equal(db.get('plans',id).next_date,'2026-10-10');
  assert.equal(metric().overdue,1);
  assert.throws(() => db.handle('POST',`/api/plans/${id}/generate`,{expected_date:'2026-10-03'}),/já foi gerada/);
  assert.equal(db.state().orders.length,1);
});
test('Backup restaura transacionalmente e mantém os dados após erro',t => {
  const {db,asset,order} = setup(t);
  order();
  assert.throws(() => db.handle('DELETE',`/api/assets/${asset}`),/vinculado/);
  const backup = db.handle('GET','/api/backup');
  const broken = structuredClone(backup);
  broken.data.orders[0].asset_id = 999999;
  const before = db.state();
  assert.throws(() => db.handle('POST','/api/restore',broken),/Referência/);
  assert.deepEqual(db.state(),before);
  db.handle('POST','/api/restore',backup);
  assert.deepEqual(db.state().orders,backup.data.orders);
  assert.equal(db.state().audit[0].event,'Backup restaurado');
});
test('Turnos e filtros respeitam capacidade compartilhada',t => {
  const {db,create,tech,order,update,metric} = setup(t);
  const id = order({shift:'2º turno'});
  assert.throws(() => update(id,{status:'Programada',scheduled_date:'2026-10-04',assignee_id:tech}),/turno/);
  const second = create('team',{name:'Outro técnico',shift:'2º turno'});
  update(id,{status:'Programada',scheduled_date:'2026-10-04',assignee_id:second});
  assert.equal(metric({shift:'2º turno'}).backlog_weeks,0.1);
  assert.equal(metric({shift:'1º turno'}).backlog_count,0);
  assert.equal(metric({area:'Outra célula'}).backlog_count,0);
  assert.equal(metric({area:'Outra célula'}).weekly_capacity,80);
  assert.equal(db.state().storage,'cloudflare');
});
test('Reabertura da base SQLite preserva registros sem repetir a demonstração',t => {
  const dir = mkdtempSync(join(tmpdir(),'pcm-cloud-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const path = join(dir,'db.sqlite');
  let connection = open(path);
  const id = connection.db.handle('POST','/api/assets',{tag:'PERSIST',name:'Persistência',area:'Teste'}).id;
  const technician = connection.db.handle('POST','/api/team',{name:'Taxa persistida',productivity_rate:37.5}).id;
  const count = connection.db.state().assets.length;
  connection.raw.close();
  connection = open(path);
  assert.equal(connection.db.get('assets',id).name,'Persistência');
  assert.equal(connection.db.get('team',technician).productivity_rate,37.5);
  assert.equal(connection.db.state().assets.length,count);
  connection.raw.close();
});
test('Entradas malformadas, referências, datas e códigos duplicados são rejeitados',t => {
  const {db,create,asset} = setup(t);
  assert.throws(() => create('assets',{tag:'test-01',name:'Duplicado',area:'A'}));
  for(const value of [null,[],true,{},Infinity,'']) assert.throws(() => create('team',{name:'Inválido',hours_day:value}));
  for(const value of ['2026-02-30',null,123,'20261004']) assert.throws(() => create('plans',{name:'Plano',asset_id:asset,next_date:value}));
  assert.throws(() => db.handle('POST','/api/__proto__',{}));
  assert.throws(() => db.handle('POST','/api/assets',[]));
  assert.equal(validDate('2024-02-29'),true);
  assert.equal(validDate('2025-02-29'),false);
});

test('Produtividade ajusta capacidade e backlog, preservando backup e legado',t => {
  const {db,tech,order,metric,create} = setup(t);
  order();
  const save = rate => db.handle('PUT',`/api/team/${tech}`,{...db.get('team',tech),productivity_rate:rate});
  assert.equal(db.get('team',tech).productivity_rate,100);
  save(50);
  assert.equal(metric().weekly_capacity,20);
  assert.equal(metric().backlog_weeks,0.2);
  const backup = db.handle('GET','/api/backup');
  assert.equal(backup.data.team[0].productivity_rate,50);
  save(0);
  assert.equal(metric().weekly_capacity,0);
  assert.equal(metric().backlog_weeks,null);
  db.handle('POST','/api/restore',backup);
  assert.equal(db.get('team',tech).productivity_rate,50);
  delete backup.data.team[0].productivity_rate;
  db.handle('POST','/api/restore',backup);
  assert.equal(db.get('team',tech).productivity_rate,100);
  assert.equal(metric().weekly_capacity,40);
  create('team',{name:'Segundo turno',shift:'2º turno',productivity_rate:25});
  create('team',{name:'Inativo',active:false,productivity_rate:100});
  assert.equal(metric().weekly_capacity,50);
  assert.equal(metric({shift:'2º turno'}).weekly_capacity,10);
});

test('Produtividade inválida não altera registros nem histórico',t => {
  const {db,tech} = setup(t);
  const before = db.state();
  for (const rate of [-1,100.01,null,true,[],{},'', 'abc',Infinity]) {
    assert.throws(() => db.handle('PUT',`/api/team/${tech}`,{...db.get('team',tech),productivity_rate:rate}),String(rate));
    assert.deepEqual(db.state(),before);
  }
  const backup = db.handle('GET','/api/backup');
  backup.data.team[0].productivity_rate=101;
  assert.throws(() => db.handle('POST','/api/restore',backup));
  assert.deepEqual(db.state(),before);
});

test('Autenticação valida assinatura, e-mail, emissor, audiência e expiração',async () => {
  const {publicKey,privateKey} = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  const resolver = createLocalJWKSet({keys:[jwk]});
  const env = {ACCESS_TEAM_DOMAIN:'https://test.cloudflareaccess.com',ACCESS_AUD:'pcm-test',ALLOWED_EMAIL:'owner@example.com'};
  const token = async (changes = {}) => new SignJWT({email:env.ALLOWED_EMAIL,...changes}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject('test-user').setIssuedAt().setIssuer(changes.iss || env.ACCESS_TEAM_DOMAIN).setAudience(changes.aud || env.ACCESS_AUD).setExpirationTime(changes.exp || '5m').sign(privateKey);
  const request = value => new Request('https://pcm.example/',{headers:{'Cf-Access-Jwt-Assertion':value}});
  assert.equal((await authorize(request(await token()),env,resolver)).email,env.ALLOWED_EMAIL);
  for(const changes of [{email:'intruso@example.com'},{aud:'outra-app'},{iss:'https://other.cloudflareaccess.com'},{exp:1}]) assert.equal(await authorize(request(await token(changes)),env,resolver),null);
  assert.equal(await authorize(request('abc.def.ghi'),env,resolver),null);
  assert.equal(await authorize(new Request('https://pcm.example/'),env,resolver),null);
  assert.equal(await authorize(request(await token()),{...env,ACCESS_AUD:''},resolver),null);
  const parts = (await token()).split('.');
  parts[1] = Buffer.from(JSON.stringify({email:env.ALLOWED_EMAIL,sub:'fake',aud:env.ACCESS_AUD,iss:env.ACCESS_TEAM_DOMAIN,exp:9999999999})).toString('base64url');
  assert.equal(await authorize(request(parts.join('.')),env,resolver),null);
});
