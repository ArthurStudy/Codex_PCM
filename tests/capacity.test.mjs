import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const context = vm.createContext({document: {addEventListener() {}}, plus: (s,n) => {
  const d = new Date(s+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10);
}});
vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8').split('// END CAPACITY MODULE')[0],context);
const team = [{id:1,active:true,hours_day:8,days_week:5},{id:2,active:true,hours_day:6,days_week:6},{id:3,active:false,hours_day:8,days_week:5}];
const order = (id,assignee_id,scheduled_date,estimated_hours,status='Programada') => ({id,assignee_id,scheduled_date,estimated_hours,status});
const data = {team,orders:[order(1,1,'2026-10-05',10),order(2,2,'2026-10-05',2),order(3,3,'2026-10-06',3),order(4,null,'2026-10-06',4),order(5,1,'2026-10-07',100,'Concluída'),order(6,1,'2026-10-08',100,'Cancelada'),order(7,1,'',100),order(8,1,'2026-10-12',100)]};
const filter = {technician:'',start:'2026-10-05',end:'2026-10-11',group:'day'};
test('weekly totals exclude closed, cancelled, unscheduled and out-of-range orders',()=>{
  const r=context.planningCapacity(data,filter);
  assert.equal(r.capacity,76); assert.equal(r.load,19); assert.equal(r.orders.length,4);
  assert.equal(r.excess,5); assert.equal(r.unassigned.length,1);
});
test('technician filtering and inactive workload',()=>{
  const active=context.planningCapacity(data,{...filter,technician:'1'});
  assert.equal(active.capacity,40); assert.equal(active.load,10); assert.equal(active.excess,2);
  const inactive=context.planningCapacity(data,{...filter,technician:'3'});
  assert.equal(inactive.capacity,0); assert.equal(inactive.load,3); assert.equal(inactive.excess,3);
});
test('weekend capacity and fractional workweek',()=>{
  assert.equal(context.productiveHours(team[0],'2026-10-10'),0);
  assert.equal(context.productiveHours(team[1],'2026-10-10'),6);
  assert.equal(context.productiveHours({...team[0],days_week:4.5},'2026-10-09'),4);
});
test('weekly grouping retains partial weeks and daily overload',()=>{
  const r=context.planningCapacity(data,{...filter,start:'2026-10-09',end:'2026-10-13',group:'week'});
  assert.equal(r.buckets.length,2); assert.equal(r.buckets[0].start,'2026-10-09');
  assert.equal(r.buckets[0].capacity,20); assert.equal(r.buckets[1].capacity,28);
  assert.equal(r.excess,92);
});
test('empty team still reports unassigned demand without invalid percentages',()=>{
  const r=context.planningCapacity({team:[],orders:[order(1,null,'2026-10-05',4)]},filter);
  assert.equal(r.capacity,0); assert.equal(r.load,4); assert.equal(r.unassigned.length,1);
});

test('productivity adjusts useful hours, weekly totals and individual overload',()=>{
  const technicians = [{...team[0],productivity_rate:50},{...team[1],productivity_rate:25}];
  assert.equal(context.productiveHours(technicians[0],'2026-10-05'),4);
  assert.equal(context.productiveHours({...technicians[0],days_week:4.5},'2026-10-09'),2);
  assert.equal(context.productiveHours(technicians[0],'2026-10-10'),0);
  const r=context.planningCapacity({team:technicians,orders:[order(1,1,'2026-10-05',5)]},filter);
  assert.equal(r.capacity,29); assert.equal(r.load,5); assert.equal(r.excess,1);
  const selected=context.planningCapacity({team:technicians,orders:[]},{...filter,technician:'1'});
  assert.equal(selected.capacity,20);
});

test('zero productivity is retained and legacy professionals keep full capacity',()=>{
  assert.equal(context.productiveHours({...team[0],productivity_rate:0},'2026-10-05'),0);
  assert.equal(context.productiveHours({...team[0],productivity_rate:100},'2026-10-05'),8);
  assert.equal(context.productiveHours(team[0],'2026-10-05'),8);
  const r=context.planningCapacity({team:[{...team[0],productivity_rate:0}],orders:[order(1,1,'2026-10-05',4)]},filter);
  assert.equal(r.capacity,0); assert.equal(r.excess,4);
});
