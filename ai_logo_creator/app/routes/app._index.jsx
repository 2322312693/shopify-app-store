import { appEnv } from "../services/app-env.server";
import "../styles/logo-creator.css";
export const config = { maxDuration: 300 };
import { APP_CONFIG } from "../app-config";
import { syncMerchantProfileSafely } from "../services/merchant-profile.server";
import { queryAdminWithRecovery } from "../services/admin-query.server";
import { normalizePlanKey, planFromSubscription, selectActiveSubscription } from "../services/subscription-policy";
import { json, redirect } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  Select,
  Text,
} from "@shopify/polaris";
import { useEffect, useRef, useState } from "react";
import { BILLING_PLANS, STARTER_PLAN, authenticate } from "../shopify.server";
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES } from "../services/upload-policy";
import { uploadReferenceToR2 } from "../services/r2-upload";
import { generateLogo } from "../services/ai-logo.server";
import {
  addImageToProduct,
  getRecentProductsWithImages,
  getRecentProductsWithImagesWithToken,
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

const isBillingTest = process.env.SHOPIFY_BILLING_TEST === "true";
const isBillingCheckEnabled = process.env.NODE_ENV === "production" || process.env.SHOPIFY_BILLING_CHECK_ENABLED !== "false";
const showDiagnostics = process.env.SHOPIFY_DEBUG_PANEL === "true";
const managedPricingAppHandle = appEnv("SHOPIFY_MANAGED_PRICING_APP_HANDLE") || APP_CONFIG.handle;
const BILLING_UNAVAILABLE_MESSAGE =
  "Shopify Billing API is currently unavailable for this app/store. Logo generation still works on the Free quota.";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};
const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query ActiveAppSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        currentPeriodEnd
        lineItems {
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                interval
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

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

async function getActiveManagedSubscriptions(admin, session) {
  const json = await queryAdminWithRecovery({ admin, session, query: ACTIVE_SUBSCRIPTIONS_QUERY });

  if (json.errors) {
    throw new Error(json.errors.map((error) => error.message || JSON.stringify(error)).join("; "));
  }

  return json.data?.currentAppInstallation?.activeSubscriptions || [];
}

async function getCurrentPlan({ admin, session, billing, billingCheck }) {
  if (!isBillingCheckEnabled) {
    const devPlan = process.env.SHOPIFY_DEV_PLAN || "Free";
    return BILLING_PLANS.includes(devPlan) ? devPlan : "Free";
  }

  const subscriptions = await getActiveManagedSubscriptions(admin, session);
  const active = selectActiveSubscription(subscriptions, isBillingTest);
  return active ? planFromSubscription(active) : "Free";
}

async function getCurrentSubscription({ admin, session, planName }) {
  if (!isBillingCheckEnabled || planName === "Free") return null;
  return selectActiveSubscription(await getActiveManagedSubscriptions(admin, session), isBillingTest);
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

function usageMatchesPlan(usage, planName) {
  return normalizePlanKey(usage?.planName) === normalizePlanKey(planName);
}

function useShopifyPlanWhenBackendIsStale(usage, planName) {
  if (planName === "Free" || usageMatchesPlan(usage, planName)) return usage;
  return fallbackUsage(planName);
}

export const loader = async ({ request }) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const missingProductScopes = getMissingProductScopes(session);
  const url = new URL(request.url);
  const reauthorizeUrl = `/auth/login?shop=${encodeURIComponent(session.shop)}&host=${encodeURIComponent(url.searchParams.get("host") || "")}`;
  const hasAccessToken = Boolean(session.accessToken);

  let usageWarning = null;
  const billingCheck = null;
  const planName = await getCurrentPlan({ admin, session, billing, billingCheck });
  const activeSubscription = await getCurrentSubscription({ admin, session, billing, planName, billingCheck });
  await syncMerchantProfileSafely({ admin, session, planName });
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
    let syncedUsage = null;
    if (isBillingCheckEnabled) {
      syncedUsage = await syncSubscriptionToBackend(session.shop, planName, {
        status: planName === "Free" ? "none" : "active",
        id: activeSubscription?.id,
        test: activeSubscription?.test,
        currentPeriodEnd: activeSubscription?.currentPeriodEnd,
        cancelAtPeriodEnd: activeSubscription?.cancelAtPeriodEnd,
      });
      if (syncedUsage) usage = syncedUsage;
    }
    const latestUsage = await getUsageStatus(session.shop, planName);
    usage = usageMatchesPlan(latestUsage, planName)
      ? latestUsage
      : useShopifyPlanWhenBackendIsStale(syncedUsage || latestUsage, planName);
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
      tokenMigration = await migrateOfflineSessionToExpiring({ session });
      products = await getRecentProductsWithImagesWithToken({
        shop: session.shop,
        accessToken: tokenMigration.accessToken,
      });
      productSource = "graphql-expiring-token";
      productWarning = null;
    } catch (migrationError) {
      console.error(`GraphQL token fallback failed for ${session.shop}`, migrationError);
      productError.tokenMigration = {
        name: migrationError.name || null,
        message: migrationError.message || String(migrationError),
        code: migrationError.code || null,
      };
      productWarning = "Product images could not be loaded. Reinstall the app or confirm product access is granted for this store.";
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
  }, { headers: NO_STORE_HEADERS });
};

