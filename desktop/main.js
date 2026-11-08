'use strict';

/**
 * 幕间 MUJIAN — Electron 主进程
 *
 * 职责只有三件：
 * 1. 在本机拉起 Next.js standalone 服务（127.0.0.1，随机密码）；
 * 2. 用一个无边框窗口承载界面，并把窗口控制权交给页面里的自定义标题栏；
 * 3. 托盘、窗口位置记忆、自动登录、外链交给系统浏览器。
 *
 * 刻意不做的事：不内置商业采集站、不代理视频流量、不收集使用数据。
 * 随包预置的 Internet Archive 公共档案源是例外——它们是明确可公开播放的馆藏。
 */

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  screen,
  session,
  shell,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const APP_ID = 'com.mujian.cinema';
const APP_NAME = '幕间';
const IS_DEV = !app.isPackaged;
const ROOT = path.join(__dirname, '..');
const SERVER_DIR = IS_DEV
  ? path.join(ROOT, '.next', 'standalone')
  : path.join(process.resourcesPath, 'server');
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const PARTITION = 'persist:mujian';
const DEFAULT_PORT = 17890;

/**
 * 开箱可用的合法片源：Internet Archive 的公共档案合集。
 * 不内置任何商业采集站；用户仍可在设置里添加自己的 Apple CMS 源。
 */
const PUBLIC_DOMAIN_SOURCES = [
  {
    name: '公共领域电影',
    url: 'https://archive.org?collection=feature_films',
    provider: 'archive',
  },
  {
    name: '经典动画',
    url: 'https://archive.org?collection=animationandcartoons',
    provider: 'archive',
  },
  {
    name: '默片时代',
    url: 'https://archive.org?collection=silent_films',
    provider: 'archive',
  },
  {
    name: '经典电视',
    url: 'https://archive.org?collection=classic_tv',
    provider: 'archive',
  },
  {
    name: '普雷林格档案',
    url: 'https://archive.org?collection=prelinger',
    provider: 'archive',
  },
  {
    name: '复古动画',
    url: 'https://archive.org?collection=vintage_cartoons',
    provider: 'archive',
  },
  {
    name: '短片集',
    url: 'https://archive.org?collection=short_films',
    provider: 'archive',
  },
  {
    name: '教育影像',
    url: 'https://archive.org?collection=avgeeks',
    provider: 'archive',
  },
];

const DEFAULT_SETTINGS = {
  port: DEFAULT_PORT,
  password: '',
  width: 1360,
  height: 880,
  x: null,
  y: null,
  maximized: false,
  closeToTray: true,
};

let settings = { ...DEFAULT_SETTINGS };
let win = null;
let tray = null;
let serverProc = null;
let serverPort = 0;
let baseUrl = '';
let booting = false;
let quitting = false;
let serverStartedOk = false;
let notifiedTray = false;
let logStream = null;
let serverLogStream = null;
let trayBalloonShown = false;

app.setName(APP_NAME);

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function logDir() {
  return path.join(app.getPath('userData'), 'logs');
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  try {
    if (!logStream) {
      fs.mkdirSync(logDir(), { recursive: true });
      logStream = fs.createWriteStream(path.join(logDir(), 'main.log'), { flags: 'a' });
    }
    logStream.write(`${line}\n`);
  } catch {
    /* 日志失败不影响主流程 */
  }
}

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    settings = { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }

  // 本地服务只监听 127.0.0.1，但 Next 在未设置 PASSWORD 时会挡住整站。
  // 生成一个仅存在本机的随机密码，并预写登录 Cookie，让界面无感。
  if (!settings.password || typeof settings.password !== 'string') {
    settings.password = crypto.randomBytes(18).toString('hex');
    saveSettings();
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (e) {
    log('保存设置失败', e.message);
  }
}

/* ------------------------------------------------------------------ */
/* 本地服务                                                            */
/* ------------------------------------------------------------------ */

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function findFreePort(preferred) {
  for (let port = preferred; port < preferred + 30; port += 1) {
    if (await isPortFree(port)) return port;
  }
  return ephemeralPort();
}

function httpGet(port, urlPath, timeout = 1800) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        timeout,
        headers: { 'user-agent': `Mujian/${app.getVersion()}` },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < 4000) body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

async function waitForServer(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!serverProc) return false;
    try {
      const { status } = await httpGet(port, '/api/status', 1500);
      if (status >= 200 && status < 500) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(240);
  }
  return false;
}

