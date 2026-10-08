"""PCM Atelier — aplicação local com biblioteca padrão e SQLite."""
import argparse
import calendar
import json
import mimetypes
import re
import os
import sqlite3
import threading
import webbrowser
from urllib.parse import urlparse, parse_qs
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB = Path(os.environ.get('PCM_DB', ROOT / 'data' / 'pcm.sqlite3'))
TABLES = {
 'assets': ['tag','name','production_line','area','criticality','manufacturer','model','serial','operating_hours_month','notes'],
 'team': ['name','specialty','hours_day','productivity_rate','days_week','shift','active'],
 'trainings': ['training_code','title','request_date','start_date','end_date','instructor','location','modality','status','workload','planned_cost','actual_cost','participants','validity_days','notes'],
 'materials': ['code','name','unit','quantity','minimum','unit_cost','location'],
 'spare_parts': ['asset_id','description','manufacturer_code','manufacturer','sap_code','quantity'],
 'projects': ['name','start','end','owner','notes'],
 'plans': ['name','asset_id','type','interval_days','next_date','hours','specialty','checklist','active'],
 'orders': ['title','asset_id','type','priority','status','shift','requested_date','due_date','scheduled_date','completed_date','start_time','end_time','assignee_id','estimated_hours','actual_hours','labor_rate','material_cost','downtime_hours','failure','cause','action','description','checklist','blocker','project_id','plan_id'],
}
DEFAULTS = {
 'assets': dict(tag='',name='',production_line='',area='',criticality='B',manufacturer='',model='',serial='',operating_hours_month=0,notes=''),
 'team': dict(name='',specialty='Mecânica',hours_day=8,productivity_rate=100,days_week=5,shift='1º turno',active=True),
 'trainings': dict(training_code='',title='',request_date='',start_date='',end_date='',instructor='',location='',modality='Presencial',status='Planejado',workload=1,planned_cost=0,actual_cost=0,participants='',validity_days=365,notes=''),
 'materials': dict(code='',name='',unit='un',quantity=0,minimum=0,unit_cost=0,location=''),
 'spare_parts': dict(asset_id='',description='',manufacturer_code='',manufacturer='',sap_code='',quantity=1),
 'projects': dict(name='',start='',end='',owner='',notes=''),
 'plans': dict(name='',asset_id='',type='Preventiva',interval_days=30,next_date='',hours=2,specialty='Mecânica',checklist='',active=True),
 'orders': dict(title='',asset_id='',type='Preventiva',priority='P3',status='Aberta',shift='1º turno',requested_date='',due_date='',scheduled_date='',completed_date='',start_time='',end_time='',assignee_id='',estimated_hours=2,actual_hours=0,labor_rate=0,material_cost=0,downtime_hours=0,failure='',cause='',action='',description='',checklist='',blocker='',project_id='',plan_id=''),
}
STATUSES = ['Aberta','Em planejamento','Aguardando material','Programada','Em execução','Concluída','Cancelada']
TYPES = ['Preventiva','Corretiva','Corretiva emergencial','Corretiva planejada','Preditiva','Inspeção','Melhoria']
SHIFTS = ['1º turno','2º turno','3º turno']
class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try: return super().__exit__(*args)
        finally: self.close()

TRANSITIONS = {
 'Aberta':['Em planejamento','Aguardando material','Programada','Cancelada'],
 'Em planejamento':['Aguardando material','Programada','Cancelada'],
 'Aguardando material':['Em planejamento','Programada','Cancelada'],
 'Programada':['Em planejamento','Aguardando material','Em execução','Cancelada'],
 'Em execução':['Aguardando material','Concluída','Cancelada'],
 'Concluída':[], 'Cancelada':[],
}
def connect():
    db = sqlite3.connect(DB, timeout=15, factory=ClosingConnection)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db

def all_rows(db, table):
    rows=[]
    for r in db.execute(f'SELECT * FROM {table} ORDER BY id'):
        data=json.loads(r['payload'])
        if table=='trainings' and not data.get('start_date') and data.get('date'):
            data['start_date']=data['date']; data['end_date']=data['date']
        if table=='trainings':
            data.setdefault('training_code',f'TR-{r["id"]:04d}')
            data.setdefault('request_date',data.get('start_date',''))
        if table=='assets' and not data.get('production_line') and data.get('area') and data.get('area') not in ['Utilidades','Embalagem'] and not data.get('area','').startswith('Célula'):
            data['production_line']=data['area']
            data['area']=''
        rows.append(dict(DEFAULTS[table], **data, id=r['id']))
    return rows

