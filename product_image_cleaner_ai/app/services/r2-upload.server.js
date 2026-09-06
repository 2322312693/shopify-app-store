import { randomUUID } from 'node:crypto';

// Same presigned PUT flow as the Canva apps: image bytes go to R2,
// while the Node AI proxy only receives a small public image URL.
export async function uploadSourceToR2(dataUrl, fetchImpl = fetch) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid upload image.');
  const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
  const objectName = `shopify/product-image-cleaner/${randomUUID()}.${extension}`;
  const response = await fetchImpl(`${process.env.AI_API_BASE_URL || 'https://ai.zestgpt.com'}/upload/get-presigned-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Channel: 'node-nauth' },
    body: JSON.stringify({ bucketName: 'video', objectName }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Image upload could not start. Please try again.');
  const signed = await response.json();
  if (!signed.success || !signed.url) throw new Error('Image upload could not start. Please try again.');
  const target = new URL(signed.url);
  if (target.protocol !== 'https:' || !target.hostname.endsWith('.r2.cloudflarestorage.com')) {
    throw new Error('Image upload service returned an invalid destination.');
  }
  const uploaded = await fetchImpl(target.href, {
    method: 'PUT',
    headers: { 'Content-Type': match[1] },
    body: Buffer.from(match[2], 'base64'),
    signal: AbortSignal.timeout(60000),
  });
  if (!uploaded.ok) throw new Error('Image upload failed. Please try again.');
  return `https://store.zestgpt.com/${objectName}`;
}
