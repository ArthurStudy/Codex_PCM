// Independent acceptance checks. Uses an in-memory SQLite database and reads
// the actual local/Worker UI source; never opens data/ or remote services.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { PCMDatabase, InputError, validDate } from '../cloudflare/core.mjs';

function fixture() {
  const raw = new DatabaseSync(':memory:');
  const sql = { exec(query, ...args) {
    const statement = raw.prepare(query);
    if (/^(SELECT|INSERT .*RETURNING)/i.test(query.trim())) return { toArray: () => statement.all(...args) };
    statement.run(...args); return { toArray: () => [] };
  }};
  const db = new PCMDatabase(sql, fn => { raw.exec('BEGIN IMMEDIATE'); try { const out=fn(); raw.exec('COMMIT'); return out; } catch(e) { raw.exec('ROLLBACK'); throw e; } }, () => '2026-10-05');
  db.initialize();
  db.handle('POST','/api/clear-demo',{confirmation:'LIMPAR DEMONSTRAÇÃO'});
  const asset = db.handle('POST','/api/assets',{tag:'ACC-01',name:'Esteira',production_line:'Linha principal'}).id;
  const tech = db.handle('POST','/api/team',{name:'Técnico',shift:'1º turno'}).id;
  const order = extra => db.handle('POST','/api/orders',{title:'Inspeção de esteira',asset_id:asset,requested_date:'2026-10-04',estimated_hours:2,...extra}).id;
  return {db,raw,asset,tech,order};
}
function rejects(action, pattern) { assert.throws(action, e => e instanceof InputError && (!pattern || pattern.test(e.message))); }

// Calendar inputs are checked as exact civil dates, not JavaScript's lenient parse.
for (const [name,value,expected] of [
  ['accepts leap-day in leap year','2024-02-29',true],
  ['rejects non-leap February 29','2025-02-29',false],
  ['rejects April 31','2026-04-31',false],
  ['rejects month zero','2026-00-10',false],
  ['rejects day zero','2026-01-00',false],
  ['rejects non-padded month','2026-1-09',false],
  ['rejects timestamp instead of date','2026-10-05T00:00:00Z',false],
  ['rejects non-string date',null,false],
]) test(`acceptance date: ${name}`,()=>assert.equal(validDate(value),expected));

// API behavior and initial state contracts.
test('acceptance initialization is idempotent and does not reseed cleared records',()=>{const {db,raw}=fixture();try{db.initialize();assert.equal(db.state().assets.length,1);}finally{raw.close();}});
test('acceptance state identifies Cloudflare storage only on cloud state response',()=>{const {db,raw}=fixture();try{assert.equal(db.handle('GET','/api/state').storage,'cloudflare');assert.equal(db.handle('GET','/api/backup').data.storage,undefined);}finally{raw.close();}});
test('acceptance unknown GET route has a not-found status',()=>{const {db,raw}=fixture();try{rejects(()=>db.handle('GET','/api/no-such-route'),/Não encontrado/);}finally{raw.close();}});
test('acceptance unsupported mutation method is rejected',()=>{const {db,raw}=fixture();try{rejects(()=>db.handle('PATCH','/api/assets',{}),/Método não permitido/);}finally{raw.close();}});
test('acceptance audit records an update with entity and record identity',()=>{const {db,raw,asset}=fixture();try{db.handle('PUT',`/api/assets/${asset}`,{tag:'ACC-01',name:'Esteira revisada',production_line:'Linha principal'});const row=db.state().audit[0];assert.equal(row.event,'Atualização');assert.equal(row.entity,'assets');assert.equal(row.record_id,asset);}finally{raw.close();}});
test('acceptance empty metrics period returns null ratios without division by zero',()=>{const {db,raw}=fixture();try{const m=db.metrics({start:'2026-10-01',end:'2026-10-05'});assert.equal(m.adherence,null);assert.equal(m.mttr,null);assert.equal(m.preventive_share,null);}finally{raw.close();}});
test('acceptance backup includes stable format marker and timestamp',()=>{const {db,raw}=fixture();try{const b=db.handle('GET','/api/backup');assert.equal(b.format,'pcm-backup-v1');assert.ok(Number.isFinite(Date.parse(b.exported_at)));}finally{raw.close();}});

