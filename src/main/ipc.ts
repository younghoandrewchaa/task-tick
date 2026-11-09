import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { Snapshot } from '../shared/model';
import type { TaskPanel } from './panel';
import type { CommandController } from './commands';
export function registerIPC(
  panel: TaskPanel,
  commands: CommandController,
  snapshot: () => Snapshot,
): void {
  const documentURL = pathToFileURL(join(__dirname, '../renderer/index.html')).href;
  const trust = (event: IpcMainInvokeEvent) => {
    if (
      event.sender !== panel.window.webContents ||
      event.senderFrame !== panel.window.webContents.mainFrame ||
      event.senderFrame?.url !== documentURL
    )
      throw new Error('Untrusted command source');
  };
  ipcMain.handle('tasktick:get', (event) => {
    trust(event);
    return snapshot();
  });
  ipcMain.handle('tasktick:command', (event, input: unknown) => {
    trust(event);
    return commands.execute(input);
  });
  ipcMain.handle('tasktick:hide', (event) => {
    trust(event);
    panel.hide();
  });
  ipcMain.handle('tasktick:quit', (event) => {
    trust(event);
    app.quit();
  });
}
