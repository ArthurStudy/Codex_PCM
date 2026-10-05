import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const context = vm.createContext({TextEncoder});
vm.runInContext(readFileSync(new URL('../public/excel-export.js', import.meta.url), 'utf8'), context);
const headers = ['OS','Atividade','Ativo','Área','Tipo','Prioridade','Situação','Turno','Solicitação','Programação','Conclusão','HH previstos','HH reais','Custo realizado'];
const order = ['OS-00001','Inspeção & revisão <motor>','00123','Produção','Preventiva','P2','Concluída','1º turno','2026-10-04','2026-10-05','',2.5,0,120.25];
function entries(rows) {
  const bytes = Buffer.from(context.PCMExcel.build(rows)), files = {};
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0);
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    const content = bytes.subarray(start, start + size);
    let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    assert.equal((crc ^ 0xffffffff) >>> 0, bytes.readUInt32LE(offset + 14), `${name} CRC`);
    files[name] = content.toString('utf8');
    offset = start + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.equal(bytes.readUInt16LE(bytes.length - 12), Object.keys(files).length);
  assert.equal(bytes.readUInt32LE(bytes.length - 6), offset);
  return files;
}

test('Excel export produces a complete XLSX archive with valid member checksums', () => {
  const files = entries([headers, order]);
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml','_rels/.rels','xl/_rels/workbook.xml.rels','xl/styles.xml','xl/workbook.xml','xl/worksheets/sheet1.xml'].sort());
  assert.match(files['xl/workbook.xml'], /name="Ordens de serviço"/);
});

test('export preserves accents, literal identifiers, decimals, zero and date types', () => {
  const sheet = entries([headers, order])['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /Inspeção &amp; revisão &lt;motor&gt;/);
  assert.match(sheet, /r="C2"[^>]*t="inlineStr"[^]*?<t[^>]*>00123<\/t>/);
  assert.match(sheet, /r="I2"[^>]*><v>46299<\/v>/);
  assert.match(sheet, /r="L2"[^>]*><v>2.5<\/v>/);
  assert.match(sheet, /r="M2"[^>]*><v>0<\/v>/);
  assert.match(sheet, /r="N2"[^>]*><v>120.25<\/v>/);
  assert.doesNotMatch(sheet, /NaN|undefined/);
});

test('user content is literal text rather than formulas or XML markup', () => {
  const row = [...order]; row[1] = '=HYPERLINK("https://example.invalid")\u0001 <tag>\nRevisão';
  const sheet = entries([headers, row])['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /t="inlineStr"><is><t[^>]*>=HYPERLINK\(&quot;/);
  assert.doesNotMatch(sheet, /<f[ >]|\u0001|<tag>/);
  assert.match(sheet, /&lt;tag&gt;\nRevisão/);
});

test('worksheet has navigation and readable formatting, including no-result export', () => {
  const files = entries([headers, order, order]);
  const sheet = files['xl/worksheets/sheet1.xml'], styles = files['xl/styles.xml'];
  assert.match(sheet, /xSplit="2" ySplit="1"[^>]*state="frozen"/);
  assert.match(sheet, /autoFilter ref="A1:N3"/);
  assert.match(sheet, /min="2" max="2" width="56"/);
  assert.match(styles, /wrapText="1"/);
  assert.match(styles, /dd\/mm\/yyyy/);
  assert.match(styles, /R\$/);
  assert.match(styles, /<b\/>/);
  assert.match(entries([headers])['xl/worksheets/sheet1.xml'], /autoFilter ref="A1:N1"/);
  assert.throws(() => context.PCMExcel.build([]), /Quantidade/);
});