// Entity payload hygiene and boundaries.
test('acceptance asset creation trims line and canonicalizes known line case',()=>{const {db,raw}=fixture();try{const id=db.handle('POST','/api/assets',{tag:'ACC-02',name:'Prensa',production_line:' linha PRINCIPAL '}).id;assert.equal(db.get('assets',id).production_line,'Linha principal');}finally{raw.close();}});
test('acceptance asset rejects missing equipment tag',()=>{const {db,raw}=fixture();try{rejects(()=>db.handle('POST','/api/assets',{name:'Motor'}),/tag/);}finally{raw.close();}});
test('acceptance asset rejects missing equipment name',()=>{const {db,raw}=fixture();try{rejects(()=>db.handle('POST','/api/assets',{tag:'A-3'}),/name/);}finally{raw.close();}});
test('acceptance asset rejects a criticality outside A B C',()=>{const {db,raw}=fixture();try{rejects(()=>db.handle('POST','/api/assets',{tag:'A-4',name:'Motor',criticality:'D'}),/Criticidade/);}finally{raw.close();}});
test('acceptance asset rejects simultaneous production line and legacy area',()=>{const {db,raw}=fixture();try{rejects(()=>db.handle('POST','/api/assets',{tag:'A-5',name:'Motor',production_line:'Linha principal',area:'Montagem'}),/linha de produção/);}finally{raw.close();}});
test('acceptance team retains zero productivity as an explicit value',()=>{const {db,raw}=fixture();try{const id=db.handle('POST','/api/team',{name:'Sem disponibilidade',productivity_rate:0}).id;assert.equal(db.get('team',id).productivity_rate,0);assert.equal(db.metrics({start:'2026-10-01',end:'2026-10-05'}).weekly_capacity,40);}finally{raw.close();}});
test('acceptance team accepts 100 percent productivity upper boundary',()=>{const {db,raw}=fixture();try{const id=db.handle('POST','/api/team',{name:'Integral',productivity_rate:100}).id;assert.equal(db.get('team',id).productivity_rate,100);}finally{raw.close();}});
test('acceptance team rejects productivity above 100 percent',()=>{const {db,raw}=fixture();try{rejects(()=>db.handle('POST','/api/team',{name:'Inválido',productivity_rate:100.01}),/produtividade/);}finally{raw.close();}});
test('acceptance team accepts 24 productive hours per day boundary',()=>{const {db,raw}=fixture();try{const id=db.handle('POST','/api/team',{name:'Plantão',hours_day:24}).id;assert.equal(db.get('team',id).hours_day,24);}finally{raw.close();}});
test('acceptance team rejects more than 24 hours in a day',()=>{const {db,raw}=fixture();try{rejects(()=>db.handle('POST','/api/team',{name:'Inválido',hours_day:24.1}),/24 h/);}finally{raw.close();}});
test('acceptance team accepts seven workdays boundary',()=>{const {db,raw}=fixture();try{const id=db.handle('POST','/api/team',{name:'Escala contínua',days_week:7}).id;assert.equal(db.get('team',id).days_week,7);}finally{raw.close();}});
test('acceptance team rejects zero workdays',()=>{const {db,raw}=fixture();try{rejects(()=>db.handle('POST','/api/team',{name:'Inválido',days_week:0}),/Dias de trabalho/);}finally{raw.close();}});
test('acceptance team rejects a non-boolean active flag',()=>{const {db,raw}=fixture();try{rejects(()=>db.handle('POST','/api/team',{name:'Inválido',active:'true'}),/Situação/);}finally{raw.close();}});
test('acceptance team rejects unknown shift label',()=>{const {db,raw}=fixture();try{rejects(()=>db.handle('POST','/api/team',{name:'Inválido',shift:'Comercial'}),/três turnos/);}finally{raw.close();}});
test('acceptance material code is case-insensitively unique',()=>{const {db,raw}=fixture();try{db.handle('POST','/api/materials',{code:'ROL-A',name:'Rolamento'});rejects(()=>db.handle('POST','/api/materials',{code:'rol-a',name:'Duplicado'}),/já cadastrado/);}finally{raw.close();}});
test('acceptance project accepts same-day start and finish',()=>{const {db,raw}=fixture();try{const id=db.handle('POST','/api/projects',{name:'Janela',start:'2026-10-05',end:'2026-10-05'}).id;assert.ok(id);}finally{raw.close();}});
test('acceptance project rejects reversed schedule dates',()=>{const {db,raw}=fixture();try{rejects(()=>db.handle('POST','/api/projects',{name:'Janela',start:'2026-10-06',end:'2026-10-05'}),/posterior/);}finally{raw.close();}});
test('acceptance maintenance plan requires a positive integer interval',()=>{const {db,raw,asset}=fixture();try{rejects(()=>db.handle('POST','/api/plans',{name:'Plano',asset_id:asset,next_date:'2026-10-10',interval_days:1.5}),/Periodicidade/);}finally{raw.close();}});
test('acceptance maintenance plan rejects interval zero',()=>{const {db,raw,asset}=fixture();try{rejects(()=>db.handle('POST','/api/plans',{name:'Plano',asset_id:asset,next_date:'2026-10-10',interval_days:0}),/Periodicidade/);}finally{raw.close();}});

