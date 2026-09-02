import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());

const { GENIUSPAY_API_KEY, GENIUSPAY_API_SECRET, PORT = 4000 } = process.env;

if (!GENIUSPAY_API_KEY || !GENIUSPAY_API_SECRET) {
  console.warn("⚠️  GENIUSPAY_API_KEY / GENIUSPAY_API_SECRET manquants dans server/.env");
}

const GENIUSPAY_BASE = "https://pay.genius.ci/api/v1/merchant/payments";

const transactions = new Map();

function geniusHeaders() {
  return {
    "X-API-Key": GENIUSPAY_API_KEY,
    "X-API-Secret": GENIUSPAY_API_SECRET,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// POST /api/payments/initiate
// ---------------------------------------------------------------------------
app.post("/api/payments/initiate", express.json(), async (req, res) => {
  try {
    const { amount, currency, method, reference, customer_name, customer_email, description, return_url } =
      req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Montant invalide." });
    }

    const geniusRes = await fetch(GENIUSPAY_BASE, {
      method: "POST",
      headers: geniusHeaders(),
      body: JSON.stringify({
        amount,
        currency: currency || "EUR",
        payment_method: method, // "card" | "paypal"
        description,
        customer: { name: customer_name, email: customer_email },
        success_url: return_url,
        error_url: return_url,
        metadata: { source: "association-smoke-web", reference },
      }),
    });

    const body = await geniusRes.json();
    console.log("GeniusPay initiate response:", geniusRes.status, body);

    if (!geniusRes.ok || body.success === false) {
      return res.status(geniusRes.status).json(body);
    }

    const tx = body.data;
    transactions.set(tx.reference, { status: tx.status, amount, currency: currency || "EUR", method });

    res.json({
      success: true,
      reference: tx.reference,
      pay_url: tx.payment_url || tx.checkout_url,
      status: tx.status,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Erreur serveur GeniusPay." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/payments/status/:reference
// ---------------------------------------------------------------------------
app.get("/api/payments/status/:reference", async (req, res) => {
  try {
    const { reference } = req.params;

    const geniusRes = await fetch(`${GENIUSPAY_BASE}/${reference}`, {
      headers: geniusHeaders(),
    });

    const body = await geniusRes.json();
    console.log("GeniusPay status response:", geniusRes.status, body);

    if (!geniusRes.ok || body.success === false) {
      return res.status(geniusRes.status).json(body);
    }

    res.json({ success: true, transaction: body.data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Erreur lors de la vérification du statut." });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`✅ Backend GeniusPay démarré sur http://localhost:${PORT}`));