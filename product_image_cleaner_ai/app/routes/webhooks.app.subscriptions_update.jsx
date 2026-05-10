import { authenticate } from "../shopify.server";
import { PLAN_LIMITS, syncSubscriptionToBackend } from "../services/usage.server";

function normalizePlanName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.keys(PLAN_LIMITS).find((planName) => planName.toLowerCase() === normalized) || "Free";
}

function getSubscriptionPayload(payload) {
  return payload?.app_subscription || payload?.appSubscription || payload || {};
}

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const subscription = getSubscriptionPayload(payload);
  const status = String(subscription.status || "none").toLowerCase();
  const planName = status === "active" ? normalizePlanName(subscription.name) : "Free";

  console.log(`Received ${topic} webhook for ${shop}: ${planName} (${status})`);

  await syncSubscriptionToBackend(shop, planName, {
    status,
    currentPeriodEnd: subscription.current_period_end || subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end || subscription.cancelAtPeriodEnd,
  });

  return new Response();
};
