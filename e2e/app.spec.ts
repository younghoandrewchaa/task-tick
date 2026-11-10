import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Snapshot } from '../src/shared/model';
let app: ElectronApplication | undefined, page: Page, directory: string;
async function launch(packaged = false) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  env.TASKTICK_DATA_DIR = directory;
  app = await electron.launch({
    // Follow Electron's nativeTheme rather than Playwright's default light override.
    colorScheme: null,
    ...(packaged
      ? {
          executablePath: resolve(
            `out/TaskTick-darwin-${process.arch}/TaskTick.app/Contents/MacOS/TaskTick`,
          ),
          args: [],
        }
      : { args: [resolve('e2e/bootstrap.cjs')] }),
    env,
    cwd: packaged ? tmpdir() : process.cwd(),
    timeout: 15000,
  });
  page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: /Your tasks/ })).toBeVisible();
}
async function snapshot(): Promise<Snapshot> {
  return page.evaluate(() => window.tasktick.getSnapshot());
}
async function add(title: string) {
  await page.getByRole('textbox', { name: 'New task title', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'New task title', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: `Select ${title}`, exact: true })).toBeVisible();
}
function row(title: string) {
  return page
    .locator('.task-row')
    .filter({ has: page.getByRole('button', { name: `Select ${title}`, exact: true }) });
}
async function chooseConfirmation(response: number) {
  await app!.evaluate(({ dialog }, response) => {
    dialog.showMessageBox = async () => ({ response, checkboxChecked: false });
  }, response);
}
function seeded(deadline: number) {
  return {
    version: 1,
    tasks: [
      {
        id: 'task-1',
        title: 'A focused session',
        durationMinutes: 15,
        sessionCount: 2,
        completedAt: null,
      },
    ],
    session: {
      id: 'session-1',
      taskId: 'task-1',
      durationMinutes: 15,
      status: 'running',
      deadline,
    },
    settings: { launchAtLogin: false },
  };
}
test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tasktick-e2e-'));
});
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  await rm(directory, { recursive: true, force: true });
});
test('task list supports presets, literal titles, rename, reorder, complete, reopen and confirmed delete', async () => {
  await launch();
  await add('Write <chapter> & notes');
  await add('Review');
  await expect(row('Write <chapter> & notes').getByRole('combobox')).toHaveValue('15');
  await row('Write <chapter> & notes').getByRole('combobox').selectOption('20');
  await expect(row('Write <chapter> & notes').getByRole('combobox')).toHaveValue('20');
  await page.getByLabel('Actions for Review', { exact: true }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rename task' }).press('Meta+A');
  await page.getByRole('textbox', { name: 'Rename task' }).pressSequentially('Review draft');
  await page.getByRole('textbox', { name: 'Rename task' }).press('Enter');
  await expect(row('Review draft')).toBeVisible();
  await page.getByLabel('Actions for Review draft', { exact: true }).click();
  await page.getByRole('button', { name: 'Move up', exact: true }).click();
  await expect(page.locator('#tasks .task-title').first()).toHaveText('Review draft');
  await page.getByRole('button', { name: 'Complete Review draft', exact: true }).click();
  await page.locator('#completed summary').click();
  await expect(
    page.getByRole('button', { name: 'Reopen Review draft', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reopen Review draft', exact: true }).click();
  await expect(page.locator('#tasks .task-title').last()).toHaveText('Review draft');
  await page.getByLabel('Actions for Review draft', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(row('Review draft')).toBeVisible(); // Default native boundary response is Cancel.
  await chooseConfirmation(1);
  await page.getByLabel('Actions for Review draft', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(row('Review draft')).toHaveCount(0);
  await expect(row('Write <chapter> & notes')).toBeVisible();
  const disk = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  expect(disk.tasks[0].title).toBe('Write <chapter> & notes');
  expect(disk.tasks[0].durationMinutes).toBe(20);
});
test('pause, cancelled and confirmed switching, and discard obey the single-timer rule', async () => {
  await launch();
  await add('First');
  await add('Second');
  await page.getByRole('button', { name: 'Start First', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause session', exact: true })).toBeVisible();
  await expect(row('First').getByRole('combobox')).toBeDisabled();
  await page.getByRole('button', { name: 'Pause session', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume session', exact: true })).toBeVisible();
  const paused = (await snapshot()).state.session;
  expect(paused?.status).toBe('paused');
  await page.getByRole('button', { name: 'Start Second', exact: true }).click();
  await expect(page.locator('#primary')).toBeEnabled();
  expect((await snapshot()).state.session?.id).toBe(paused!.id);
  await chooseConfirmation(1);
  await page.getByRole('button', { name: 'Start Second', exact: true }).click();
  await expect(page.locator('#focus-title')).toHaveText('Second');
  expect((await snapshot()).state.session?.id).not.toBe(paused!.id);
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start session', exact: true })).toBeVisible();
  expect((await snapshot()).state.tasks.map((t) => t.sessionCount)).toEqual([0, 0]);
});
test('paused time survives a real app restart and edits survive timer updates', async () => {
  await launch();
  await add('Keep this');
  await page.getByRole('button', { name: 'Start Keep this', exact: true }).click();
  await page.getByRole('button', { name: 'Pause session', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume session', exact: true })).toBeVisible();
  const saved = (await snapshot()).state.session;
  await app!.close();
  app = undefined;
  await launch();
  expect((await snapshot()).state.session).toEqual(saved);
  await expect(page.getByRole('button', { name: 'Resume session', exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'New task title', exact: true })
    .fill('A draft that must stay');
  await app!.evaluate(({ powerMonitor }) => {
    powerMonitor.emit('resume');
  });
  await expect(page.getByRole('textbox', { name: 'New task title', exact: true })).toHaveValue(
    'A draft that must stay',
  );
  await expect(page.getByRole('textbox', { name: 'New task title', exact: true })).toBeFocused();
});
test('a live deadline credits once and reopens a hidden panel', async () => {
  await writeFile(join(directory, 'state.json'), JSON.stringify(seeded(Date.now() + 6500)));
  await launch();
  await page.getByRole('button', { name: 'Hide panel', exact: true }).click();
  await expect
    .poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(false);
  await expect
    .poll(async () => (await snapshot()).state.tasks[0].sessionCount, { timeout: 12000 })
    .toBe(3);
  await expect
    .poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(true);
  await expect(
    page.getByText('Session complete: A focused session', { exact: true }),
  ).toBeVisible();
  expect(await app!.evaluate(() => globalThis.__tasktickAlerts.length)).toBe(1);
  await app!.evaluate(({ powerMonitor }) => {
    powerMonitor.emit('resume');
    powerMonitor.emit('unlock-screen');
  });
  expect((await snapshot()).state.tasks[0].sessionCount).toBe(3);
  expect(await app!.evaluate(() => globalThis.__tasktickAlerts.length)).toBe(1);
  await app!.close();
  app = undefined;
  await launch();
  expect((await snapshot()).state.tasks[0].sessionCount).toBe(3);
  expect(await app!.evaluate(() => globalThis.__tasktickAlerts.length)).toBe(0);
});
test('long task lists scroll, menus stay in view, drag reorder works, and both themes render', async () => {
  await launch();
  for (let i = 1; i <= 7; i++) await add(`Task ${i} with a longer title`);
  const last = row('Task 7 with a longer title');
  await last.scrollIntoViewIfNeeded();
  await last.getByLabel('Actions for Task 7 with a longer title', { exact: true }).click();
  const menu = page.locator('.row-menu[open] .menu-items');
  await expect(menu.getByRole('button', { name: 'Delete task', exact: true })).toBeVisible();
  const box = await menu.boundingBox();
  const height = await page.evaluate(() => innerHeight);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height);
  await page.getByRole('textbox', { name: 'New task title', exact: true }).click();
  await row('Task 2 with a longer title')
    .locator('.task-title')
    .dragTo(row('Task 1 with a longer title').locator('.task-title'));
  await expect(page.locator('#tasks .task-title').first()).toHaveText('Task 2 with a longer title');
  for (const theme of ['light', 'dark'] as const) {
    await app!.evaluate(({ nativeTheme }, theme) => {
      nativeTheme.themeSource = theme;
    }, theme);
    await expect
      .poll(() => app!.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors))
      .toBe(theme === 'dark');
    await expect
      .poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches))
      .toBe(theme === 'dark');
    await page.screenshot({ path: `test-results/tasktick-${theme}.png` });
  }
});
test('development builds report their version with updates disabled', async () => {
  await launch();
  const { update } = await snapshot();
  const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  expect(update).toEqual({ version, status: 'disabled' });
  await expect(page.locator('#version')).toHaveText(`v${version}`);
  expect(await page.evaluate(() => typeof window.tasktick.installUpdate)).toBe('function');
});
test('packaged app loads its preload and assets outside the repository and reconciles overdue startup', async () => {
  test.skip(
    !process.env.TASKTICK_TEST_PACKAGED,
    'Set TASKTICK_TEST_PACKAGED=1 after npm run package',
  );
  await writeFile(join(directory, 'state.json'), JSON.stringify(seeded(Date.now() - 1000)));
  await launch(true);
  await expect.poll(async () => (await snapshot()).state.tasks[0].sessionCount).toBe(3);
  await expect(
    page.getByText('Session complete: A focused session', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  expect(await page.evaluate(() => typeof window.tasktick.dispatch)).toBe('function');
  await app!.close();
  app = undefined;
  await launch(true);
  expect((await snapshot()).state.tasks[0].sessionCount).toBe(3);
});
