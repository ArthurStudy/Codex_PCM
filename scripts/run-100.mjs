import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..',import.meta.url)));
function run(label, command, args, parseCount, env = process.env) {
  const result = spawnSync(command, args, { cwd:root, env, encoding:'utf8', windowsHide:true, maxBuffer:16*1024*1024 });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(`\n--- ${label} ---\n${output}`);
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} encerrou com código ${result.status}.`);
  const count = parseCount(output);
  if (!Number.isInteger(count)) throw new Error(`Não foi possível contar os testes de ${label}.`);
  return count;
}

const wrangler = resolve(root,'node_modules','wrangler','bin','wrangler.js');
if (!existsSync(wrangler)) throw new Error('Dependências ausentes. Execute pnpm install --frozen-lockfile antes.');
run('Build local Cloudflare',process.execPath,[wrangler,'deploy','--dry-run','--outdir','dist'],()=>0);
const nodeCount = run('Testes Node e runtime Cloudflare',process.execPath,[
  '--test','--test-reporter=tap',
  'tests/worker.test.mjs','tests/capacity.test.mjs','tests/excel-export.test.mjs',
  'tests/pcm-acceptance-100.test.mjs','tests/kpi-dashboard.test.mjs','tests/spare-parts.test.mjs',
  'tests/spare-parts-ui.test.mjs','tests/cloudflare-runtime.test.mjs'
],output => Number(/^1\.\.(\d+)$/m.exec(output)?.[1]));

const pythonCandidates = process.env.PYTHON ? [[process.env.PYTHON,[]]] : process.platform === 'win32'
  ? [['py',['-3']],['python',[]],['python3',[]],...[resolve(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe')].filter(existsSync).map(path=>[path,[]])]
  : [['python3',[]],['python',[]]];
let pythonCount;
let pythonError;
const pythonTemp = mkdtempSync(join(root,'.pcm-100-test-'));
try {
  for (const [command,prefix] of pythonCandidates) {
    const version = spawnSync(command,[...prefix,'--version'],{cwd:root,encoding:'utf8',windowsHide:true});
    if (version.error || version.status !== 0) continue;
    try {
      const env = {...process.env,TMP:pythonTemp,TEMP:pythonTemp,TMPDIR:pythonTemp};
      pythonCount = run('Testes Python HTTP com SQLite temporário',command,[...prefix,'-m','unittest','discover','-s','tests','-v'],output => Number(/Ran (\d+) tests?/.exec(output)?.[1]),env);
      break;
    } catch (error) { pythonError = error; break; }
  }
} finally { rmSync(pythonTemp,{recursive:true,force:true}); }
if (!Number.isInteger(pythonCount)) throw pythonError || new Error('Python 3 não encontrado. Instale Python 3 ou defina a variável PYTHON.');

const total = nodeCount + pythonCount;
process.stdout.write(`\nTotal contabilizado: ${nodeCount} Node + ${pythonCount} Python = ${total}/${total} aprovados (100%).\n`);
if (total < 100) throw new Error(`A suíte deveria cobrir pelo menos 100 testes; encontrou ${total}.`);
