import path from 'node:path';
import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from 'electron';

/**
 * Electron entry point.
 *
 * The Express API runs inside this process, listening on loopback only, and the
 * window simply loads it. That keeps a single process to start and stop, and
 * means the same code serves the browser-only mode (`npm run serve`).
 */

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5273';

// A packaged app cannot write next to its own executable, so data goes to the
// per-user application-data folder. This must be set before the server module is
// loaded, because the database path is resolved on import.
if (app.isPackaged) {
  process.env.AASMA_DATA_DIR = app.getPath('userData');
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
type ServerModule = typeof import('../server/index');

let mainWindow: BrowserWindow | null = null;
let server: Awaited<ReturnType<ServerModule['startServer']>> | null = null;

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open data folder',
          click: () => {
            void shell.openPath(app.isPackaged ? app.getPath('userData') : process.cwd());
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' } as Electron.MenuItemConstructorOptions] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Aasma Buildcon CRM',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'Aasma Buildcon CRM',
              message: 'Aasma Buildcon CRM',
              detail:
                `Version ${app.getVersion()}\n` +
                'Offline CRM and construction ERP for Aasma Construction.\n\n' +
                `Data folder: ${app.isPackaged ? app.getPath('userData') : process.cwd()}`,
              buttons: ['Close'],
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#F7F7F8',
    title: 'Aasma Buildcon CRM',
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Links to anything outside the app open in the user's browser, never inside
  // the application window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const target = isDev ? DEV_URL : server!.url;
  await mainWindow.loadURL(target);
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function registerIpc(): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataFolder: app.isPackaged ? app.getPath('userData') : process.cwd(),
    apiUrl: server?.url ?? '',
  }));

  ipcMain.handle('app:open-folder', async (_event, kind: 'data' | 'backups' | 'reports' | 'uploads') => {
    const root = app.isPackaged ? app.getPath('userData') : process.cwd();
    const folder = kind === 'data' ? path.join(root, 'data') : path.join(root, kind);
    const error = await shell.openPath(folder);
    return { ok: error === '', error };
  });

  // Used after restoring a backup: the database file underneath us has changed.
  ipcMain.handle('app:restart', () => {
    app.relaunch();
    app.exit(0);
  });
}

async function bootstrap(): Promise<void> {
  try {
    // Required late so AASMA_DATA_DIR above is already in place.
    const { startServer } = require('../server/index') as ServerModule;
    server = await startServer();
  } catch (error) {
    dialog.showErrorBox(
      'Aasma Buildcon CRM could not start',
      `The local database could not be opened.\n\n${(error as Error).message}`,
    );
    app.exit(1);
    return;
  }

  registerIpc();
  buildMenu();
  await createWindow();
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch((error) => {
    dialog.showErrorBox('Aasma Buildcon CRM', String(error));
    app.exit(1);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    void server?.stop();
  });
}
