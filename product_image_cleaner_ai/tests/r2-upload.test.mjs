import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadSourceToR2 } from '../app/services/r2-upload.server.js';

test('large image bytes bypass Node and only go to signed R2 PUT', async () => {
  const bytes = Buffer.alloc(2 * 1024 * 1024, 42);
  const calls = [];
  const url = await uploadSourceToR2(`data:image/png;base64,${bytes.toString('base64')}`, async (url, options) => {
    calls.push(url);
    if (options.method === 'POST') {
      assert.ok(options.body.length < 300);
      assert.equal(JSON.parse(options.body).bucketName, 'video');
      return Response.json({ success: true, url: 'https://test.r2.cloudflarestorage.com/video/test?signature=test' });
    }
    assert.equal(options.method, 'PUT');
    assert.deepEqual(options.body, bytes);
    return new Response('', { status: 200 });
  });
  assert.equal(calls.length, 2);
  assert.match(url, /^https:\/\/store.zestgpt.com\/shopify\/product-image-cleaner\/[a-f0-9-]+\.png$/);
});

test('R2 failure stops processing and unexpected upload destinations are rejected', async () => {
  const input = 'data:image/png;base64,AQID';
  await assert.rejects(uploadSourceToR2(input, async () => new Response('', { status: 503 })), /could not start/);
  await assert.rejects(uploadSourceToR2(input, async () => Response.json({ success: true, url: 'https://example.com/upload' })), /invalid destination/);
  await assert.rejects(uploadSourceToR2(input, async (_url, options) => options.method === 'POST'
    ? Response.json({ success: true, url: 'https://test.r2.cloudflarestorage.com/upload' })
    : new Response('', { status: 500 })), /upload failed/);
});
