import { syncMerchantProfileSafely } from "../services/merchant-profile.server";
import { queryAdminWithRecovery } from "../services/admin-query.server";
import { planFromSubscription } from "../services/subscription-policy";
import { authenticate, unauthenticated } from "../shopify.server";
import { syncSubscriptionToBackend } from "../services/usage.server";

function getSubscriptionPayload(payload) {
  return payload?.app_subscription || payload?.appSubscription || payload || {};
}

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  let subscription = getSubscriptionPayload(payload);
  // Webhooks can arrive out of order during plan changes. Reconcile the current
  // installation instead of applying an old cancellation to a new subscription.
  const { admin, session } = await unauthenticated.admin(shop);
  const result = await queryAdminWithRecovery({ admin, session, query: `#graphql
    query CurrentSubscriptionForWebhook {
      currentAppInstallation {
        activeSubscriptions { id name status test currentPeriodEnd }
      }
    }
  ` });
  if (result.errors) throw new Error('Unable to reconcile Shopify subscription');
  const current = result.data?.currentAppInstallation;
  if (!current) throw new Error('Shopify installation missing in subscription query');
  const active = current.activeSubscriptions.find((item) =>
    item.status === 'ACTIVE' && planFromSubscription(item));
  subscription = active || { ...subscription, status: String(subscription.status).toLowerCase() === 'active' ? 'none' : subscription.status };

  const status = String(subscription.status || "none").toLowerCase();
  const planName = status === "active" ? (planFromSubscription(subscription) || "Free") : "Free";

  console.log(`Received ${topic} webhook for ${shop}: ${planName} (${status})`);

  await syncSubscriptionToBackend(shop, planName, {
    status,
    id: subscription.admin_graphql_api_id || subscription.id,
    test: subscription.test === true,
    currentPeriodEnd: subscription.current_period_end || subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end || subscription.cancelAtPeriodEnd,
  });

  await syncMerchantProfileSafely({ admin, session, planName });
  return new Response();
};
