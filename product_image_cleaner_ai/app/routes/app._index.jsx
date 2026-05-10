import { json, redirect } from "@remix-run/node";
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
import {
  addImageToProduct,
  getRecentProductsWithImages,
  getRecentProductsWithImagesFromRest,
  migrateOfflineSessionToExpiring,
} from "../services/shopify-products.server";
import {
  completeReservation,
  getUsageStatus,
  PLAN_LIMITS,
  refundReservation,
  reserveGeneration,
  syncSubscriptionToBackend,
} from "../services/usage.server";

const isBillingTest = process.env.SHOPIFY_BILLING_TEST !== "false";
const isBillingCheckEnabled = process.env.SHOPIFY_BILLING_CHECK_ENABLED === "true";
const showDiagnostics = process.env.SHOPIFY_DEBUG_PANEL === "true";
const managedPricingAppHandle = process.env.SHOPIFY_MANAGED_PRICING_APP_HANDLE || "product-image-cleaner-ai";
const BILLING_UNAVAILABLE_MESSAGE =
  "Shopify Billing API is currently unavailable for this app/store. Core image cleaning still works on the Free quota.";

function sessionScopes(session) {
  return String(session.scope || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function getMissingProductScopes(session) {
  const scopes = sessionScopes(session);
  const hasProductRead = scopes.includes("read_products") || scopes.includes("write_products");
  const hasProductWrite = scopes.includes("write_products");
  return [
    !hasProductRead ? "read_products" : null,
    !hasProductWrite ? "write_products" : null,
  ].filter(Boolean);
}

function isBillingForbidden(error) {
  const message = [
    error?.message,
    error?.response?.message,
    error?.response?.statusText,
    error?.networkStatusCode,
  ].filter(Boolean).join(" ");
  return message.includes("403") || message.includes("Forbidden");
}

async function checkBillingSafely({ billing }) {
  try {
    return {
      ok: true,
      warning: null,
      result: await billing.check({
        plans: BILLING_PLANS,
        isTest: isBillingTest,
      }),
    };
  } catch (error) {
    if (isBillingForbidden(error)) {
      console.warn("Billing check forbidden; using backend/free quota state instead.");
      return { ok: false, warning: BILLING_UNAVAILABLE_MESSAGE, result: null };
    }
    console.error("Billing check failed", error);
    throw error;
  }
}

async function getCurrentPlan({ billing, billingCheck }) {
  if (!isBillingCheckEnabled) {
    const devPlan = process.env.SHOPIFY_DEV_PLAN || "Free";
    return BILLING_PLANS.includes(devPlan) ? devPlan : "Free";
  }

  const check = billingCheck || await checkBillingSafely({ billing });
  if (!check.ok) return "Free";

  const activePlan = check.result?.appSubscriptions?.find((subscription) =>
    BILLING_PLANS.includes(subscription.name),
  );

  return activePlan?.name || "Free";
}

async function getCurrentSubscription({ billing, planName, billingCheck }) {
  if (!isBillingCheckEnabled || planName === "Free") return null;
  const check = billingCheck || await checkBillingSafely({ billing });
  if (!check.ok) return null;
  return check.result?.appSubscriptions?.find((subscription) => subscription.name === planName) || null;
}

function getStoreHandle(shop) {
  return shop.replace(/\.myshopify\.com$/i, "");
}

function getManagedPricingUrl(shop) {
  return `https://admin.shopify.com/store/${getStoreHandle(shop)}/charges/${managedPricingAppHandle}/pricing_plans`;
}

function getBillingErrorMessage(error) {
  const details = error.errorData || error.errors || error.response?.errors;
  if (details) {
    try {
      const serialized = JSON.stringify(details);
      if (serialized.includes("Apps without a public distribution cannot use the Billing API")) {
        return "This app cannot use Shopify Billing API until distribution is set to Public in Shopify Dev Dashboard.";
      }
      if (serialized.includes("Forbidden")) {
        return BILLING_UNAVAILABLE_MESSAGE;
      }
      return `${error.message}: ${serialized}`;
    } catch {
      return error.message;
    }
  }
  if (isBillingForbidden(error)) return BILLING_UNAVAILABLE_MESSAGE;
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
  const missingProductScopes = getMissingProductScopes(session);
  const url = new URL(request.url);
  const reauthorizeUrl = `/auth/login?shop=${encodeURIComponent(session.shop)}&host=${encodeURIComponent(url.searchParams.get("host") || "")}`;
  const hasAccessToken = Boolean(session.accessToken);

  let usageWarning = null;
  const billingCheck = isBillingCheckEnabled ? await checkBillingSafely({ billing }) : null;
  const planName = await getCurrentPlan({ billing, billingCheck });
  const activeSubscription = await getCurrentSubscription({ billing, planName, billingCheck });
  const billingWarning = billingCheck?.warning || null;
  let usage = fallbackUsage(planName);
  let productWarning = null;
  let productError = null;
  let productSource = null;
  let tokenMigration = null;
  let products = [];

  if (!hasAccessToken) {
    console.warn(`Shopify session for ${session.shop} is missing accessToken. Deleting stale session.`);
    productWarning = "Shopify access expired. Reauthorize the app to reload product images.";
  }

  try {
    if (isBillingCheckEnabled) {
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

  try {
    if (hasAccessToken) {
      products = await getRecentProductsWithImages(admin);
      productSource = "graphql";
    }
  } catch (error) {
    console.error(`Product image query failed for ${session.shop}`, error);
    productError = {
      name: error.name || null,
      message: error.message || String(error),
      code: error.code || null,
    };

    try {
      products = await getRecentProductsWithImagesFromRest({
        shop: session.shop,
        accessToken: session.accessToken,
      });
      productSource = "rest";
      productWarning = null;
    } catch (restError) {
      console.error(`REST product fallback failed for ${session.shop}`, restError);
      productError.rest = {
        name: restError.name || null,
        message: restError.message || String(restError),
        code: restError.code || null,
      };

      if (String(restError.message || "").includes("Non-expiring access tokens are no longer accepted")) {
        try {
          tokenMigration = await migrateOfflineSessionToExpiring({ session });
          products = await getRecentProductsWithImagesFromRest({
            shop: session.shop,
            accessToken: tokenMigration.accessToken,
          });
          productSource = "rest-expiring-token";
          productWarning = null;
        } catch (migrationError) {
          console.error(`Offline token migration failed for ${session.shop}`, migrationError);
          productError.tokenMigration = {
            name: migrationError.name || null,
            message: migrationError.message || String(migrationError),
            code: migrationError.code || null,
          };
          productWarning = "Product images could not be loaded because Shopify token migration failed.";
        }
      } else {
        productWarning = "Product images could not be loaded. Reinstall the app or confirm product access is granted for this store.";
      }
    }
  }

  const productImageCount = products.reduce((total, product) => total + product.images.length, 0);
  const diagnostics = showDiagnostics ? {
    shop: session.shop,
    sessionId: session.id,
    sessionScope: session.scope || null,
    hasAccessToken,
    scopes: sessionScopes(session),
    missingProductScopes,
    reauthorizeUrl,
    billingCheckEnabled: isBillingCheckEnabled,
    planName,
    usage,
    tokenMigration: tokenMigration ? {
      scope: tokenMigration.scope,
      expiresIn: tokenMigration.expiresIn,
      refreshTokenReceived: tokenMigration.refreshTokenReceived,
    } : null,
    productQuery: {
      returnedProducts: products.length,
      returnedImages: productImageCount,
      source: productSource,
      productError,
      products: products.map((product) => ({
        id: product.id,
        title: product.title,
        handle: product.handle,
        status: product.status || null,
        imageCount: product.images.length,
        images: product.images.map((image) => ({
          id: image.id,
          url: image.url,
          width: image.width,
          height: image.height,
        })),
      })),
    },
  } : null;

  return json({
    products,
    billingCheckEnabled: isBillingCheckEnabled,
    billingWarning,
    managedPricingUrl: getManagedPricingUrl(session.shop),
    usage,
    usageWarning,
    productWarning,
    diagnostics,
    missingProductScopes,
    reauthorizeUrl,
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
  const missingProductScopes = getMissingProductScopes(session);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (!session.accessToken) {
      return json({
        ok: false,
        error: "Shopify access expired. Reauthorize the app first.",
      }, { status: 403 });
    }

    if (missingProductScopes.length > 0 && (intent === "generate" || intent === "add")) {
      return json({
        ok: false,
        error: `Missing Shopify product access scopes: ${missingProductScopes.join(", ")}. Reauthorize the app first.`,
      }, { status: 403 });
    }

    if (intent === "subscribe") {
      const plan = String(formData.get("plan") || STARTER_PLAN);
      if (!BILLING_PLANS.includes(plan)) {
        return json({ ok: false, error: "Unknown plan." }, { status: 400 });
      }

      return redirect(getManagedPricingUrl(session.shop));
    }

    if (intent === "generate") {
      const productId = String(formData.get("productId") || "");
      const sourceImageUrl = String(formData.get("sourceImageUrl") || "");
      const cleanupMode = String(formData.get("cleanupMode") || "supplier");

      if (!productId || !sourceImageUrl) {
        return json({ ok: false, error: "Select a product image first." }, { status: 400 });
      }

      const billingCheck = isBillingCheckEnabled ? await checkBillingSafely({ billing }) : null;
      const planName = await getCurrentPlan({ billing, billingCheck });
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
  const {
    products,
    cleanupModes,
    billingCheckEnabled,
    billingWarning,
    managedPricingUrl,
    usage: initialUsage,
    usageWarning,
    productWarning,
    diagnostics,
    missingProductScopes,
    reauthorizeUrl,
    plans,
  } = useLoaderData();
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

            {!billingCheckEnabled ? (
              <Banner tone="warning">
                Shopify subscription status checks are currently disabled. Plan buttons still open Shopify Managed Pricing.
              </Banner>
            ) : null}

            {usageWarning ? (
              <Banner tone="warning">{usageWarning}</Banner>
            ) : null}

            {billingWarning ? (
              <Banner tone="warning">{billingWarning}</Banner>
            ) : null}

            {productWarning ? (
              <Banner tone="critical">{productWarning}</Banner>
            ) : null}

            {missingProductScopes.length > 0 ? (
              <Banner
                tone="critical"
                action={{
                  content: "Reauthorize app",
                  url: reauthorizeUrl,
                  target: "_top",
                }}
              >
                Missing Shopify product access scopes: {missingProductScopes.join(", ")}.
              </Banner>
            ) : null}

            {diagnostics?.hasAccessToken === false ? (
              <Banner
                tone="critical"
                action={{
                  content: "Reauthorize app",
                  url: reauthorizeUrl,
                  target: "_top",
                }}
              >
                Shopify access expired. Reauthorize the app to load product images.
              </Banner>
            ) : null}

            {diagnostics ? (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Debug diagnostics
                  </Text>
                  <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: 12 }}>
                    {JSON.stringify(diagnostics, null, 2)}
                  </pre>
                </BlockStack>
              </Card>
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
                <BlockStack gap="200">
                  <Text as="p" tone="subdued">
                    Plan changes are approved on Shopify's managed pricing page and billed through your Shopify invoice.
                  </Text>
                  <InlineStack gap="200">
                    {plans.map((plan) => (
                      <Button
                        key={plan.name}
                        url={managedPricingUrl}
                        target="_top"
                        disabled={usage.planName === plan.name}
                      >
                        {usage.planName === plan.name
                          ? `${plan.name} active`
                          : `${plan.name} - ${plan.price} ${plan.interval} - ${plan.limit} images`}
                      </Button>
                    ))}
                  </InlineStack>
                </BlockStack>
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
