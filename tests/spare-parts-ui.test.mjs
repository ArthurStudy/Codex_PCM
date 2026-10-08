import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const app = readFileSync(resolve(root, 'public/app.js'), 'utf8');
const index = readFileSync(resolve(root, 'public/index.html'), 'utf8');

test('Spare Parts está ligado ao menu e à tela principal', () => {
  assert.match(app, /\['spares','Spare parts por máquina'/);
  assert.match(app, /spares:sparePartsPage/);
  assert.match(app, /function sparePartsPage\(\)/);
  assert.match(app, /Lista principal por SAP/);
});

test('formulário e ações de Spare Parts permanecem integrados', () => {
  assert.match(app, /spare_parts:\[\['asset_id','Máquina'/);
  assert.match(app, /action==='spares-view'/);
  assert.match(app, /action==='spare-detail'/);
  assert.match(app, /id==='spare-search'/);
});

test('agregador de Spare Parts é carregado antes da aplicação', () => {
  assert.ok(index.indexOf('/spare-parts.js') < index.indexOf('/app.js'));
});
