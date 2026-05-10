import { authenticate, sessionStorage } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (session) {
    await sessionStorage.deleteSession(session.id);
  }

  if (shop) {
    await sessionStorage.deleteSession(`offline_${shop}`);
  }

  return new Response();
};
