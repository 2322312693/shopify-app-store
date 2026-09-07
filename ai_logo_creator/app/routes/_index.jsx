import { redirect } from "@remix-run/node";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (!url.searchParams.get("shop") && !url.searchParams.get("host")) {
    return redirect(`${import.meta.env.BASE_URL}auth/login`);
  }
  return redirect(`${import.meta.env.BASE_URL}app${url.search}`);
};
