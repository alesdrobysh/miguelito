import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import dotenv from 'dotenv';

interface MinimalServer {
  stop(): void;
}

let webServer: MinimalServer | null = null;

async function startBackend(): Promise<void> {
  const userData = app.getPath('userData');

  // Must be set before loadConfig() reads process.env
  process.env.DATA_DIR = userData;
  process.env.TRANSPORT = 'web';

  // Load API keys from userData/.env (e.g. OPENROUTER_API_KEY=...)
  dotenv.config({ path: path.join(userData, '.env') });

  const appRoot = app.getAppPath();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadConfig } = require(path.join(appRoot, 'dist/infrastructure/config')) as {
    loadConfig(): { webHost: string; webPort: number };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRuntimeManager } = require(path.join(appRoot, 'dist/runtime')) as {
    createRuntimeManager(config: unknown): Promise<unknown>;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebServer } = require(path.join(appRoot, 'dist/web/WebServer')) as {
    WebServer: new (manager: unknown) => { start(host: string, port: number): void; stop(): void };
  };

  const config = loadConfig();
  const manager = await createRuntimeManager(config);
  const server = new WebServer(manager);
  server.start(config.webHost, config.webPort);
  webServer = server;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 420,
    height: 820,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL('http://127.0.0.1:8787');
}

app.whenReady().then(async () => {
  try {
    await startBackend();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const envPath = path.join(app.getPath('userData'), '.env');
    dialog.showErrorBox(
      'Miguelito — Configuration Error',
      `Failed to start: ${msg}\n\nCreate ${envPath} with:\nOPENROUTER_API_KEY=your_key_here`,
    );
    app.quit();
    return;
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  webServer?.stop();
  app.quit();
});
