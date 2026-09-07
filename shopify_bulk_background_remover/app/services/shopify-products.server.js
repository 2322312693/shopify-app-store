import { appEnv } from "./app-env.server";
import { sessionStorage } from "../shopify.server";

const PRODUCTS_QUERY = `#graphql
  query ProductImages($first: Int!) {
    products(first: $first) {
      nodes {
        id
        title
        handle
        media(first: 12) {
          nodes {
            ... on MediaImage {
              id
              alt
              image {
                url
                altText
                width
                height
              }
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_CREATE_MEDIA_MUTATION = `#graphql
  mutation AddCleanedImage($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        id
        status
        alt
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

export async function getRecentProductsWithImages(admin, first = 20) {
  let response;
  try {
    response = await admin.graphql(PRODUCTS_QUERY, {
      variables: { first },
    });
  } catch (error) {
    throw new Error(JSON.stringify(await serializeAdminError(error)));
  }

  const json = await response.json();

  if (json.errors) {
    throw new Error(formatGraphQLErrors(json.errors));
  }

  const products = (json.data?.products?.nodes || []).map((product) => ({
    ...product,
    images: (product.media?.nodes || [])
      .filter((media) => media?.image?.url)
      .map((media) => ({
        id: media.id,
        alt: media.alt || media.image.altText || "",
        url: media.image.url,
        width: media.image.width,
        height: media.image.height,
      })),
  }));

  console.info(
    `Loaded ${products.length} products and ${products.reduce((total, product) => total + product.images.length, 0)} product images from Shopify.`,
  );

  return products;
}

export async function getRecentProductsWithImagesWithToken({ shop, accessToken, first = 20 }) {
  if (!shop || !accessToken) {
    throw new Error("Missing shop or access token for GraphQL product fallback.");
  }

  const response = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: PRODUCTS_QUERY,
      variables: { first },
    }),
  });
  const data = await response.json().catch(async () => ({
    raw: await response.text().catch(() => null),
  }));

  if (!response.ok) {
    throw new Error(JSON.stringify({
      type: "GRAPHQL_PRODUCTS_ERROR",
      status: response.status,
      statusText: response.statusText,
      body: data,
    }));
  }

  if (data.errors) {
    throw new Error(formatGraphQLErrors(data.errors));
  }

  const products = (data.data?.products?.nodes || []).map((product) => ({
    ...product,
    images: (product.media?.nodes || [])
      .filter((media) => media?.image?.url)
      .map((media) => ({
        id: media.id,
        alt: media.alt || media.image.altText || "",
        url: media.image.url,
        width: media.image.width,
        height: media.image.height,
      })),
  }));

  console.info(
    `Loaded ${products.length} products and ${products.reduce((total, product) => total + product.images.length, 0)} product images from Shopify GraphQL token fallback.`,
  );

  return products;
}

export async function migrateOfflineSessionToExpiring({ session }) {
  if (!session?.shop || !session?.accessToken) {
    throw new Error("Missing offline session for token migration.");
  }

  const body = new URLSearchParams({
    client_id: appEnv("SHOPIFY_API_KEY") || "",
    client_secret: appEnv("SHOPIFY_API_SECRET") || "",
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: session.accessToken,
    subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: "1",
  });

  const response = await fetch(`https://${session.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await response.json().catch(async () => ({
    raw: await response.text().catch(() => null),
  }));

  if (!response.ok) {
    throw new Error(JSON.stringify({
      type: "TOKEN_MIGRATION_ERROR",
      status: response.status,
      statusText: response.statusText,
      body: data,
    }));
  }

  if (!data.access_token || !data.refresh_token) {
    throw new Error("Shopify token migration returned an incomplete token pair.");
  }
  session.refreshToken = data.refresh_token;
  if (data.refresh_token_expires_in) {
    session.refreshTokenExpires = new Date(Date.now() + data.refresh_token_expires_in * 1000);
  }
  session.accessToken = data.access_token;
  session.scope = data.scope || session.scope;
  if (data.expires_in) {
    session.expires = new Date(Date.now() + data.expires_in * 1000);
  }

  await sessionStorage.storeSession(session);

  return {
    accessToken: data.access_token,
    scope: data.scope || session.scope,
    expiresIn: data.expires_in || null,
    refreshTokenReceived: Boolean(data.refresh_token),
  };
}

function formatGraphQLErrors(errors = []) {
  return errors.map((error) => {
    if (typeof error === "string") return error;
    return error.message || JSON.stringify(error);
  }).join("; ");
}

async function serializeResponse(response) {
  const headers = {};
  response.headers?.forEach?.((value, key) => {
    headers[key] = value;
  });

  return {
    type: "Response",
    status: response.status,
    statusText: response.statusText,
    url: response.url || null,
    redirected: response.redirected || false,
    headers,
    body: await response.clone().text().catch(() => null),
  };
}

async function serializeAdminError(error) {
  if (typeof Response !== "undefined" && error instanceof Response) {
    return serializeResponse(error);
  }

  return {
    name: error.name || null,
    message: error.message || String(error),
    code: error.code || null,
    responseCode: error.response?.code || null,
    responseStatusText: error.response?.statusText || null,
    responseBody: error.response?.body || null,
    networkStatusCode: error.networkStatusCode || null,
  };
}

export async function addImageToProduct(admin, { productId, imageUrl, alt }) {
  const response = await admin.graphql(PRODUCT_CREATE_MEDIA_MUTATION, {
    variables: {
      productId,
      media: [
        {
          mediaContentType: "IMAGE",
          originalSource: imageUrl,
          alt: alt || "AI cleaned product image",
        },
      ],
    },
  });
  const json = await response.json();

  const userErrors = json.data?.productCreateMedia?.mediaUserErrors || [];
  if (json.errors || userErrors.length) {
    const errors = [
      ...(json.errors || []).map((error) => error.message),
      ...userErrors.map((error) => error.message),
    ];
    throw new Error(errors.join("; "));
  }

  return json.data.productCreateMedia.media?.[0] || null;
}