def metrics(state, start, end, area='', shift=''):
    date.fromisoformat(start); date.fromisoformat(end)
    if start>end: raise ValueError('Período inválido.')
    assets={a['id']:a for a in state['assets']}
    orders=[o for o in state['orders'] if (not area or (assets.get(o['asset_id'],{}).get('production_line') or assets.get(o['asset_id'],{}).get('area'))==area) and (not shift or o.get('shift','1º turno')==shift)]
    active=[o for o in orders if o['status'] not in ['Concluída','Cancelada']]
    completed=[o for o in orders if o['status']=='Concluída' and start<=o['completed_date']<=end]
    planned=[o for o in orders if o['status']!='Cancelada' and o['scheduled_date'] and start<=o['scheduled_date']<=min(end,date.today().isoformat())]
    on_time=[o for o in planned if o['status']=='Concluída' and o['completed_date']<=o['scheduled_date']]
    failures=[o for o in completed if o['type'] in ['Corretiva','Corretiva emergencial'] and o['downtime_hours']>0]
    hours=sum(o['estimated_hours'] for o in active)
    weekly=sum(t['hours_day']*t.get('days_week',5)*t.get('productivity_rate',100)/100 for t in state['team'] if t['active'] and (not shift or t.get('shift','1º turno')==shift))
    return dict(backlog_count=len(active), backlog_hours=hours, backlog_weeks=hours/weekly if weekly else None,
        weekly_capacity=weekly, completed=len(completed), completed_hours=sum(o['actual_hours'] for o in completed),
        cost=sum(o['actual_hours']*o['labor_rate']+o['material_cost'] for o in completed),
        planned=len(planned),on_time=len(on_time),adherence=100*len(on_time)/len(planned) if planned else None,
        failures=len(failures),downtime=sum(o['downtime_hours'] for o in failures),
        mttr=sum(o['downtime_hours'] for o in failures)/len(failures) if failures else None,
        preventive_share=100*sum(o['type'] in ['Preventiva','Corretiva planejada','Preditiva','Inspeção'] for o in completed)/len(completed) if completed else None,
        overdue=sum(bool(o.get('due_date') and o['due_date']<date.today().isoformat()) for o in active),
        by_type={kind:sum(o['type']==kind for o in completed) for kind in TYPES})

def insert(db, table, data):
    return db.execute(f'INSERT INTO {table}(payload) VALUES (?)', (json.dumps(data, ensure_ascii=False),)).lastrowid

def audit(db, event, entity, record_id):
    db.execute('INSERT INTO audit(time,event,entity,record_id) VALUES (?,?,?,?)', (datetime.now().isoformat(timespec='seconds'),event,entity,record_id))

