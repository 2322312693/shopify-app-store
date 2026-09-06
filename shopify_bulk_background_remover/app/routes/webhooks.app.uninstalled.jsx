import { authenticateLifecycleWebhook } from "../services/webhook-auth.server";
import { sessionStorage } from "../shopify.server";

import { syncSubscriptionToBackend } from "../services/usage.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticateLifecycleWebhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Persist revocation before acknowledging delivery or removing sessions.
  await syncSubscriptionToBackend(shop, "Free", { status: "cancelled" });

  if (session) {
    await sessionStorage.deleteSession(session.id);
  }

  if (shop) {
    await sessionStorage.deleteSession(`offline_${shop}`);
  }

  return new Response();
};
