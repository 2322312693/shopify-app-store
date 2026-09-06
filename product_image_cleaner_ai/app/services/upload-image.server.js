import { MAX_UPLOAD_BYTES, UPLOAD_TYPES } from './upload-policy.js';

export async function readUploadedImage(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size) {
    throw new Error('Choose an image from your computer first.');
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Upload an image no larger than 3 MB.');
  if (!UPLOAD_TYPES.includes(file.type)) throw new Error('Only JPG, PNG, and WebP images are supported.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const png = bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length > 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  const detected = png ? 'image/png' : jpeg ? 'image/jpeg' : webp ? 'image/webp' : null;
  if (detected !== file.type) throw new Error('This file does not match a supported image format.');
  return `data:${detected};base64,${bytes.toString('base64')}`;
}
