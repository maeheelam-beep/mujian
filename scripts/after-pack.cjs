'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * electron-builder 在复制 extraResources 时会跳过 node_modules，
 * 导致 Next standalone 的 server.js 找不到 next。这里在打包完成后
 * 直接把 standalone 的运行时依赖补进 resources/server。
 */
exports.default = async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  const source = path.join(projectDir, '.next', 'standalone', 'node_modules');
  const target = path.join(context.appOutDir, 'resources', 'server', 'node_modules');

  if (!fs.existsSync(source)) {
    throw new Error(`[after-pack] 缺少 standalone 依赖：${source}`);
  }

  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, dereference: true });

  console.log(`[after-pack] 已补齐 server/node_modules → ${target}`);
};
