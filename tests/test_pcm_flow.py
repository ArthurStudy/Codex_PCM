"""Independent acceptance tests: real HTTP API, disposable SQLite only.

Run: python -m unittest discover -s tests -v
"""
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from datetime import date, timedelta
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import urlencode


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pcm_acceptance_server', ROOT / 'server.py')
pcm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pcm)


class QuietHandler(pcm.Handler):
    def log_message(self, *args):
        pass


class PCMFlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='pcm-acceptance-')
        pcm.DB = Path(self.tmp.name) / 'test.sqlite3'
        pcm.initialize()
        self.http = pcm.ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = 'http://127.0.0.1:' + str(self.http.server_port)
        self.call('POST', '/api/clear-demo', {'confirmation': 'LIMPAR DEMONSTRAÇÃO'})
        self.today = date.today().isoformat()
        self.yesterday = (date.today() - timedelta(days=1)).isoformat()
        self.asset = self.create('assets', dict(tag='QA-LAV-01', name='Transportador de lavadoras', area='Linha principal', criticality='A'))
        self.tech = self.create('team', dict(name='Técnico de teste', specialty='Mecânica', hours_day=8))

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def call(self, method, route, payload=None, expected=200):
        raw = json.dumps(payload).encode() if payload is not None else None
        request = Request(self.base + route, raw, method=method, headers={'Content-Type': 'application/json', 'X-PCM-Client': 'local'})
        try:
            with urlopen(request, timeout=5) as response:
                code, body = response.status, json.load(response)
        except HTTPError as error:
            code, body = error.code, json.load(error)
        self.assertEqual(code, expected, f'{method} {route}: {body}')
        return body

    def create(self, table, values):
        return self.call('POST', '/api/' + table, values)['id']

    def state(self):
        return self.call('GET', '/api/state')

    def order(self, rid):
        return next(order for order in self.state()['orders'] if order['id'] == rid)

    def update(self, rid, expected=200, **values):
        data = dict(self.order(rid), **values)
        self.call('PUT', '/api/orders/' + str(rid), data, expected)

    def new_order(self, **values):
        return self.create('orders', dict(title='Corrigir travamento da esteira', asset_id=self.asset, requested_date=self.yesterday, type='Corretiva', estimated_hours=4, **values))

    def metrics(self):
        return self.call('GET', '/api/metrics?start=' + self.yesterday + '&end=' + self.today)

    def test_complete_order_changes_backlog_and_metrics_and_persists(self):
        rid = self.new_order()
        self.assertEqual(self.metrics()['backlog_count'], 1)
        self.assertEqual(self.metrics()['backlog_hours'], 4)
        self.update(rid, status='Em planejamento')
        self.update(rid, status='Programada', scheduled_date=self.today, assignee_id=self.tech)
        self.assertEqual(self.metrics()['planned'], 1)
        self.assertEqual(self.metrics()['adherence'], 0)
        self.update(rid, status='Em execução')
        self.update(rid, status='Concluída', completed_date=self.today, actual_hours=3, downtime_hours=2, labor_rate=100, material_cost=150, failure='Transportador parado', cause='Rolamento travado', action='Substituído rolamento e realizado teste funcional')
        result = self.metrics()
        for key, expected in {'backlog_count': 0, 'backlog_hours': 0, 'completed': 1, 'completed_hours': 3, 'cost': 450, 'failures': 1, 'downtime': 2, 'mttr': 2, 'on_time': 1, 'adherence': 100, 'preventive_share': 0}.items():
            self.assertEqual(result[key], expected, key)
        pcm.initialize()  # reopening/reinitialization must preserve the stored order
        self.assertEqual(self.order(rid)['status'], 'Concluída')
        with pcm.connect() as db:
            stored = pcm.all_rows(db, 'orders')
        self.assertEqual(stored[0]['actual_hours'], 3)
        self.assertGreaterEqual(len(self.state()['audit']), 7)

    def test_rejects_skips_and_incomplete_closure_without_mutating(self):
        rid = self.new_order()
        self.update(rid, expected=400, status='Concluída', completed_date=self.today, action='Fechado direto')
        self.assertEqual(self.order(rid)['status'], 'Aberta')
        self.update(rid, expected=400, status='Programada')
        self.update(rid, status='Programada', scheduled_date=self.today, assignee_id=self.tech)
        self.update(rid, status='Em execução')
        self.update(rid, expected=400, status='Concluída', completed_date=self.today, action='Troca')
        self.update(rid, expected=400, status='Concluída', completed_date=self.today, action='Troca', actual_hours=2)
        self.assertEqual(self.order(rid)['status'], 'Em execução')
        self.assertEqual(self.metrics()['completed'], 0)

    def test_cancelled_work_excluded_and_future_programming_not_due(self):
        cancelled = self.new_order()
        self.update(cancelled, status='Programada', scheduled_date=self.today, assignee_id=self.tech)
        self.update(cancelled, expected=400, status='Cancelada')
        self.update(cancelled, status='Cancelada', action='Serviço cancelado: solicitação duplicada')
        future = self.new_order()
        self.update(future, status='Programada', scheduled_date=(date.today()+timedelta(days=2)).isoformat(), assignee_id=self.tech)
        result = self.metrics()
        self.assertEqual(result['backlog_count'], 1)
        self.assertEqual(result['planned'], 0)
        self.assertIsNone(result['adherence'])
        self.assertIsNone(result['mttr'])

    def test_plan_generation_deduplicates_occurrence_and_advances_date(self):
        plan = self.create('plans', dict(name='Inspeção do transportador', asset_id=self.asset, next_date=self.today, interval_days=7, hours=2, checklist='Inspecionar rolamentos\nTestar sensor'))
        rid = self.call('POST', f'/api/plans/{plan}/generate', {'expected_date': self.today})['id']
        order = self.order(rid)
        self.assertEqual(order['plan_id'], plan)
        self.assertEqual(order['status'], 'Aberta')
        self.assertEqual(order['estimated_hours'], 2)
        self.assertIn('Testar sensor', order['checklist'])
        self.call('POST', f'/api/plans/{plan}/generate', {'expected_date': self.today}, expected=400)
        self.assertEqual(len(self.state()['orders']), 1)
        self.assertEqual(self.state()['plans'][0]['next_date'], (date.today()+timedelta(days=7)).isoformat())

    def test_backup_restore_is_atomic_and_protects_references(self):
        rid = self.new_order()
        self.call('DELETE', '/api/assets/' + str(self.asset), expected=400)
        backup = self.call('GET', '/api/backup')
        original_count = len(self.state()['orders'])
        broken = json.loads(json.dumps(backup))
        broken['data']['orders'][0]['asset_id'] = 999999
        self.call('POST', '/api/restore', broken, expected=400)
        self.assertEqual(len(self.state()['orders']), original_count)
        self.assertEqual(self.order(rid)['asset_id'], self.asset)
        self.call('POST', '/api/restore', backup)
        self.assertEqual(self.order(rid)['title'], backup['data']['orders'][0]['title'])

    def test_overdue_plan_preserves_due_date_in_backlog(self):
        plan = self.create('plans', dict(name='Preventiva vencida', asset_id=self.asset, next_date=self.yesterday, interval_days=30, hours=2))
        rid = self.call('POST', f'/api/plans/{plan}/generate', {'expected_date': self.yesterday})['id']
        self.assertEqual(self.order(rid)['due_date'], self.yesterday)
        self.assertEqual(self.metrics()['overdue'], 1)

    def test_duplicate_tag_and_negative_hours_rejected(self):
        self.call('POST', '/api/assets', dict(tag='qa-lav-01', name='Duplicado', area='Linha principal'), expected=400)
        rid = self.new_order()
        self.update(rid, expected=400, estimated_hours=-1)
        self.assertEqual(self.order(rid)['estimated_hours'], 4)

    def test_filters_and_shift_assignment_keep_scope_consistent(self):
        rid = self.new_order(shift='2º turno')
        self.update(rid, expected=400, status='Programada', scheduled_date=self.today, assignee_id=self.tech)
        technician = self.create('team', dict(name='Técnico segundo turno', specialty='Mecânica', hours_day=8, days_week=5, shift='2º turno'))
        self.update(rid, status='Programada', scheduled_date=self.today, assignee_id=technician)
        query = dict(start=self.yesterday, end=self.today, area='Linha principal', shift='2º turno')
        result = self.call('GET', '/api/metrics?' + urlencode(query))
        self.assertEqual(result['backlog_count'], 1)
        self.assertEqual(result['weekly_capacity'], 40)
        self.assertEqual(result['backlog_weeks'], .1)
        query['shift'] = '1º turno'
        self.assertEqual(self.call('GET', '/api/metrics?' + urlencode(query))['backlog_count'], 0)
        query['shift'] = '2º turno'
        query['area'] = 'Célula distinta'
        self.assertEqual(self.call('GET', '/api/metrics?' + urlencode(query))['backlog_count'], 0)

    def test_productivity_capacity_backup_legacy_and_persistence(self):
        self.new_order()
        def save(rate):
            person = next(t for t in self.state()['team'] if t['id'] == self.tech)
            self.call('PUT', '/api/team/' + str(self.tech), dict(person, productivity_rate=rate))
        self.assertEqual(self.state()['team'][0]['productivity_rate'], 100)
        save(50)
        self.assertEqual(self.metrics()['weekly_capacity'], 20)
        self.assertEqual(self.metrics()['backlog_weeks'], .2)
        pcm.initialize()
        self.assertEqual(self.state()['team'][0]['productivity_rate'], 50)
        backup = self.call('GET', '/api/backup')
        self.assertEqual(backup['data']['team'][0]['productivity_rate'], 50)
        save(0)
        self.assertEqual(self.metrics()['weekly_capacity'], 0)
        self.assertIsNone(self.metrics()['backlog_weeks'])
        self.call('POST', '/api/restore', backup)
        self.assertEqual(self.state()['team'][0]['productivity_rate'], 50)
        del backup['data']['team'][0]['productivity_rate']
        self.call('POST', '/api/restore', backup)
        self.assertEqual(self.state()['team'][0]['productivity_rate'], 100)
        self.assertEqual(self.metrics()['weekly_capacity'], 40)
        self.create('team', dict(name='Segundo turno', shift='2º turno', productivity_rate=25))
        self.create('team', dict(name='Inativo', active=False, productivity_rate=100))
        self.assertEqual(self.metrics()['weekly_capacity'], 50)
        query = urlencode(dict(start=self.yesterday, end=self.today, shift='2º turno'))
        self.assertEqual(self.call('GET', '/api/metrics?' + query)['weekly_capacity'], 10)

    def test_invalid_productivity_and_boolean_numbers_are_rejected_atomically(self):
        before = self.state()
        person = before['team'][0]
        for rate in [-1, 100.01, None, True, [], {}, '', 'abc', float('inf')]:
            with self.subTest(rate=rate):
                self.call('PUT', '/api/team/' + str(self.tech), dict(person, productivity_rate=rate), expected=400)
                self.assertEqual(self.state(), before)
        for field in ('hours_day', 'days_week', 'productivity_rate'):
            with self.subTest(field=field):
                invalid = self.call('PUT', '/api/team/' + str(self.tech), dict(person, **{field: True}), expected=400)
                self.assertIn('Número inválido', invalid['error'])
                self.assertEqual(self.state(), before)
        rid = self.create('orders', dict(title='Validação numérica', asset_id=self.asset, requested_date=self.today))
        order = self.order(rid)
        for value in (True, False):
            with self.subTest(estimated_hours=value):
                invalid = self.call('PUT', '/api/orders/' + str(rid), dict(order, estimated_hours=value), expected=400)
                self.assertIn('Número inválido', invalid['error'])
                self.assertEqual(self.order(rid)['estimated_hours'], 2)
        before_restore = self.state()
        backup = self.call('GET', '/api/backup')
        backup['data']['orders'][0]['estimated_hours'] = True
        invalid = self.call('POST', '/api/restore', backup, expected=400)
        self.assertIn('Número inválido', invalid['error'])
        self.assertEqual(self.state(), before_restore)

    def test_spare_parts_persist_by_machine_and_legacy_backup_restores_empty_list(self):
        second = self.create('assets', dict(tag='QA-LAV-02', name='Prensa', production_line='Linha 2'))
        first = self.create('spare_parts', dict(asset_id=self.asset, description='Sensor indutivo', manufacturer_code='XS-18', manufacturer='Acme', sap_code=' 000123 ', quantity=2))
        self.create('spare_parts', dict(asset_id=second, description='Sensor indutivo', manufacturer_code='XS-18', manufacturer='Acme', sap_code='000123', quantity=3))
        parts = self.state()['spare_parts']
        self.assertEqual(next(part for part in parts if part['id'] == first)['sap_code'], '000123')
        self.assertEqual(sum(part['quantity'] for part in parts), 5)
        self.call('POST', '/api/spare_parts', dict(asset_id=self.asset, description='Duplicado', sap_code='000123', quantity=1), expected=400)
        self.call('DELETE', '/api/assets/' + str(self.asset), {}, expected=400)
        backup = self.call('GET', '/api/backup')
        del backup['data']['spare_parts']
        self.call('POST', '/api/restore', backup)
        self.assertEqual(self.state()['spare_parts'], [])

    def test_spare_parts_excel_batch_is_atomic(self):
        second = self.create('assets', dict(tag='QA-LAV-02', name='Prensa', production_line='Linha 2'))
        part = dict(asset_id=self.asset, description='Rolamento', manufacturer_code='6200Z', manufacturer='SKF', sap_code='SAP-IMP', quantity=2)
        result = self.call('POST', '/api/spare_parts/import', {'spare_parts': [part, dict(part, asset_id=second, quantity=3)]})
        self.assertEqual(result['count'], 2)
        invalid = [dict(part, sap_code='NOVO'), dict(part, asset_id=999, sap_code='ERRO')]
        self.call('POST', '/api/spare_parts/import', {'spare_parts': invalid}, expected=400)
        self.assertFalse(any(row['sap_code'] == 'NOVO' for row in self.state()['spare_parts']))

    def test_completion_date_and_terminal_transition_are_guarded(self):
        rid = self.new_order()
        self.update(rid, status='Programada', scheduled_date=self.today, assignee_id=self.tech)
        self.update(rid, status='Em execução')
        closure = dict(status='Concluída', completed_date=self.today, action='Troca e teste', actual_hours=2, failure='Falha mecânica', cause='Em análise')
        self.update(rid, expected=400, **dict(closure, completed_date=(date.today()+timedelta(days=1)).isoformat()))
        self.update(rid, **closure)
        self.update(rid, expected=400, status='Aberta')
        self.assertEqual(self.order(rid)['status'], 'Concluída')


if __name__ == '__main__':
    unittest.main(verbosity=2)
