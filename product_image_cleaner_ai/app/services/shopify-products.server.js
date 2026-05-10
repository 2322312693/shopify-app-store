const PRODUCTS_QUERY = `#graphql
  query ProductImages($first: Int!) {
    products(first: $first, sortKey: UPDATED_AT, reverse: true) {
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
  const response = await admin.graphql(PRODUCTS_QUERY, {
    variables: { first },
  });
  const json = await response.json();

  if (json.errors) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }

  return (json.data?.products?.nodes || []).map((product) => ({
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
