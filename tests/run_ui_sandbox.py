"""Start a disposable demonstration instance for independent browser acceptance."""
import importlib.util
from pathlib import Path
import tempfile

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pcm_ui_sandbox', root / 'server.py')
pcm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pcm)
with tempfile.TemporaryDirectory(prefix='pcm-ui-acceptance-') as sandbox:
    pcm.DB = Path(sandbox) / 'test.sqlite3'
    pcm.initialize()
    print('Disposable PCM UI: http://127.0.0.1:8877', flush=True)
    try:
        pcm.ThreadingHTTPServer(('127.0.0.1', 8877), pcm.Handler).serve_forever()
    except KeyboardInterrupt:
        pass
