import "@shopify/shopify-app-remix/adapters/node";

import {
  AppDistribution,
  ApiVersion,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { SQLiteSessionStorage } from "@shopify/shopify-app-session-storage-sqlite";
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

const sessionDbPath = process.env.SHOPIFY_SESSION_DB_PATH || ".data/shopify_sessions.sqlite";
const sessionDbDir = path.dirname(sessionDbPath);
if (sessionDbDir && sessionDbDir !== ".") {
  fs.mkdirSync(sessionDbDir, { recursive: true });
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: appScopes(),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new SQLiteSessionStorage(sessionDbPath),
  distribution: AppDistribution.AppStore,
  billing: {
    [STARTER_PLAN]: {
      lineItems: [
        {
          amount: 9.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [PRO_PLAN]: {
      lineItems: [
        {
          amount: 29.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [BUSINESS_PLAN]: {
      lineItems: [
        {
          amount: 79.99,
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
