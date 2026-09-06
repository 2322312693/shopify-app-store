import { APP_CONFIG } from "../app-config";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { login, sessionStorage } from "../shopify.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const reset = url.searchParams.get("reset");

  if (shop && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop.trim())) {
    if (reset === "1") {
      await sessionStorage.deleteSession(`offline_${shop.trim()}`);
    }
    return login(request);
  }

  return json({
    appName: APP_CONFIG.name,
  });
};

export default function Login() {
  const { appName } = useLoaderData();

  return (
    <main style={{ fontFamily: "Inter, system-ui, sans-serif", margin: "64px auto", maxWidth: 460, padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>{appName}</h1>
      <p style={{ color: "#5f6368", lineHeight: 1.5, marginBottom: 24 }}>
        Install or open this app from the Shopify App Store or your Shopify admin Apps page.
      </p>
      <a
        href="https://apps.shopify.com/"
        style={{
          background: "#202223",
          borderRadius: 6,
          color: "white",
          display: "inline-block",
          fontSize: 15,
          fontWeight: 600,
          padding: "10px 14px",
          textDecoration: "none",
        }}
      >
        Open Shopify App Store
      </a>
    </main>
  );
}
