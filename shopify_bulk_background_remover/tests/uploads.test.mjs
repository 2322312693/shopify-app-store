import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { File } from 'node:buffer';
import { readUploadedImage } from '../app/services/upload-image.server.js';
import { MAX_UPLOAD_BYTES } from '../app/services/upload-policy.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN3cAAAAASUVORK5CYII=', 'base64');
const file = () => new File([png], 'product.png', { type: 'image/png' });
test('upload validates real type, emptiness and size before processing', async () => {
  assert.match(await readUploadedImage(file()), /^data:image\/png;base64,/);
  await assert.rejects(readUploadedImage(new File(['<svg/>'], 'x.png', { type: 'image/png' })));
  await assert.rejects(readUploadedImage(new File([png], 'x.jpg', { type: 'image/jpeg' })));
  await assert.rejects(readUploadedImage(new File([], 'x.png', { type: 'image/png' })));
  await assert.rejects(readUploadedImage({ size: MAX_UPLOAD_BYTES + 1, arrayBuffer() { assert.fail('oversized file read'); } }));
});
function actionWith(calls, fail = false) {
 const text = fs.readFileSync(new URL('../app/routes/app._index.jsx', import.meta.url), 'utf8');
 const code = text.slice(text.indexOf('export const action ='), text.indexOf("import { useFetcher }")).replace('export const action', 'const action');
 const deps = {
  authenticate: { admin: async () => ({ admin: {}, billing: {}, session: { shop: 'test.myshopify.com', accessToken: 'test' } }) },
  getMissingProductScopes: () => [], readUploadedImage,
  json: (body, options = {}) => ({ body, status: options.status || 200 }),
  CUSTOM_REMOVAL_MAX_LENGTH: 500,
  getCurrentPlan: async () => { calls.push('verify-plan'); return 'Starter'; },
  reserveGeneration: async (_shop, plan, metadata) => { calls.push('reserve'); assert.equal(plan, 'Starter'); assert.equal(metadata.sourceImageUrl, null); return { reservationId: 'reservation' }; },
  generateCleanProductImage: async args => { calls.push('generate'); assert.match(args.imageUrl, /^data:image\/png;base64,/); if (fail) throw new Error('AI unavailable'); return { outputUrl: 'https://example.com/result.jpg', jobId: 'job' }; },
  completeReservation: async () => calls.push('complete'),
  refundReservation: async () => calls.push('refund'),
  getUsageStatus: async () => ({ used: 1, limit: 100 }),
  console: { error() {} },
 };
 return new Function(...Object.keys(deps), code + '; return action;')(...Object.values(deps));
}
function uploadRequest(image = file()) {
 const form = new FormData(); form.set('intent', 'generate'); form.set('imageSource', 'upload'); form.set('imageFile', image);
 return new Request('https://app.example.com/app', { method: 'POST', body: form });
}
test('local upload without product still verifies subscription and reserves quota', async () => {
 const calls=[];const result=await actionWith(calls)({request:uploadRequest()});
 assert.equal(result.status,200);assert.equal(result.body.productId,'');assert.equal(result.body.sourceImageUrl,null);
 assert.deepEqual(calls,['verify-plan','reserve','generate','complete']);
});
test('invalid file consumes no quota; failed generation refunds reservation', async () => {
 const calls=[];const invalid=await actionWith(calls)({request:uploadRequest(new File(['bad'],'bad.png',{type:'image/png'}))});
 assert.equal(invalid.status,400);assert.deepEqual(calls,[]);
 const failed=await actionWith(calls,true)({request:uploadRequest()});
 assert.equal(failed.status,500);assert.deepEqual(calls,['verify-plan','reserve','generate','refund']);
});

