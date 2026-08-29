import crypto from "node:crypto";

export class YunoGateway {
  constructor(env = process.env) {
    this.mode = env.YUNO_MODE || "mock";
    this.baseUrl = env.YUNO_BASE_URL || "https://api-sandbox.y.uno/v1";
    this.privateSecretKey = env.YUNO_PRIVATE_SECRET_KEY || "";
    this.publicApiKey = env.YUNO_PUBLIC_API_KEY || "";
    this.accountId = env.YUNO_ACCOUNT_ID || "";
  }

  async createPayment({ orderId, amount, currency, country, customerId, paymentToken, paymentTokenType = "vaulted", description, metadata = [] }) {
    if (this.mode !== "real") {
      return {
        mode: "mock",
        id: `mock_${crypto.randomUUID()}`,
        status: "SUCCEEDED",
        sub_status: "APPROVED",
        merchant_order_id: orderId,
        amount: { value: Math.round(Number(amount) * 100), currency },
        payment_method: { type: "CARD", vaulted_token: paymentToken || "yuno_mock_vaulted_****4242" },
        processed_at: new Date().toISOString(),
      };
    }

    if (!this.accountId || !this.privateSecretKey || !this.publicApiKey) {
      throw new Error("Yuno está en modo real pero faltan YUNO_ACCOUNT_ID, YUNO_PRIVATE_SECRET_KEY o YUNO_PUBLIC_API_KEY.");
    }

    const paymentMethod = paymentTokenType === "one_time"
      ? {
          type: "CARD",
          token: paymentToken,
          detail: { card: { capture: true, installments: 1 } },
        }
      : {
          type: "CARD",
          vaulted_token: paymentToken,
          detail: { card: { capture: true, installments: 1 } },
        };

    const body = {
      account_id: this.accountId,
      description,
      country,
      merchant_order_id: orderId,
      amount: { currency, value: Math.round(Number(amount) * 100) },
      payment_method: paymentMethod,
      metadata,
      callback_url: process.env.YUNO_CALLBACK_URL || undefined,
      ...(customerId ? { customer_payer: { id: customerId } } : {}),
    };

    const response = await fetch(`${this.baseUrl}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Idempotency-Key": orderId,
        "private-secret-key": this.privateSecretKey,
        "public-api-key": this.publicApiKey,
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.message || payload?.error || `Yuno returned ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }
}
