import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStateStore } from '../src/main/store';
import { emptyState } from '../src/core/state';
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), 'tasktick-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, store: new FileStateStore(dir) };
}
function sample() {
  const s = emptyState();
  s.tasks.push({
    id: 't1',
    title: 'Write',
    durationMinutes: 20,
    sessionCount: 4,
    completedAt: null,
  });
  s.session = { id: 's1', taskId: 't1', durationMinutes: 20, status: 'paused', remainingMs: 10000 };
  return s;
}
test('first launch initializes empty state; complete saved state round-trips', async (t) => {
  const { store } = await fixture(t);
  assert.deepEqual((await store.load()).state, emptyState());
  const s = sample();
  await store.save(s);
  assert.deepEqual((await store.load()).state, s);
  s.session = { id: 's2', taskId: 't1', durationMinutes: 20, status: 'running', deadline: 999999 };
  await store.save(s);
  assert.deepEqual((await store.load()).state, s);
});
test('corrupt primary recovers last known good state and preserves evidence', async (t) => {
  const { dir, store } = await fixture(t);
  const s = sample();
  await store.save(s);
  s.tasks[0].sessionCount = 5;
  await store.save(s);
  await writeFile(join(dir, 'state.json'), '{broken');
  const loaded = await store.load();
  assert.equal(loaded.state.tasks[0].sessionCount, 4);
  assert.match(loaded.warning!, /recover/i);
  assert.equal(await readFile(join(dir, 'state.json'), 'utf8'), '{broken');
  await store.save(loaded.state);
  const names = await readdir(dir);
  const evidence = names.find((n) => n.startsWith('state.corrupt-'));
  assert.ok(evidence);
  assert.equal(await readFile(join(dir, evidence), 'utf8'), '{broken');
  assert.equal((await store.load()).state.tasks[0].sessionCount, 4);
});
test('missing primary recovers backup instead of silently dropping tasks', async (t) => {
  const { dir, store } = await fixture(t);
  await store.save(sample());
  await store.save(sample());
  await rm(join(dir, 'state.json'));
  const loaded = await store.load();
  assert.equal(loaded.state.tasks[0].sessionCount, 4);
  assert.match(loaded.warning!, /recover/i);
});
test('both invalid files and unsupported versions are preserved and reported', async (t) => {
  const { dir, store } = await fixture(t);
  await writeFile(join(dir, 'state.json'), JSON.stringify({ ...sample(), version: 9 }));
  await writeFile(join(dir, 'state.backup.json'), 'bad backup');
  await assert.rejects(() => store.load(), /recover|read|saved/i);
  assert.match(await readFile(join(dir, 'state.json'), 'utf8'), /"version":9/);
  assert.equal(await readFile(join(dir, 'state.backup.json'), 'utf8'), 'bad backup');
});
test('write failure preserves existing valid state; invalid state cannot be saved', async (t) => {
  const { dir, store } = await fixture(t);
  await store.save(sample());
  const before = await readFile(join(dir, 'state.json'), 'utf8');
  const invalid = sample();
  invalid.tasks[0].sessionCount = -1;
  await assert.rejects(() => store.save(invalid));
  assert.equal(await readFile(join(dir, 'state.json'), 'utf8'), before);
  const blocker = join(dir, 'not-a-directory');
  await writeFile(blocker, 'block');
  const blocked = new FileStateStore(blocker);
  await assert.rejects(() => blocked.save(sample()));
  assert.equal(await readFile(blocker, 'utf8'), 'block');
});
test('failure replacing primary does not erase backup', async (t) => {
  const { dir, store } = await fixture(t);
  await store.save(sample());
  await store.save(sample());
  await rm(join(dir, 'state.json'));
  await mkdir(join(dir, 'state.json'));
  await assert.rejects(() => store.save(sample()));
  assert.equal(
    JSON.parse(await readFile(join(dir, 'state.backup.json'), 'utf8')).tasks[0].sessionCount,
    4,
  );
});

test('a rejected first primary commit never reappears as a successful mutation after restart', async (t) => {
  const { dir, store } = await fixture(t);
  const fs = require('node:fs/promises') as typeof import('node:fs/promises');
  const original = fs.rename;
  t.mock.method(
    fs,
    'rename',
    async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
      if (String(to) === join(dir, 'state.json'))
        throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
      return original(from, to);
    },
  );
  await assert.rejects(() => store.save(sample()), /Disk full/);
  assert.deepEqual((await store.load()).state, emptyState());
});
