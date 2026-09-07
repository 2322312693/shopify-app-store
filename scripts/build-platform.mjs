import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeFileTrace } from '@vercel/nft';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apps = JSON.parse(await readFile(path.join(root, 'platform-apps.json'), 'utf8'));
const output = path.join(root, '.vercel/output');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'static'), { recursive: true });
const installed = new Set();
for (const app of apps) {
  const cwd = path.join(root, app.directory);
  if (!installed.has(cwd)) {
    if (process.env.PLATFORM_SKIP_INSTALL !== '1') execFileSync('npm', ['ci'], { cwd, stdio: 'inherit' });
    installed.add(cwd);
  }
  const env = { ...process.env, APP_BASE_PATH: app.path, PLATFORM_BUILD: '1' };
  delete env.VERCEL;
  execFileSync('npm', ['run', 'build'], { cwd, env, stdio: 'inherit' });
  const fn = path.join(output, 'functions', `${app.id}.func`);
  await mkdir(fn, { recursive: true });
  // Each app gets an isolated module graph. No request ever rewrites process.env.
  const source = path.join(cwd, 'build/server/index.js');
  const { fileList } = await nodeFileTrace([source, path.join(cwd, 'node_modules/@remix-run/node/dist/index.js')], { base: root, processCwd: cwd });
  for (const relative of fileList) {
    const target = path.join(fn, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(root, relative), target, { dereference: true });
  }
  await writeFile(path.join(fn, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(fn, 'index.mjs'), `
import { Readable } from 'node:stream';
import { createRequestHandler } from './${app.directory}/node_modules/@remix-run/node/dist/index.js';
import * as build from './${app.directory}/build/server/index.js';
const handle = createRequestHandler(build, 'production');
export default async function handler(req, res) {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const url = new URL(req.url, 'https://imagecleaner.zestgpt.com');
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) headers.append(key, item);
  }
  const init = { method: req.method, headers, signal: controller.signal };
  if (!['GET', 'HEAD'].includes(req.method)) { init.body = Readable.toWeb(req); init.duplex = 'half'; }
  const response = await handle(new Request(url, init));
  res.statusCode = response.status;
  response.headers.forEach((value, key) => { if (key !== 'set-cookie') res.setHeader(key, value); });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);
  if (!response.body || req.method === 'HEAD') return res.end();
  for await (const chunk of response.body) { if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve)); }
  res.end();
}
`);
  await writeFile(path.join(fn, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs24.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration: 300 }));
  await cp(path.join(cwd, 'build/client'), path.join(output, 'static', app.path), { recursive: true });
}
const routes = [
  { handle: 'filesystem' },
  ...apps.filter(app => app.path).map(app => ({ src: `${app.path}(?:/.*)?`, dest: `/${app.id}` })),
  { src: '/(?:|app(?:/.*)?|auth(?:/.*)?|webhooks(?:/.*)?|privacy)', dest: '/legacy' },
  { src: '/.*', status: 404 }
];
await writeFile(path.join(output, 'config.json'), JSON.stringify({ version: 3, routes }, null, 2));
console.log('Unified platform built:', apps.map(app => app.path || '/ (legacy)').join(', '));
