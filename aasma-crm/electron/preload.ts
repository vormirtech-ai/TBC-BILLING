import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only bridge between the page and the desktop shell. Nothing from Node is
 * exposed directly — just three named actions the Settings screen uses.
 */
const api = {
  isDesktop: true,
  info: (): Promise<{ version: string; platform: string; dataFolder: string; apiUrl: string }> =>
    ipcRenderer.invoke('app:info'),
  openFolder: (kind: 'data' | 'backups' | 'reports' | 'uploads'): Promise<{ ok: boolean; error: string }> =>
    ipcRenderer.invoke('app:open-folder', kind),
  restart: (): Promise<void> => ipcRenderer.invoke('app:restart'),
};

contextBridge.exposeInMainWorld('aasma', api);

export type AasmaBridge = typeof api;