/**
 * Node 的 fetch 不会自动走 Windows 系统代理；而 Chromium 会。
 * 这个应用的所有上游请求都在 Next 服务端发出，所以要把系统代理显式交给子进程，
 * 否则 archive.org 这类被 DNS 污染的域名会出现「浏览器能开、应用里超时」。
 */
function detectSystemProxy() {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) {
    return process.env.HTTPS_PROXY || process.env.https_proxy || '';
  }
  if (process.platform !== 'win32') return '';
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  try {
    const enabled = execFileSync('reg', ['query', key, '/v', 'ProxyEnable'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(enabled)) return '';
    const value = execFileSync('reg', ['query', key, '/v', 'ProxyServer'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const match = /ProxyServer\s+REG_SZ\s+(.+)/i.exec(value);
    if (!match) return '';
    const raw = match[1].trim();
    const parts = raw.split(';').map((part) => part.trim());
    const https = parts.find((part) => /^https?=/i.test(part));
    const address = https ? https.replace(/^https?=/i, '') : raw;
    if (!address) return '';
    return /^[a-z]+:\/\//i.test(address) ? address : `http://${address}`;
  } catch {
    return '';
  }
}

const SYSTEM_PROXY = detectSystemProxy();

function startServer(port) {
  const entry = path.join(SERVER_DIR, 'server.js');
  if (!fs.existsSync(entry)) {
    throw new Error(
      `未找到本地服务：${entry}\n\n开发环境请先运行 npm run build:desktop；安装包内文件可能已损坏，请重新安装。`
    );
  }

  try {
    fs.mkdirSync(logDir(), { recursive: true });
    const serverLog = path.join(logDir(), 'server.log');
    if (fs.existsSync(serverLog) && fs.statSync(serverLog).size > 4 * 1024 * 1024) {
      try {
        fs.renameSync(serverLog, `${serverLog}.1`);
      } catch {
        /* ignore */
      }
    }
    serverLogStream = fs.createWriteStream(serverLog, { flags: 'a' });
    serverLogStream.write(`\n===== ${new Date().toISOString()} :${port} =====\n`);
  } catch {
    serverLogStream = null;
  }

  const env = {
    ...process.env,
    // 直接复用 Electron 自带的 Node，无需再打包 node.exe
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    PASSWORD: settings.password,
    SEARCH_MAX_PAGES: process.env.SEARCH_MAX_PAGES || '1',
    SEARCH_SOURCE_TIMEOUT_MS: process.env.SEARCH_SOURCE_TIMEOUT_MS || '6000',
    DEFAULT_SOURCES: process.env.DEFAULT_SOURCES || JSON.stringify(PUBLIC_DOMAIN_SOURCES),
    ...(SYSTEM_PROXY
      ? {
          HTTP_PROXY: SYSTEM_PROXY,
          HTTPS_PROXY: SYSTEM_PROXY,
          NODE_USE_ENV_PROXY: '1',
          NO_PROXY: process.env.NO_PROXY || 'localhost,127.0.0.1,::1',
        }
      : {}),
  };

  log('启动本地服务', entry, 'port', port);
  const child = spawn(process.execPath, [entry], {
    cwd: SERVER_DIR,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc = child;
  serverStartedOk = false;

  if (serverLogStream) {
    child.stdout.pipe(serverLogStream, { end: false });
    child.stderr.pipe(serverLogStream, { end: false });
  }

  child.on('error', (err) => {
    log('本地服务启动失败', err.message);
    if (serverProc === child) serverProc = null;
  });

  child.on('exit', (code) => {
    if (serverProc !== child) return;
    serverProc = null;
    if (quitting) return;
    if (!serverStartedOk) {
      log('本地服务启动阶段退出 code=', code);
      return;
    }
    log('本地服务意外退出 code=', code);
    void showError(new Error(`本地服务已退出（退出码 ${code}）。`));
    updateTray();
  });

  return child;
}

function stopServer() {
  const child = serverProc;
  serverProc = null;
  serverStartedOk = false;
  if (!child || child.exitCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('exit', finish);
    try {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('error', () => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        });
      } else {
        child.kill('SIGKILL');
      }
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    setTimeout(finish, 4000);
  });
}

/**
 * 与 LibreTV 的 lib/auth 保持同一套令牌算法：
 *   key   = sha256(PASSWORD + ":libretv::session-salt")
 *   token = `${expiresAt}.${hmac_sha256(key, expiresAt)}`
 * 这样桌面端可以无感登录，同时不改变上游鉴权逻辑。
 */
async function applySessionCookie() {
  try {
    const expiresAt = Date.now() + 90 * 24 * 60 * 60 * 1000;
    const key = crypto
      .createHash('sha256')
      .update(`${settings.password}:libretv::session-salt`)
      .digest('hex');
    const token = `${expiresAt}.${crypto
      .createHmac('sha256', key)
      .update(String(expiresAt))
      .digest('hex')}`;
    await session.fromPartition(PARTITION).cookies.set({
      url: baseUrl,
      name: 'ltv_session',
      value: token,
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: expiresAt / 1000,
    });
    log('已写入自动登录 Cookie');
  } catch (e) {
    log('写入自动登录 Cookie 失败', e.message);
  }
}

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

function restoreBounds() {
  const bounds = {
    width: Math.max(1080, Number(settings.width) || DEFAULT_SETTINGS.width),
    height: Math.max(680, Number(settings.height) || DEFAULT_SETTINGS.height),
  };
  if (Number.isFinite(settings.x) && Number.isFinite(settings.y)) {
    const visible = screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      return (
        settings.x < area.x + area.width - 80 &&
        settings.x + bounds.width > area.x + 80 &&
        settings.y < area.y + area.height - 80 &&
        settings.y + bounds.height > area.y + 80
      );
    });
    if (visible) {
      bounds.x = Math.round(settings.x);
      bounds.y = Math.round(settings.y);
    }
  }
  return bounds;
}

