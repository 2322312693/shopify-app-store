import { APP_CONFIG } from "../app-config.js";
export function appEnv(name) {
  const base = import.meta.env?.BASE_URL || "/";
  if (name === "SHOPIFY_APP_URL" && base !== "/") {
    return "https://imagecleaner.zestgpt.com" + base.replace(/\/$/, "");
  }
  const dedicated = process.env[`${APP_CONFIG.key.toUpperCase()}_${name}`];
  if (dedicated) return dedicated;
  if (APP_CONFIG.key === "product_image_cleaner_ai" || base === "/") return process.env[name];
  return undefined;
}