export const action = async ({ request }) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const missingProductScopes = getMissingProductScopes(session);
  if (Number(request.headers.get("content-length")) > 64 * 1024) {
    return json({ ok: false, error: "Request is too large." }, { status: 413 });
  }
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (!session.accessToken) {
      return json({
        ok: false,
        error: "Shopify access expired. Reauthorize the app first.",
      }, { status: 403 });
    }

    if (missingProductScopes.length > 0 && intent === "add") {
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
      const brandName = String(formData.get("brandName") || "").trim().slice(0, 80);
      const brief = String(formData.get("brief") || "").trim().slice(0, 400);
      const referenceImageUrl = String(formData.get("referenceImageUrl") || "");
      const hasReference = Boolean(referenceImageUrl);
      if (!brandName && !brief) {
        return json({ ok: false, error: "Add a brand name or creative brief first." }, { status: 400 });
      }
      const billingCheck = null;
      const planName = await getCurrentPlan({ admin, session, billing, billingCheck });
      const reservation = await reserveGeneration(session.shop, planName, {
        productId: "",
        sourceImageUrl: null,
        imageSource: hasReference ? "reference" : "text",
        cleanupMode: "logo",
      });

      try {
        const result = await generateLogo({ brandName, brief, referenceImageUrl, shop: session.shop });

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
          brandName,
          brief,
          hasReference,
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
      const brandName = String(formData.get("brandName") || "").trim().slice(0, 80);

      if (!productId || !outputUrl) {
        return json({ ok: false, error: "Missing generated image." }, { status: 400 });
      }

      const media = await addImageToProduct(admin, {
        productId,
        imageUrl: outputUrl,
        alt: `${brandName || "AI-generated"} logo concept`,
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

function LogoResult({ data, products, brandName, onStartOver }) {
  const save = useFetcher();
  const [destination, setDestination] = useState(products[0]?.id || "");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  async function download() {
    setDownloading(true);
    setDownloadError("");
    try {
      const response = await fetch(data.outputUrl, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${brandName || "brand"}-logo.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setDownloadError("Download failed. Open the image and save it from your browser.");
    } finally {
      setDownloading(false);
    }
  }

  return <section className="logo-result-page" aria-labelledby="logo-result-heading">
    <div className="logo-result-nav">
      <Button onClick={onStartOver}>← Back to logo creator</Button>
      <span>Generation complete</span>
    </div>
    <section className="logo-result">
    <div className="logo-result-copy">
      <span className="logo-kicker">Your new concept</span>
      <h2 id="logo-result-heading">A logo ready for your next product</h2>
      <p>Download the concept or add it as a new image to a product. Existing product media stays unchanged.</p>
      <InlineStack gap="200">
        <Button variant="primary" onClick={download} loading={downloading}>Download logo</Button>
        <Button url={data.outputUrl} external>Open full size</Button>
      </InlineStack>
      {downloadError && <Banner tone="warning">{downloadError}</Banner>}
      {products.length > 0 && <save.Form method="post">
        <BlockStack gap="200">
          <input type="hidden" name="intent" value="add" />
          <input type="hidden" name="outputUrl" value={data.outputUrl} />
          <input type="hidden" name="brandName" value={brandName} />
          <Select label="Add logo to product" name="productId" options={products.map((p)=>({ label:p.title, value:p.id }))} value={destination} onChange={setDestination} />
          <Button submit loading={save.state !== "idle"} disabled={!destination || save.state !== "idle"}>Add as new product image</Button>
        </BlockStack>
      </save.Form>}
      {save.data && <Banner tone={save.data.ok ? "success" : "critical"}>{save.data.ok ? "Logo added as a new product image." : save.data.error}</Banner>}
    </div>
    <div className="logo-result-frame"><img src={data.outputUrl} alt={`${brandName || "Generated"} logo concept`} /></div>
    </section>
  </section>;
}

export default function LogoCreator() {
  const { products, usage, usageWarning, managedPricingUrl } = useLoaderData();
  const generator = useFetcher();
  const fileInput = useRef(null);
  const previewUrl = useRef("");
  const [brandName, setBrandName] = useState("");
  const [brief, setBrief] = useState("");
  const [reference, setReference] = useState(null);
  const [preview, setPreview] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("create");
  const currentUsage = generator.data?.usage || usage;
  const busy = uploading || generator.state !== "idle";

  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  useEffect(() => {
    if (generator.data?.ok && generator.data.intent === "generate") {
      setView("result");
    }
  }, [generator.data]);

  function chooseReference(file) {
    setError("");
    if (!file) return;
    if (!UPLOAD_TYPES.includes(file.type) || !file.size || file.size > MAX_UPLOAD_BYTES) {
      setError("Use a JPG, PNG or WebP reference image no larger than 5 MB.");
      return;
    }
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = URL.createObjectURL(file);
    setReference(file);
    setPreview(previewUrl.current);
  }

  async function submit() {
    setError("");
    if (!brandName.trim() && !brief.trim()) {
      setError("Add a brand name or creative brief first.");
      return;
    }
    setUploading(true);
    try {
      const referenceImageUrl = reference ? await uploadReferenceToR2(reference) : "";
      generator.submit({ intent: "generate", brandName, brief, referenceImageUrl }, { method:"post" });
    } catch (uploadError) {
      setError(uploadError.message || "Reference upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  function startOver() {
    setError("");
    setView("create");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (view === "result" && generator.data?.ok) {
    return <Page title="Your logo result" subtitle="Download it or add it to a Shopify product.">
      <BlockStack gap="400">
        <InlineStack gap="200" align="space-between">
          <Text as="p">{currentUsage ? `${currentUsage.used} / ${currentUsage.limit} logos used` : "Usage unavailable"}</Text>
          <Button url={managedPricingUrl} target="_top">View plans / Manage subscription</Button>
        </InlineStack>
        <LogoResult
          data={generator.data}
          products={products}
          brandName={generator.data.brandName}
          onStartOver={startOver}
        />
      </BlockStack>
    </Page>;
  }

  return <Page title="Zest AI Logo Creator" subtitle="Turn a brand brief into an original logo concept for your store.">
    <BlockStack gap="400">
      <div className="logo-hero">
        <div><span className="logo-kicker">Brand studio</span><h2>Shape a mark customers can remember.</h2><p>Describe your brand, set the visual direction and create a polished square logo concept.</p></div>
        <div className="logo-hero-mark" aria-hidden="true"><span>✦</span></div>
      </div>
      <InlineStack gap="200" align="space-between">
        <Text as="p">{currentUsage ? `${currentUsage.used} / ${currentUsage.limit} logos used` : "Usage unavailable"}</Text>
        <Button url={managedPricingUrl} target="_top">View plans / Manage subscription</Button>
      </InlineStack>
      {usageWarning && <Banner tone="warning">{usageWarning}</Banner>}
      {error && <Banner tone="critical">{error}</Banner>}
      {generator.data && !generator.data.ok && <Banner tone="critical">{generator.data.error}</Banner>}

      <div className="logo-workspace">
        <Card>
          <BlockStack gap="400">
            <div><Text as="h2" variant="headingMd">Create your logo</Text><Text as="p" tone="subdued">One clear brief works better than a list of unrelated styles.</Text></div>
            <label className="logo-field"><span>Brand name</span><input value={brandName} maxLength={80} disabled={busy} onChange={(e)=>setBrandName(e.target.value)} placeholder="e.g. Northstar Coffee" /></label>
            <label className="logo-field"><span>Creative direction</span><textarea value={brief} maxLength={400} disabled={busy} onChange={(e)=>setBrief(e.target.value)} placeholder="Minimal mountain symbol, deep green and warm gold, premium outdoor feel" /><small>{brief.length}/400</small></label>
            <div className={`logo-dropzone ${dragging ? "is-dragging" : ""}`}
              onDragOver={(e)=>{e.preventDefault();if(!busy)setDragging(true);}}
              onDragLeave={()=>setDragging(false)}
              onDrop={(e)=>{e.preventDefault();setDragging(false);chooseReference(e.dataTransfer.files[0]);}}>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload optional logo reference" disabled={busy} onChange={(e)=>{chooseReference(e.target.files?.[0]);e.target.value="";}} />
              {preview ? <><img src={preview} alt="Logo reference preview" /><div><strong>Reference added</strong><span>{reference?.name}</span></div><Button disabled={busy} onClick={()=>{setReference(null);setPreview("");}}>Remove</Button></>
                : <><div className="logo-upload-icon">↥</div><div><strong>Optional reference image</strong><span>Drop an image here or browse · JPG, PNG or WebP · 5 MB max</span></div><Button disabled={busy} onClick={()=>fileInput.current?.click()}>Choose reference</Button></>}
            </div>
            <Button variant="primary" size="large" loading={busy} disabled={busy} onClick={submit}>Generate logo concept</Button>
            <Text as="p" tone="subdued">Each successful generation uses one logo from your plan. Failed generations are refunded.</Text>
          </BlockStack>
        </Card>
        <aside className="logo-brief-guide"><span className="logo-kicker">Brief recipe</span><h3>Three details are enough</h3><ol><li><strong>Symbol</strong><span>What should people recognize?</span></li><li><strong>Color</strong><span>Choose one dominant mood.</span></li><li><strong>Character</strong><span>Modern, playful, refined or bold.</span></li></ol><p>Reference images guide the direction. They are redesigned substantially rather than copied.</p></aside>
      </div>
    </BlockStack>
  </Page>;
}
