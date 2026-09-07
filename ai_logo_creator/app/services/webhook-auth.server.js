import { appEnv } from "./app-env.server.js";
import { createHmac, timingSafeEqual } from "node:crypto";

// Uninstall and privacy events must still authenticate after a shop's API
// access token has been revoked; they do not need an Admin API session.
export async function authenticateLifecycleWebhook(request) {
  if (request.method !== "POST") throw new Response(null, { status: 405 });
  const secret = appEnv("SHOPIFY_API_SECRET");
  if (!secret) throw new Response(null, { status: 500 });
  const body = await request.text();
  const supplied = Buffer.from(request.headers.get("x-shopify-hmac-sha256") || "", "base64");
  const expected = createHmac("sha256", secret).update(body).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Response(null, { status: 401 });
  }
  const shop = request.headers.get("x-shopify-shop-domain") || "";
  const topic = (request.headers.get("x-shopify-topic") || "").toUpperCase().replaceAll("/", "_");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !topic) {
    throw new Response(null, { status: 400 });
  }
  return { shop, topic, payload: JSON.parse(body) };
}
