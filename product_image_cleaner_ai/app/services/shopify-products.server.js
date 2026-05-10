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

const SHOP_DIAGNOSTICS_QUERY = `#graphql
  query ShopProductDiagnostics {
    currentAppInstallation {
      accessScopes {
        handle
      }
    }
    shop {
      name
    }
    products(first: 10) {
      nodes {
        id
        title
        handle
        media(first: 3) {
          nodes {
            id
            preview {
              image {
                url
              }
            }
            ... on MediaImage {
              image {
                url
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

export async function getRecentProductsWithImagesFromRest({ shop, accessToken, first = 20 }) {
  if (!shop || !accessToken) {
    throw new Error("Missing shop or access token for REST product fallback.");
  }

  const url = new URL(`https://${shop}/admin/api/2025-10/products.json`);
  url.searchParams.set("limit", String(first));
  url.searchParams.set("fields", "id,title,handle,images");

  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Accept": "application/json",
    },
  });
  const data = await response.json().catch(async () => ({
    raw: await response.text().catch(() => null),
  }));

  if (!response.ok) {
    throw new Error(JSON.stringify({
      type: "REST_PRODUCTS_ERROR",
      status: response.status,
      statusText: response.statusText,
      body: data,
    }));
  }

  const products = (data.products || []).map((product) => ({
    id: `gid://shopify/Product/${product.id}`,
    title: product.title,
    handle: product.handle,
    images: (product.images || [])
      .filter((image) => image?.src)
      .map((image) => ({
        id: `gid://shopify/ProductImage/${image.id}`,
        alt: image.alt || "",
        url: image.src,
        width: image.width,
        height: image.height,
      })),
  }));

  console.info(
    `Loaded ${products.length} products and ${products.reduce((total, product) => total + product.images.length, 0)} product images from Shopify REST fallback.`,
  );

  return products;
}

export async function migrateOfflineSessionToExpiring({ session, sessionStorage }) {
  if (!session?.shop || !session?.accessToken) {
    throw new Error("Missing offline session for token migration.");
  }

  const body = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY || "",
    client_secret: process.env.SHOPIFY_API_SECRET || "",
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

function compactDiagnosticProducts(products = []) {
  return products.map((product) => ({
    id: product.id,
    title: product.title,
    handle: product.handle,
    media: (product.media?.nodes || []).map((media) => ({
      id: media.id,
      imageUrl: media.image?.url || media.preview?.image?.url || null,
    })),
  }));
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

export async function getShopProductDiagnostics(admin) {
  try {
    const response = await admin.graphql(SHOP_DIAGNOSTICS_QUERY);
    const json = await response.json();

    return {
      ok: !json.errors,
      errors: json.errors ? json.errors.map((error) => ({
        message: error.message || JSON.stringify(error),
        path: error.path || null,
        extensions: error.extensions || null,
      })) : null,
      appAccessScopes: (json.data?.currentAppInstallation?.accessScopes || []).map((scope) => scope.handle),
      shopName: json.data?.shop?.name || null,
      products: compactDiagnosticProducts(json.data?.products?.nodes),
    };
  } catch (error) {
    return {
      ok: false,
      errors: [await serializeAdminError(error)],
      appAccessScopes: null,
      shopName: null,
      products: [],
    };
  }
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