function captureWindowState() {
  if (!win || win.isDestroyed()) return;
  if (!win.isMinimized() && !win.isFullScreen()) {
    const bounds = typeof win.getNormalBounds === 'function' ? win.getNormalBounds() : win.getBounds();
    settings.width = bounds.width;
    settings.height = bounds.height;
    settings.x = bounds.x;
    settings.y = bounds.y;
  }
  settings.maximized = win.isMaximized();
}

function createWindow() {
  const bounds = restoreBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    frame: false,
    thickFrame: true,
    hasShadow: true,
    backgroundColor: '#0c0c0d',
    title: '幕间 MUJIAN',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
      partition: PARTITION,
      additionalArguments: [`--mujian-origin=${baseUrl}`, `--mujian-version=${app.getVersion()}`],
    },
  });

  win.once('ready-to-show', () => {
    if (settings.maximized) win.maximize();
    win.show();
  });

  win.on('close', (event) => {
    captureWindowState();
    saveSettings();
    if (quitting) return;
    event.preventDefault();
    if (settings.closeToTray) {
      hideToTray();
    } else {
      quitApp();
    }
  });

  win.on('closed', () => {
    win = null;
  });

  let persistTimer = null;
  const persistLater = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      captureWindowState();
      saveSettings();
    }, 500);
  };
  win.on('resize', persistLater);
  win.on('move', persistLater);
  win.on('maximize', () => {
    persistLater();
    sendMaximized(true);
  });
  win.on('unmaximize', () => {
    persistLater();
    sendMaximized(false);
  });
  win.on('show', updateTray);
  win.on('hide', updateTray);

  const wc = win.webContents;

  wc.setWindowOpenHandler(({ url }) => {
    if (baseUrl && url.startsWith(baseUrl)) return { action: 'allow' };
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('will-navigate', (event, url) => {
    if (baseUrl && url.startsWith(baseUrl)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });

  wc.on('will-attach-webview', (event) => event.preventDefault());

  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' && IS_DEV) {
      wc.toggleDevTools();
      event.preventDefault();
      return;
    }
    if (input.key === 'Escape' && win && win.isFullScreen()) {
      win.setFullScreen(false);
    }
  });

  wc.on('render-process-gone', (event, details) => {
    if (quitting) return;
    void showError(new Error(`渲染进程异常退出：${details.reason || 'unknown'}`));
  });

  return win;
}

function sendMaximized(value) {
  if (win && !win.isDestroyed()) win.webContents.send('window:maximized-changed', !!value);
}

function splashHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    :root{color-scheme:dark}
    *{box-sizing:border-box}
    html,body{height:100%;margin:0}
    body{background:radial-gradient(100% 100% at 78% 8%,#2b1813 0%,#120d0b 42%,#0b0b0c 100%);color:#f0ebe2;
      font-family:"Iowan Old Style","Palatino Linotype",Palatino,"Songti SC","Noto Serif SC",serif;
      display:flex;align-items:center;justify-content:center;-webkit-app-region:drag;overflow:hidden}
    body:after{content:"";position:fixed;inset:0;background:radial-gradient(60% 50% at 50% 50%,transparent 0%,rgba(0,0,0,.5) 100%)}
    .box{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:20px}
    .mark{width:74px;height:74px;border:1px solid rgba(224,105,76,.4);border-radius:18px;display:flex;align-items:center;justify-content:center;
      background:rgba(255,255,255,.02);box-shadow:0 20px 60px -30px #000}
    .name{font-size:34px;letter-spacing:.3em;margin-left:.3em}
    .en{font-family:"Segoe UI",sans-serif;font-size:9px;letter-spacing:.55em;color:rgba(240,235,226,.35);margin-left:.55em}
    .line{width:150px;height:1px;background:linear-gradient(90deg,transparent,rgba(224,105,76,.55),transparent);margin-top:6px}
    .hint{font-family:"Segoe UI","Microsoft YaHei",sans-serif;font-size:11px;letter-spacing:.16em;color:rgba(240,235,226,.42)}
    .dots{display:flex;gap:5px}.dots i{width:3px;height:3px;border-radius:99px;background:#e0694c;animation:p 1.2s infinite}
    .dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
    @keyframes p{0%,100%{opacity:.2}50%{opacity:1}}
  </style></head><body><div class="box">
    <div class="mark"><svg width="46" height="46" viewBox="0 0 40 40" fill="none">
      <path d="M7 32V17a13 13 0 0 1 26 0v15" stroke="#e0694c" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M12 32V18a8 8 0 0 1 16 0v14" stroke="#f0ebe2" stroke-opacity=".45" stroke-width="1" stroke-linecap="round"/>
      <path d="M20 10v22" stroke="#f0ebe2" stroke-opacity=".22" stroke-width=".8"/>
      <circle cx="20" cy="20" r="1.6" fill="#e0694c"/>
    </svg></div>
    <div style="text-align:center"><div class="name">幕间</div><div class="en">MUJIAN CINEMA</div></div>
    <div class="line"></div>
    <div class="hint">正在点亮放映机</div>
    <div class="dots"><i></i><i></i><i></i></div>
  </div></body></html>`;
}

async function showSplash() {
  if (!win || win.isDestroyed()) return;
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml())}`);
  } catch {
    /* ignore */
  }
}

