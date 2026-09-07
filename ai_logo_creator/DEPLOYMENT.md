# Shopify on Vercel

> This app now deploys through the existing `shopify-app-store` project at the repository root. Follow [the shared deployment instructions](../README.md). The standalone import steps below are historical and must not be used to create another project. Production credentials are `AI_LOGO_CREATOR_SHOPIFY_API_KEY` and `AI_LOGO_CREATOR_SHOPIFY_API_SECRET`; the entry URL is `https://imagecleaner.zestgpt.com/ai_logo_creator`.

## Architecture

Each app is a Remix/Vercel project. Product identity lives in `app/app-config.js`.
AI predictions and quotas use the existing node_server. Shopify sessions are AES-256-GCM encrypted by the app and stored in node_server's persistent SQLite database, isolated by app key and session ID. Vercel never writes session data to its local filesystem.

Back up the node_server database and retain the app encryption secret. Session encryption derives from SHOPIFY_API_SECRET and app key; changing it invalidates stored sessions and requires reauthorization. Plan credential rotation before changing this secret.

## Deploy an app

1. Set the same nonempty SHOPIFY_INTERNAL_API_KEY on the existing Render service and the new Vercel Production environment before enabling it on node_server. Keep this secret out of Git. Deploy node_server with the `/shopify/:app_key/sessions` routes. Set SHOPIFY_INTERNAL_API_KEY on both services to the same existing value.
2. Create a Vercel project from this repository. Root Directory is the app folder, Framework is Remix, Node.js is 24.x, Install is npm ci and Build is npm run build. Enable Fluid Compute. A commercial Vercel plan is required for the paid production app.
3. Copy `.env.example` into Vercel Environment Variables and supply existing app credentials. SHOPIFY_APP_URL must be the canonical custom domain registered in Shopify. Vercel automatically selects remote session storage; never use local SQLite there.
4. Preview deployments must not use live Shopify credentials or the production app key. Use a separate development Shopify app and backend app config for authenticated preview tests. Keep preview deployment protection enabled.
5. Validate the public login/health route, authentication, subscription, generation, usage deduction and image insertion on a test store. Check webhook HMAC rejection and cancellation tests. Keep production routes reachable by Shopify; inspect deployment protection rather than disabling security on previews.
6. Only after backend and deployment verification, add the existing custom domain in Vercel and update DNS to the exact target Vercel provides. Keep the Render service available for rollback. Keeping the same domain preserves Shopify callback configuration.

Image generation currently polls the existing asynchronous AI service within a bounded request (180-second polling deadline, 15-second HTTP timeouts); the app route has maxDuration 300. It is not a durable background worker. For high throughput, replace this with browser polling and durable reservation/job reconciliation on node_server.

## Template creation

From the repository root:

```sh
node scripts/create-shopify-app.mjs new_app "New App" new-app new-app.example.com YOUR_SHOPIFY_CLIENT_ID
```

The generator excludes credentials, local sessions, build output and provider bindings. It creates a working image-tool starting point, not an automatically registered or approved Shopify listing. Change product UI/prompts, configure independent backend APP_CONFIGS/pricing, and register the new app in Shopify before release.

## Checks

```sh
npm ci
npm test
npm run build
VERCEL=1 npm run build
```

Existing Render deployment remains supported when VERCEL is absent and SHOPIFY_SESSION_STORAGE is not remote. Its local SQLite storage is for compatibility, not the recommended production configuration.

## Dependency compatibility

@vercel/remix 2.16.7 declares exact older Remix peers. Scoped npm overrides keep the adapter on this app’s patched Remix 2.17 runtime instead of downgrading the framework. Validate npm ci as well as both build modes whenever upgrading either package.
