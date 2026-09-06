import { migrateOfflineSessionToExpiring } from "./shopify-products.server";

function authorizationFailure(error) {
  const status = error?.status || error?.response?.status || error?.response?.code || error?.networkStatusCode || error?.data?.errors?.networkStatusCode;
  return Number(status) === 401 || Number(status) === 403;
}

// The SDK can reject legacy sessions before the product loader gets a chance
// to recover them. Keep subscription verification on the same recovery path.
export async function queryAdminWithRecovery({ admin, session, query }) {
  try {
    const response = await admin.graphql(query);
    return await response.json();
  } catch (error) {
    if (!authorizationFailure(error) || !session?.accessToken) throw error;
  }
  const request = async () => {
    const response = await fetch(`https://${session.shop}/admin/api/2025-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": session.accessToken },
      body: JSON.stringify({ query }),
    });
    if (!response.ok) {
      const error = new Error(`Shopify subscription query failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };
  try {
    return await request();
  } catch (error) {
    if (!authorizationFailure(error)) throw error;
    await migrateOfflineSessionToExpiring({ session });
    return request();
  }
}
