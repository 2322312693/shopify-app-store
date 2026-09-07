import { redirect } from "@remix-run/node";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (!url.searchParams.get("shop") && !url.searchParams.get("host")) {
    return redirect("/auth/login");
  }
  return redirect(`/app${url.search}`);
};
