import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.use(cors());

const {
  CAMERPAY_API_TOKEN,
  CAMERPAY_CALLBACK_SECRET, // optionnel pour l'instant (pas de webhook en sandbox)
  PUBLIC_BACKEND_URL = "https://example.com", // placeholder tant qu'on n'utilise pas le webhook
  PORT = 4000,
} = process.env;

if (!CAMERPAY_API_TOKEN) {
  console.warn("⚠️  CAMERPAY_API_TOKEN manquant dans server/.env — les appels à CamerPay vont échouer.");
}

const CAMERPAY_BASE = "https://camerpay.biz/api";

// Stockage temporaire en mémoire, uniquement pour la démo/sandbox.
const transactions = new Map();

// ---------------------------------------------------------------------------
// POST /api/payments/initiate — crée une transaction CamerPay et renvoie pay_url
// ---------------------------------------------------------------------------
app.post("/api/payments/initiate", express.json(), async (req, res) => {
  try {
    const { amount, currency, method, reference, customer_name, customer_email, description, return_url } =
      req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Montant invalide." });
    }
    if (!["stripe", "paypal"].includes(method)) {
      return res.status(400).json({ success: false, message: "Moyen de paiement invalide." });
    }

    // CamerPay facture toujours en XAF (Franc CFA), quelle que soit la devise
    // envoyée. Le XAF est indexé à taux fixe sur l'euro : 1 EUR = 655.957 XAF.
    const EUR_TO_XAF = 655.957;
    const amountXaf = Math.round(amount * EUR_TO_XAF);

    const camerpayRes = await fetch(`${CAMERPAY_BASE}/payment/initiate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CAMERPAY_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountXaf,
        currency: "XAF",
        payment_method: method, // "stripe" | "paypal"
        customer_name,
        customer_email,
        merchant_invoice_id: reference,
        // Pas encore utilisé (pas de webhook en sandbox) — champ requis quand même par l'API.
        merchant_callback_url: `${PUBLIC_BACKEND_URL}/api/payments/webhook`,
        merchant_return_url: return_url,
        source: "association-smoke-web",
      }),
    });

    const data = await camerpayRes.json();
    console.log("CamerPay initiate response:", camerpayRes.status, data);

    if (!camerpayRes.ok || data.success === false) {
      return res.status(camerpayRes.status).json(data);
    }

    transactions.set(data.transaction_uuid, {
      status: data.status,
      reference,
      amount,
      currency: currency || "EUR",
      method,
      customer_email,
      description,
      createdAt: new Date().toISOString(),
    });

    res.json(data); // { success, transaction_uuid, status, pay_url, redirect_url }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Erreur serveur CamerPay." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/payments/status/:uuid — vérifie le vrai statut auprès de CamerPay
// (c'est notre méthode principale de confirmation tant qu'il n'y a pas de webhook)
// ---------------------------------------------------------------------------
app.get("/api/payments/status/:uuid", async (req, res) => {
  try {
    const { uuid } = req.params;

    const camerpayRes = await fetch(`${CAMERPAY_BASE}/payment/${uuid}/status`, {
      headers: { Authorization: `Bearer ${CAMERPAY_API_TOKEN}` },
    });

    const data = await camerpayRes.json();
    console.log("CamerPay status response:", camerpayRes.status, data);

    if (!camerpayRes.ok || data.success === false) {
      return res.status(camerpayRes.status).json(data);
    }

    const local = transactions.get(uuid);
    if (local) {
      transactions.set(uuid, { ...local, status: data.transaction.status });
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Erreur lors de la vérification du statut." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/payments/webhook — laissé en place pour plus tard (webhook indisponible en sandbox)
// ---------------------------------------------------------------------------
app.post("/api/payments/webhook", express.urlencoded({ extended: true }), (req, res) => {
  if (!CAMERPAY_CALLBACK_SECRET) {
    console.warn("Webhook reçu mais CAMERPAY_CALLBACK_SECRET non configuré — ignoré.");
    return res.status(200).send("OK (non vérifié)");
  }

  const { uuid, invoice_id, status, amount, signature } = req.body;
  const data = `${uuid}|${invoice_id}|${status}|${amount}`;
  const expected = crypto.createHmac("sha256", CAMERPAY_CALLBACK_SECRET).update(data).digest("hex");

  const sigBuffer = Buffer.from(signature || "");
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return res.status(401).send("Signature invalide");
  }

  const local = transactions.get(uuid) || {};
  transactions.set(uuid, { ...local, status, updatedAt: new Date().toISOString() });
  res.status(200).send("OK");
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`✅ Backend CamerPay démarré sur http://localhost:${PORT}`));