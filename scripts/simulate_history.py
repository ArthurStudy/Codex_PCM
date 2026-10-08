"""Populate only the local PCM database with labelled, repeatable history.

Run ``python scripts/simulate_history.py --as-of 2026-10-07 --apply``.
Without --apply this prints the intended volume and changes nothing.
"""
import argparse
import calendar
import json
import sqlite3
from contextlib import closing
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
KINDS = ['Preventiva', 'Corretiva emergencial', 'Corretiva planejada', 'Preditiva', 'Inspeção', 'Melhoria', 'Corretiva']
ASSETS = [
    ('SIM-PRE-002', 'Prensa de gabinetes B', 'Célula de gabinetes', 'A'),
    ('SIM-DOB-001', 'Dobradeira de chapas', 'Célula de gabinetes', 'B'),
    ('SIM-SOL-001', 'Robô de solda dos gabinetes', 'Célula de gabinetes', 'A'),
    ('SIM-INJ-001', 'Injetora de componentes', 'Célula de componentes', 'A'),
    ('SIM-BAL-001', 'Balanceadora de cestos', 'Célula de cestos', 'B'),
    ('SIM-MNT-002', 'Estação de fixação do tanque', 'Linha principal', 'A'),
    ('SIM-EST-003', 'Esteira de inspeção final', 'Linha principal', 'B'),
    ('SIM-TST-002', 'Teste funcional de lavadoras', 'Linha principal', 'A'),
    ('SIM-EMB-002', 'Seladora de embalagens', 'Embalagem', 'C'),
]
TEAM = [
    ('SIM • Bruno Lima', 'Mecânica', '1º turno', 75),
    ('SIM • Larissa Rocha', 'Elétrica', '1º turno', 70),
    ('SIM • Diego Martins', 'Automação', '2º turno', 68),
    ('SIM • Camila Ribeiro', 'Mecânica', '2º turno', 80),
    ('SIM • Marcos Pereira', 'Instrumentação', '3º turno', 65),
    ('SIM • Paula Almeida', 'Elétrica', '3º turno', 72),
]
MATERIALS = [
    ('SIM-ROL-6305', 'Rolamento 6305 da esteira', 3, 6, 110),
    ('SIM-SEN-M12', 'Sensor indutivo M12', 5, 8, 135),
    ('SIM-COR-B47', 'Correia B47', 4, 5, 95),
    ('SIM-VAL-24V', 'Válvula solenóide 24 V', 2, 4, 210),
]
ACTIONS = {
    'Preventiva': ('Inspeção e lubrificação periódica', 'Limpeza, lubrificação e teste funcional'),
    'Corretiva emergencial': ('Falha intermitente na operação', 'Troca do componente e teste sob carga'),
    'Corretiva planejada': ('Desgaste identificado em inspeção', 'Substituição programada e teste funcional'),
    'Preditiva': ('Tendência de vibração elevada', 'Medição, ajuste e nova leitura de vibração'),
    'Inspeção': ('Verificação de condição', 'Inspeção visual, medições e registro da condição'),
    'Melhoria': ('Oportunidade de reduzir microparadas', 'Instalação de melhoria e validação em produção'),
    'Corretiva': ('Falha de acionamento', 'Reparo e teste funcional'),
}


def api(base, method, path, body=None):
    payload = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
    request = Request(base + path, data=payload, method=method,
                      headers={'Content-Type': 'application/json', 'X-PCM-Client': 'local'})
    try:
        with urlopen(request, timeout=20) as response:
            return json.load(response)
    except HTTPError as error:
        detail = error.read().decode('utf-8', 'replace')
        raise RuntimeError(f'{method} {path}: HTTP {error.code}: {detail}') from error


def month_shift(anchor, offset):
    index = anchor.year * 12 + anchor.month - 1 + offset
    return index // 12, index % 12 + 1


