import { uploadSourceToR2 } from './r2-upload.server.js';

const AI_API_BASE_URL = process.env.AI_API_BASE_URL || "https://ai.zestgpt.com";
const AI_MODEL = process.env.AI_MODEL || "google/nano-banana";

export const CLEANUP_MODES = {
  text: {
    label: "Remove text",
    prompt:
      "Remove all visible text, captions, promotional words, labels, stickers, and corner badges from this authorized product image. Preserve the product shape, color, texture, lighting, shadows, background, camera angle, and image resolution. Fill removed areas naturally so the final image looks like a clean original product photo. Do not add new text, logos, watermarks, objects, or decorative elements.",
  },
  watermark: {
    label: "Remove watermark/logo",
    prompt:
      "Remove old logos, supplier marks, watermarks, and brand stamps from this authorized product image. Preserve the product exactly as shown, including color, materials, edges, perspective, lighting, and background. Reconstruct the cleaned areas naturally. Do not add any new logo, text, watermark, object, pattern, or decoration.",
  },
  objects: {
    label: "Remove unwanted objects",
    prompt:
      "Clean this authorized product image by removing distracting non-product objects, stickers, labels, clutter, and visual artifacts. Keep the main product unchanged and realistic. Preserve the original product details, color, shadows, reflection, background style, and composition. Do not add new text, logos, watermarks, or objects.",
  },
  supplier: {
    label: "Clean supplier image",
    prompt:
      "Turn this supplier product image into a clean ecommerce-ready product photo. Remove text, watermarks, supplier labels, corner badges, arrows, borders, stickers, and promotional graphics. Keep the product accurate and unchanged. Preserve natural lighting, shadows, perspective, and background continuity. Do not add any text, logo, watermark, or new object.",
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOutputUrl(output) {
  if (!output) return "";
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return getOutputUrl(output[0]);
  return output.url || output.image || output.output || "";
}

function buildPrompt(mode, customRemovalTarget) {
  if (!customRemovalTarget || mode !== CLEANUP_MODES.objects) return mode.prompt;

  return [
    `Remove this specific unwanted item from the authorized product image: ${customRemovalTarget}.`,
    "Only remove the requested item. Keep the main product unchanged and realistic.",
    "Preserve the original product details, color, shadows, reflection, background style, and composition.",
    "Fill the removed area naturally. Do not add new text, logos, watermarks, or objects.",
  ].join(" ");
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

export async function generateCleanProductImage({ imageUrl, cleanupMode, shop, customRemovalTarget }) {
  if (!imageUrl) throw new Error("Missing source image URL");

  if (imageUrl.startsWith('data:')) imageUrl = await uploadSourceToR2(imageUrl);

  const mode = CLEANUP_MODES[cleanupMode] || CLEANUP_MODES.supplier;
  const input = {
    prompt: buildPrompt(mode, customRemovalTarget),
    image_input: [imageUrl],
    aspect_ratio: "match_input_image",
    output_format: "jpg",
  };

  const createResult = await postJson(`${AI_API_BASE_URL}/replicate/create`, {
    model: AI_MODEL,
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
