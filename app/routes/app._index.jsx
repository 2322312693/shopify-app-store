import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  ChoiceList,
  EmptyState,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
} from "@shopify/polaris";
import { useMemo, useState } from "react";
import { MONTHLY_PLAN, authenticate } from "../shopify.server";
import { CLEANUP_MODES, generateCleanProductImage } from "../services/ai-cleaner.server";
import { addImageToProduct, getRecentProductsWithImages } from "../services/shopify-products.server";

const isBillingTest = process.env.SHOPIFY_BILLING_TEST !== "false";

export const loader = async ({ request }) => {
  const { admin, billing } = await authenticate.admin(request);

  await billing.require({
    plans: [MONTHLY_PLAN],
    isTest: isBillingTest,
    onFailure: async () =>
      billing.request({
        plan: MONTHLY_PLAN,
        isTest: isBillingTest,
      }),
  });

  const products = await getRecentProductsWithImages(admin);

  return json({
    products,
    cleanupModes: Object.entries(CLEANUP_MODES).map(([value, mode]) => ({
      label: mode.label,
      value,
    })),
  });
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (intent === "generate") {
      const productId = String(formData.get("productId") || "");
      const sourceImageUrl = String(formData.get("sourceImageUrl") || "");
      const cleanupMode = String(formData.get("cleanupMode") || "supplier");

      if (!productId || !sourceImageUrl) {
        return json({ ok: false, error: "Select a product image first." }, { status: 400 });
      }

      const result = await generateCleanProductImage({
        imageUrl: sourceImageUrl,
        cleanupMode,
        shop: session.shop,
      });

      return json({
        ok: true,
        intent,
        productId,
        sourceImageUrl,
        cleanupMode,
        outputUrl: result.outputUrl,
        jobId: result.jobId,
      });
    }

    if (intent === "add") {
      const productId = String(formData.get("productId") || "");
      const outputUrl = String(formData.get("outputUrl") || "");

      if (!productId || !outputUrl) {
        return json({ ok: false, error: "Missing generated image." }, { status: 400 });
      }

      const media = await addImageToProduct(admin, {
        productId,
        imageUrl: outputUrl,
        alt: "AI cleaned product image",
      });

      return json({ ok: true, intent, media });
    }

    return json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error.message || "Request failed." }, { status: 500 });
  }
};

export default function Index() {
  const { products, cleanupModes } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id || "");
  const [selectedImageUrl, setSelectedImageUrl] = useState(products[0]?.images?.[0]?.url || "");
  const [cleanupMode, setCleanupMode] = useState(["supplier"]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId),
    [products, selectedProductId],
  );

  const selectedImage = useMemo(
    () => selectedProduct?.images?.find((image) => image.url === selectedImageUrl),
    [selectedProduct, selectedImageUrl],
  );

  const isSubmitting = navigation.state === "submitting";
  const isGenerating =
    isSubmitting && navigation.formData?.get("intent") === "generate";
  const isAdding = isSubmitting && navigation.formData?.get("intent") === "add";
  const generated = actionData?.ok && actionData.intent === "generate" ? actionData : null;

  const productOptions = products.map((product) => ({
    label: `${product.title} (${product.images.length} images)`,
    value: product.id,
    disabled: product.images.length === 0,
  }));

  function handleProductChange(productId) {
    const product = products.find((item) => item.id === productId);
    setSelectedProductId(productId);
    setSelectedImageUrl(product?.images?.[0]?.url || "");
  }

  return (
    <Page
      title="Product Image Cleaner AI"
      subtitle="Clean authorized product images and add the result back to Shopify."
      primaryAction={{
        content: "Open Shopify product",
        disabled: !selectedProduct?.handle,
        url: selectedProduct?.handle ? `shopify://admin/products/${selectedProduct.id.split("/").pop()}` : undefined,
      }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Banner tone="info">
              Use this tool only for product images you own or are authorized to edit. Generated images are added as new product media and original images are not replaced.
            </Banner>

            {actionData?.ok === false ? (
              <Banner tone="critical">{actionData.error}</Banner>
            ) : null}

            {actionData?.ok && actionData.intent === "add" ? (
              <Banner tone="success">Cleaned image added to the product.</Banner>
            ) : null}

            {products.length === 0 ? (
              <Card>
                <EmptyState
                  heading="No products found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Add products with images to this store, then return here to clean them.</p>
                </EmptyState>
              </Card>
            ) : (
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Select product image
                    </Text>
                    <Badge tone="attention">Original kept</Badge>
                  </InlineStack>

                  <Select
                    label="Product"
                    options={productOptions}
                    value={selectedProductId}
                    onChange={handleProductChange}
                  />

                  {selectedProduct?.images?.length ? (
                    <div className="imageGrid">
                      {selectedProduct.images.map((image) => (
                        <button
                          key={image.id}
                          type="button"
                          className={`imageChoice ${selectedImageUrl === image.url ? "imageChoiceSelected" : ""}`}
                          onClick={() => setSelectedImageUrl(image.url)}
                          aria-label="Select product image"
                        >
                          <img src={image.url} alt={image.alt || selectedProduct.title} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                      <Text as="p" tone="subdued">
                        This product has no image media.
                      </Text>
                    </Box>
                  )}

                  <ChoiceList
                    title="Cleanup mode"
                    choices={cleanupModes}
                    selected={cleanupMode}
                    onChange={setCleanupMode}
                  />

                  <Form method="post">
                    <input type="hidden" name="intent" value="generate" />
                    <input type="hidden" name="productId" value={selectedProductId} />
                    <input type="hidden" name="sourceImageUrl" value={selectedImageUrl} />
                    <input type="hidden" name="cleanupMode" value={cleanupMode[0]} />
                    <Button
                      submit
                      variant="primary"
                      loading={isGenerating}
                      disabled={!selectedImage || isSubmitting}
                    >
                      Generate cleaned image
                    </Button>
                  </Form>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Result
              </Text>

              {generated ? (
                <BlockStack gap="300">
                  <div className="beforeAfter">
                    <BlockStack gap="200">
                      <Text as="p" tone="subdued">
                        Before
                      </Text>
                      <img
                        className="previewImage"
                        src={generated.sourceImageUrl}
                        alt="Original product"
                      />
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" tone="subdued">
                        After
                      </Text>
                      <img
                        className="previewImage"
                        src={generated.outputUrl}
                        alt="AI cleaned product"
                      />
                    </BlockStack>
                  </div>

                  <Form method="post">
                    <input type="hidden" name="intent" value="add" />
                    <input type="hidden" name="productId" value={generated.productId} />
                    <input type="hidden" name="outputUrl" value={generated.outputUrl} />
                    <Button submit variant="primary" loading={isAdding} disabled={isSubmitting}>
                      Add to product
                    </Button>
                  </Form>
                </BlockStack>
              ) : (
                <Text as="p" tone="subdued">
                  Generate a cleaned image to preview it here before adding it to the product.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
