import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context=vm.createContext({document:{addEventListener(){}}});
vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8').split('// BEGIN KPI DASHBOARD')[1].split('// END KPI DASHBOARD')[0],context);
const filter={start:'2026-10-01',end:'2026-10-07'};
const base={status:'Concluída',type:'Corretiva emergencial',asset_id:1,shift:'1º turno',requested_date:'2026-10-01',completed_date:'2026-10-03',scheduled_date:'2026-10-03',actual_hours:2,estimated_hours:3,labor_rate:50,material_cost:20,downtime_hours:4};
const build=(orders,f=filter)=>context.buildKpiDashboard({orders,assets:[{id:1,tag:'M1',production_line:'A'},{id:2,tag:'M2',production_line:'B'}]},f,'2026-10-07');
test('empty denominators never imply perfect performance',()=>{const r=build([]);assert.equal(r.adherence,null);assert.equal(r.cost,0);assert.equal(r.pareto.length,0);assert.equal(r.trend.length,7);});
test('cancellation, current backlog and due-date cohort remain distinct',()=>{
 const r=build([{...base,id:1},{...base,id:2,status:'Cancelada'},{...base,id:3,status:'Aberta',completed_date:'',scheduled_date:'2026-10-05',due_date:'2026-10-06'},{...base,id:4,status:'Programada',scheduled_date:'2026-10-08',completed_date:''}]);
 assert.equal(r.completed.length,1);assert.equal(r.due.length,2);assert.equal(r.adherence,50);assert.equal(r.backlog.length,2);assert.equal(r.overdue.length,1);assert.equal(r.cost,120);assert.equal(r.backlogHours,6);
});
test('global filters consistently affect cards, groups and detail',()=>{const r=build([{...base,id:1},{...base,id:2,asset_id:2},{...base,id:3,shift:'2º turno'}],{...filter,area:'A',shift:'1º turno'});assert.equal(r.completed.length,1);assert.equal(r.pareto[0].value,4);assert.equal(r.trend.reduce((s,b)=>s+b.closed.length,0),1);assert.equal(r.effort[0].actual,2);});
test('previous interval boundaries and missing effort are explicit',()=>{const r=build([{...base,completed_date:'2026-09-24'},{...base,completed_date:'2026-09-30'},{...base,completed_date:'2026-09-23'},{...base,actual_hours:0}]);assert.equal(r.previous.length,2);assert.equal(r.previousCost,240);assert.equal(r.missing.length,1);});
test('Pareto conserves downtime and includes legacy corrective only',()=>{const r=build([{...base,type:'Corretiva',downtime_hours:6},{...base,asset_id:2,downtime_hours:2},{...base,type:'Preventiva',downtime_hours:100}]);assert.equal(r.downtime,8);assert.equal(r.pareto[0].cumulative,75);assert.equal(r.pareto[1].cumulative,100);assert.equal(r.pareto.flatMap(g=>g.rows).length,2);});
test('long intervals use bounded buckets without losing records or mutating inputs',()=>{const rows=[{...base,completed_date:'2026-10-07'}];const before=JSON.stringify(rows);const r=build(rows,{start:'2026-01-01',end:'2026-12-31'});assert.ok(r.trend.length<=12);assert.equal(r.trend.reduce((s,b)=>s+b.closed.length,0),1);assert.equal(JSON.stringify(rows),before);});
