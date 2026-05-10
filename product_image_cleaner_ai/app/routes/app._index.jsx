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
import { BILLING_PLANS, STARTER_PLAN, authenticate } from "../shopify.server";
import { CLEANUP_MODES, generateCleanProductImage } from "../services/ai-cleaner.server";
import { addImageToProduct, getRecentProductsWithImages } from "../services/shopify-products.server";
import {
  completeReservation,
  getUsageStatus,
  PLAN_LIMITS,
  refundReservation,
  reserveGeneration,
  syncSubscriptionToBackend,
} from "../services/usage.server";

const isBillingTest = process.env.SHOPIFY_BILLING_TEST !== "false";
const isBillingEnabled = process.env.SHOPIFY_BILLING_ENABLED === "true";

async function getCurrentPlan({ billing }) {
  if (!isBillingEnabled) {
    const devPlan = process.env.SHOPIFY_DEV_PLAN || "Free";
    return BILLING_PLANS.includes(devPlan) ? devPlan : "Free";
  }

  const billingCheck = await billing.check({
    plans: BILLING_PLANS,
    isTest: isBillingTest,
  });

  const activePlan = billingCheck.appSubscriptions?.find((subscription) =>
    BILLING_PLANS.includes(subscription.name),
  );

  return activePlan?.name || "Free";
}

async function getCurrentSubscription({ billing, planName }) {
  if (!isBillingEnabled || planName === "Free") return null;
  const billingCheck = await billing.check({
    plans: BILLING_PLANS,
    isTest: isBillingTest,
  });
  return billingCheck.appSubscriptions?.find((subscription) => subscription.name === planName) || null;
}

function getBillingReturnUrl(request) {
  const url = new URL(request.url);
  return `${url.origin}/app${url.search}`;
}

function getBillingErrorMessage(error) {
  const details = error.errorData || error.errors || error.response?.errors;
  if (details) {
    try {
      const serialized = JSON.stringify(details);
      if (serialized.includes("Apps without a public distribution cannot use the Billing API")) {
        return "This app cannot use Shopify Billing API until distribution is set to Public in Shopify Dev Dashboard.";
      }
      return `${error.message}: ${serialized}`;
    } catch {
      return error.message;
    }
  }
  return error.message || "Error while billing the store";
}

function fallbackUsage(planName) {
  const plan = PLAN_LIMITS[planName] || PLAN_LIMITS.Free;
  return {
    planName: plan.label,
    limit: plan.limit,
    used: 0,
    remaining: plan.limit,
    period: plan.period,
    periodKey: plan.period === "month" ? "current" : "lifetime",
    canGenerate: true,
  };
}

export const loader = async ({ request }) => {
  const { admin, billing, session } = await authenticate.admin(request);

  const planName = await getCurrentPlan({ billing });
  const activeSubscription = await getCurrentSubscription({ billing, planName });
  let usageWarning = null;
  let usage = fallbackUsage(planName);

  try {
    if (isBillingEnabled) {
      await syncSubscriptionToBackend(session.shop, planName, {
        status: planName === "Free" ? "none" : "active",
        currentPeriodEnd: activeSubscription?.currentPeriodEnd,
        cancelAtPeriodEnd: activeSubscription?.cancelAtPeriodEnd,
      });
    }
    usage = await getUsageStatus(session.shop, planName);
  } catch (error) {
    console.error("Usage backend unavailable", error);
    usageWarning = "Usage service is temporarily unavailable. Generation still requires the usage service before it can run.";
  }

  const products = await getRecentProductsWithImages(admin);

  return json({
    products,
    billingEnabled: isBillingEnabled,
    usage,
    usageWarning,
    plans: Object.entries(PLAN_LIMITS)
      .filter(([name]) => name !== "Free")
      .map(([name, plan]) => ({
        name,
        limit: plan.limit,
        price: plan.price,
        interval: plan.interval,
      })),
    cleanupModes: Object.entries(CLEANUP_MODES).map(([value, mode]) => ({
      label: mode.label,
      value,
    })),
  });
};

