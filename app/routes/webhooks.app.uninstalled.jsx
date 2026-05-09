import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (session) {
    // Memory session storage is development-only. A production database session
    // storage adapter should delete sessions here.
  }

  return new Response();
};
