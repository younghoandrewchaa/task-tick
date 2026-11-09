import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { emptyState } from '../src/core/state';
import { TaskService } from '../src/core/service';
import type { Snapshot, TaskTickAPI } from '../src/shared/model';
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('UI did not settle');
    await new Promise((resolve) => setImmediate(resolve));
  }
}
async function fixture(t: { after(fn: () => void): void }) {
  const dom = new JSDOM(await readFile(resolve('src/renderer/index.html'), 'utf8'), {
    runScripts: 'outside-only',
    url: 'file:///tasktick/index.html',
  });
  t.after(() => dom.window.close());
  const state = emptyState();
  state.tasks = [
    { id: 'a', title: 'Alpha', durationMinutes: 15, sessionCount: 0, completedAt: null },
    { id: 'b', title: 'Beta', durationMinutes: 15, sessionCount: 0, completedAt: null },
  ];
  let fail = false,
    hold = false,
    release: (() => void) | undefined;
  const listeners = new Set<(s: Snapshot) => void>();
  const service = new TaskService({
    state,
    store: {
      load: async () => ({ state }),
      save: async () => {
        if (fail) throw new Error('Disk full');
        if (hold)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
      },
    },
    clock: Date.now,
    id: () => crypto.randomUUID(),
    onExpiry: () => {},
    onChange: (s) => listeners.forEach((listener) => listener(s)),
  });
  const api: TaskTickAPI = {
    getSnapshot: async () => service.snapshot(),
    dispatch: async (action) => {
      try {
        return { ok: true, snapshot: await service.dispatch(action) };
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
    },
    onSnapshot: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hidePanel: async () => {},
    quit: async () => {},
  };
  Object.assign(dom.window, { tasktick: api });
  const code = (await readFile(resolve('dist/renderer/index.js'), 'utf8')).replace(
    /export\s*\{\s*\};?\s*$/,
    '',
  );
  dom.window.eval(code);
  await until(() => dom.window.document.querySelectorAll('.task-row').length === 2);
  return {
    window: dom.window,
    document: dom.window.document,
    service,
    fail: () => {
      fail = true;
    },
    hold: () => {
      hold = true;
    },
    release: () => release?.(),
    isWaiting: () => release !== undefined,
  };
}
test('a failed duration save restores the authoritative preset before starting', async (t) => {
  const f = await fixture(t);
  f.fail();
  const select = f.document.querySelector('select')!;
  select.value = '20';
  select.dispatchEvent(new f.window.Event('change', { bubbles: true }));
  await until(() => !f.document.getElementById('error')!.hidden);
  assert.equal(f.document.querySelector('select')!.value, '15');
  assert.equal(f.service.snapshot().state.tasks[0].durationMinutes, 15);
});
test('duration controls cannot accept edits while another command is pending', async (t) => {
  const f = await fixture(t);
  f.hold();
  (f.document.getElementById('primary') as HTMLButtonElement).click();
  assert.ok([...f.document.querySelectorAll('select')].every((select) => select.disabled));
  await until(() => f.isWaiting());
  f.release();
});
test('opening another rename never transfers the previous task draft', async (t) => {
  const f = await fixture(t);
  (f.document.querySelector('[data-task-id="a"] .menu-items button') as HTMLButtonElement).click();
  const a = f.document.querySelector<HTMLInputElement>('[data-edit="a"]')!;
  a.value = 'Uncommitted Alpha';
  (f.document.querySelector('[data-task-id="b"] .menu-items button') as HTMLButtonElement).click();
  assert.equal(f.document.querySelector<HTMLInputElement>('[data-edit="b"]')!.value, 'Beta');
  assert.equal(f.service.snapshot().state.tasks[1].title, 'Beta');
});
test('row menus are positioned inside the viewport during activation, before the queued toggle event', async (t) => {
  const f = await fixture(t);
  Object.defineProperty(f.window, 'innerHeight', { value: 690 });
  Object.defineProperty(f.window, 'innerWidth', { value: 420 });
  const menu = f.document.querySelector<HTMLDetailsElement>('.row-menu')!;
  const summary = menu.querySelector('summary')!;
  const items = menu.querySelector<HTMLElement>('.menu-items')!;
  // Layout measurements are supplied because jsdom does not perform layout.
  // Keep the real activation handler, menu element and positioning code.
  summary.getBoundingClientRect = () => ({
    x: 370,
    y: 625,
    left: 370,
    top: 625,
    right: 391,
    bottom: 650,
    width: 21,
    height: 25,
    toJSON: () => ({}),
  });
  Object.defineProperty(items, 'offsetHeight', { value: 120 });
  summary.click();
  assert.equal(menu.open, true);
  assert.notEqual(items.style.top, '');
  assert.ok(Number.parseFloat(items.style.top) + items.offsetHeight <= f.window.innerHeight);
  summary.click();
  assert.equal(menu.open, false);
});