async function showError(error) {
  const message = error && error.message ? error.message : String(error);
  log('错误：', message);
  if (!win || win.isDestroyed()) return;
  const choice = await dialog.showMessageBox(win, {
    type: 'error',
    title: '放映室没能启动',
    message: '本地服务没有正常启动',
    detail: `${message}\n\n日志位于：${logDir()}`,
    buttons: ['重试', '打开日志', '退出'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (choice.response === 0) {
    setTimeout(() => void boot(), 300);
  } else if (choice.response === 1) {
    void shell.openPath(logDir());
    setTimeout(() => void boot(), 600);
  } else {
    quitApp();
  }
}

/* ------------------------------------------------------------------ */
/* 托盘                                                                */
/* ------------------------------------------------------------------ */

function trayImage() {
  try {
    const image = nativeImage.createFromPath(ICON_PATH);
    if (image.isEmpty()) return nativeImage.createEmpty();
    return image.resize({ width: 20, height: 20 });
  } catch {
    return nativeImage.createEmpty();
  }
}

function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  const running = !!serverProc;
  tray.setToolTip(`幕间 MUJIAN · ${running ? '放映室运行中' : '放映室已停止'}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: win && win.isVisible() ? '隐藏主窗口' : '显示主窗口',
        click: toggleWindow,
      },
      {
        label: '全屏',
        type: 'checkbox',
        checked: !!(win && win.isFullScreen()),
        click: () => {
          if (win) win.setFullScreen(!win.isFullScreen());
        },
      },
      { type: 'separator' },
      { label: '重启本地服务', click: () => void boot() },
      {
        label: '在浏览器中打开',
        enabled: !!baseUrl,
        click: () => {
          if (baseUrl) void shell.openExternal(baseUrl);
        },
      },
      { label: '打开日志文件夹', click: () => void shell.openPath(logDir()) },
      { label: '打开数据目录', click: () => void shell.openPath(app.getPath('userData')) },
      { type: 'separator' },
      {
        label: '关闭窗口时最小化到托盘',
        type: 'checkbox',
        checked: !!settings.closeToTray,
        click: (item) => {
          settings.closeToTray = item.checked;
          saveSettings();
        },
      },
      { type: 'separator' },
      { label: '退出幕间', click: () => quitApp() },
    ])
  );
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('幕间 MUJIAN');
  tray.on('click', toggleWindow);
  tray.on('double-click', showWindow);
  updateTray();
}

function hideToTray() {
  if (!win || win.isDestroyed()) return;
  win.hide();
  if (!trayBalloonShown && tray) {
    trayBalloonShown = true;
    try {
      tray.displayBalloon({
        title: '幕间还在放映',
        content: '窗口已收到托盘，单击托盘图标可以重新打开。',
      });
    } catch {
      /* ignore */
    }
  }
  updateTray();
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible() && !win.isMinimized()) hideToTray();
  else showWindow();
}

/* ------------------------------------------------------------------ */
/* 启动 / 退出                                                         */
/* ------------------------------------------------------------------ */

async function boot() {
  if (booting) return;
  booting = true;
  try {
    const preferred = Number(settings.port) || DEFAULT_PORT;
    const port = await findFreePort(preferred);
    if (port !== preferred) {
      settings.port = port;
      saveSettings();
      log('端口被占用，改用', port);
    }
    serverPort = port;
    baseUrl = `http://127.0.0.1:${port}`;

    if (!win || win.isDestroyed()) {
      createWindow();
      await showSplash();
    } else {
      await showSplash();
    }

    await stopServer();
    startServer(port);
    const ready = await waitForServer(port, 60000);
    if (!ready) throw new Error('本地服务在 60 秒内没有就绪，请查看 server.log。');
    serverStartedOk = true;
    log('本地服务就绪', baseUrl);

    await applySessionCookie();
    await win.loadURL(baseUrl);
    if (!win.isVisible()) win.show();
    if (win.isMinimized()) win.restore();
    updateTray();
  } catch (error) {
    await stopServer();
    await showError(error);
  } finally {
    booting = false;
  }
}

function quitApp() {
  if (quitting) return;
  quitting = true;
  captureWindowState();
  saveSettings();
  void stopServer();
  if (tray && !tray.isDestroyed()) tray.destroy();
  app.quit();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_ID);
    nativeTheme.themeSource = 'system';
    loadSettings();
    Menu.setApplicationMenu(null);

    // 去掉 Electron 标识，避免部分采集站 / CDN 直接拒绝请求
    try {
      const ua = app.userAgentFallback
        .replace(/\sElectron\/[\d.]+/g, '')
        .replace(new RegExp(`\\s${APP_NAME}\\/[\\d.]+`, 'g'), '');
      session.fromPartition(PARTITION).setUserAgent(ua);
      app.userAgentFallback = ua;
    } catch {
      /* ignore */
    }

    try {
      const ses = session.fromPartition(PARTITION);
      ses.setPermissionRequestHandler((wc, permission, callback) => {
        callback(['fullscreen', 'clipboard-sanitized-write'].includes(permission));
      });
      ses.setPermissionCheckHandler(() => false);
    } catch {
      /* ignore */
    }

    createTray();
    await boot();
  });

  app.on('before-quit', () => {
    quitting = true;
    captureWindowState();
    saveSettings();
  });

  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });

  app.on('activate', () => {
    if (!win) void boot();
    else showWindow();
  });
}

/* ------------------------------------------------------------------ */
/* IPC：只接受来自本地放映室的调用                                      */
/* ------------------------------------------------------------------ */

function trusted(event) {
  try {
    const url = event.senderFrame ? event.senderFrame.url : event.sender.getURL();
    return !!baseUrl && new URL(url).origin === baseUrl;
  } catch {
    return false;
  }
}

ipcMain.on('window:minimize', (event) => {
  if (trusted(event) && win) win.minimize();
});

ipcMain.on('window:toggle-maximize', (event) => {
  if (!trusted(event) || !win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.on('window:close', (event) => {
  if (!trusted(event) || !win) return;
  if (settings.closeToTray) hideToTray();
  else quitApp();
});

ipcMain.handle('window:is-maximized', (event) => {
  if (!trusted(event) || !win) return false;
  return win.isMaximized();
});

ipcMain.handle('app:version', (event) => {
  if (!trusted(event)) return '';
  return app.getVersion();
});

ipcMain.handle('app:info', (event) => {
  if (!trusted(event)) return null;
  return {
    version: app.getVersion(),
    baseUrl,
    userData: app.getPath('userData'),
    logDir: logDir(),
  };
});

ipcMain.on('app:open-external', (event, url) => {
  if (!trusted(event) || typeof url !== 'string') return;
  if (/^https?:/i.test(url)) void shell.openExternal(url);
});

ipcMain.on('app:open-logs', (event) => {
  if (trusted(event)) void shell.openPath(logDir());
});