def initialize():
    DB.parent.mkdir(parents=True,exist_ok=True)
    with connect() as db:
        for table in TABLES:
            db.execute(f'CREATE TABLE IF NOT EXISTS {table}(id INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT)')
        db.execute('CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,time TEXT,event TEXT,entity TEXT,record_id INTEGER)')
        if db.execute("SELECT value FROM meta WHERE key='initialized'").fetchone():
            return
        db.execute("INSERT INTO meta VALUES ('initialized','1')")
        db.execute("INSERT INTO meta VALUES ('demo','1')")
        today = date.today()
        ds = lambda offset: (today+timedelta(days=offset)).isoformat()
        for tag,name,line,area,crit in [('MON-001','Estação de montagem do cesto','Linha principal','','A'),('EST-002','Esteira de montagem final','Linha principal','','A'),('CMP-001','Compressor de ar','','Utilidades','A'),('PRE-001','Prensa de gabinetes','','Célula de gabinetes','A'),('TST-001','Bancada de estanqueidade','','Célula de testes','A'),('PLT-001','Paletizador de lavadoras','','Embalagem','B')]:
            insert(db,'assets',dict(DEFAULTS['assets'],tag=tag,name=name,production_line=line,area=area,criticality=crit,operating_hours_month=480))
        for name,spec,shift in [('Carlos Mendes','Mecânica','1º turno'),('Ana Oliveira','Elétrica','2º turno'),('Rafael Santos','Instrumentação','3º turno'),('Juliana Costa','Mecânica','1º turno')]:
            insert(db,'team',dict(DEFAULTS['team'],name=name,specialty=spec,shift=shift))
        for code,name,qty,mn,cost in [('ROL-6205','Rolamento 6205',4,6,85),('COR-A42','Correia A42',12,4,46),('SEN-M18','Sensor indutivo M18',2,3,180),('LUB-EP2','Graxa industrial EP2',18,5,42)]:
            insert(db,'materials',dict(DEFAULTS['materials'],code=code,name=name,quantity=qty,minimum=mn,unit_cost=cost,location='Almoxarifado central'))
        insert(db,'projects',dict(DEFAULTS['projects'],name='Parada programada • Linha 01',start=ds(2),end=ds(7),owner='Planejamento',notes='Confirmar janela de produção, recursos, peças e liberações aplicáveis.'))
        for name,asset,interval,offset,hours in [('Lubrificação da estação de montagem',1,7,1,2),('Inspeção do compressor',3,30,-1,3),('Verificação dos sensores da prensa',4,15,4,2),('Inspeção da bancada de testes',5,90,7,4)]:
            insert(db,'plans',dict(DEFAULTS['plans'],name=name,asset_id=asset,interval_days=interval,next_date=ds(offset),hours=hours,checklist='Registrar condição encontrada\nExecutar procedimento aprovado\nRegistrar medições e evidências'))
        jobs=[('Substituir rolamento do transportador',2,'Corretiva','P2','Aguardando material',-5,'',1,4,0),('Inspecionar fixação do cesto',1,'Preventiva','P2','Programada',-3,0,1,3,0),('Verificar painel de comando',4,'Inspeção','P3','Programada',-2,1,2,2,0),('Corrigir vazamento da bancada',5,'Corretiva','P1','Em execução',-2,0,4,4,0),('Análise de vibração do compressor',3,'Preditiva','P2','Programada',-4,2,3,3,0),('Revisar pinças do paletizador',6,'Preventiva','P3','Em planejamento',-9,'','',5,0),('Lubrificar mancais da esteira',2,'Preventiva','P3','Concluída',-8,-5,1,2,2),('Substituir sensor da prensa',4,'Corretiva','P2','Concluída',-6,-3,2,2,3),('Ajustar transmissão da montagem',1,'Preventiva','P2','Programada',-3,3,4,6,0),('Inspecionar conexões pneumáticas',3,'Inspeção','P3','Aberta',-12,'','',2,0),('Eliminar falha de acionamento',6,'Corretiva','P1','Concluída',-10,-7,2,4,5),('Instalar ponto de inspeção',5,'Melhoria','P4','Em planejamento',-18,'','',8,0)]
        for title,asset,typ,pri,status,req,scheduled,person,est,actual in jobs:
            completed=status=='Concluída'
            insert(db,'orders',dict(DEFAULTS['orders'],title=title,asset_id=asset,type=typ,priority=pri,status=status,shift='2º turno' if person==2 else '3º turno' if person==3 else '1º turno',requested_date=ds(req),due_date=ds(scheduled) if scheduled!='' else ds(3 if pri!='P1' else 0),scheduled_date=ds(scheduled) if scheduled!='' else '',completed_date=ds(scheduled) if completed else '',assignee_id=person,estimated_hours=est,actual_hours=actual,labor_rate=65,material_cost=180 if completed else 0,downtime_hours=actual if completed and typ=='Corretiva' else 0,failure='Falha funcional' if completed and typ=='Corretiva' else '',cause='Desgaste' if completed and typ=='Corretiva' else '',action='Substituição e teste funcional' if completed else '',blocker='Rolamento indisponível' if status=='Aguardando material' else '',project_id=1 if scheduled!='' and scheduled>=2 else ''))

