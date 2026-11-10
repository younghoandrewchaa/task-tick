import { app, autoUpdater, dialog, net, powerMonitor, Menu } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TaskService } from '../core/service';
import { FileStateStore } from './store';
import { TaskPanel } from './panel';
import { CommandController } from './commands';
import { registerIPC } from './ipc';
import { UpdateManager, fetchLatestRelease } from './updates';
import type { Snapshot } from '../shared/model';
app.setName('TaskTick');
// A separate data directory is useful for local development and smoke checks.
if (process.env.TASKTICK_DATA_DIR) {
  const directory = resolve(process.env.TASKTICK_DATA_DIR);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  app.setPath('userData', directory);
}
let panel: TaskPanel | undefined;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => panel?.show());
  app.on('window-all-closed', () => {});
  void app.whenReady().then(async () => {
    app.dock?.hide();
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));
    try {
      const store = new FileStateStore(app.getPath('userData'));
      const loaded = await store.load();
      let notice = loaded.warning;
      let service: TaskService;
      let updates: UpdateManager | undefined;
      const snapshot = (): Snapshot => ({
        ...service.snapshot(),
        notice,
        notificationStatus: panel?.status(),
        update: updates?.getState(),
      });
      const publish = () => {
        if (service && panel) panel.update(snapshot());
      };
      panel = new TaskPanel(publish);
      service = new TaskService({
        state: loaded.state,
        store,
        clock: Date.now,
        id: randomUUID,
        onChange: publish,
        onExpiry: (e) => {
          notice = `Session complete: ${e.taskTitle}`;
          panel!.notify(e);
          publish();
        },
      });
      const commands = new CommandController({
        service,
        confirm: (message, detail) => panel!.confirm(message, detail),
        snapshot,
        setLogin: (enabled) => {
          if (!app.isPackaged)
            throw new Error('Launch at login is available in the packaged TaskTick.app.');
          app.setLoginItemSettings({ openAtLogin: enabled });
          const actual = app.getLoginItemSettings();
          if (actual.openAtLogin !== enabled)
            throw new Error(
              'macOS could not update Launch at login. Check System Settings → General → Login Items.',
            );
          return actual.openAtLogin;
        },
      });
      const updater = new UpdateManager({
        // Read our own package.json: app.getVersion() reports Electron's version when launched from another folder.
        version: JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')).version,
        enabled:
          app.isPackaged &&
          process.platform === 'darwin' &&
          process.arch === 'arm64' &&
          !process.env.TASKTICK_DATA_DIR,
        native: autoUpdater,
        fetchRelease: () => fetchLatestRelease((url, options) => net.fetch(url, options)),
        confirm: (version) =>
          panel!.confirm(
            `Update TaskTick to v${version}?`,
            'TaskTick will download the update, then quit and reopen. A running session keeps its deadline.',
            'Update and Restart',
          ),
        publish,
        // The panel blocks window closes until it knows the app is quitting.
        beforeRestart: () => panel!.setQuitting(true),
        restartFailed: () => panel!.setQuitting(false),
      });
      updates = updater;
      registerIPC(panel, commands, snapshot, updater);
      panel.window.webContents.on('did-finish-load', publish);
      const settle = () =>
        service
          .reconcile()
          .then(publish)
          .catch((error) => {
            notice = `Could not save tasks: ${error instanceof Error ? error.message : String(error)}`;
            publish();
          });
      // Also reconcile each second to detect system-clock changes and keep the tray current.
      const ticker = setInterval(() => {
        void settle();
      }, 1000);
      // Hourly ticks plus the manager's 24-hour cooldown give one check a day, even across sleep.
      const updateTicker = setInterval(() => void updater.check(), 60 * 60_000);
      powerMonitor.on('resume', () => {
        void settle();
        void updater.check();
      });
      powerMonitor.on('lock-screen', () => panel!.setLocked(true));
      powerMonitor.on('unlock-screen', () => {
        panel!.setLocked(false);
        void settle();
      });
      app.on('before-quit', () => {
        clearInterval(ticker);
        clearInterval(updateTicker);
      });
      await settle();
      if (app.isPackaged) {
        const actual = app.getLoginItemSettings().openAtLogin;
        if (actual !== service.snapshot().state.settings.launchAtLogin)
          await service.dispatch({ type: 'login', enabled: actual });
      }
      if (!app.isPackaged || !app.getLoginItemSettings().wasOpenedAtLogin || notice) panel.show();
      publish();
      void updater.check();
    } catch (error) {
      dialog.showErrorBox(
        'TaskTick could not open your tasks',
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    }
  });
}
