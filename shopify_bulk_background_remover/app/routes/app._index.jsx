import "../styles/bulk-picker.css";
export const config = { maxDuration: 300 };
import { APP_CONFIG } from "../app-config";
import { syncMerchantProfileSafely } from "../services/merchant-profile.server";
import { queryAdminWithRecovery } from "../services/admin-query.server";
import { normalizePlanKey, planFromSubscription, selectActiveSubscription } from "../services/subscription-policy";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
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
import { readUploadedImage } from "../services/upload-image.server";
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES } from "../services/upload-policy";
import { CLEANUP_MODES, generateCleanProductImage } from "../services/ai-cleaner.server";
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
const managedPricingAppHandle = process.env.SHOPIFY_MANAGED_PRICING_APP_HANDLE || APP_CONFIG.handle;
const BILLING_UNAVAILABLE_MESSAGE =
  "Shopify Billing API is currently unavailable for this app/store. Core image cleaning still works on the Free quota.";
const CUSTOM_REMOVAL_MAX_LENGTH = 60;
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
    cleanupModes: Object.entries(CLEANUP_MODES).map(([value, mode]) => ({
      label: mode.label,
      value,
    })),
  }, { headers: NO_STORE_HEADERS });
};

export const action = async ({ request }) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const missingProductScopes = getMissingProductScopes(session);
  if (Number(request.headers.get("content-length")) > 4 * 1024 * 1024) {
    return json({ ok: false, error: "Upload an image smaller than 3 MB." }, { status: 413 });
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
      const isUpload = formData.get("imageSource") === "upload";
      const productId = isUpload ? "" : String(formData.get("productId") || "");
      let sourceImageUrl = String(formData.get("sourceImageUrl") || "");
      if (isUpload) {
        try { sourceImageUrl = await readUploadedImage(formData.get("imageFile")); }
        catch (error) { return json({ ok: false, error: error.message }, { status: 400 }); }
      }
      const cleanupMode = "background";
      const customRemovalTarget = String(formData.get("customRemovalTarget") || "").trim();
      const originalText = String(formData.get("originalText") || "").trim();
      const replacementText = String(formData.get("replacementText") || "").trim();
      const editInstructions = String(formData.get("editInstructions") || "").trim();
      if (cleanupMode === "edit_text" && (!originalText || !replacementText || originalText.length > 300 || replacementText.length > 300)) {
        return json({ ok: false, error: "Enter original and replacement text (up to 300 characters each)." }, { status: 400 });
      }
      if (cleanupMode === "custom" && (!editInstructions || editInstructions.length > 2000)) {
        return json({ ok: false, error: "Enter editing instructions (up to 2000 characters)." }, { status: 400 });
      }

      if ((!isUpload && !productId) || !sourceImageUrl) {
        return json({ ok: false, error: "Select a product image first." }, { status: 400 });
      }

      if (cleanupMode === "objects" && customRemovalTarget.length > CUSTOM_REMOVAL_MAX_LENGTH) {
        return json({
          ok: false,
          error: `Removal instructions must be ${CUSTOM_REMOVAL_MAX_LENGTH} characters or fewer.`,
        }, { status: 400 });
      }

      const billingCheck = null;
      const planName = await getCurrentPlan({ admin, session, billing, billingCheck });
      const reservation = await reserveGeneration(session.shop, planName, {
        productId,
        sourceImageUrl: isUpload ? null : sourceImageUrl,
        imageSource: isUpload ? "upload" : "product",
        cleanupMode,
      });

      try {
        const result = await generateCleanProductImage({
          imageUrl: sourceImageUrl,
          originalText, replacementText, editInstructions,
          cleanupMode,
          customRemovalTarget: cleanupMode === "objects" ? customRemovalTarget : "",
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
          sourceImageUrl: isUpload ? null : sourceImageUrl,
          imageSource: isUpload ? "upload" : "product",
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

import { useFetcher } from '@remix-run/react';
import { Checkbox, ProgressBar } from '@shopify/polaris';

function Result({ item, products }) {
  const save = useFetcher();
  const [destination, setDestination] = useState(item.productId || products[0]?.id || '');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const fileInput = useRef(null);
  const [downloading, setDownloading] = useState(false);
  async function download() {
    setDownloading(true); setError('');
    try {
      const response = await fetch(item.outputUrl, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a'); a.href = url; a.download = 'background-removed.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setError('Download failed. Open the image and save it from your browser.'); }
    finally { setDownloading(false); }
  }
  return <BlockStack gap="300">
    <img src={item.outputUrl} alt={`Background removed: ${item.name}`} style={{width:'100%',height:200,objectFit:'contain',background:'repeating-conic-gradient(#eee 0% 25%,white 0% 50%) 0 / 20px 20px'}} />
    <InlineStack gap="200"><Button onClick={download} loading={downloading}>Download PNG</Button><Button url={item.outputUrl} external>Open image</Button></InlineStack>
    {error && <Banner tone="warning">{error}</Banner>}
    {products.length > 0 && <save.Form method="post"><BlockStack gap="200">
      <input type="hidden" name="intent" value="add"/><input type="hidden" name="outputUrl" value={item.outputUrl}/>
      <Select label="Save to product" name="productId" options={products.map(p=>({label:p.title,value:p.id}))} value={destination} onChange={setDestination}/>
      <Button submit loading={save.state !== 'idle'} disabled={!destination || save.state !== 'idle'}>Add to product</Button>
    </BlockStack></save.Form>}
    {save.data && <Banner tone={save.data.ok?'success':'critical'}>{save.data.ok?'Added as a new product image.':save.data.error}</Banner>}
  </BlockStack>;
}

export default function BulkBackground() {
  const { products, usage, usageWarning, managedPricingUrl } = useLoaderData();
  const processor = useFetcher();
  const [items, setItems] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const fileInput = useRef(null);
  const [currentUsage, setCurrentUsage] = useState(usage);
  const flight = useRef(null);
  const previous = useRef(null);
  const previews = useRef([]);
  useEffect(()=>()=>previews.current.forEach(URL.revokeObjectURL),[]);
  useEffect(() => {
    if (processor.state !== 'idle') return;
    if (flight.current) {
      if (!processor.data || processor.data === previous.current) return;
      const id = flight.current; flight.current = null;
      const data = processor.data; previous.current = data;
      setItems(list=>list.map(item=>item.id===id?{...item,status:data.ok?'done':'failed',outputUrl:data.outputUrl,error:data.error || 'Request failed'}:item));
      if (data.usage) setCurrentUsage(data.usage);
      if (!data.ok && data.usage) setRunning(false);
      return;
    }
    if (!running) return;
    const next = items.find(item=>item.status === 'pending');
    if (!next) { setRunning(false); return; }
    flight.current = next.id; previous.current = processor.data;
    const form = new FormData(); form.set('intent','generate');form.set('cleanupMode','background');
    form.set('imageSource',next.file?'upload':'product');
    if(next.file)form.set('imageFile',next.file);
    else {form.set('productId',next.productId);form.set('sourceImageUrl',next.preview);}
    setItems(list=>list.map(item=>item.id===next.id?{...item,status:'processing'}:item));
    processor.submit(form,{method:'post',encType:'multipart/form-data'});
  },[processor.state,processor.data,running,items]);
  function upload(event) {
    const files=Array.from(event.target.files || []); event.target.value=''; addFiles(files);
  }
  function addFiles(files) {
    if (running || items.some(i=>i.status==='processing')) return;
    setError('');
    if(items.length+files.length>20){setError('Choose up to 20 images per batch.');return;}
    if(files.some(f=>!UPLOAD_TYPES.includes(f.type)||!f.size||f.size>MAX_UPLOAD_BYTES)){setError('Each image must be JPG, PNG or WebP, no larger than 3 MB.');return;}
    setItems(list=>[...list,...files.map(file=>{const preview=URL.createObjectURL(file);previews.current.push(preview);return {id:crypto.randomUUID(),file,preview,name:file.name,status:'pending'};})]);
  }
  function select(product,image,checked) {
    setError('');const id=product.id+image.id;
    if(checked && items.length>=20){setError('Choose up to 20 images per batch.');return;}
    setItems(list=>checked?[...list,{id,productId:product.id,preview:image.url,name:product.title,status:'pending'}]:list.filter(i=>i.id!==id));
  }
  const busy = items.some(i=>i.status==='processing');
  const completed=items.filter(i=>i.status==='done'||i.status==='failed').length;
  return <Page title="Bulk background remover" subtitle="Remove backgrounds from up to 20 product photos and export transparent PNGs.">
    <BlockStack gap="400"><InlineStack gap="200"><Button url={managedPricingUrl}>View plans / Manage subscription</Button></InlineStack>
      <Banner>Each image uses one image from your existing plan. Failed processing is refunded. Keep this page open while the batch runs. Original product images are preserved.</Banner>
      {usageWarning && <Banner tone="warning">{usageWarning}</Banner>}
      {currentUsage && <Text as="p">{currentUsage.used} / {currentUsage.limit} images used</Text>}
      {error && <Banner tone="critical">{error}</Banner>}
      <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">1. Choose images</Text>
        <Text as="p">Upload images you own or are authorized to edit. Selected files are uploaded to our image storage and sent for processing when you start.</Text>
        <div className={`bulk-upload ${dragging ? 'is-dragging' : ''} ${running||busy ? 'is-disabled' : ''}`}
          onDragOver={event=>{event.preventDefault();if(!running&&!busy)setDragging(true);}}
          onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget))setDragging(false);}}
          onDrop={event=>{event.preventDefault();setDragging(false);addFiles(Array.from(event.dataTransfer.files));}}>
          <input ref={fileInput} className="bulk-file-input" type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="Upload images for background removal" disabled={running||busy} onChange={upload}/>
          <div className="bulk-upload-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 16V4m-4 4 4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg></div>
          <h3>Drop your product photos here</h3>
          <p>Clean backgrounds start with a simple upload.</p>
          <Button disabled={running||busy} onClick={()=>fileInput.current?.click()}>Choose images</Button>
          <span className="bulk-file-hint">JPG, PNG or WebP · Up to 3 MB each · 20 images per batch</span>
        </div>
        <div className="bulk-source-divider"><span>or choose from your store</span></div>
        <section className="bulk-library">
          <button className="bulk-library-toggle" type="button" aria-expanded={libraryOpen} aria-controls="bulk-product-library" onClick={()=>setLibraryOpen(v=>!v)}>
            <span className="bulk-library-symbol" aria-hidden="true">▦</span>
            <span className="bulk-library-heading"><strong>Shopify product images</strong><span>Browse your products and select the photos to edit</span></span>
            <span className="bulk-selected-count">{items.filter(i=>!i.file).length} selected</span>
            <span className={`bulk-chevron ${libraryOpen?'is-open':''}`} aria-hidden="true">⌄</span>
          </button>
          {libraryOpen&&<div id="bulk-product-library" className="bulk-library-body">
            <label className="bulk-search"><span>Search products</span><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search by product name…"/></label>
            <div className="bulk-product-grid">
              {products.filter(product=>product.title.toLowerCase().includes(search.toLowerCase())).flatMap(product=>product.images.map(image=>{
                const selected=items.some(i=>i.id===product.id+image.id);
                return <label className={`bulk-product ${selected?'is-selected':''}`} key={product.id+image.id}>
                  <input type="checkbox" aria-label={product.title} checked={selected} disabled={running||busy||(!selected&&items.length>=20)} onChange={event=>select(product,image,event.target.checked)}/>
                  <span className="bulk-product-photo"><img src={image.url} alt="" loading="lazy"/></span>
                  <span className="bulk-product-name">{product.title}</span>
                </label>;
              }))}
            </div>
            {!products.some(product=>product.title.toLowerCase().includes(search.toLowerCase())&&product.images.length>0)&&<p className="bulk-empty">No product images found. Try another search or upload images above.</p>}
          </div>}
        </section>
        <div className="bulk-batch-summary"><strong>{items.length} / 20 images selected</strong><span>Original product images stay unchanged</span></div>
        <InlineStack gap="200"><Button variant="primary" disabled={running||busy||!items.some(i=>i.status==='pending')} onClick={()=>setRunning(true)}>Remove backgrounds</Button>
        {running && <Button onClick={()=>setRunning(false)}>Stop after current image</Button>}
        {!running&&!busy&&items.length>0&&<Button onClick={()=>{setItems([]);previews.current.forEach(URL.revokeObjectURL);previews.current=[];}}>Clear batch</Button>}
        </InlineStack>
        {items.length>0&&<><ProgressBar progress={completed/items.length*100}/><Text as="p">{completed} / {items.length} processed{busy?' · Processing one image…':''}</Text></>}
      </BlockStack></Card>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:16}}>
      {items.map(item=><Card key={item.id}><BlockStack gap="300"><Text as="h3" variant="headingSm">{item.name}</Text><Badge tone={item.status==='done'?'success':item.status==='failed'?'critical':'info'}>{item.status}</Badge>
        {item.status==='done'?<Result item={item} products={products}/>:<img src={item.preview} alt={item.name} style={{width:'100%',height:160,objectFit:'contain'}}/>}
        {!running&&!busy&&item.status==='pending'&&<Button onClick={()=>setItems(list=>list.filter(i=>i.id!==item.id))}>Remove from batch</Button>}
        {item.status==='failed'&&<><Banner tone="critical">{item.error}</Banner><Button disabled={running||busy} onClick={()=>setItems(list=>list.map(i=>i.id===item.id?{...i,status:'pending'}:i))}>Retry this image</Button></>}
      </BlockStack></Card>)}
      </div>
    </BlockStack>
  </Page>;
}
