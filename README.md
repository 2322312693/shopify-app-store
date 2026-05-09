# Product Image Cleaner AI

Shopify embedded app for cleaning authorized product images with AI. It removes unwanted text, supplier labels, old logos, watermarks, badges, stickers, and visual clutter, then adds the cleaned result back to the Shopify product as new media.

## What it does

- Reads recent Shopify products and product image media.
- Lets a merchant choose an image and cleanup mode.
- Calls the existing ZestGPT Replicate proxy with `google/nano-banana`.
- Shows a before/after preview.
- Adds the generated result as a new product image without replacing the original.
- Requires a Shopify monthly subscription before use.

## Local development

```bash
cd /Users/sen/Desktop/lsl_code/shopify_app_store/product_image_cleaner_ai
npm install
cp .env.example .env
shopify auth login
shopify app config link
shopify app dev
```

The Shopify CLI opens or prints an install URL for your development store. Install the app, complete the test subscription, then open it from Shopify Admin > Apps.

## Required environment

```bash
SHOPIFY_API_KEY=your_shopify_api_key
SHOPIFY_API_SECRET=your_shopify_api_secret
SCOPES=read_products,write_products,read_files,write_files
SHOPIFY_APP_URL=https://your-tunnel-or-production-url
AI_API_BASE_URL=https://ai.zestgpt.com
AI_MODEL=google/nano-banana
SHOPIFY_BILLING_TEST=true
```

Keep `SHOPIFY_BILLING_TEST=true` while testing on a development store. Set it to `false` before production billing.

## Test flow

1. Install the app on a Shopify development store.
2. Accept the test monthly subscription.
3. Add at least one product with an image.
4. Select a product image in the app.
5. Choose `Clean supplier image` or another cleanup mode.
6. Generate the cleaned image.
7. Click `Add to product`.
8. Confirm the product has the new image while the original remains unchanged.

## Git remote

```bash
git remote add origin https://github.com/2322312693/shopify-app-store.git
git branch -M main
git push -u origin main
```

## App Store review notes

- Do not market this as removing arbitrary watermarks.
- Use language such as "authorized product images", "old logos", "supplier labels", and "outdated promotional text".
- Record the review screencast from a test store showing install, subscription, product selection, image generation, and adding the result back to the product.
