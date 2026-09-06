import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { selectActiveSubscription, planFromSubscription } from '../app/services/subscription-policy.js';

const active = { id: 'new', name: 'Pro', status: 'ACTIVE', test: false };
test('access requires active paid plan and explicit test opt-in', () => {
  assert.equal(selectActiveSubscription([{ ...active, status: 'CANCELLED' }]), null);
  assert.equal(selectActiveSubscription([{ ...active, status: 'FROZEN' }]), null);
  assert.equal(selectActiveSubscription([{ ...active, test: true }]), null);
  assert.equal(selectActiveSubscription([{ ...active, test: true }], true).id, 'new');
  assert.equal(selectActiveSubscription([{ ...active, name: 'Free' }]), null);
  assert.equal(selectActiveSubscription([active]).id, 'new');
});
function loadAction(file, dependencies) {
  const code = fs.readFileSync(new URL('../app/routes/' + file, import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export const action', 'const action');
  return new Function(...Object.keys(dependencies), code + '; return action;')(...Object.values(dependencies));
}
function subscriptionAction(current, sync, payload = { status: 'CANCELLED', name: 'Starter' }) {
  return loadAction('webhooks.app.subscriptions_update.jsx', {
    authenticate: { webhook: async () => ({ shop: 'example.myshopify.com', payload }) },
    unauthenticated: { admin: async () => ({ admin: { graphql: async () => ({ json: async () => current }) } }) },
    queryAdminWithRecovery: async ({ admin }) => (await admin.graphql()).json(),
    planFromSubscription, syncSubscriptionToBackend: sync,
  });
}
test('late old-plan cancellation preserves current paid subscription', async () => {
  let args;
  await subscriptionAction({ data: { currentAppInstallation: { activeSubscriptions: [active] } } }, async (...value) => { args = value; })({});
  assert.equal(args[1], 'Pro'); assert.equal(args[2].id, 'new'); assert.equal(args[2].status, 'active');
});
test('late activation does not restore a cancelled subscription', async () => {
  let args;
  await subscriptionAction({ data: { currentAppInstallation: { activeSubscriptions: [] } } }, async (...value) => { args = value; }, active)({});
  assert.equal(args[1], 'Free'); assert.equal(args[2].status, 'none');
});
test('lookup and persistence failures are not acknowledged', async () => {
  await assert.rejects(subscriptionAction({ errors: [{ message: 'unavailable' }] }, async () => {})({}));
  await assert.rejects(subscriptionAction({ data: { currentAppInstallation: { activeSubscriptions: [active] } } }, async () => { throw new Error('offline'); })({}));
});
test('uninstall persists revocation before deleting sessions', async () => {
  const calls = [];
  const action = loadAction('webhooks.app.uninstalled.jsx', {
    authenticate: { webhook: async () => ({ shop: 'example.myshopify.com', session: { id: 'online' } }) },
    sessionStorage: { deleteSession: async (id) => calls.push(id) },
    syncSubscriptionToBackend: async (shop, plan, sub) => { calls.push(sub.status); assert.equal(plan, 'Free'); },
  });
  await action({});
  assert.deepEqual(calls, ['cancelled', 'online', 'offline_example.myshopify.com']);
});

function recoveryQuery(fetch, migrateOfflineSessionToExpiring) {
  const code = fs.readFileSync(new URL('../app/services/admin-query.server.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export async function', 'async function');
  return new Function('fetch', 'migrateOfflineSessionToExpiring', code + '; return queryAdminWithRecovery;')(fetch, migrateOfflineSessionToExpiring);
}
test('SDK 403 recovers through direct query without granting unverified access', async () => {
  const query = recoveryQuery(async () => ({ ok: true, json: async () => ({ data: 'verified' }) }), async () => assert.fail('unnecessary migration'));
  const result = await query({ admin: { graphql: async () => { throw { status: 403 }; } }, session: { shop: 'test.myshopify.com', accessToken: 'old' }, query: 'query' });
  assert.equal(result.data, 'verified');
});
test('invalid legacy token is migrated once and retry failure propagates', async () => {
  let migrations = 0, requests = 0;
  const query = recoveryQuery(async () => { requests++; return { ok: false, status: 403 }; }, async () => { migrations++; });
  await assert.rejects(query({ admin: { graphql: async () => { throw { status: 403 }; } }, session: { shop: 'test.myshopify.com', accessToken: 'old' }, query: 'query' }));
  assert.equal(migrations, 1); assert.equal(requests, 2);
});
test('server failures never trigger token migration', async () => {
  const query = recoveryQuery(async () => assert.fail('unexpected fetch'), async () => assert.fail('unexpected migration'));
  await assert.rejects(query({ admin: { graphql: async () => { throw { status: 500 }; } }, session: { accessToken: 'old' }, query: 'query' }));
});

test('session storage preserves expiring offline token pairs', async () => {
  const { SQLiteSessionStorage } = await import('@shopify/shopify-app-session-storage-sqlite');
  const { Session } = await import('@shopify/shopify-api');
  const storage = new SQLiteSessionStorage(':memory:');
  const session = new Session({ id: 'offline_test.myshopify.com', shop: 'test.myshopify.com', state: '', isOnline: false });
  session.accessToken = 'test-access'; session.refreshToken = 'test-refresh';
  session.expires = new Date('2026-09-06T12:00:00Z');
  session.refreshTokenExpires = new Date('2026-12-01T12:00:00Z');
  await storage.storeSession(session);
  const restored = await storage.loadSession(session.id);
  assert.equal(restored.refreshToken, session.refreshToken);
  assert.equal(restored.expires.getTime(), session.expires.getTime());
  assert.equal(restored.refreshTokenExpires.getTime(), session.refreshTokenExpires.getTime());
});
