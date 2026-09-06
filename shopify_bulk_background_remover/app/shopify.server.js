import "@shopify/shopify-app-remix/adapters/node";

import {
  AppDistribution,
  ApiVersion,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { RemoteSessionStorage } from "./services/remote-session-storage.server";
import { APP_CONFIG } from "./app-config";
import fs from "node:fs";
import path from "node:path";

export const STARTER_PLAN = "Starter";
export const PRO_PLAN = "Pro";
export const BUSINESS_PLAN = "Business";
export const BILLING_PLANS = [STARTER_PLAN, PRO_PLAN, BUSINESS_PLAN];
const REQUIRED_SCOPES = ["read_products", "write_products"];

function appScopes() {
  const envScopes = (process.env.SCOPES || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  return [...new Set([...envScopes, ...REQUIRED_SCOPES])];
}

const useRemoteSessions = process.env.SHOPIFY_SESSION_STORAGE === "remote" || process.env.VERCEL === "1";
let storage;
if (useRemoteSessions) {
  storage = new RemoteSessionStorage({
    baseUrl: process.env.SHOPIFY_USAGE_API_BASE_URL || process.env.AI_API_BASE_URL || "https://ai.zestgpt.com",
    appKey: APP_CONFIG.key,
    secret: process.env.SHOPIFY_INTERNAL_API_KEY,
    encryptionSecret: process.env.SHOPIFY_API_SECRET,
  });
} else {
  const sessionDbPath = process.env.SHOPIFY_SESSION_DB_PATH || ".data/shopify_sessions.sqlite";
  fs.mkdirSync(path.dirname(sessionDbPath), { recursive: true });
  const { SQLiteSessionStorage } = await import("@shopify/shopify-app-session-storage-sqlite");
  storage = new SQLiteSessionStorage(sessionDbPath);
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: appScopes(),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: storage,
  distribution: AppDistribution.AppStore,
  billing: {
    [STARTER_PLAN]: {
      lineItems: [
        {
          amount: 6.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [PRO_PLAN]: {
      lineItems: [
        {
          amount: 12.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [BUSINESS_PLAN]: {
      lineItems: [
        {
          amount: 19.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session }) => {
      try {
        await shopify.registerWebhooks({ session });
      } catch (error) {
        console.warn("Runtime webhook registration failed; using deployed app config webhooks.", error);
      }
    },
  },
});

export default shopify;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
