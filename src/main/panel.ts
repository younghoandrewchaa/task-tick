import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  Notification,
  screen,
  Tray,
} from 'electron';
import { join } from 'node:path';
import type { Expiry, Snapshot } from '../shared/model';
export class TaskPanel {
  readonly window: BrowserWindow;
  readonly tray: Tray;
  private dialogOpen = false;
  private notifications = new Set<Notification>();
  private notificationStatus =
    'Permission is managed by macOS. Enable banners and sound in System Settings → Notifications → TaskTick.';
  private pendingShow = false;
  private locked = false;
  private quitting = false;
  constructor(private changed: () => void) {
    const display = screen.getPrimaryDisplay().workAreaSize;
    this.window = new BrowserWindow({
      width: 420,
      height: Math.min(690, display.height - 32),
      minWidth: 360,
      show: false,
      frame: false,
      resizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      type: 'panel',
      backgroundColor: '#f7f7f2',
      roundedCorners: true,
      hasShadow: true,
      webPreferences: {
        preload: join(__dirname, '../preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    this.window.on('blur', () => {
      if (!this.dialogOpen) this.hide();
    });
    this.window.on('close', (e) => {
      if (!this.quitting) {
        e.preventDefault();
        this.hide();
      }
    });
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', (e) => e.preventDefault());
    this.window.webContents.session.setPermissionRequestHandler((_web, _permission, callback) =>
      callback(false),
    );
    void this.window.loadFile(join(__dirname, '../renderer/index.html'));
    const icon = nativeImage.createFromPath(join(__dirname, '../assets/trayTemplate.png'));
    icon.setTemplateImage(true);
    this.tray = new Tray(icon);
    this.tray.setToolTip('TaskTick · A little focus goes a long way');
    this.tray.on('click', () => (this.window.isVisible() ? this.hide() : this.show()));
    this.tray.on('right-click', () =>
      this.tray.popUpContextMenu(
        Menu.buildFromTemplate([
          { label: 'Open TaskTick', click: () => this.show() },
          { type: 'separator' },
          { label: 'Quit TaskTick', click: () => app.quit() },
        ]),
      ),
    );
    app.on('before-quit', () => {
      this.quitting = true;
    });
  }
  status(): string {
    return Notification.isSupported()
      ? this.notificationStatus
      : 'Native notifications are unavailable. The task panel will still open at expiry.';
  }
  update(snapshot: Snapshot): void {
    const session = snapshot.state.session;
    if (!session) this.tray.setTitle('');
    else {
      const ms = session.status === 'running' ? session.deadline - Date.now() : session.remainingMs;
      const seconds = Math.max(0, Math.ceil(ms / 1000));
      const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      this.tray.setTitle(session.status === 'paused' ? `Ⅱ ${time}` : time, {
        fontType: 'monospacedDigit',
      });
    }
    if (!this.window.isDestroyed() && !this.window.webContents.isLoading())
      this.window.webContents.send('tasktick:snapshot', {
        ...snapshot,
        notificationStatus: this.status(),
      });
  }
  show(): void {
    if (this.locked) {
      this.pendingShow = true;
      return;
    }
    const bounds = this.tray.getBounds();
    const area = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
    const [width] = this.window.getSize();
    const height = Math.min(690, area.height - 24);
    this.window.setBounds({
      x: Math.max(
        area.x + 8,
        Math.min(bounds.x + bounds.width / 2 - width / 2, area.x + area.width - width - 8),
      ),
      y: Math.max(
        area.y + 8,
        Math.min(bounds.y + bounds.height + 8, area.y + area.height - height - 8),
      ),
      width,
      height,
    });
    this.window.show();
    app.focus({ steal: true });
    this.window.focus();
    this.changed();
  }
  hide(): void {
    if (!this.dialogOpen) this.window.hide();
  }
  setLocked(locked: boolean): void {
    this.locked = locked;
    if (!locked && this.pendingShow) {
      this.pendingShow = false;
      this.show();
    }
  }
  /** Lets the window close during a quit that macOS starts before `before-quit`, such as an update restart. */
  setQuitting(value: boolean): void {
    this.quitting = value;
  }
  async confirm(message: string, detail: string, confirmLabel?: string): Promise<boolean> {
    this.show();
    this.dialogOpen = true;
    try {
      const result = await dialog.showMessageBox(this.window, {
        type: 'question',
        message,
        detail,
        buttons: ['Cancel', 'Discard & switch'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        ...(message.startsWith('Delete')
          ? { buttons: ['Cancel', 'Delete task'] }
          : message.startsWith('Discard')
            ? { buttons: ['Cancel', 'Discard session'] }
            : {}),
        ...(confirmLabel ? { buttons: ['Cancel', confirmLabel] } : {}),
      });
      return result.response === 1;
    } finally {
      this.dialogOpen = false;
      this.window.focus();
    }
  }
  notify(expiry: Expiry): void {
    this.show();
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: 'Session complete',
      body: `${expiry.taskTitle} · One more session in the books.`,
      silent: false,
      sound: 'Glass',
    });
    this.notifications.add(notification);
    notification.on('click', () => this.show());
    notification.on('close', () => this.notifications.delete(notification));
    notification.on('failed', (_event, error) => {
      this.notifications.delete(notification);
      this.notificationStatus = `macOS could not deliver the last notification: ${error}. Check System Settings → Notifications.`;
      this.changed();
    });
    notification.on('show', () => {
      this.notificationStatus =
        'Last notification was handed to macOS. Focus mode, banner and sound settings still apply.';
      this.changed();
    });
    notification.show();
  }
}
