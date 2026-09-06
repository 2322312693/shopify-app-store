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
