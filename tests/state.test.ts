import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState,
  applyAction,
  reconcile,
  validateState,
  validateAction,
} from '../src/core/state';
import type { Action, AppState } from '../src/shared/model';
let serial = 0;
const id = () => `id-${++serial}`;
const action = (s: AppState, a: Action, now = 1000) => applyAction(s, a, now, id);
function withTask() {
  return action(emptyState(), { type: 'add', title: '  Write a chapter  ' });
}
test('creates trimmed tasks with 15 minute defaults and distinct duplicate titles', () => {
  let s = withTask();
  s = action(s, { type: 'add', title: 'Write a chapter' });
  assert.equal(s.tasks[0].title, 'Write a chapter');
  assert.equal(s.tasks[0].durationMinutes, 15);
  assert.equal(s.tasks[0].sessionCount, 0);
  assert.notEqual(s.tasks[0].id, s.tasks[1].id);
});
test('rejects empty names and unsupported duration values', () => {
  assert.throws(() => action(emptyState(), { type: 'add', title: '   ' }));
  const s = withTask();
  assert.throws(() => action(s, { type: 'duration', taskId: s.tasks[0].id, minutes: 5 as never }));
  for (const minutes of [15, 20, 25, 30] as const)
    assert.equal(
      action(s, { type: 'duration', taskId: s.tasks[0].id, minutes }).tasks[0].durationMinutes,
      minutes,
    );
});
test('renames, reorders, completes, reopens and deletes without losing counts', () => {
  let s = withTask();
  const a = s.tasks[0].id;
  s = action(s, { type: 'add', title: 'Second' });
  const b = s.tasks[1].id;
  s = action(s, { type: 'rename', taskId: a, title: 'Renamed' });
  s = action(s, { type: 'reorder', taskIds: [b, a] });
  assert.equal(s.tasks[0].id, b);
  assert.throws(() => action(s, { type: 'reorder', taskIds: [a, a] }));
  s = action(s, { type: 'complete', taskId: b });
  assert.equal(s.tasks.find((t) => t.id === b)?.completedAt, 1000);
  s = action(s, { type: 'reopen', taskId: b });
  assert.equal(s.tasks.at(-1)?.id, b);
  s = action(s, { type: 'delete', taskId: a });
  assert.equal(s.tasks.length, 1);
});
test('credits exactly once at the deadline, equally for every preset', () => {
  for (const minutes of [15, 20, 25, 30] as const) {
    let s = withTask();
    const taskId = s.tasks[0].id;
    s = action(s, { type: 'duration', taskId, minutes });
    s = action(s, { type: 'start', taskId });
    const deadline = 1000 + minutes * 60000;
    assert.equal(s.session?.status === 'running' && s.session.deadline, deadline);
    assert.equal(reconcile(s, deadline - 1).state.tasks[0].sessionCount, 0);
    const expired = reconcile(s, deadline);
    assert.equal(expired.state.tasks[0].sessionCount, 1);
    assert.equal(expired.state.session, null);
    assert.equal(expired.expired?.taskTitle, 'Write a chapter');
    assert.equal(reconcile(expired.state, deadline + 1).expired, null);
    assert.equal(reconcile(expired.state, deadline + 1).state.tasks[0].sessionCount, 1);
  }
});
test('pause freezes remaining time; resume starts from remaining time; stale commands rejected', () => {
  let s = withTask();
  s = action(s, { type: 'start', taskId: s.tasks[0].id });
  const sid = s.session!.id;
  s = action(s, { type: 'pause', sessionId: sid }, 61000);
  assert.equal(s.session?.status === 'paused' && s.session.remainingMs, 840000);
  assert.equal(reconcile(s, 99999999).state.tasks[0].sessionCount, 0);
  s = action(s, { type: 'resume', sessionId: sid }, 2000000);
  assert.equal(s.session?.status === 'running' && s.session.deadline, 2840000);
  assert.throws(() => action(s, { type: 'discard', sessionId: 'old' }));
  assert.throws(() => action(s, { type: 'duration', taskId: s.tasks[0].id, minutes: 30 }));
  s = action(s, { type: 'discard', sessionId: sid });
  assert.equal(s.session, null);
  assert.equal(s.tasks[0].sessionCount, 0);
});
test('one timer; explicit switch replaces session without credit; completing/deleting stops partial sessions', () => {
  let s = withTask();
  const a = s.tasks[0].id;
  s = action(s, { type: 'add', title: 'Second' });
  const b = s.tasks[1].id;
  s = action(s, { type: 'start', taskId: a });
  const old = s.session!.id;
  assert.throws(() => action(s, { type: 'start', taskId: b }));
  s = action(s, { type: 'switch', taskId: b, sessionId: old });
  assert.notEqual(s.session!.id, old);
  assert.equal(s.tasks[0].sessionCount, 0);
  s = action(s, { type: 'complete', taskId: b });
  assert.equal(s.session, null);
  assert.throws(() => action(s, { type: 'start', taskId: b }));
  s = action(s, { type: 'start', taskId: a });
  s = action(s, { type: 'delete', taskId: a });
  assert.equal(s.session, null);
});
test('validates persisted structure and rejects unknown IPC actions and malformed values', () => {
  const s = withTask();
  assert.deepEqual(validateState(s), s);
  for (const bad of [
    null,
    {},
    { ...s, version: 2 },
    { ...s, tasks: [s.tasks[0], s.tasks[0]] },
    {
      ...s,
      session: {
        id: 's',
        taskId: 'missing',
        status: 'running',
        durationMinutes: 15,
        deadline: 1000,
      },
    },
  ])
    assert.throws(() => validateState(bad));
  for (const bad of [
    null,
    { type: 'erase-disk' },
    { type: 'add', title: 7 },
    { type: 'reorder', taskIds: [4] },
    { type: 'login', enabled: 'yes' },
  ])
    assert.throws(() => validateAction(bad));
  assert.deepEqual(validateAction({ type: 'add', title: 'Test' }), { type: 'add', title: 'Test' });
});
