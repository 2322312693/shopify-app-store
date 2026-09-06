import { uploadSourceToR2 } from './r2-upload.server.js';

const AI_API_BASE_URL = process.env.AI_API_BASE_URL || "https://ai.zestgpt.com";

export const CLEANUP_MODES = { background: { label: "Remove background" } };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOutputUrl(output) {
  if (!output) return "";
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return getOutputUrl(output[0]);
  return output.url || output.image || output.output || "";
}

async function postJson(url, body, timeoutMs = 15000) {
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "Content-Type": "application/json",
      Channel: "shopify",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(response.status === 413
      ? 'The image request is too large. Please try a smaller image.'
      : `AI processing service is unavailable (${response.status}). Please try again.`);
  }

  return response.json();
}

export async function generateCleanProductImage({ imageUrl, cleanupMode, shop, customRemovalTarget, originalText, replacementText, editInstructions }) {
  if (!imageUrl) throw new Error("Missing source image URL");

  if (imageUrl.startsWith('data:')) imageUrl = await uploadSourceToR2(imageUrl);

  const input = { image: imageUrl, format: "png", reverse: false, background_type: "rgba" };

  const createResult = await postJson(`${AI_API_BASE_URL}/replicate/create`, {
    version: "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc",
    input,
    user_id: `shopify_${shop || "unknown"}`,
  });

  const jobId = createResult.jobId || createResult.id;
  if (!jobId) {
    throw new Error("AI proxy did not return a job id");
  }

  const deadline = Date.now() + 180000;
  for (let attempt = 0; attempt < 60 && Date.now() < deadline; attempt += 1) {
    await sleep(3000);

    const prediction = await postJson(`${AI_API_BASE_URL}/replicate/get`, {
      id: jobId,
    }, Math.max(1, Math.min(15000, deadline - Date.now())));

    if (prediction.status === "succeeded") {
      const outputUrl = getOutputUrl(prediction.output);
      if (!outputUrl) throw new Error("AI job succeeded but returned no image URL");
      return { jobId, outputUrl, cleanupMode };
    }

    if (prediction.status === "failed" || prediction.status === "canceled") {
      throw new Error(`AI job ${prediction.status}`);
    }
  }

  throw new Error("AI job timed out");
}
