import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "@shopify/shopify-api";
import { RemoteSessionStorage } from "../app/services/remote-session-storage.server.js";

test("encrypted remote sessions survive new instances and preserve refresh tokens", async () => {
  const db = new Map();
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    let result = { success: true };
    if (body.operation === 'store') db.set(body.id, body);
    if (body.operation === 'load') result.sealed = db.get(body.id)?.sealed;
    if (body.operation === 'find') result.sessions = [...db.values()].filter(x => x.shop === body.shop).map(x => x.sealed);
    if (body.operation === 'delete') body.ids.forEach(id => db.delete(id));
    return { ok: true, json: async () => result };
  };
  const config = { baseUrl: 'https://example.com', appKey: 'app_a', secret: 'internal', encryptionSecret: 'app-secret', fetchImpl };
  const storage = new RemoteSessionStorage(config);
  const session = new Session({ id: 'offline_test.myshopify.com', shop: 'test.myshopify.com', state: '', isOnline: false });
  session.accessToken = 'sensitive-token'; session.refreshToken = 'sensitive-refresh';
  session.expires = new Date('2026-09-07T00:00:00Z'); session.refreshTokenExpires = new Date('2026-12-07T00:00:00Z');
  await storage.storeSession(session);
  assert.ok(!db.get(session.id).sealed.includes('sensitive'));
  const restarted = new RemoteSessionStorage(config);
  const loaded = await restarted.loadSession(session.id);
  assert.equal(loaded.accessToken, session.accessToken); assert.equal(loaded.refreshToken, session.refreshToken);
  assert.equal(loaded.expires.getTime(), session.expires.getTime());
  assert.equal(loaded.refreshTokenExpires.getTime(), session.refreshTokenExpires.getTime());
  assert.equal((await restarted.findSessionsByShop(session.shop)).length, 1);
  await assert.rejects(new RemoteSessionStorage({ ...config, appKey: 'app_b' }).loadSession(session.id));
  await restarted.deleteSession(session.id); assert.equal(await restarted.loadSession(session.id), undefined);
});
test('storage outages fail closed', async () => {
  const storage = new RemoteSessionStorage({ baseUrl: 'https://example.com', appKey: 'app', secret: 'secret', encryptionSecret: 'encryption', fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(storage.loadSession('id'), /unavailable/);
});
