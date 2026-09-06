export const PLAN_LIMITS = {
  Free: { label: "Free", limit: 5, period: "lifetime", price: "$0", interval: "lifetime" },
  Starter: { label: "Starter", limit: 100, period: "month", price: "$9.99", interval: "every 30 days" },
  Pro: { label: "Pro", limit: 500, period: "month", price: "$29.99", interval: "every 30 days" },
  Business: { label: "Business", limit: 2000, period: "month", price: "$79.99", interval: "every 30 days" },
};

const APP_KEY = "product_image_cleaner_ai";

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function usageApiBaseUrls() {
  return unique([
    process.env.SHOPIFY_USAGE_API_BASE_URL,
    process.env.AI_API_BASE_URL,
    "https://ai.zestgpt.com",
  ]).map((value) => value.replace(/\/$/, ""));
}

function headers() {
  const base = { "Content-Type": "application/json" };
  if (process.env.SHOPIFY_INTERNAL_API_KEY) {
    base["x-shopify-app-secret"] = process.env.SHOPIFY_INTERNAL_API_KEY;
  }
  return base;
}

function toQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) query.set(key, String(value));
  });
  return query.toString();
}

async function requestUsage(path, { method = "GET", body, query, timeoutMs } = {}) {
  const errors = [];

  for (const baseUrl of usageApiBaseUrls()) {
    const url = `${baseUrl}/shopify/${APP_KEY}${path}${query ? `?${toQuery(query)}` : ""}`;
    try {
      const response = await fetch(url, {
        method,
        signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
        headers: headers(),
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        const error = new Error(data.message || `Usage API request failed: ${response.status}`);
        error.code = data.error || "USAGE_API_ERROR";
        error.usage = data.usage;
        throw error;
      }

      return data;
    } catch (error) {
      if (error.code === "QUOTA_EXCEEDED" || error.code === "UNAUTHORIZED") {
        throw error;
      }
      errors.push(`${url}: ${error.message}`);
    }
  }

  const error = new Error(`Usage API request failed. Tried: ${errors.join(" | ")}`);
  error.code = "USAGE_API_UNAVAILABLE";
  throw error;
}

export async function getUsageStatus(shop, planName) {
  const data = await requestUsage("/usage", {
    query: { shop, planName },
  });
  return data.usage;
}

export async function reserveGeneration(shop, planName, job) {
  const data = await requestUsage("/reserve", {
    method: "POST",
    body: {
      shop,
      planName,
      productId: job.productId,
      sourceImageUrl: job.sourceImageUrl,
      cleanupMode: job.cleanupMode,
    },
  });
  return { usage: data.usage, reservationId: data.reservationId };
}

export async function completeReservation(shop, reservationId, updates = {}) {
  await requestUsage("/complete", {
    method: "POST",
    body: {
      shop,
      reservationId,
      planName: updates.planName,
      outputUrl: updates.outputUrl,
    },
  });
}

export async function refundReservation(shop, planName, reservationId) {
  const data = await requestUsage("/refund", {
    method: "POST",
    body: { shop, planName, reservationId },
  });
  return data.usage;
}

export async function syncSubscriptionToBackend(shop, planName, subscription = {}) {
  const data = await requestUsage("/subscription", {
    method: "POST",
    body: {
      shop,
      planName,
      subscriptionId: subscription.id,
      test: subscription.test === true,
      status: subscription.status || (planName === "Free" ? "none" : "active"),
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    },
  });
  return data.usage;
}

export async function syncMerchantProfileToBackend(shop, planName, merchant) {
  return requestUsage("/profile", {
    method: "POST", body: { shop, planName, merchant }, timeoutMs: 5000,
  });
}
