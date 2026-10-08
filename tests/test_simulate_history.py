"""Historical simulation through the real local HTTP API and temporary SQLite."""
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]


class SimulatedHistoryTests(unittest.TestCase):
    def test_ten_months_resume_without_duplicates_and_preserve_original_rows(self):
        with tempfile.TemporaryDirectory(prefix='pcm-history-test-') as temporary:
            database = Path(temporary) / 'history.sqlite3'
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                port = listener.getsockname()[1]
            base = f'http://127.0.0.1:{port}'
            environment = dict(os.environ, PCM_DB=str(database))
            server = subprocess.Popen([sys.executable, str(ROOT / 'server.py'), '--port', str(port)],
                                      cwd=ROOT, env=environment, stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL)
            try:
                for _ in range(60):
                    try:
                        initial = self.state(base)
                        break
                    except Exception:
                        if server.poll() is not None:
                            self.fail('O servidor local de teste encerrou antes de iniciar.')
                        time.sleep(0.1)
                else:
                    self.fail('O servidor local de teste não respondeu.')
                original_ids = {row['id'] for row in initial['orders']}
                preview = self.run_generator(base, database, '--limit', '10')
                self.assertIn('Nada foi alterado', preview)
                self.assertEqual(len(self.state(base)['orders']), len(initial['orders']))

                partial = self.run_generator(base, database, '--limit', '10', '--apply')
                self.assertIn('"created_orders": 10', partial)
                self.assertEqual(len([o for o in self.state(base)['orders'] if o['title'].startswith('[SIM-')]), 10)
                full = self.run_generator(base, database, '--apply')
                self.assertIn('"created_orders": 90', full)
                again = self.run_generator(base, database, '--apply')
                self.assertIn('"created_orders": 0', again)
                self.assertIn('"transitions": 0', again)

                final = self.state(base)
                simulated = [row for row in final['orders'] if row['title'].startswith('[SIM-')]
                self.assertEqual(len(simulated), 100)
                self.assertEqual(len({row['title'] for row in simulated}), 100)
                self.assertTrue(original_ids.issubset({row['id'] for row in final['orders']}))
                self.assertEqual(sum(row['status'] == 'Concluída' for row in simulated), 66)
                self.assertEqual(sum(row['status'] == 'Cancelada' for row in simulated), 10)
                self.assertEqual(sum(row['status'] not in ('Concluída', 'Cancelada') for row in simulated), 24)
                self.assertEqual(len([a for a in final['assets'] if a['tag'].startswith('SIM-')]), 9)
                self.assertEqual(len([t for t in final['team'] if t['name'].startswith('SIM • ')]), 6)
                january = self.metrics(base, '2026-01-01', '2026-01-31')
                independent = sum(row['status'] == 'Concluída' and '2026-01-01' <= row['completed_date'] <= '2026-01-31'
                                  for row in final['orders'])
                self.assertEqual(january['completed'], independent)
                self.assertGreater(january['completed'], 0)
                manifest = json.loads((database.parent / 'simulacao-historica-20261007.json').read_text(encoding='utf-8'))
                self.assertEqual(manifest['created']['orders'], 0)
                self.assertNotEqual(manifest['original_backup'], manifest['last_run_backup'])
                with closing(sqlite3.connect(manifest['last_run_backup'])) as backup:
                    self.assertEqual(backup.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                    self.assertEqual(backup.execute('SELECT COUNT(*) FROM orders').fetchone()[0], len(final['orders']))
                with closing(sqlite3.connect(manifest['original_backup'])) as backup:
                    self.assertEqual(backup.execute('SELECT COUNT(*) FROM orders').fetchone()[0], len(initial['orders']))
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)

    @staticmethod
    def state(base):
        with urlopen(base + '/api/state', timeout=3) as response:
            return json.load(response)

    @staticmethod
    def metrics(base, start, end):
        with urlopen(base + f'/api/metrics?start={start}&end={end}', timeout=3) as response:
            return json.load(response)

    @staticmethod
    def run_generator(base, database, *options):
        command = [sys.executable, str(ROOT / 'scripts' / 'simulate_history.py'),
                   '--base-url', base, '--db', str(database), '--as-of', '2026-10-07', *options]
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise AssertionError(f'Gerador falhou:\n{result.stdout}\n{result.stderr}')
        return result.stdout


if __name__ == '__main__':
    unittest.main()
