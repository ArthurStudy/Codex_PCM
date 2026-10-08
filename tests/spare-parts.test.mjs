import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../public/spare-parts.js', import.meta.url), 'utf8'), context);

test('lista principal consolida quantidades pelo código SAP e preserva as máquinas de origem', () => {
  const assets=[{id:1,tag:'MAQ-01',name:'Prensa'},{id:2,tag:'MAQ-02',name:'Esteira'}];
  const parts=[
    {id:1,asset_id:1,sap_code:' 000123 ',description:'Sensor',manufacturer_code:'XS1',manufacturer:'Acme',quantity:2},
    {id:2,asset_id:2,sap_code:'000123',description:'Sensor',manufacturer_code:'XS1',manufacturer:'Acme',quantity:3},
    {id:3,asset_id:1,sap_code:'abc-9',description:'Correia',manufacturer_code:'',manufacturer:'',quantity:1}
  ];
  const catalog=context.PCMSpareParts.catalog(parts,assets);
  assert.equal(catalog.length,2);
  assert.equal(catalog[0].sap_code,'000123');
  assert.equal(catalog[0].total_quantity,5);
  assert.deepEqual(Array.from(catalog[0].usages,u=>u.machine.tag),['MAQ-01','MAQ-02']);
  assert.equal(catalog[1].sap_code,'ABC-9');
  assert.equal(catalog[1].total_quantity,1);
});

test('consolidação ignora código SAP vazio e não produz totais inválidos', () => {
  const catalog=context.PCMSpareParts.catalog([{asset_id:1,sap_code:'',quantity:2},{asset_id:1,sap_code:'SAP-1',quantity:'inválida'}],[{id:1,tag:'M1'}]);
  assert.equal(catalog.length,1);
  assert.equal(catalog[0].total_quantity,0);
});
