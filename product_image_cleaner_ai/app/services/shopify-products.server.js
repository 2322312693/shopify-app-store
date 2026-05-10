const PRODUCTS_QUERY = `#graphql
  query ProductImages($first: Int!, $query: String) {
    products(first: $first, query: $query, sortKey: UPDATED_AT, reverse: true) {
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
      productImagesCount {
        count
      }
    }
    active: products(first: 5, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        status
        totalVariants
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
    draft: products(first: 5, query: "status:draft", sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        status
        totalVariants
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
    archived: products(first: 5, query: "status:archived", sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        status
        totalVariants
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
    variables: { first, query: "status:active,draft,archived" },
  });
  const json = await response.json();

  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
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
      errors: json.errors || null,
      shopName: json.data?.shop?.name || null,
      productImagesCount: json.data?.shop?.productImagesCount?.count ?? null,
      active: compactDiagnosticProducts(json.data?.active?.nodes),
      draft: compactDiagnosticProducts(json.data?.draft?.nodes),
      archived: compactDiagnosticProducts(json.data?.archived?.nodes),
    };
  } catch (error) {
    return {
      ok: false,
      errors: [{ message: error.message }],
      shopName: null,
      productImagesCount: null,
      active: [],
      draft: [],
      archived: [],
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
