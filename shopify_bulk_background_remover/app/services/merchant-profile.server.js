import { queryAdminWithRecovery } from "./admin-query.server";
import { syncMerchantProfileToBackend } from "./usage.server";

export async function syncMerchantProfileSafely({ admin, session, planName }) {
  try {
    const result = await queryAdminWithRecovery({ admin, session, query: `#graphql
      query MerchantContact { shop { name email } }
    ` });
    const shop = result.data?.shop;
    if (result.errors || !shop?.email) return false;
    await syncMerchantProfileToBackend(session.shop, planName, {
      email: shop.email, name: shop.name,
    });
    return true;
  } catch {
    // Contact enrichment must never block billing, quotas, or image generation.
    console.warn("Shopify merchant contact sync deferred.");
    return false;
  }
}
