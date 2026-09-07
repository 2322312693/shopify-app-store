const AI_API_BASE_URL = process.env.AI_API_BASE_URL || "https://ai.zestgpt.com";
const MODEL = "bytedance/seedream-4.5";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

function outputUrl(output) {
  if (!output) return "";
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return outputUrl(output[0]);
  return output.url || output.image || output.output || "";
}

async function postJson(path, body, timeoutMs = 15000) {
  const response = await fetch(`${AI_API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Channel: "shopify" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Logo generation service is unavailable (${response.status}). Please try again.`);
  }
  return response.json();
}

export function buildLogoPrompt({ brandName, brief, hasReference }) {
  const name = clean(brandName, 80);
  const direction = clean(brief, 400);
  return [
    "Create one original, professional brand logo.",
    `Brand name: ${name || "Untitled brand"}.`,
    `Creative brief: ${direction || "modern, memorable, clean and versatile"}.`,
    hasReference
      ? "Use the reference only as visual inspiration. Redesign it substantially and do not copy protected marks."
      : "Create an original identity from the written brief.",
    "Center one logo on a plain white or transparent-looking background.",
    "Use a clear symbol, readable wordmark, strong silhouette, balanced spacing, limited colors and crisp edges.",
    "No mockup, device, poster, watermark, extra logos or placeholder text.",
  ].join(" ");
}

export function validateReferenceImageUrl(value) {
  if (!value) return "";
  const url = new URL(String(value));
  if (url.protocol !== "https:" || url.hostname !== "store.zestgpt.com" || !url.pathname.startsWith("/shopify/ai-logo-creator/")) {
    throw new Error("Invalid reference image URL.");
  }
  return url.href;
}

export async function generateLogo({ brandName, brief, referenceImageUrl: referenceUrl, shop }) {
  const referenceImageUrl = validateReferenceImageUrl(referenceUrl);

  const input = {
    prompt: buildLogoPrompt({ brandName, brief, hasReference: Boolean(referenceImageUrl) }),
    aspect_ratio: "1:1",
    size: "2K",
  };
  if (referenceImageUrl) input.image_input = [referenceImageUrl];

  const created = await postJson("/replicate/create", {
    model: MODEL,
    input,
    user_id: `shopify_${shop || "unknown"}`,
  });
  const jobId = created.jobId || created.id;
  if (!jobId) throw new Error("Logo generation did not return a job id.");

  const deadline = Date.now() + 180000;
  for (let attempt = 0; attempt < 60 && Date.now() < deadline; attempt += 1) {
    await sleep(3000);
    const prediction = await postJson("/replicate/get", { id: jobId });
    if (prediction.status === "succeeded") {
      const url = outputUrl(prediction.output);
      if (!url) throw new Error("Logo generation returned no image.");
      return { jobId, outputUrl: url, referenceImageUrl };
    }
    if (prediction.status === "failed" || prediction.status === "canceled") {
      throw new Error(`Logo generation ${prediction.status}. Please try again.`);
    }
  }
  throw new Error("Logo generation timed out. Please try again.");
}
