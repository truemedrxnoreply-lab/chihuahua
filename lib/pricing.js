// Règles tarifaires CÔTÉ SERVEUR — source de vérité pour le paiement.
// Doit rester IDENTIQUE à src/config/reservation.js et src/config/delivery.js du frontend.
// Tous les montants sont en cents USD.

export const CURRENCY = "usd";
export const PRICE_LIMITS_CENTS = { min: 55000, max: 360000 };

export const DEPOSIT_TIERS = [
  { maxCents: 70000, percent: 50 },
  { maxCents: 90000, percent: 40 },
  { maxCents: 120000, percent: 30 },
  { maxCents: 180000, percent: 20 },
  { maxCents: 360000, percent: 10 },
];

export const DELIVERY_FEES_CENTS = {
  sameState: 10000,
  otherState: 2000,
  canada: 30000,
  restOfWorld: 30000,
};

export const HANDOVER = { DELIVERY: "delivery", MEETUP: "meetup" };

export const US_STATE_CODES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ")
);

export function computeDeposit(priceCents) {
  if (!Number.isInteger(priceCents)) return { ok: false, code: "PRICE_INVALID" };
  if (priceCents < PRICE_LIMITS_CENTS.min || priceCents > PRICE_LIMITS_CENTS.max) {
    return { ok: false, code: "PRICE_OUT_OF_RANGE" };
  }
  const tier = DEPOSIT_TIERS.find((t) => priceCents <= t.maxCents);
  if (!tier) return { ok: false, code: "TIER_NOT_CONFIGURED" };
  return { ok: true, depositCents: Math.round((priceCents * tier.percent) / 100) };
}

export function computeDeliveryFee({ handover, puppyStateCode, destination }) {
  if (handover === HANDOVER.MEETUP) return { ok: true, feeCents: 0 };
  if (handover !== HANDOVER.DELIVERY) return { ok: false, code: "HANDOVER_REQUIRED" };
  const d = destination || {};
  if (d.country === "US") {
    if (!US_STATE_CODES.has(d.state)) return { ok: false, code: "DESTINATION_INVALID" };
    return {
      ok: true,
      feeCents: d.state === puppyStateCode ? DELIVERY_FEES_CENTS.sameState : DELIVERY_FEES_CENTS.otherState,
    };
  }
  if (d.country === "CA") return { ok: true, feeCents: DELIVERY_FEES_CENTS.canada };
  if (d.country === "OTHER") {
    if (!String(d.countryName || "").trim()) return { ok: false, code: "DESTINATION_INVALID" };
    return { ok: true, feeCents: DELIVERY_FEES_CENTS.restOfWorld };
  }
  return { ok: false, code: "DESTINATION_REQUIRED" };
}

export function quoteReservation({ priceCents, puppyStateCode, handover, destination }) {
  const deposit = computeDeposit(priceCents);
  if (!deposit.ok) return deposit;
  const delivery = computeDeliveryFee({ handover, puppyStateCode, destination });
  if (!delivery.ok) return delivery;
  return {
    ok: true,
    priceCents,
    depositCents: deposit.depositCents,
    deliveryFeeCents: delivery.feeCents,
    totalDueCents: deposit.depositCents + delivery.feeCents,
  };
}