// Work-order rules not exercised by the existing closure happy-path tests.
test('acceptance new work order must begin open',()=>{const {db,raw,order,tech}=fixture();try{rejects(()=>order({status:'Programada',scheduled_date:'2026-10-05',assignee_id:tech}),/iniciar como Aberta/);}finally{raw.close();}});
test('acceptance priority outside P1-P4 is rejected',()=>{const {db,raw,order}=fixture();try{rejects(()=>order({priority:'P0'}),/prioridade/);}finally{raw.close();}});
test('acceptance estimated hours must be strictly positive',()=>{const {db,raw,order}=fixture();try{rejects(()=>order({estimated_hours:0}),/maior que zero/);}finally{raw.close();}});
test('acceptance requested date cannot be in the future',()=>{const {db,raw,order}=fixture();try{rejects(()=>order({requested_date:'2026-10-06'}),/data futura/);}finally{raw.close();}});
test('acceptance completed date is forbidden while order is open',()=>{const {db,raw,order}=fixture();try{rejects(()=>order({completed_date:'2026-10-05'}),/exclusiva/);}finally{raw.close();}});
test('acceptance completed corrective order requires failure description',()=>{const {db,raw,asset,tech}=fixture();try{rejects(()=>db.handle('POST','/api/orders',{title:'Corretiva',asset_id:asset,type:'Corretiva',requested_date:'2026-10-04',status:'Concluída',scheduled_date:'2026-10-04',assignee_id:tech,completed_date:'2026-10-05',actual_hours:1,action:'Reparo',cause:'Desgaste'}),/falha e a causa/);}finally{raw.close();}});
test('acceptance completed preventive order does not require corrective failure fields',()=>{const {db,raw,asset,tech}=fixture();try{const id=db.handle('POST','/api/orders',{title:'Preventiva',asset_id:asset,type:'Preventiva',requested_date:'2026-10-04',status:'Aberta'}).id;db.handle('PUT',`/api/orders/${id}`,{...db.get('orders',id),status:'Em planejamento'});db.handle('PUT',`/api/orders/${id}`,{...db.get('orders',id),status:'Programada',scheduled_date:'2026-10-05',assignee_id:tech});db.handle('PUT',`/api/orders/${id}`,{...db.get('orders',id),status:'Em execução'});db.handle('PUT',`/api/orders/${id}`,{...db.get('orders',id),status:'Concluída',completed_date:'2026-10-05',actual_hours:1,action:'Lubrificação'});assert.equal(db.get('orders',id).status,'Concluída');}finally{raw.close();}});
test('acceptance cancellation requires a recorded reason',()=>{const {db,raw,order}=fixture();try{const id=order();rejects(()=>db.handle('PUT',`/api/orders/${id}`,{...db.get('orders',id),status:'Cancelada'}),/motivo do cancelamento/);}finally{raw.close();}});
test('acceptance waiting-material status requires blocker detail',()=>{const {db,raw,order}=fixture();try{const id=order();rejects(()=>db.handle('PUT',`/api/orders/${id}`,{...db.get('orders',id),status:'Aguardando material'}),/impedimento pendente/);}finally{raw.close();}});
test('acceptance order rejects completion earlier than request date',()=>{const {db,raw,asset,tech}=fixture();try{rejects(()=>db.handle('POST','/api/orders',{title:'Preventiva',asset_id:asset,type:'Preventiva',requested_date:'2026-10-04',status:'Concluída',scheduled_date:'2026-10-04',assignee_id:tech,completed_date:'2026-10-03',actual_hours:1,action:'Concluído'}),/anterior à solicitação/);}finally{raw.close();}});
test('acceptance planned date cannot precede request date',()=>{const {db,raw,asset,tech}=fixture();try{rejects(()=>db.handle('POST','/api/orders',{title:'Preventiva',asset_id:asset,type:'Preventiva',requested_date:'2026-10-04',status:'Programada',scheduled_date:'2026-10-03',assignee_id:tech}),/Programação anterior/);}finally{raw.close();}});
test('acceptance planned order cannot use a technician from another shift',()=>{const {db,raw,asset,tech}=fixture();try{rejects(()=>db.handle('POST','/api/orders',{title:'Preventiva',asset_id:asset,type:'Preventiva',requested_date:'2026-10-04',status:'Programada',scheduled_date:'2026-10-05',assignee_id:tech,shift:'2º turno'}),/turno da OS/);}finally{raw.close();}});
test('acceptance planned order cannot be assigned to an inactive technician',()=>{const {db,raw,asset,tech}=fixture();try{db.handle('PUT',`/api/team/${tech}`,{...db.get('team',tech),active:false});rejects(()=>db.handle('POST','/api/orders',{title:'Preventiva',asset_id:asset,type:'Preventiva',requested_date:'2026-10-04',status:'Programada',scheduled_date:'2026-10-05',assignee_id:tech}),/inativo/);}finally{raw.close();}});
test('acceptance order update cannot jump directly from open to execution',()=>{const {db,raw,order,tech}=fixture();try{const id=order();rejects(()=>db.handle('PUT',`/api/orders/${id}`,{...db.get('orders',id),status:'Em execução',scheduled_date:'2026-10-05',assignee_id:tech}),/Transição inválida/);}finally{raw.close();}});
test('acceptance unknown asset reference is rejected for new order',()=>{const {db,raw,order}=fixture();try{rejects(()=>order({asset_id:999}),/Referência inexistente/);}finally{raw.close();}});
test('acceptance deleting an asset referenced by a plan is rejected',()=>{const {db,raw,asset}=fixture();try{db.handle('POST','/api/plans',{name:'Inspeção',asset_id:asset,next_date:'2026-10-10'});rejects(()=>db.handle('DELETE',`/api/assets/${asset}`),/Registro vinculado/);}finally{raw.close();}});
test('acceptance unknown resource ID returns not-found for update',()=>{const {db,raw}=fixture();try{rejects(()=>db.handle('PUT','/api/assets/999',{tag:'X',name:'x'}),/Registro não encontrado/);}finally{raw.close();}});

