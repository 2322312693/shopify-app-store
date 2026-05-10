import { json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login } from "../shopify.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    return login(request);
  }

  const errors = await login(request);
  return json({ errors });
};

export default function Login() {
  const { errors } = useLoaderData();

  return (
    <main style={{ fontFamily: "Inter, system-ui, sans-serif", margin: "64px auto", maxWidth: 420, padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Product Image Cleaner AI</h1>
      <p style={{ color: "#5f6368", lineHeight: 1.5, marginBottom: 24 }}>
        Enter your Shopify store domain to install or open the app.
      </p>
      <Form method="get">
        <label htmlFor="shop" style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>
          Shopify store
        </label>
        <input
          id="shop"
          name="shop"
          placeholder="your-store.myshopify.com"
          style={{
            border: "1px solid #c9cccf",
            borderRadius: 6,
            boxSizing: "border-box",
            fontSize: 16,
            marginBottom: 16,
            padding: "10px 12px",
            width: "100%",
          }}
        />
        {errors?.shop ? (
          <p style={{ color: "#b42318", marginTop: 0 }}>Enter a valid myshopify.com store domain.</p>
        ) : null}
        <button
          type="submit"
          style={{
            background: "#202223",
            border: 0,
            borderRadius: 6,
            color: "white",
            cursor: "pointer",
            fontSize: 15,
            fontWeight: 600,
            padding: "10px 14px",
          }}
        >
          Continue
        </button>
      </Form>
    </main>
  );
}
