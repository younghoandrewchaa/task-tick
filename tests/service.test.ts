import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskService } from '../src/core/service';
import { emptyState } from '../src/core/state';
import type { AppState, Expiry, StateStore } from '../src/shared/model';
function fixture(initial = emptyState()) {
  let now = 1000, serial = 0, disk = structuredClone(initial), fail = false;
  const events: string[] = [], expiries: Expiry[] = [];
  const store: StateStore = { load: async()=>({state:disk}), save: async s=>{ if(fail) throw new Error('Disk full'); disk=structuredClone(s); events.push('saved'); } };
  const service = new TaskService({ state: initial, store, clock: ()=>now, id: ()=>`id-${++serial}`, onExpiry:e=>{events.push('expired');expiries.push(e);} });
  return {service,store,events,expiries,time:(t:number)=>{now=t;},fail:()=>{fail=true;},disk:()=>disk};
}
async function running() { const f=fixture(); await f.service.dispatch({type:'add',title:'Draft'}); const taskId=f.service.snapshot().state.tasks[0].id; await f.service.dispatch({type:'start',taskId}); return {...f, taskId}; }
test('concurrent expiry checks save once before effects and publish one credit', async()=>{
  const f=await running(); f.time(901000); f.events.length=0;
  await Promise.all([f.service.reconcile(), f.service.reconcile(), f.service.reconcile()]);
  assert.equal(f.disk().tasks[0].sessionCount,1); assert.equal(f.expiries.length,1); assert.deepEqual(f.events,['saved','expired']);
});
test('startup and wake reconcile overdue state without re-credit on reload', async()=>{
  const f=await running(); f.time(2000000); await f.service.reconcile();
  const restarted=fixture(f.disk()); restarted.time(3000000); await restarted.service.reconcile();
  assert.equal(restarted.disk().tasks[0].sessionCount,1); assert.equal(restarted.expiries.length,0);
});
test('failed save preserves live and disk state and emits no expiry; retry can credit', async()=>{
  const f=await running(); f.fail(); f.time(901000);
  await assert.rejects(()=>f.service.reconcile(), /Disk full/);
  assert.equal(f.service.snapshot().state.tasks[0].sessionCount,0); assert.equal(f.disk().tasks[0].sessionCount,0); assert.equal(f.expiries.length,0);
  await assert.rejects(()=>f.service.dispatch({type:'add',title:'Unsaved'})); assert.equal(f.service.snapshot().state.tasks.length,1);
});
test('expired session is credited before stale action rejects, and queue survives errors', async()=>{
  const f=await running(); const sessionId=f.service.snapshot().state.session!.id; f.time(901000);
  await assert.rejects(()=>f.service.dispatch({type:'pause',sessionId})); assert.equal(f.service.snapshot().state.tasks[0].sessionCount,1);
  await f.service.dispatch({type:'rename',taskId:f.taskId,title:'Renamed'}); assert.equal(f.disk().tasks[0].title,'Renamed');
});
test('completion at deadline credits first; partial completion does not', async()=>{
  const f=await running(); f.time(901000); await f.service.dispatch({type:'complete',taskId:f.taskId}); assert.equal(f.disk().tasks[0].sessionCount,1); assert.equal(f.disk().session,null);
  const g=await running(); g.time(5000); await g.service.dispatch({type:'complete',taskId:g.taskId}); assert.equal(g.disk().tasks[0].sessionCount,0);
});
test('paused reload retains remaining time and snapshot mutation cannot change service truth', async()=>{
  const f=await running(); const sessionId=f.service.snapshot().state.session!.id; f.time(61000); await f.service.dispatch({type:'pause',sessionId});
  const restarted=fixture(f.disk()); restarted.time(99999999); await restarted.service.reconcile();
  const snap=restarted.service.snapshot(); assert.equal(snap.state.session?.status==='paused'&&snap.state.session.remainingMs,840000);
  snap.state.tasks[0].title='External mutation'; assert.equal(restarted.service.snapshot().state.tasks[0].title,'Draft');
});