def order_specs(as_of):
    """100 stable cases across ten months, all civil dates at or before as_of."""
    output = []
    for month_index in range(10):
        year, month = month_shift(as_of, month_index - 9)
        last_day = calendar.monthrange(year, month)[1]
        for number in range(10):
            day = min(last_day, 2 + number * 2)
            if month_index == 9:
                day = min(as_of.day, 1 + number % max(1, as_of.day))
            requested = date(year, month, day)
            scheduled = requested + timedelta(days=1 + number % 2)
            completed = scheduled + timedelta(days=number % 2)
            kind = KINDS[(month_index * 2 + number) % len(KINDS)]
            if month_index < 9:
                status = 'Concluída' if number < 7 else 'Cancelada' if number == 7 else 'Aguardando material' if number == 8 else ['Programada', 'Em planejamento', 'Em execução'][month_index % 3]
            else:
                status = 'Concluída' if number < 3 else ['Cancelada', 'Aberta', 'Em planejamento', 'Aguardando material', 'Programada', 'Em execução', 'Aberta'][number - 3]
            if status == 'Concluída' and completed > as_of:
                completed = as_of
                scheduled = min(scheduled, completed)
            marker = f'SIM-{year}{month:02d}-{number + 1:02d}'
            output.append(dict(marker=marker, kind=kind, status=status,
                               requested=requested.isoformat(), scheduled=scheduled.isoformat(),
                               completed=completed.isoformat(), due=(requested + timedelta(days=3 + number % 4)).isoformat(),
                               asset_index=(month_index * 3 + number) % len(ASSETS),
                               team_index=(month_index + number) % len(TEAM),
                               priority=['P1', 'P2', 'P2', 'P3', 'P3', 'P4'][number % 6],
                               estimated=round(1.5 + (number % 5) * 1.25, 2)))
    return output


def backup_database(db_path):
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    target = db_path.parent / 'backups' / f'{db_path.stem}-antes-simulacao-{stamp}.sqlite3'
    target.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(db_path)) as source, closing(sqlite3.connect(target)) as copy:
        source.backup(copy)
        if copy.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Falha de integridade no backup SQLite. A carga foi cancelada.')
    return target


def ensure_master(base, table, key, rows):
    existing = {str(row[key]): row for row in api(base, 'GET', '/api/state')[table]}
    identifiers = []
    created = 0
    for value, payload in rows:
        row = existing.get(value)
        if row:
            if not value.startswith('SIM-') and not value.startswith('SIM • '):
                raise RuntimeError(f'Colisão com cadastro não simulado: {value}')
            identity_fields = {'assets': ('name', 'production_line', 'area', 'criticality'),
                               'team': ('specialty', 'shift', 'active'),
                               'materials': ('name', 'unit'),
                               'plans': ('asset_id', 'type')}.get(table, ())
            if any(row.get(field) != payload.get(field) for field in identity_fields):
                raise RuntimeError(f'Cadastro SIM alterado; revise antes de retomar: {value}')
            identifiers.append(row['id'])
            continue
        result = api(base, 'POST', f'/api/{table}', payload)
        identifiers.append(result['id'])
        created += 1
    return identifiers, created


def transition_payload(current, status, spec):
    payload = {key: value for key, value in current.items() if key != 'id'}
    payload['status'] = status
    if status in ('Programada', 'Em execução', 'Concluída'):
        payload['scheduled_date'] = spec['scheduled']
    if status == 'Aguardando material':
        payload['blocker'] = 'Aguardando item de reposição do almoxarifado (cenário SIM).'
    if status == 'Cancelada':
        payload['action'] = 'Solicitação simulada cancelada após reavaliação da necessidade.'
    if status == 'Concluída':
        payload['completed_date'] = spec['completed']
        payload['actual_hours'] = round(spec['estimated'] * (0.75 + (spec['team_index'] % 4) * 0.16), 2)
        payload['labor_rate'] = 65 + (spec['team_index'] % 3) * 12
        payload['material_cost'] = [0, 45, 110, 180][spec['asset_index'] % 4]
        if spec['kind'] in ('Corretiva', 'Corretiva emergencial'):
            payload['downtime_hours'] = round(payload['actual_hours'] * 0.7, 2)
            payload['failure'] = ACTIONS[spec['kind']][0]
            payload['cause'] = 'Componente desgastado; causa simulada para análise histórica.'
        payload['action'] = ACTIONS[spec['kind']][1] + '. Resultado aprovado pela produção (simulação).'
    return payload


