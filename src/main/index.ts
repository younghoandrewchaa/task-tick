import { app, dialog, powerMonitor, Menu } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { TaskService } from '../core/service';
import { FileStateStore } from './store';
import { TaskPanel } from './panel';
import { CommandController } from './commands';
import { registerIPC } from './ipc';
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
    Menu.setApplicationMenu(null);
    try {
      const store = new FileStateStore(app.getPath('userData'));
      const loaded = await store.load();
      let notice = loaded.warning;
      let service: TaskService;
      const snapshot = (): Snapshot => ({
        ...service.snapshot(),
        notice,
        notificationStatus: panel?.status(),
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
      registerIPC(panel, commands, snapshot);
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
      powerMonitor.on('resume', () => void settle());
      powerMonitor.on('lock-screen', () => panel!.setLocked(true));
      powerMonitor.on('unlock-screen', () => {
        panel!.setLocked(false);
        void settle();
      });
      app.on('before-quit', () => clearInterval(ticker));
      await settle();
      if (app.isPackaged) {
        const actual = app.getLoginItemSettings().openAtLogin;
        if (actual !== service.snapshot().state.settings.launchAtLogin)
          await service.dispatch({ type: 'login', enabled: actual });
      }
      if (!app.isPackaged || !app.getLoginItemSettings().wasOpenedAtLogin || notice) panel.show();
      publish();
    } catch (error) {
      dialog.showErrorBox(
        'TaskTick could not open your tasks',
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    }
  });
}