def validate(db, table, incoming):
    if not isinstance(incoming,dict): raise ValueError('Registro inválido.')
    data=dict(DEFAULTS[table])
    for key in TABLES[table]:
        if key in incoming: data[key]=incoming[key]
    required={'assets':['tag','name'],'team':['name'],'trainings':['training_code','title','request_date','start_date','end_date'],'materials':['code','name'],'spare_parts':['asset_id','description','sap_code'],'projects':['name','start','end'],'plans':['name','asset_id','next_date'],'orders':['title','asset_id','requested_date']}
    for key in required[table]:
        if not str(data[key]).strip(): raise ValueError(f'Preencha o campo {key}.')
    for key,value in data.items():
        if key in ['hours_day','productivity_rate','days_week','quantity','minimum','unit_cost','hours','estimated_hours','actual_hours','labor_rate','material_cost','downtime_hours','operating_hours_month','interval_days','workload','validity_days','planned_cost','actual_cost']:
            if isinstance(value, bool): raise ValueError(f'Número inválido: {key}.')
            try: data[key]=float(value)
            except (ValueError,TypeError): raise ValueError(f'Número inválido: {key}.')
            if not 0 <= data[key] <= 100000000: raise ValueError(f'Valor fora do limite: {key}.')
        elif key in ['start','end','next_date','requested_date','due_date','scheduled_date','completed_date','request_date','start_date','end_date'] and value:
            try: date.fromisoformat(value)
            except (ValueError,TypeError): raise ValueError(f'Data inválida: {key}.')
        elif key in ['active']:
            if type(value) is not bool: raise ValueError('Situação inválida.')
        elif key.endswith('_id'):
            if value!='':
                foreign={'asset_id':'assets','assignee_id':'team','project_id':'projects','plan_id':'plans'}[key]
                if not db.execute(f'SELECT id FROM {foreign} WHERE id=?',(value,)).fetchone(): raise ValueError(f'Referência inexistente: {key}.')
                data[key]=int(value)
        elif not isinstance(value,str) or len(value)>20000:
            raise ValueError(f'Texto inválido: {key}.')
    if table in ['orders','plans'] and data['type'] not in TYPES: raise ValueError('Tipo inválido.')
    if table=='assets' and data['criticality'] not in ['A','B','C']: raise ValueError('Criticidade inválida.')
    if table=='assets':
        data['production_line']=data['production_line'].strip()
        known={str(row.get('production_line') or '').strip().casefold():row.get('production_line') for row in all_rows(db,'assets') if row.get('production_line')}
        data['production_line']=known.get(data['production_line'].casefold(),data['production_line'])
        if data['production_line'] and data['area']: raise ValueError('Selecione uma linha de produção ou uma área legada, não ambas.')
    if table=='spare_parts':
        data['sap_code']=data['sap_code'].strip().upper()
        data['manufacturer_code']=data['manufacturer_code'].strip()
        if data['quantity']<1 or data['quantity']%1: raise ValueError('A quantidade utilizada na máquina deve ser um número inteiro maior que zero.')
    if table=='team' and (isinstance(incoming.get('productivity_rate'),bool) or data['productivity_rate']>100): raise ValueError('Taxa de produtividade deve ser entre 0 e 100%.')
    if table=='team' and data['hours_day']>24: raise ValueError('Capacidade diária deve ser até 24 h.')
    if table=='team' and not 1<=data['days_week']<=7: raise ValueError('Dias de trabalho por semana devem ser entre 1 e 7.')
    if table=='trainings':
        if data['status'] not in ['Planejado','Realizado','Cancelado']: raise ValueError('Status de treinamento inválido.')
        if data['modality'] not in ['Presencial','Online','Híbrido']: raise ValueError('Modalidade inválida.')
        if data['workload']<=0 or data['validity_days']<0: raise ValueError('Carga horária e validade devem ser válidas.')
        if data['request_date']>data['start_date']: raise ValueError('A solicitação ao RH não pode ser posterior ao início do treinamento.')
        if data['end_date']<data['start_date']: raise ValueError('Data de fim deve ser igual ou posterior à data de início.')
    if table in ['team','orders'] and data['shift'] not in SHIFTS: raise ValueError('Selecione um dos três turnos.')
    if table=='plans' and (data['interval_days']<1 or data['interval_days']%1): raise ValueError('Periodicidade deve ser um número inteiro de dias, maior que zero.')
    if table=='projects' and data['end']<data['start']: raise ValueError('Fim deve ser posterior ao início.')
    if table=='orders':
        for time_key in ['start_time','end_time']:
            if data[time_key] and (not isinstance(data[time_key],str) or not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d',data[time_key])): raise ValueError(f'Horário inválido: {time_key}. Use HH:MM.')
        if data['status'] not in STATUSES or data['priority'] not in ['P1','P2','P3','P4']: raise ValueError('Situação ou prioridade inválida.')
        if data['estimated_hours']<=0: raise ValueError('Informe uma estimativa maior que zero.')
        if data['requested_date']>date.today().isoformat(): raise ValueError('A solicitação não pode ter data futura.')
        if data['status'] in ['Programada','Em execução','Concluída'] and (not data['scheduled_date'] or not data['assignee_id']): raise ValueError('OS programada, em execução ou concluída precisa de data e responsável.')
        if data['assignee_id'] and data['status'] in ['Programada','Em execução']:
            person=json.loads(db.execute('SELECT payload FROM team WHERE id=?',(data['assignee_id'],)).fetchone()['payload'])
            if not person['active']: raise ValueError('O responsável está inativo.')
            if person.get('shift','1º turno')!=data['shift']: raise ValueError('O turno da OS deve corresponder ao turno do responsável.')
        if data['status']=='Concluída' and (not data['completed_date'] or not data['action'].strip()): raise ValueError('Informe a data de conclusão e o serviço realizado.')
        if data['status']=='Concluída':
            if data['actual_hours']<=0: raise ValueError('Informe as horas reais de execução, maiores que zero.')
            if data['completed_date']>date.today().isoformat(): raise ValueError('A conclusão não pode ter data futura.')
            if data['type'] in ['Corretiva','Corretiva emergencial'] and (not data['failure'].strip() or not data['cause'].strip()): raise ValueError('Registre a falha e a causa da corretiva emergencial. Use "Em análise" se a causa ainda não foi confirmada.')
        elif data['completed_date']: raise ValueError('A data de conclusão é exclusiva de OS concluída.')
        if data['status']=='Cancelada' and not data['action'].strip(): raise ValueError('Informe o motivo do cancelamento no serviço realizado / justificativa.')
        if data['status']=='Aguardando material' and not data['blocker'].strip(): raise ValueError('Descreva o material ou impedimento pendente.')
        if data['due_date'] and data['due_date']<data['requested_date'] and not data['plan_id']: raise ValueError('Prazo anterior à solicitação.')
        if data['completed_date'] and data['completed_date']<data['requested_date']: raise ValueError('Conclusão anterior à solicitação.')
        if data['scheduled_date'] and data['scheduled_date']<data['requested_date']: raise ValueError('Programação anterior à solicitação.')
    return data

class Handler(BaseHTTPRequestHandler):
    def send_json(self,value,status=200):
        payload=json.dumps(value,ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(payload))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(payload)
    def do_GET(self):
        if self.path=='/api/local-db-path':
            return self.send_json({'path':str(DB.resolve(strict=True))})
        if self.path.startswith('/api/metrics?'):
            try:
                query=parse_qs(urlparse(self.path).query)
                with connect() as db: state={table:all_rows(db,table) for table in TABLES}
                return self.send_json(metrics(state,query['start'][0],query['end'][0],query.get('area',[''])[0],query.get('shift',[''])[0]))
            except (ValueError,KeyError): return self.send_json({'error':'Informe um período válido.'},400)
        if self.path=='/api/state':
            with connect() as db:
                state={table:all_rows(db,table) for table in TABLES}
                state['demo']=db.execute("SELECT value FROM meta WHERE key='demo'").fetchone()['value']=='1'
                state['audit']=[dict(r) for r in db.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 100')]
            return self.send_json(state)
        if self.path=='/api/backup':
            with connect() as db:
                state={table:all_rows(db,table) for table in TABLES}
                state['demo']=db.execute("SELECT value FROM meta WHERE key='demo'").fetchone()['value']=='1'
                state['audit']=[dict(r) for r in db.execute('SELECT * FROM audit ORDER BY id')]
            return self.send_json(dict(format='pcm-backup-v1',exported_at=datetime.now().isoformat(),data=state))
        path=self.path.split('?')[0]
        allowed={'/':'index.html','/app.js':'app.js','/excel-export.js':'excel-export.js','/orders-import.js':'orders-import.js','/spare-parts.js':'spare-parts.js','/style.css':'style.css','/kpi-team.css':'kpi-team.css'}
        if path not in allowed: return self.send_json({'error':'Não encontrado'},404)
        file=ROOT/'public'/allowed[path]
        raw=file.read_bytes(); self.send_response(200); self.send_header('Content-Type',mimetypes.guess_type(file)[0]+'; charset=utf-8'); self.send_header('Content-Length',str(len(raw))); self.send_header('X-Content-Type-Options','nosniff'); self.end_headers(); self.wfile.write(raw)
    def do_POST(self): self.mutate('POST')
    def do_PUT(self): self.mutate('PUT')
    def do_DELETE(self): self.mutate('DELETE')
    def mutate(self,method):
        try:
            # Same-origin writes only. Local server is never bound to the LAN.
            origin=self.headers.get('Origin')
            host=self.headers.get('Host')
            if origin and origin!=f'http://{host}': return self.send_json({'error':'Origem não autorizada.'},403)
            if self.headers.get('X-PCM-Client')!='local': return self.send_json({'error':'Cliente inválido.'},403)
            size=int(self.headers.get('Content-Length',0))
            if size>5_000_000: raise ValueError('Arquivo excede 5 MB.')
            incoming=json.loads(self.rfile.read(size) or b'{}')
            parts=self.path.strip('/').split('/')
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                if parts==['api','clear-demo'] and method=='POST':
                    if incoming.get('confirmation')!='LIMPAR DEMONSTRAÇÃO': raise ValueError('Confirmação incorreta.')
                    if db.execute("SELECT value FROM meta WHERE key='demo'").fetchone()['value']!='1': raise ValueError('A base já está em modo real.')
                    for table in TABLES: db.execute(f'DELETE FROM {table}')
                    db.execute("UPDATE meta SET value='0' WHERE key='demo'")
                    audit(db,'Base demonstrativa limpa','sistema',0)
                    db.commit()
                    return self.send_json({'ok':True})
                if parts==['api','restore'] and method=='POST':
                    if incoming.get('format')!='pcm-backup-v1' or not isinstance(incoming.get('data'),dict): raise ValueError('Backup inválido.')
                    payload=incoming['data']
                    payload.setdefault('trainings',[])
                    payload.setdefault('spare_parts',[])
                    if any(not isinstance(payload.get(t),list) for t in TABLES): raise ValueError('Backup incompleto.')
                    for table in reversed(TABLES): db.execute(f'DELETE FROM {table}')
                    for table in TABLES:
                        seen=set()
                        for row in payload[table]:
                            if not isinstance(row,dict) or type(row.get('id')) is not int or row['id']<1 or row['id'] in seen: raise ValueError('Identificador inválido ou duplicado no backup.')
                            seen.add(row['id'])
                            valid=validate(db,table,row)
                            db.execute(f'INSERT INTO {table}(id,payload) VALUES (?,?)',(row['id'],json.dumps(valid,ensure_ascii=False)))
                    db.execute("UPDATE meta SET value=? WHERE key='demo'",('1' if payload.get('demo') else '0',))
                    audit(db,'Backup restaurado','sistema',0)
                    db.commit()
                    return self.send_json({'ok':True})
                if len(parts)==4 and parts[:2]==['api','plans'] and parts[3]=='generate' and method=='POST':
                    row=db.execute('SELECT payload FROM plans WHERE id=?',(int(parts[2]),)).fetchone()
                    if not row: raise ValueError('Plano não encontrado.')
                    plan=json.loads(row['payload'])
                    if not plan['active']: raise ValueError('Plano inativo.')
                    if incoming.get('expected_date')!=plan['next_date']: raise ValueError('Esta ocorrência já foi gerada. Atualize a tela.')
                    order=dict(DEFAULTS['orders'],title=plan['name'],asset_id=plan['asset_id'],type=plan['type'],requested_date=date.today().isoformat(),due_date=plan['next_date'],estimated_hours=plan['hours'],checklist=plan['checklist'],plan_id=int(parts[2]),description='Ocorrência do plano prevista para '+plan['next_date'])
                    rid=insert(db,'orders',validate(db,'orders',order))
                    plan['next_date']=(date.fromisoformat(plan['next_date'])+timedelta(days=int(plan['interval_days']))).isoformat()
                    db.execute('UPDATE plans SET payload=? WHERE id=?',(json.dumps(plan,ensure_ascii=False),int(parts[2])))
                    audit(db,'OS gerada pelo plano','orders',rid)
                    db.commit()
                    return self.send_json({'id':rid})
                if parts==['api','orders','import'] and method=='POST':
                    orders=incoming.get('orders')
                    if not isinstance(orders,list) or not 1<=len(orders)<=500: raise ValueError('Envie de 1 a 500 ordens para importar.')
                    ids=[]
                    for index,row in enumerate(orders):
                        try: ids.append(insert(db,'orders',validate(db,'orders',row)))
                        except ValueError as error: raise ValueError(f'Linha {index+2}: {error}')
                    for rid in ids: audit(db,'Importação de OS','orders',rid)
                    db.commit()
                    return self.send_json({'ok':True,'count':len(ids),'ids':ids})
                if len(parts) not in [2,3] or parts[0]!='api' or parts[1] not in TABLES: return self.send_json({'error':'Rota inválida'},404)
                table=parts[1]; rid=int(parts[2]) if len(parts)==3 else None
                if method in ['PUT','DELETE'] and (not rid or not db.execute(f'SELECT id FROM {table} WHERE id=?',(rid,)).fetchone()): return self.send_json({'error':'Registro não encontrado.'},404)
                if method=='DELETE':
                    if table=='orders': raise ValueError('OS não pode ser excluída. Use Cancelada com justificativa para preservar o histórico.')
                    refs={'assets': [('orders','asset_id'),('plans','asset_id'),('spare_parts','asset_id')], 'team':[('orders','assignee_id')], 'projects':[('orders','project_id')], 'plans':[('orders','plan_id')]}
                    for other,key in refs.get(table,[]):
                        if any(str(row[key])==str(rid) for row in all_rows(db,other)): raise ValueError('Registro vinculado. Remova os vínculos antes de excluir.')
                    db.execute(f'DELETE FROM {table} WHERE id=?',(rid,))
                else:
                    data=validate(db,table,incoming)
                    if table=='orders':
                        if method=='POST' and data['status']!='Aberta': raise ValueError('Uma nova OS deve iniciar como Aberta.')
                        if method=='PUT':
                            previous=json.loads(db.execute('SELECT payload FROM orders WHERE id=?',(rid,)).fetchone()['payload'])
                            if data['status']!=previous['status'] and data['status'] not in TRANSITIONS[previous['status']]: raise ValueError('Transição inválida: '+previous['status']+' → '+data['status']+'.')
                    unique='tag' if table=='assets' else 'code' if table=='materials' else 'training_code' if table=='trainings' else None
                    if unique and any(str(row[unique]).casefold()==data[unique].casefold() and row['id']!=rid for row in all_rows(db,table)): raise ValueError('Código já cadastrado.')
                    if table=='spare_parts' and any(row['id']!=rid and row['asset_id']==data['asset_id'] and row['sap_code'].casefold()==data['sap_code'].casefold() for row in all_rows(db,table)): raise ValueError('Este código SAP já está cadastrado nesta máquina.')
                    if method=='POST': rid=insert(db,table,data)
                    else: db.execute(f'UPDATE {table} SET payload=? WHERE id=?',(json.dumps(data,ensure_ascii=False),rid))
                event={'POST':'Criação','PUT':'Atualização','DELETE':'Exclusão'}[method]
                if method=='PUT' and table=='orders' and previous['status']!=data['status']: event=previous['status']+' → '+data['status']
                audit(db,event,table,rid)
            self.send_json({'ok':True,'id':rid})
        except (ValueError,TypeError,KeyError,OverflowError,sqlite3.IntegrityError) as error: self.send_json({'error':str(error)},400)
        except Exception:
            import traceback
            traceback.print_exc()
            self.send_json({'error':'Erro interno. Consulte o terminal.'},500)

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=8765); parser.add_argument('--open',action='store_true'); args=parser.parse_args()
    initialize()
    url=f'http://127.0.0.1:{args.port}'
    print(f'PCM pronto em {url}',flush=True)
    if args.open: threading.Timer(0.7,lambda:webbrowser.open(url)).start()
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
