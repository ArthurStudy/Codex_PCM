// The cloud backend preserves the local API and JSON backup format.
// Each workspace has one transactional SQLite database; no user data is global.
import model from './model.json' with { type: 'json' };
import seed from './seed.json' with { type: 'json' };

export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status) => { throw new InputError(message, status); };
const { defaults, tables, statuses, types, shifts, transitions } = model;
const names = Object.keys(tables);
const numeric = new Set(['hours_day','productivity_rate','days_week','quantity','minimum','unit_cost','hours','estimated_hours','actual_hours','labor_rate','material_cost','downtime_hours','operating_hours_month','interval_days']);
const dates = new Set(['start','end','next_date','requested_date','due_date','scheduled_date','completed_date']);
const foreign = { asset_id:'assets', assignee_id:'team', project_id:'projects', plan_id:'plans' };
const required = { assets:['tag','name','area'],team:['name'],materials:['code','name'],projects:['name','start','end'],plans:['name','asset_id','next_date'],orders:['title','asset_id','requested_date'] };
const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
const addDays = (value, count) => new Date(Date.parse(value + 'T12:00:00Z') + count * 86400000).toISOString().slice(0,10);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class PCMDatabase {
  constructor(sql, transaction, clock = today) {
    this.sql = sql;
    this.transaction = transaction;
    this.clock = clock;
  }
  rows(query, ...args) { return this.sql.exec(query, ...args).toArray(); }
  one(query, ...args) { return this.rows(query, ...args)[0]; }
  initialize() {
    this.transaction(() => {
      for (const table of names) this.sql.exec(`CREATE TABLE IF NOT EXISTS ${table}(id INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL)`);
      this.sql.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,time TEXT,event TEXT,entity TEXT,record_id INTEGER)');
      if (this.one("SELECT value FROM meta WHERE key='initialized'")) return;
      const offset = Math.round((Date.parse(this.clock()) - Date.parse(seed.reference_date)) / 86400000);
      for (const table of names) for (const original of seed.data[table]) {
        const row = { ...original };
        delete row.id;
        for (const key of dates) if (row[key]) row[key] = addDays(row[key], offset);
        this.insert(table, row);
      }
      this.sql.exec("INSERT INTO meta VALUES ('initialized','1'),('demo','1')");
    });
  }
  all(table) { return this.rows(`SELECT * FROM ${table} ORDER BY id`).map(r => ({ ...defaults[table], ...JSON.parse(r.payload), id:r.id })); }
  get(table, id) { const row = this.one(`SELECT payload FROM ${table} WHERE id=?`, id); return row ? JSON.parse(row.payload) : null; }
  insert(table, data) { return this.one(`INSERT INTO ${table}(payload) VALUES (?) RETURNING id`, JSON.stringify(data)).id; }
  audit(event, entity, id) { this.sql.exec('INSERT INTO audit(time,event,entity,record_id) VALUES (?,?,?,?)', new Date().toISOString(), event, entity, id); }
  state(backup = false) {
    const state = Object.fromEntries(names.map(t => [t, this.all(t)]));
    state.demo = this.one("SELECT value FROM meta WHERE key='demo'").value === '1';
    state.audit = this.rows('SELECT * FROM audit ORDER BY id ' + (backup ? 'ASC' : 'DESC LIMIT 100'));
    if (!backup) state.storage = 'cloudflare';
    return state;
  }
  validate(table, incoming) {
    if (!object(incoming)) fail('Registro inválido.');
    const data = { ...defaults[table] };
    for (const key of tables[table]) if (Object.hasOwn(incoming, key)) data[key] = incoming[key];
    for (const key of required[table]) if (data[key] == null || !String(data[key]).trim()) fail(`Preencha o campo ${key}.`);
    for (const [key, value] of Object.entries(data)) {
      if (numeric.has(key)) {
        if (!['number','string'].includes(typeof value) || String(value).trim() === '') fail(`Número inválido: ${key}.`);
        data[key] = Number(value);
        if (!Number.isFinite(data[key]) || data[key] < 0 || data[key] > 100000000) fail(`Valor fora do limite: ${key}.`);
      } else if (dates.has(key)) {
        if (value !== '' && !validDate(value)) fail(`Data inválida: ${key}.`);
      } else if (key === 'active') {
        if (typeof value !== 'boolean') fail('Situação inválida.');
      } else if (Object.hasOwn(foreign, key)) {
        if (value !== '') {
          if (!['number','string'].includes(typeof value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || !this.get(foreign[key], Number(value))) fail(`Referência inexistente: ${key}.`);
          data[key] = Number(value);
        }
      } else if (typeof value !== 'string' || value.length > 20000) fail(`Texto inválido: ${key}.`);
    }
    if (['orders','plans'].includes(table) && !types.includes(data.type)) fail('Tipo inválido.');
    if (table === 'assets' && !['A','B','C'].includes(data.criticality)) fail('Criticidade inválida.');
    if (table === 'team' && data.productivity_rate > 100) fail('Taxa de produtividade deve ser entre 0 e 100%.');
    if (table === 'team' && data.hours_day > 24) fail('Capacidade diária deve ser até 24 h.');
    if (table === 'team' && (data.days_week < 1 || data.days_week > 7)) fail('Dias de trabalho por semana devem ser entre 1 e 7.');
    if (['team','orders'].includes(table) && !shifts.includes(data.shift)) fail('Selecione um dos três turnos.');
    if (table === 'plans' && (!Number.isInteger(data.interval_days) || data.interval_days < 1)) fail('Periodicidade deve ser um número inteiro de dias, maior que zero.');
    if (table === 'projects' && data.end < data.start) fail('Fim deve ser posterior ao início.');
    if (table === 'orders') {
      if (!statuses.includes(data.status) || !['P1','P2','P3','P4'].includes(data.priority)) fail('Situação ou prioridade inválida.');
      if (data.estimated_hours <= 0) fail('Informe uma estimativa maior que zero.');
      if (data.requested_date > this.clock()) fail('A solicitação não pode ter data futura.');
      if (['Programada','Em execução','Concluída'].includes(data.status) && (!data.scheduled_date || !data.assignee_id)) fail('OS programada, em execução ou concluída precisa de data e responsável.');
      if (data.assignee_id && ['Programada','Em execução'].includes(data.status)) {
        const person = this.get('team', data.assignee_id);
        if (!person.active) fail('O responsável está inativo.');
        if ((person.shift || '1º turno') !== data.shift) fail('O turno da OS deve corresponder ao turno do responsável.');
      }
      if (data.status === 'Concluída') {
        if (!data.completed_date || !data.action.trim()) fail('Informe a data de conclusão e o serviço realizado.');
        if (data.actual_hours <= 0) fail('Informe as horas reais de execução, maiores que zero.');
        if (data.completed_date > this.clock()) fail('A conclusão não pode ter data futura.');
        if (data.type === 'Corretiva' && (!data.failure.trim() || !data.cause.trim())) fail('Registre a falha e a causa da corretiva. Use "Em análise" se a causa ainda não foi confirmada.');
      } else if (data.completed_date) fail('A data de conclusão é exclusiva de OS concluída.');
      if (data.status === 'Cancelada' && !data.action.trim()) fail('Informe o motivo do cancelamento no serviço realizado / justificativa.');
      if (data.status === 'Aguardando material' && !data.blocker.trim()) fail('Descreva o material ou impedimento pendente.');
      if (data.due_date && data.due_date < data.requested_date && !data.plan_id) fail('Prazo anterior à solicitação.');
      if (data.completed_date && data.completed_date < data.requested_date) fail('Conclusão anterior à solicitação.');
      if (data.scheduled_date && data.scheduled_date < data.requested_date) fail('Programação anterior à solicitação.');
    }
    return data;
  }
  metrics(query) {
    const { start, end, area = '', shift = '' } = query;
    if (!validDate(start) || !validDate(end) || start > end) fail('Informe um período válido.');
    const state = this.state();
    const assets = new Map(state.assets.map(a => [a.id, a]));
    const orders = state.orders.filter(o => (!area || assets.get(o.asset_id)?.area === area) && (!shift || o.shift === shift));
    const active = orders.filter(o => !['Concluída','Cancelada'].includes(o.status));
    const completed = orders.filter(o => o.status === 'Concluída' && start <= o.completed_date && o.completed_date <= end);
    const limit = end < this.clock() ? end : this.clock();
    const planned = orders.filter(o => o.status !== 'Cancelada' && o.scheduled_date && start <= o.scheduled_date && o.scheduled_date <= limit);
    const onTime = planned.filter(o => o.status === 'Concluída' && o.completed_date <= o.scheduled_date);
    const failures = completed.filter(o => o.type === 'Corretiva' && o.downtime_hours > 0);
    const hours = sum(active, 'estimated_hours');
    const weekly = state.team.filter(t => t.active && (!shift || t.shift === shift)).reduce((n,t) => n + t.hours_day * t.days_week * (t.productivity_rate ?? 100) / 100, 0);
    return { backlog_count:active.length,backlog_hours:hours,backlog_weeks:weekly ? hours / weekly : null,weekly_capacity:weekly,
      completed:completed.length,completed_hours:sum(completed,'actual_hours'),cost:completed.reduce((n,o) => n + o.actual_hours * o.labor_rate + o.material_cost,0),
      planned:planned.length,on_time:onTime.length,adherence:planned.length ? 100 * onTime.length / planned.length : null,
      failures:failures.length,downtime:sum(failures,'downtime_hours'),mttr:failures.length ? sum(failures,'downtime_hours') / failures.length : null,
      preventive_share:completed.length ? 100 * completed.filter(o => ['Preventiva','Preditiva','Inspeção'].includes(o.type)).length / completed.length : null,
      overdue:active.filter(o => o.due_date && o.due_date < this.clock()).length,by_type:Object.fromEntries(types.map(t => [t, completed.filter(o => o.type === t).length])) };
  }
  handle(method, route, incoming = {}) {
    const url = new URL(route, 'https://pcm.invalid');
    if (method === 'GET') {
      if (url.pathname === '/api/state') return this.state();
      if (url.pathname === '/api/backup') return { format:'pcm-backup-v1',exported_at:new Date().toISOString(),data:this.state(true) };
      if (url.pathname === '/api/metrics') return this.metrics(Object.fromEntries(url.searchParams));
      fail('Não encontrado.',404);
    }
    if (!['POST','PUT','DELETE'].includes(method)) fail('Método não permitido.',405);
    if (!object(incoming)) fail('Registro inválido.');
    return this.transaction(() => this.mutate(method, url.pathname, incoming));
  }
  mutate(method, path, incoming) {
    if (path === '/api/clear-demo' && method === 'POST') {
      if (incoming.confirmation !== 'LIMPAR DEMONSTRAÇÃO') fail('Confirmação incorreta.');
      if (this.one("SELECT value FROM meta WHERE key='demo'").value !== '1') fail('A base já está em modo real.');
      for (const table of names) this.sql.exec(`DELETE FROM ${table}`);
      this.sql.exec("UPDATE meta SET value='0' WHERE key='demo'");
      this.audit('Base demonstrativa limpa','sistema',0);
      return { ok:true };
    }
    if (path === '/api/restore' && method === 'POST') {
      if (incoming.format !== 'pcm-backup-v1' || !object(incoming.data)) fail('Backup inválido.');
      const payload = incoming.data;
      if (names.some(t => !Array.isArray(payload[t]))) fail('Backup incompleto.');
      for (const table of [...names].reverse()) this.sql.exec(`DELETE FROM ${table}`);
      for (const table of names) {
        const seen = new Set();
        const codes = new Set();
        for (const row of payload[table]) {
          if (!object(row) || !Number.isSafeInteger(row.id) || row.id < 1 || seen.has(row.id)) fail('Identificador inválido ou duplicado no backup.');
          seen.add(row.id);
          const data = this.validate(table, row);
          const code = table === 'assets' ? data.tag.toLowerCase() : table === 'materials' ? data.code.toLowerCase() : null;
          if (code !== null && codes.has(code)) fail('Código duplicado no backup.');
          if (code !== null) codes.add(code);
          this.sql.exec(`INSERT INTO ${table}(id,payload) VALUES (?,?)`, row.id, JSON.stringify(data));
        }
      }
      this.sql.exec("UPDATE meta SET value=? WHERE key='demo'", payload.demo ? '1' : '0');
      this.audit('Backup restaurado','sistema',0);
      return { ok:true };
    }
    const generation = path.match(/^\/api\/plans\/(\d+)\/generate$/);
    if (generation && method === 'POST') {
      const planId = Number(generation[1]);
      const plan = this.get('plans', planId);
      if (!plan) fail('Plano não encontrado.');
      if (!plan.active) fail('Plano inativo.');
      if (incoming.expected_date !== plan.next_date) fail('Esta ocorrência já foi gerada. Atualize a tela.');
      const data = this.validate('orders', { ...defaults.orders,title:plan.name,asset_id:plan.asset_id,type:plan.type,requested_date:this.clock(),due_date:plan.next_date,
        estimated_hours:plan.hours,checklist:plan.checklist,plan_id:planId,description:'Ocorrência do plano prevista para ' + plan.next_date });
      const id = this.insert('orders', data);
      plan.next_date = addDays(plan.next_date, plan.interval_days);
      this.sql.exec('UPDATE plans SET payload=? WHERE id=?', JSON.stringify(plan), planId);
      this.audit('OS gerada pelo plano','orders',id);
      return { id };
    }
    const match = path.match(/^\/api\/([a-z]+)(?:\/(\d+))?$/);
    if (!match || !Object.hasOwn(tables, match[1])) fail('Rota inválida.',404);
    const table = match[1];
    let id = match[2] ? Number(match[2]) : null;
    const previous = id ? this.get(table,id) : null;
    if (method === 'POST' && id) fail('Rota inválida.',404);
    if (method !== 'POST' && (!Number.isSafeInteger(id) || !previous)) fail('Registro não encontrado.',404);
    let event = { POST:'Criação',PUT:'Atualização',DELETE:'Exclusão' }[method];
    if (method === 'DELETE') {
      if (table === 'orders') fail('OS não pode ser excluída. Use Cancelada com justificativa para preservar o histórico.');
      const references = { assets:[['orders','asset_id'],['plans','asset_id']],team:[['orders','assignee_id']],projects:[['orders','project_id']],plans:[['orders','plan_id']] };
      for (const [other,key] of references[table] || []) if (this.all(other).some(r => r[key] === id)) fail('Registro vinculado. Remova os vínculos antes de excluir.');
      this.sql.exec(`DELETE FROM ${table} WHERE id=?`,id);
    } else {
      const data = this.validate(table,incoming);
      if (table === 'orders') {
        if (method === 'POST' && data.status !== 'Aberta') fail('Uma nova OS deve iniciar como Aberta.');
        if (method === 'PUT' && data.status !== previous.status) {
          if (!transitions[previous.status].includes(data.status)) fail(`Transição inválida: ${previous.status} → ${data.status}.`);
          event = `${previous.status} → ${data.status}`;
        }
      }
      const unique = table === 'assets' ? 'tag' : table === 'materials' ? 'code' : null;
      if (unique && this.all(table).some(r => r.id !== id && r[unique].toLowerCase() === data[unique].toLowerCase())) fail('Código já cadastrado.');
      if (method === 'POST') id = this.insert(table,data);
      else this.sql.exec(`UPDATE ${table} SET payload=? WHERE id=?`,JSON.stringify(data),id);
    }
    this.audit(event,table,id);
    return { ok:true,id };
  }
}
