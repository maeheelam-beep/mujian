// 开发预览截图：用 Electron 载入本地 Next 页面，按指定主题截取视口。
// 用法：electron.exe scripts/shot.js <path> <out.png> <light|dark> [width] [height]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [urlPath = '/', outName = 'shot.png', theme = 'dark', width = '1440', height = '900'] =
  process.argv.slice(2);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: Number(width),
    height: Number(height),
    show: true,
    backgroundColor: theme === 'dark' ? '#0c0c0d' : '#f6f3ed',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      paintWhenInitiallyHidden: true,
    },
  });

  const base = process.env.SHOT_BASE || 'http://127.0.0.1:8090';
  await win.loadURL(`${base}${urlPath}`);
  await wait(3000);
  const password = process.env.SHOT_PASSWORD || 'mujian-dev';
  const loginStatus = await win.webContents.executeJavaScript(`
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ${JSON.stringify(password)} }),
    }).then((r) => r.status).catch(() => -1)
  `);
  console.log('login:', loginStatus, 'title:', win.getTitle());
  await win.reload();
  await wait(4200);
  await win.webContents.executeJavaScript(`
    localStorage.setItem('mujian-theme', ${JSON.stringify(theme)});
    document.documentElement.classList.toggle('dark', ${JSON.stringify(theme)} === 'dark');
    document.documentElement.style.colorScheme = ${JSON.stringify(theme)};
  `);
  await wait(1500);

  const image = await win.webContents.capturePage();
  const target = path.resolve(outName);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, image.toPNG());
  console.log(`${target} ${image.getSize().width}x${image.getSize().height}`);
  app.quit();
});
