import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const context=vm.createContext({});
vm.runInContext(readFileSync(new URL('../public/spare-parts-import.js',import.meta.url),'utf8'),context);
const importer=context.PCMSparePartsImport;
const state={assets:[{id:1,tag:'MON-001',name:'Montadora'},{id:2,tag:'TST-001',name:'Teste'}],spare_parts:[{asset_id:1,sap_code:'100'}]};

test('valida máquina pela opção exibida na lista e normaliza SAP',()=>{
  const rows=[importer.columns,['TST-001 · Teste','Rolamento','6200Z','SKF',' sap-20 ','3']];
  assert.deepEqual(JSON.parse(JSON.stringify(importer.validate(rows,state))),[{asset_id:2,description:'Rolamento',manufacturer_code:'6200Z',manufacturer:'SKF',sap_code:'SAP-20',quantity:3}]);
});

test('rejeita máquina fora da lista, quantidade inválida e SAP duplicado',()=>{
  assert.throws(()=>importer.validate([importer.columns,['Outra','Peça','','','200','1']],state),/lista suspensa/);
  assert.throws(()=>importer.validate([importer.columns,['TST-001 · Teste','Peça','','','200','1,5']],state),/inteiro maior que zero/);
  assert.throws(()=>importer.validate([importer.columns,['MON-001 · Montadora','Peça','','','100','1']],state),/já está cadastrado/);
  assert.throws(()=>importer.validate([importer.columns,['TST-001 · Teste','A','','','200','1'],['TST-001 · Teste','B','','','200','2']],state),/repetido/);
});
