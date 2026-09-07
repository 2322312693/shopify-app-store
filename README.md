# Zest Shopify shared deployment

One Vercel project (`shopify-app-store`) serves `https://imagecleaner.zestgpt.com`.

| App | Entry |
| --- | --- |
| Product Image Cleaner AI | `/product_image_cleaner_ai` |
| Bulk Background Remover | `/bulk_background_remover` |
| Zest AI Logo Creator | `/ai_logo_creator` |

The original `/app`, `/auth/*` and `/webhooks/*` routes remain served by the legacy Product Image Cleaner build until its Shopify configuration is switched. Existing Bulk hosting remains available for rollback.

## Build

Configure the existing Vercel project's Root Directory as empty (repository root). The root `vercel.json` selects the Build Output API pipeline. `npm ci && npm run build` builds each registered entry from `platform-apps.json`, packages its own dependency graph, and writes `.vercel/output`. Run `npm test` after building to validate generated functions, prefixes, static assets, identity isolation, and HMAC rejection. For local iterations with installed dependencies use `PLATFORM_SKIP_INSTALL=1 npm run build`.

Each application is a separate function and Shopify SDK instance. The build never embeds secrets. Runtime credentials are resolved from dedicated variables; missing credentials for a prefixed new app never fall back to another app's identity.

Production variables:

- Existing `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`: legacy Product Image Cleaner only.
- `AI_LOGO_CREATOR_SHOPIFY_API_KEY`, `AI_LOGO_CREATOR_SHOPIFY_API_SECRET`.
- `BULK_BACKGROUND_REMOVER_SHOPIFY_API_KEY`, `BULK_BACKGROUND_REMOVER_SHOPIFY_API_SECRET`.
- Shared `SHOPIFY_INTERNAL_API_KEY`, `SHOPIFY_SESSION_STORAGE=remote`, `AI_API_BASE_URL`, `SHOPIFY_USAGE_API_BASE_URL`.
- Optional app-specific pricing handle: `<APP_KEY_UPPERCASE>_SHOPIFY_MANAGED_PRICING_APP_HANDLE`.

New applications add one registry entry and use the same basename-aware configuration pattern. Update that application's Shopify App URL, allowed OAuth callback, webhook destinations and pricing return path after the deployment is verified. A domain or code deployment does not itself update Shopify versions or App Store listings.
