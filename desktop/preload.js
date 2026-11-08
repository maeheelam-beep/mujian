'use strict';

/**
 * 只向本地放映室（主窗口同源）暴露最小窗口控制接口。
 * 任何外部页面、iframe、data: 启动页都拿不到这些能力。
 */

const { contextBridge, ipcRenderer } = require('electron');

const originArg = process.argv.find((arg) => arg.startsWith('--mujian-origin='));
const allowedOrigin = originArg ? originArg.slice('--mujian-origin='.length) : '';
const versionArg = process.argv.find((arg) => arg.startsWith('--mujian-version='));
const appVersion = versionArg ? versionArg.slice('--mujian-version='.length) : '';

function allowed() {
  try {
    return !!allowedOrigin && location.origin === allowedOrigin;
  } catch {
    return false;
  }
}

if (allowed()) {
  contextBridge.exposeInMainWorld('mujian', {
    platform: process.platform,
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    version: appVersion,
    openExternal: (url) => ipcRenderer.send('app:open-external', url),
    info: () => ipcRenderer.invoke('app:info'),
    onMaximizedChange: (callback) => {
      const listener = (_event, value) => callback(!!value);
      ipcRenderer.on('window:maximized-changed', listener);
      return () => ipcRenderer.removeListener('window:maximized-changed', listener);
    },
  });
}
