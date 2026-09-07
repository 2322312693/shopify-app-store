import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const apps = JSON.parse(await readFile('platform-apps.json', 'utf8'));
// Synthetic credentials only. They deliberately differ per application.
process.env.SHOPIFY_API_KEY = 'legacy-key';
process.env.SHOPIFY_API_SECRET = 'legacy-secret';
process.env.SHOPIFY_APP_URL = 'https://imagecleaner.zestgpt.com';
process.env.SHOPIFY_INTERNAL_API_KEY = 'test-internal';
process.env.SHOPIFY_SESSION_STORAGE = 'remote';
for (const key of ['ai_logo_creator', 'bulk_background_remover']) {
  process.env[`${key.toUpperCase()}_SHOPIFY_API_KEY`] = `${key}-key`;
  process.env[`${key.toUpperCase()}_SHOPIFY_API_SECRET`] = `${key}-secret`;
}
for (const app of apps) {
  test(`${app.id}: generated bundle preserves prefix and app identity`, async () => {
    const build = await import(pathToFileURL(path.resolve(`.vercel/output/functions/${app.id}.func/${app.directory}/build/server/index.js`)));
    assert.equal(build.basename, app.path || '/');
    const index = build.routes['routes/_index'].module;
    const response = await index.loader({ request: new Request(`https://imagecleaner.zestgpt.com${app.path}/?shop=test.myshopify.com&host=kept`) });
    assert.equal(response.headers.get('location'), '/app?shop=test.myshopify.com&host=kept');
    const root = await build.routes.root.module.loader();
    const expectedKey = ['legacy', 'product_image_cleaner_ai'].includes(app.id) ? 'legacy-key' : `${app.id}-key`;
    assert.equal((await root.json()).apiKey, expectedKey);
    assert.ok(build.assets.entry.module.startsWith(`${app.path}/`));
    // Another app's HMAC must not authenticate at this route, without reaching storage.
    const wrongSecret = app.id === 'ai_logo_creator' ? 'bulk_background_remover-secret' : 'ai_logo_creator-secret';
    const request = new Request(`https://imagecleaner.zestgpt.com${app.path}/webhooks/app/uninstalled`, { method:'POST', body:'{}', headers:{'x-shopify-hmac-sha256':createHmac('sha256', wrongSecret).update('{}').digest('base64'), 'x-shopify-topic':'app/uninstalled', 'x-shopify-shop-domain':'test.myshopify.com'} });
    await assert.rejects(build.routes['routes/webhooks.app.uninstalled'].module.action({request}), error => error.status === 401);
    const {default: handler} = await import(pathToFileURL(path.resolve(`.vercel/output/functions/${app.id}.func/index.mjs`)));
    const server = createServer((req,res) => handler(req,res).catch(error => { res.statusCode=500; res.end(error.message); }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const entry = await fetch(`http://127.0.0.1:${server.address().port}${app.path}/?shop=test.myshopify.com&host=kept`, {redirect:'manual'});
      assert.equal(entry.headers.get('location'), `${app.path}/app?shop=test.myshopify.com&host=kept`);
      const response = await fetch(`http://127.0.0.1:${server.address().port}${app.path}/auth/login`);
      const html = await response.text();
      assert.equal(response.status, 200, html.slice(0,200));
      assert.ok(html.includes(expectedKey));
      assert.ok(html.includes(`${app.path}/assets/`));
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
}
test('unknown app paths do not fall back to another app', async () => {
  const {routes} = JSON.parse(await readFile('.vercel/output/config.json', 'utf8'));
  const rule = routes.find(route => route.src && new RegExp(`^${route.src}$`).test('/unknown_app/app'));
  assert.equal(rule.status, 404);
});
