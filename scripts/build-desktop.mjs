#!/usr/bin/env node
/**
 * 构建桌面端所需的 Next.js standalone 产物。
 *
 * 产物布局：
 *   .next/standalone/server.js        ← Electron 启动它
 *   .next/standalone/.next/static     ← 前端静态资源
 *   .next/standalone/public           ← 图标 / manifest
 *
 * 之后 `npm run dist` 会把 .next/standalone 作为 extraResources 打进安装包。
 */

import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standalone = path.join(root, '.next', 'standalone');
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function sizeOf(target) {
  let total = 0;
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    const info = statSync(current);
    if (info.isDirectory()) {
      for (const entry of readdirSync(current)) {
        stack.push(path.join(current, entry));
      }
    } else {
      total += info.size;
    }
  }
  return total;
}

console.log('▸ 构建 Next.js standalone…');
run(process.execPath, [nextBin, 'build'], {
  DOCKER_BUILD: '1',
  NEXT_TELEMETRY_DISABLED: '1',
});

if (!existsSync(path.join(standalone, 'server.js'))) {
  console.error('✗ 没有找到 .next/standalone/server.js');
  process.exit(1);
}

console.log('▸ 复制静态资源…');
rmSync(path.join(standalone, '.next', 'static'), { recursive: true, force: true });
cpSync(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), {
  recursive: true,
});

if (existsSync(path.join(root, 'public'))) {
  rmSync(path.join(standalone, 'public'), { recursive: true, force: true });
  cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
}

console.log(`✓ standalone 就绪：${(sizeOf(standalone) / 1024 / 1024).toFixed(1)} MB`);
console.log('  下一步：npm run dist');