def ensure_order(base, spec, assets, team, known):
    title = f"[{spec['marker']}] {ACTIONS[spec['kind']][0]} — {ASSETS[spec['asset_index']][1]}"
    target = spec['status']
    path = ['Aberta']
    if target == 'Cancelada':
        path.append('Cancelada')
    elif target != 'Aberta':
        path.append('Em planejamento')
        if target == 'Aguardando material':
            path.append(target)
        elif target in ('Programada', 'Em execução', 'Concluída'):
            path.append('Programada')
            if target in ('Em execução', 'Concluída'):
                path.append('Em execução')
            if target == 'Concluída':
                path.append(target)
    current = known.get(spec['marker'])
    created = False
    if current is None:
        employee = TEAM[spec['team_index']]
        current = dict(title=title, asset_id=assets[spec['asset_index']], type=spec['kind'],
                       priority=spec['priority'], status='Aberta', shift=employee[2],
                       requested_date=spec['requested'], due_date=spec['due'],
                       assignee_id=team[spec['team_index']], estimated_hours=spec['estimated'],
                       description=f"Caso histórico fictício {spec['marker']}; dados apenas para validação.",
                       checklist='Confirmar segurança e bloqueio\nExecutar atividade\nRegistrar medições e resultado')
        current['id'] = api(base, 'POST', '/api/orders', current)['id']
        known[spec['marker']] = current
        created = True
    elif current['title'] != title or current['description'] != f"Caso histórico fictício {spec['marker']}; dados apenas para validação.":
        raise RuntimeError(f'OS com marcador alterado; intervenção manual necessária: {spec["marker"]}')
    if current['status'] not in path:
        raise RuntimeError(f'Estado incompatível para retomada de {spec["marker"]}: {current["status"]}')
    transitions = 0
    order_id = current['id']
    for status in path[path.index(current['status']) + 1:]:
        current = transition_payload(current, status, spec)
        api(base, 'PUT', f'/api/orders/{order_id}', current)
        current['id'] = order_id
        transitions += 1
    known[spec['marker']] = current
    return created, transitions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--as-of', type=date.fromisoformat, default=date.today())
    parser.add_argument('--base-url', default='http://127.0.0.1:8765')
    parser.add_argument('--db', type=Path, default=ROOT / 'data' / 'pcm.sqlite3')
    parser.add_argument('--limit', type=int, default=100, help='Somente para ensaiar uma carga parcial; máximo 100.')
    parser.add_argument('--apply', action='store_true', help='Gravar na base local após criar backup SQLite.')
    args = parser.parse_args()
    if urlparse(args.base_url).hostname != '127.0.0.1' or urlparse(args.base_url).scheme != 'http':
        parser.error('A simulação só pode usar http://127.0.0.1 em uma instância local.')
    if not 1 <= args.limit <= 100 or args.as_of > date.today():
        parser.error('Limite inválido ou data de referência futura.')
    specs = order_specs(args.as_of)[:args.limit]
    print(f'Prévia: {len(specs)} OS fictícias em dez meses até {args.as_of}; '
          f'{len(ASSETS)} máquinas, {len(TEAM)} técnicos, {len(MATERIALS)} materiais.')
    if not args.apply:
        print('Nada foi alterado. Execute novamente com --apply para criar backup e carregar os dados.')
        return
    db_path = args.db.resolve(strict=True)
    base = args.base_url.rstrip('/')
    server_db_path = Path(api(base, 'GET', '/api/local-db-path')['path']).resolve(strict=True)
    if not db_path.samefile(server_db_path):
        raise RuntimeError('A instância HTTP usa outro arquivo SQLite. Carga cancelada antes do backup.')
    before = api(base, 'GET', '/api/state')
    with closing(sqlite3.connect(db_path)) as db:
        for table in ('assets', 'team', 'materials', 'plans', 'projects', 'orders'):
            count = db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
            if count != len(before[table]):
                raise RuntimeError('A instância HTTP e o banco informado não coincidem. Carga cancelada.')
    manifest = db_path.parent / f'simulacao-historica-{args.as_of:%Y%m%d}.json'
    previous = json.loads(manifest.read_text(encoding='utf-8')) if manifest.exists() else {}
    original_backup = previous.get('original_backup')
    if original_backup and not Path(original_backup).is_file():
        raise RuntimeError('O backup original do manifesto não foi encontrado. Carga cancelada.')
    backup = backup_database(db_path)
    original_backup = original_backup or str(backup)
    def save_manifest(payload):
        temporary = manifest.with_suffix('.tmp')
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(manifest)
    save_manifest(dict(as_of=args.as_of.isoformat(), original_backup=original_backup,
                       last_run_backup=str(backup), status='em andamento'))
    print(f'Backup íntegro antes da carga: {backup}')
    asset_rows = [(tag, dict(tag=tag, name=name, production_line=line if line == 'Linha principal' else '',
                             area='' if line == 'Linha principal' else line, criticality=criticality,
                             operating_hours_month=480, notes='Equipamento fictício para simulação histórica.'))
                  for tag, name, line, criticality in ASSETS]
    team_rows = [(name, dict(name=name, specialty=specialty, shift=shift,
                             productivity_rate=productivity, hours_day=8, days_week=5, active=True))
                 for name, specialty, shift, productivity in TEAM]
    material_rows = [(code, dict(code=code, name=name, quantity=quantity, minimum=minimum,
                                 unit_cost=cost, unit='un', location='Almoxarifado (SIM)'))
                     for code, name, quantity, minimum, cost in MATERIALS]
    assets, asset_count = ensure_master(base, 'assets', 'tag', asset_rows)
    team, team_count = ensure_master(base, 'team', 'name', team_rows)
    _, material_count = ensure_master(base, 'materials', 'code', material_rows)
    plans = [(f'SIM • Plano {ASSETS[index][0]}', dict(name=f'SIM • Plano {ASSETS[index][0]}',
              asset_id=assets[index], type='Preventiva', interval_days=30 + 15 * index,
              next_date=(args.as_of + timedelta(days=7 + index * 6)).isoformat(), hours=2 + index,
              specialty='Mecânica', checklist='Verificar condição\nExecutar rotina\nRegistrar resultado', active=True))
             for index in (0, 3, 5, 7)]
    _, plan_count = ensure_master(base, 'plans', 'name', plans)
    state = api(base, 'GET', '/api/state')
    known = {row['title'].split(']')[0][1:]: row for row in state['orders']
             if row['title'].startswith('[SIM-') and ']' in row['title']}
    order_count = transition_count = 0
    for spec in specs:
        created, transitions = ensure_order(base, spec, assets, team, known)
        order_count += created
        transition_count += transitions
    after = api(base, 'GET', '/api/state')
    selected = [row for row in after['orders'] if row['title'].startswith('[SIM-')]
    statuses = {status: sum(row['status'] == status for row in selected) for status in
                ('Aberta', 'Em planejamento', 'Aguardando material', 'Programada', 'Em execução', 'Concluída', 'Cancelada')}
    if len(selected) < len(specs) or any(sum(row['title'].startswith(f"[{spec['marker']}]") for row in selected) != 1 for spec in specs):
        raise RuntimeError('Contagem de OS simuladas inconsistente após a carga.')
    save_manifest(dict(as_of=args.as_of.isoformat(), original_backup=original_backup,
                       last_run_backup=str(backup), status='concluída',
                       created=dict(assets=asset_count, team=team_count, materials=material_count,
                                    plans=plan_count, orders=order_count),
                       transitions=transition_count, statuses=statuses))
    print('Carga validada:', json.dumps(dict(created_orders=order_count, transitions=transition_count,
                                              total_simulated_orders=len(selected), statuses=statuses), ensure_ascii=False))
    print(f'Manifesto local: {manifest}')


if __name__ == '__main__':
    main()
