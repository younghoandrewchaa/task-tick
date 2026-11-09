import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandController } from '../src/main/commands';
import { TaskService } from '../src/core/service';
import { emptyState } from '../src/core/state';
async function setup(answer: () => Promise<boolean>) {
  let serial = 0,
    now = 1000;
  const service = new TaskService({
    state: emptyState(),
    store: { load: async () => ({ state: emptyState() }), save: async () => {} },
    clock: () => now,
    id: () => String(++serial),
    onExpiry: () => {},
  });
  await service.dispatch({ type: 'add', title: 'First' });
  await service.dispatch({ type: 'add', title: 'Second' });
  const [a, b] = service.snapshot().state.tasks;
  await service.dispatch({ type: 'start', taskId: a.id });
  const commands = new CommandController({
    service,
    confirm: answer,
    setLogin: (e) => e,
    snapshot: () => service.snapshot(),
  });
  return {
    service,
    commands,
    a,
    b,
    time: (t: number) => {
      now = t;
    },
  };
}
test('cancelling switch, discard and delete preserves the original running session', async () => {
  const f = await setup(async () => false),
    before = f.service.snapshot().state;
  for (const action of [
    { type: 'start', taskId: f.b.id },
    { type: 'discard', sessionId: before.session!.id },
    { type: 'delete', taskId: f.a.id },
  ]) {
    await f.commands.execute(action);
    assert.deepEqual(f.service.snapshot().state, before);
  }
});
test('confirmed switching replaces one session without credit and confirmed discard stops it', async () => {
  const f = await setup(async () => true);
  const result = await f.commands.execute({ type: 'start', taskId: f.b.id });
  assert.equal(result.ok, true);
  assert.equal(f.service.snapshot().state.session?.taskId, f.b.id);
  assert.equal(f.service.snapshot().state.tasks[0].sessionCount, 0);
  await f.commands.execute({ type: 'discard', sessionId: f.service.snapshot().state.session!.id });
  assert.equal(f.service.snapshot().state.session, null);
});
test('expiry during switch confirmation cannot start an unconfirmed replacement', async () => {
  let release!: (v: boolean) => void;
  const f = await setup(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = f.commands.execute({ type: 'start', taskId: f.b.id });
  await new Promise((resolve) => setImmediate(resolve));
  f.time(901000);
  await f.service.reconcile();
  release(true);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(f.service.snapshot().state.session, null);
  assert.equal(f.service.snapshot().state.tasks[0].sessionCount, 1);
});
test('invalid commands return errors without mutation', async () => {
  const f = await setup(async () => true),
    before = f.service.snapshot().state;
  assert.equal((await f.commands.execute({ type: 'add', title: 5 })).ok, false);
  assert.deepEqual(f.service.snapshot().state, before);
});
