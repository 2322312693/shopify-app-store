function referenceExtension(file) {
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/webp") return "webp";
  return "png";
}

export async function uploadReferenceToR2(file, fetchImpl = fetch, objectId = crypto.randomUUID()) {
  const objectName = `shopify/ai-logo-creator/${objectId}.${referenceExtension(file)}`;
  const signedResponse = await fetchImpl("https://ai.zestgpt.com/upload/get-presigned-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", Channel: "node-nauth" },
    body: JSON.stringify({ bucketName: "store", objectName }),
    signal: AbortSignal.timeout(15000),
  });
  if (!signedResponse.ok) throw new Error("Reference upload could not start. Please try again.");
  const signed = await signedResponse.json();
  let target;
  try {
    target = new URL(signed.url || "");
  } catch {
    throw new Error("Reference upload returned an invalid destination.");
  }
  if (!signed.success || target.protocol !== "https:" || !target.hostname.endsWith(".r2.cloudflarestorage.com")) {
    throw new Error("Reference upload returned an invalid destination.");
  }
  const uploaded = await fetchImpl(target.href, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
    signal: AbortSignal.timeout(60000),
  });
  if (!uploaded.ok) throw new Error("Reference upload failed. Please try again.");
  return `https://store.zestgpt.com/${objectName}`;
}
