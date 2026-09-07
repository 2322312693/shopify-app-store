import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadReferenceToR2 } from '../app/services/r2-upload.js';

test('reference image bytes go directly to signed R2 PUT', async () => {
  const file = new Blob([Buffer.alloc(2 * 1024 * 1024, 42)], { type: 'image/png' });
  const calls = [];
  const url = await uploadReferenceToR2(file, async (url, options) => {
    calls.push(url);
    if (options.method === 'POST') {
      assert.ok(options.body.length < 300);
      assert.equal(JSON.parse(options.body).bucketName, 'store');
      return Response.json({ success: true, url: 'https://test.r2.cloudflarestorage.com/video/test?signature=test' });
    }
    assert.equal(options.method, 'PUT');
    assert.equal(options.body, file);
    return new Response('', { status: 200 });
  }, 'fixed-id');
  assert.equal(calls.length, 2);
  assert.equal(url, 'https://store.zestgpt.com/shopify/ai-logo-creator/fixed-id.png');
});

test('R2 failure stops processing and unexpected upload destinations are rejected', async () => {
  const input = new Blob(['image'], { type: 'image/png' });
  await assert.rejects(uploadReferenceToR2(input, async () => new Response('', { status: 503 }), 'a'), /could not start/);
  await assert.rejects(uploadReferenceToR2(input, async () => Response.json({ success: true, url: 'https://example.com/upload' }), 'b'), /invalid destination/);
  await assert.rejects(uploadReferenceToR2(input, async (_url, options) => options.method === 'POST'
    ? Response.json({ success: true, url: 'https://test.r2.cloudflarestorage.com/upload' })
    : new Response('', { status: 500 }), 'c'), /upload failed/);
});
