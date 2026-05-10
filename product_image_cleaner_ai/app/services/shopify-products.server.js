const PRODUCTS_QUERY = `#graphql
  query ProductImages($first: Int!) {
    products(first: $first, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        status
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
    shop {
      name
    }
    products(first: 10, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        status
        mediaCount {
          count
        }
        media(first: 3) {
          nodes {
            id
            mediaContentType
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
  const response = await admin.graphql(PRODUCTS_QUERY, {
    variables: { first },
  });
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
    status: product.status,
    totalVariants: product.totalVariants,
    mediaCount: product.mediaCount?.count ?? null,
    media: (product.media?.nodes || []).map((media) => ({
      id: media.id,
      type: media.mediaContentType,
      imageUrl: media.image?.url || media.preview?.image?.url || null,
    })),
  }));
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
      shopName: json.data?.shop?.name || null,
      products: compactDiagnosticProducts(json.data?.products?.nodes),
    };
  } catch (error) {
    return {
      ok: false,
      errors: [{ message: error.message }],
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
