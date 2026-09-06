import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [key, name, handle, domain, clientId] = process.argv.slice(2);
if (!/^[a-z][a-z0-9_]+$/.test(key || "") || !name || !/^[a-z0-9-]+$/.test(handle || "") || !/^[a-z0-9.-]+$/.test(domain || "") || !/^[a-z0-9]+$/i.test(clientId || "")) {
  throw new Error('Usage: node scripts/create-shopify-app.mjs app_key "App Name" app-handle app.example.com SHOPIFY_CLIENT_ID');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "product_image_cleaner_ai");
const target = path.join(root, key);
if (fs.existsSync(target)) throw new Error("Target already exists; refusing to overwrite it");
fs.mkdirSync(target);
// Explicit allowlist: never copy .env, sessions, tokens, .shopify or .vercel.
for (const entry of ["app", "public", "tests", "package.json", "package-lock.json", "vite.config.js", "tsconfig.json", "vercel.json", ".gitignore", ".env.example", "shopify.web.toml", "DEPLOYMENT.md"]) {
  const from = path.join(source, entry);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(target, entry), { recursive: true });
}
fs.writeFileSync(path.join(target, "app/app-config.js"), `export const APP_CONFIG = ${JSON.stringify({ key, name, handle }, null, 2)};\n`);
const pkg = JSON.parse(fs.readFileSync(path.join(target, "package.json")));
pkg.name = handle;
fs.writeFileSync(path.join(target, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
const lock = JSON.parse(fs.readFileSync(path.join(target, "package-lock.json")));
lock.name = handle; if (lock.packages?.[""]) lock.packages[""].name = handle;
fs.writeFileSync(path.join(target, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
const toml = fs.readFileSync(path.join(source, "shopify.app.toml"), "utf8")
  .replace(/^client_id = .*$/m, `client_id = ${JSON.stringify(clientId)}`)
  .replace(/^name = .*$/m, `name = ${JSON.stringify(name)}`)
  .replaceAll("imagecleaner.zestgpt.com", domain);
fs.writeFileSync(path.join(target, "shopify.app.toml"), toml);
const env = fs.readFileSync(path.join(target, ".env.example"), "utf8").replace("SHOPIFY_API_KEY=", `SHOPIFY_API_KEY=${clientId}`).replace("YOUR_APP_DOMAIN", domain);
fs.writeFileSync(path.join(target, ".env.example"), env);
console.log(`Created ${target}. Configure node_server APP_CONFIGS[${JSON.stringify(key)}], app credentials, plans and product-specific UI/prompts before deployment.`);
