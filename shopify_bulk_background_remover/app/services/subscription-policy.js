const PLAN_LIMITS = { Free: 0, Starter: 100, Pro: 500, Business: 2000 };

export function normalizePlanKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function planFromSubscription(subscription) {
  const normalizedName = normalizePlanKey(subscription?.name);
  const paidPlans = Object.keys(PLAN_LIMITS).filter((planName) => planName !== "Free");
  const byName = paidPlans.find((planName) =>
    normalizePlanKey(planName) === normalizedName || normalizedName.includes(normalizePlanKey(planName)),
  );
  if (byName) return byName;

  const amount = Number(subscription?.lineItems?.[0]?.plan?.pricingDetails?.price?.amount);
  if (Math.abs(amount - 9.99) < 0.01) return "Starter";
  if (Math.abs(amount - 29.99) < 0.01) return "Pro";
  if (Math.abs(amount - 79.99) < 0.01) return "Business";

  return null;
}

export function selectActiveSubscription(subscriptions, allowTest = false) {
  return subscriptions.find((sub) => sub.status === 'ACTIVE' &&
    (allowTest || !sub.test) && planFromSubscription(sub)) || null;
}
