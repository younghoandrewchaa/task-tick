import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  UpdateManager,
  selectRelease,
  fetchLatestRelease,
  CHECK_COOLDOWN_MS,
} from '../src/main/updates';
import type { UpdateState } from '../src/shared/model';

const download = (version: string) =>
  `https://github.com/younghoandrewchaa/task-tick/releases/download/v${version}/`;
const base = download('0.3.0');
function release(version = '0.3.0') {
  return {
    currentRelease: version,
    releases: [
      {
        version,
        updateTo: {
          url: `${download(version)}TaskTick-darwin-arm64-${version}.zip`,
          name: `TaskTick ${version}`,
          notes: 'Notes',
          pub_date: '2026-11-10T00:00:00Z',
        },
      },
    ],
  };
}

class FakeNative extends EventEmitter {
  feeds: { url: string; serverType: 'json' }[] = [];
  checks = 0;
  installs = 0;
  failInstall = false;
  setFeedURL(options: { url: string; serverType: 'json' }) {
    this.feeds.push(options);
  }
  checkForUpdates() {
    this.checks++;
  }
  quitAndInstall() {
    this.installs++;
    if (this.failInstall) throw new Error('nope');
  }
}

function setup(overrides: Partial<ConstructorParameters<typeof UpdateManager>[0]> = {}) {
  const native = new FakeNative();
  const states: UpdateState[] = [];
  let now = 1_000_000;
  const calls = { fetch: 0, confirm: [] as string[], beforeRestart: 0, restartFailed: 0 };
  const manager = new UpdateManager({
    version: '0.2.0',
    enabled: true,
    native,
    fetchRelease: async () => {
      calls.fetch++;
      return release();
    },
    confirm: async (version) => {
      calls.confirm.push(version);
      return true;
    },
    publish: (state) => states.push(state),
    beforeRestart: () => calls.beforeRestart++,
    restartFailed: () => calls.restartFailed++,
    now: () => now,
    ...overrides,
  });
  return { manager, native, states, calls, advance: (ms: number) => (now += ms) };
}

test('selectRelease accepts only a newer stable release whose ZIP is in this repo', () => {
  assert.deepEqual(selectRelease(release('0.3.0'), '0.2.0'), {
    version: '0.3.0',
    feedUrl: `${base}update-darwin-arm64.json`,
  });
  assert.ok(selectRelease(release('0.10.0'), '0.9.0'));
  for (const value of [
    release('0.2.0'),
    release('0.1.9'),
    release('0.3.0-beta.1'),
    null,
    {},
    { ...release('0.3.0'), releases: [] },
  ])
    assert.equal(selectRelease(value, '0.2.0'), undefined);
  for (const url of [
    'https://example.com/x.zip',
    `${base}TaskTick-darwin-x64-0.3.0.zip`,
    'https://github.com/younghoandrewchaa/y-term/releases/download/v0.3.0/TaskTick-darwin-arm64-0.3.0.zip',
  ]) {
    const manifest = release('0.3.0');
    manifest.releases[0].updateTo.url = url;
    assert.equal(selectRelease(manifest, '0.2.0'), undefined);
  }
});

test('fetchLatestRelease reads the website latest-download URL and treats 404 as no release', async () => {
  const manifest = release();
  const result = await fetchLatestRelease(async (url, options) => {
    assert.equal(
      url,
      'https://github.com/younghoandrewchaa/task-tick/releases/latest/download/update-darwin-arm64.json',
    );
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify(manifest));
  });
  assert.deepEqual(result, manifest);
  assert.equal(await fetchLatestRelease(async () => new Response('', { status: 404 })), undefined);
  await assert.rejects(
    fetchLatestRelease(async () => new Response('', { status: 500 })),
    /GitHub returned 500/,
  );
});

test('checks at most once per 24 hours', async () => {
  const { manager, calls, advance } = setup();
  await manager.check();
  assert.equal(calls.fetch, 1);
  advance(23 * 60 * 60_000);
  await manager.check();
  assert.equal(calls.fetch, 1);
  advance(2 * 60 * 60_000);
  await manager.check();
  assert.equal(calls.fetch, 2);
  assert.equal(CHECK_COOLDOWN_MS, 24 * 60 * 60_000);
});

test('failed checks are silent and retry on the next tick', async () => {
  let fail = true;
  const { manager, calls, states } = setup({
    fetchRelease: async () => {
      calls.fetch++;
      if (fail) throw new Error('offline');
      return release();
    },
  });
  const error = console.error;
  console.error = () => {};
  try {
    await manager.check();
  } finally {
    console.error = error;
  }
  assert.deepEqual(
    states.map((s) => s.status),
    ['checking', 'idle'],
  );
  fail = false;
  await manager.check();
  assert.equal(calls.fetch, 2);
  assert.equal(manager.getState().status, 'available');
});

test('one confirmed click downloads, then restarts only after update-downloaded', async () => {
  const { manager, native, calls } = setup();
  await manager.check();
  assert.deepEqual(manager.getState(), {
    version: '0.2.0',
    status: 'available',
    latestVersion: '0.3.0',
  });
  await manager.install();
  assert.deepEqual(calls.confirm, ['0.3.0']);
  assert.deepEqual(native.feeds, [{ url: `${base}update-darwin-arm64.json`, serverType: 'json' }]);
  assert.equal(native.checks, 1);
  assert.equal(manager.getState().status, 'downloading');
  assert.equal(native.installs, 0);
  native.emit('update-downloaded');
  assert.equal(calls.beforeRestart, 1);
  assert.equal(native.installs, 1);
  assert.equal(manager.getState().status, 'installing');
  assert.equal(manager.isInstalling, true);
});

test('cancelling the dialog keeps the update available and downloads nothing', async () => {
  const { manager, native } = setup({ confirm: async () => false });
  await manager.check();
  await manager.install();
  assert.equal(manager.getState().status, 'available');
  assert.equal(native.feeds.length, 0);
});

test('concurrent installs open one dialog', async () => {
  let answer: (value: boolean) => void = () => {};
  let dialogs = 0;
  const { manager, native } = setup({
    confirm: () => {
      dialogs++;
      return new Promise<boolean>((resolve) => (answer = resolve));
    },
  });
  await manager.check();
  const first = manager.install();
  await manager.install();
  answer(true);
  await first;
  assert.equal(dialogs, 1);
  assert.equal(native.feeds.length, 1);
});

test('download errors keep the update and allow a retry', async () => {
  const { manager, native } = setup();
  await manager.check();
  await manager.install();
  native.emit('error', new Error('network'));
  assert.deepEqual(manager.getState(), {
    version: '0.2.0',
    status: 'error',
    latestVersion: '0.3.0',
    message: 'Update failed. Click to try again.',
  });
  await manager.install();
  assert.equal(native.feeds.length, 2);
});

test('a restart that cannot begin calls restartFailed and reports an error', async () => {
  const { manager, native, calls } = setup();
  native.failInstall = true;
  await manager.check();
  await manager.install();
  native.emit('update-downloaded');
  assert.equal(calls.restartFailed, 1);
  assert.equal(manager.getState().status, 'error');
  assert.equal(manager.getState().message, 'Could not restart. Click to try again.');
});

test('disabled builds report their version and never touch the network', async () => {
  const { manager, native, calls } = setup({ enabled: false });
  assert.deepEqual(manager.getState(), { version: '0.2.0', status: 'disabled' });
  await manager.check();
  await manager.install();
  assert.equal(calls.fetch, 0);
  assert.equal(native.feeds.length, 0);
});