// Metrics and aggregation are verified from observable work-order outcomes.

// Import/restore transaction integrity and compatibility.
test('acceptance restore rejects backup with a missing table collection atomically',()=>{const {db,raw,order}=fixture();try{order();const before=db.state();const backup=db.handle('GET','/api/backup');delete backup.data.plans;rejects(()=>db.handle('POST','/api/restore',backup),/Backup incompleto/);assert.deepEqual(db.state(),before);}finally{raw.close();}});
test('acceptance restore rejects duplicate equipment tags ignoring case',()=>{const {db,raw}=fixture();try{const b=db.handle('GET','/api/backup');b.data.assets.push({...b.data.assets[0],id:99,tag:b.data.assets[0].tag.toLowerCase()});rejects(()=>db.handle('POST','/api/restore',b),/Código duplicado/);}finally{raw.close();}});
test('acceptance restore rejects duplicate row IDs within a table',()=>{const {db,raw}=fixture();try{const b=db.handle('GET','/api/backup');b.data.assets.push({...b.data.assets[0],tag:'UNIQUE'});rejects(()=>db.handle('POST','/api/restore',b),/duplicado no backup/);}finally{raw.close();}});
test('acceptance restore accepts legacy team without productivity rate using 100 percent',()=>{const {db,raw,tech}=fixture();try{const b=db.handle('GET','/api/backup');delete b.data.team.find(t=>t.id===tech).productivity_rate;db.handle('POST','/api/restore',b);assert.equal(db.get('team',tech).productivity_rate,100);}finally{raw.close();}});
test('acceptance clear-demo rejects incorrect confirmation',()=>{const {db,raw}=fixture();try{rejects(()=>db.handle('POST','/api/clear-demo',{confirmation:'CLEAR'}),/Confirmação incorreta/);}finally{raw.close();}});
// Exercise the actual XLSX importer against workbooks produced by the exporter.
import vm from 'node:vm';
const browserContext=vm.createContext({TextEncoder,TextDecoder,Uint8Array,DataView,Blob,Response,URL,DecompressionStream,document:{createElement(){return {set innerHTML(v){this.value=v.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");}};}}});
vm.runInContext(readFileSync(new URL('../public/excel-export.js',import.meta.url),'utf8'),browserContext);
vm.runInContext(readFileSync(new URL('../public/orders-import.js',import.meta.url),'utf8'),browserContext);
const masterData={assets:[{id:7,tag:'ACC-01'}],team:[{id:3,name:'Técnico',active:true,shift:'1º turno'}]};
const importMatrix=[browserContext.PCMOrderImport.columns,['Trocar correia','ACC-01','Preventiva','P2','2026-10-04','2026-10-08',2,'1º turno','Técnico','Descrição','Checklist','']];
async function readWorkbook(matrix=importMatrix,name='ordens.xlsx'){const bytes=Buffer.from(browserContext.PCMExcel.build(matrix));const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);return browserContext.PCMOrderImport.read({name,size:bytes.length,arrayBuffer:async()=>buffer});}
test('acceptance XLSX reader round-trips worksheet data from generated workbook',async()=>{const rows=await readWorkbook();assert.deepEqual(Array.from(rows[1]),importMatrix[1].map(String));});
test('acceptance XLSX validator resolves tag and technician to database IDs',async()=>{const rows=await readWorkbook();const result=browserContext.PCMOrderImport.validate(rows,masterData);assert.equal(result[0].asset_id,7);assert.equal(result[0].assignee_id,3);assert.equal(result[0].status,'Aberta');});
test('acceptance XLSX validator rejects a changed required header',async()=>{const rows=await readWorkbook();rows[0][0]='Atividade';assert.throws(()=>browserContext.PCMOrderImport.validate(rows,masterData),/colunas não correspondem/);});
test('acceptance XLSX validator rejects unresolved master data before submission',async()=>{const rows=await readWorkbook();rows[1][1]='INEXISTENTE';assert.throws(()=>browserContext.PCMOrderImport.validate(rows,masterData),/ativo "INEXISTENTE" não encontrado/);});
test('acceptance XLSX validator enforces matching technician shift',async()=>{const rows=await readWorkbook();rows[1][7]='2º turno';assert.throws(()=>browserContext.PCMOrderImport.validate(rows,masterData),/turno .*não corresponde/);});
test('acceptance XLSX reader rejects CSV renamed as Excel',async()=>{await assert.rejects(()=>readWorkbook(importMatrix,'ordens.csv'),/arquivo \.xlsx/);});
