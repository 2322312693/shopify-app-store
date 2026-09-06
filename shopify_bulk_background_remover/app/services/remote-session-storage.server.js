import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Session } from "@shopify/shopify-api";

export class RemoteSessionStorage {
  constructor({ baseUrl, appKey, secret, encryptionSecret, fetchImpl = fetch }) {
    if (!baseUrl || !appKey || !secret || !encryptionSecret) throw new Error("Remote Shopify session configuration is incomplete");
    this.url = `${baseUrl.replace(/\/$/, "")}/shopify/${encodeURIComponent(appKey)}/sessions`;
    this.secret = secret;
    this.key = createHash("sha256").update(`${appKey}:${encryptionSecret}`).digest();
    this.aad = Buffer.from(appKey);
    this.fetch = fetchImpl;
  }
  seal(session) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.aad);
    const data = Buffer.concat([cipher.update(JSON.stringify(session.toPropertyArray(true)), "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map(value => value.toString("base64")).join(".");
  }
  unseal(sealed) {
    const [iv, tag, data] = sealed.split(".").map(value => Buffer.from(value, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAAD(this.aad); decipher.setAuthTag(tag);
    const values = JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"));
    return Session.fromPropertyArray(values, true);
  }
  async request(body) {
    const response = await this.fetch(this.url, {
      method: "POST", headers: { "Content-Type": "application/json", "x-shopify-app-secret": this.secret },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Shopify session service unavailable (${response.status})`);
    const result = await response.json();
    if (!result.success) throw new Error("Shopify session storage failed");
    return result;
  }
  async storeSession(session) {
    await this.request({ operation: "store", id: session.id, shop: session.shop, sealed: this.seal(session) });
    return true;
  }
  async loadSession(id) {
    const result = await this.request({ operation: "load", id });
    if (!result.sealed) return undefined;
    const session = this.unseal(result.sealed);
    if (session.id !== id) throw new Error("Shopify session identity mismatch");
    return session;
  }
  async deleteSession(id) { return this.deleteSessions([id]); }
  async deleteSessions(ids) { await this.request({ operation: "delete", ids }); return true; }
  async findSessionsByShop(shop) {
    const result = await this.request({ operation: "find", shop });
    const sessions = result.sessions.map(value => this.unseal(value));
    if (sessions.some(session => session.shop !== shop)) throw new Error("Shopify session shop mismatch");
    return sessions;
  }
}
