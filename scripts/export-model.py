"""Export only source-code defaults and fictional seed data, never the user's DB."""
import json
import sys
import tempfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server

target = ROOT / 'cloudflare'
target.mkdir(exist_ok=True)
model = dict(defaults=server.DEFAULTS, tables=server.TABLES, statuses=server.STATUSES,
             types=server.TYPES, shifts=server.SHIFTS, transitions=server.TRANSITIONS)
(target / 'model.json').write_text(json.dumps(model, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
with tempfile.TemporaryDirectory() as directory:
    server.DB = Path(directory) / 'demo.sqlite3'
    server.initialize()
    with server.connect() as db:
        seed = {table: server.all_rows(db, table) for table in server.TABLES}
(target / 'seed.json').write_text(json.dumps(dict(reference_date=date.today().isoformat(), data=seed), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
