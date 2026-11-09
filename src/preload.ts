import { contextBridge, ipcRenderer } from 'electron';
import type { Action, Snapshot, TaskTickAPI } from './shared/model';
const api: TaskTickAPI = {
  getSnapshot: () => ipcRenderer.invoke('tasktick:get'),
  dispatch: (action: Action) => ipcRenderer.invoke('tasktick:command', action),
  onSnapshot: (listener: (snapshot: Snapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) => listener(snapshot);
    ipcRenderer.on('tasktick:snapshot', handler);
    return () => ipcRenderer.removeListener('tasktick:snapshot', handler);
  },
  hidePanel: () => ipcRenderer.invoke('tasktick:hide'),
  quit: () => ipcRenderer.invoke('tasktick:quit'),
};
contextBridge.exposeInMainWorld('tasktick', api);