export const action = async ({ request }) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (intent === "subscribe") {
      const plan = String(formData.get("plan") || STARTER_PLAN);
      if (!BILLING_PLANS.includes(plan)) {
        return json({ ok: false, error: "Unknown plan." }, { status: 400 });
      }

      try {
        return await billing.request({
          plan,
          isTest: isBillingTest,
          returnUrl: getBillingReturnUrl(request),
        });
      } catch (error) {
        console.error("Billing request failed", error);
        return json({ ok: false, error: getBillingErrorMessage(error) }, { status: 500 });
      }
    }

    if (intent === "generate") {
      const productId = String(formData.get("productId") || "");
      const sourceImageUrl = String(formData.get("sourceImageUrl") || "");
      const cleanupMode = String(formData.get("cleanupMode") || "supplier");

      if (!productId || !sourceImageUrl) {
        return json({ ok: false, error: "Select a product image first." }, { status: 400 });
      }

      const planName = await getCurrentPlan({ billing });
      const reservation = await reserveGeneration(session.shop, planName, {
        productId,
        sourceImageUrl,
        cleanupMode,
      });

      try {
        const result = await generateCleanProductImage({
          imageUrl: sourceImageUrl,
          cleanupMode,
          shop: session.shop,
        });

        await completeReservation(session.shop, reservation.reservationId, {
          planName,
          jobId: result.jobId,
          outputUrl: result.outputUrl,
        });
        const usage = await getUsageStatus(session.shop, planName);

        return json({
          ok: true,
          intent,
          usage,
          productId,
          sourceImageUrl,
          cleanupMode,
          outputUrl: result.outputUrl,
          jobId: result.jobId,
        });
      } catch (error) {
        await refundReservation(session.shop, planName, reservation.reservationId);
        throw error;
      }
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
    if (error.code === "QUOTA_EXCEEDED") {
      return json({
        ok: false,
        error: `You have used ${error.usage.used}/${error.usage.limit} images on the ${error.usage.planName} plan.`,
        usage: error.usage,
      }, { status: 402 });
    }
    return json({ ok: false, error: error.message || "Request failed." }, { status: 500 });
  }
};

export default function Index() {
  const { products, cleanupModes, billingEnabled, usage: initialUsage, usageWarning, plans } = useLoaderData();
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
  const isSubscribing = isSubmitting && navigation.formData?.get("intent") === "subscribe";
  const generated = actionData?.ok && actionData.intent === "generate" ? actionData : null;
  const usage = actionData?.usage || initialUsage;

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

            {!billingEnabled ? (
              <Banner tone="warning">
                Billing is disabled for local development. Set SHOPIFY_BILLING_ENABLED=true when you are ready to test the monthly subscription flow.
              </Banner>
            ) : null}

            {usageWarning ? (
              <Banner tone="warning">{usageWarning}</Banner>
            ) : null}

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Image quota
                    </Text>
                    <Text as="p" tone="subdued">
                      {usage.planName} plan · {usage.period === "month" ? "Monthly" : "Lifetime"} quota
                    </Text>
                  </BlockStack>
                  <Badge tone={usage.remaining > 0 ? "success" : "critical"}>
                    {usage.used} / {usage.limit} used
                  </Badge>
                </InlineStack>
                {billingEnabled ? (
                  <BlockStack gap="200">
                    <Text as="p" tone="subdued">
                      Charges are approved in Shopify and billed through your Shopify invoice.
                    </Text>
                    <InlineStack gap="200">
                      {plans.map((plan) => (
                        <Form method="post" key={plan.name}>
                          <input type="hidden" name="intent" value="subscribe" />
                          <input type="hidden" name="plan" value={plan.name} />
                          <Button submit loading={isSubscribing} disabled={usage.planName === plan.name}>
                            {usage.planName === plan.name
                              ? `${plan.name} active`
                              : `${plan.name} - ${plan.price} ${plan.interval} - ${plan.limit} images`}
                          </Button>
                        </Form>
                      ))}
                    </InlineStack>
                  </BlockStack>
                ) : null}
              </BlockStack>
            </Card>

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
