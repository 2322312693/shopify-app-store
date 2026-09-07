import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLogoPrompt, validateReferenceImageUrl } from '../app/services/ai-logo.server.js';

test('logo prompt includes the merchant brief and reference originality guard', () => {
  const prompt = buildLogoPrompt({
    brandName: 'Northstar Coffee',
    brief: 'Minimal mountain symbol in deep green and warm gold',
    hasReference: true,
  });
  assert.match(prompt, /Northstar Coffee/);
  assert.match(prompt, /Minimal mountain symbol/);
  assert.match(prompt, /Redesign it substantially/);
  assert.match(prompt, /do not copy protected marks/);
  assert.match(prompt, /No mockup/);
});

test('reference URL is limited to this app R2 prefix', () => {
  assert.equal(
    validateReferenceImageUrl('https://store.zestgpt.com/shopify/ai-logo-creator/example.png'),
    'https://store.zestgpt.com/shopify/ai-logo-creator/example.png',
  );
  assert.throws(() => validateReferenceImageUrl('https://example.com/reference.png'));
  assert.throws(() => validateReferenceImageUrl('https://store.zestgpt.com/shopify/another-app/reference.png'));
});
