import { authenticateLifecycleWebhook } from "../services/webhook-auth.server";
import { sessionStorage } from "../shopify.server";

const CUSTOMER_DATA_REQUEST = "CUSTOMERS_DATA_REQUEST";
const CUSTOMERS_REDACT = "CUSTOMERS_REDACT";
const SHOP_REDACT = "SHOP_REDACT";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticateLifecycleWebhook(request);

  console.log(`Received ${topic} compliance webhook for ${shop}`);

  if (topic === SHOP_REDACT && shop) {
    await sessionStorage.deleteSession(`offline_${shop}`);
  }

  if (topic === CUSTOMER_DATA_REQUEST || topic === CUSTOMERS_REDACT) {
    console.log(`No customer personal data is stored for ${shop}: ${payload?.customer?.id || "unknown customer"}`);
  }

  return new Response();
};
