import crypto from "crypto";
import { Paddle, Environment } from "@paddle/paddle-node-sdk";
import pool from "../config/database.js";
import {
  getUserPremiumAccess,
} from "../utils/subscriptionAccess.js";

const getPaddleClient = () => {
  if (!process.env.PADDLE_API_KEY) {
    console.error("Missing PADDLE_API_KEY environment variable");
    return null;
  }

  const environment =
    process.env.PADDLE_ENVIRONMENT === "production"
      ? Environment.production
      : Environment.sandbox;

  return new Paddle(process.env.PADDLE_API_KEY, { environment });
};

const normalize = (value) => String(value || "").trim().toLowerCase();

const verifyPaddleSignature = (rawBody, signatureHeader) => {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;

  if (process.env.DISABLE_PADDLE_WEBHOOK_VERIFICATION === "true") {
    console.warn(
      "DISABLE_PADDLE_WEBHOOK_VERIFICATION is true - skipping Paddle signature verification",
    );
    return true;
  }

  if (!secret) {
    console.warn("Paddle webhook secret not configured - skipping verification");
    return true;
  }

  if (!signatureHeader) {
    console.error("Missing Paddle-Signature header");
    return false;
  }

  try {
    const parts = signatureHeader.split(";");
    const tsMatch = parts[0]?.match(/ts=(\d+)/);
    const h1Match = parts[1]?.match(/h1=([a-f0-9]+)/);

    if (!tsMatch || !h1Match) return false;

    const timestamp = tsMatch[1];
    const signature = h1Match[1];
    const signedPayload = `${timestamp}:${rawBody}`;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex"),
    );

    if (!isValid) return false;

    const currentTime = Math.floor(Date.now() / 1000);
    return currentTime - parseInt(timestamp, 10) <= 300;
  } catch (error) {
    console.error("Error verifying Paddle signature:", error);
    return false;
  }
};

function resolvePriceId(plan) {
  const normalized = normalize(plan);
  if (normalized === "yearly") {
    return process.env.PADDLE_PRICE_ID_YEARLY;
  }
  return process.env.PADDLE_PRICE_ID_MONTHLY;
}

async function resolveUserIdFromEventData(client, eventData) {
  const customData = eventData.custom_data || eventData.customData || {};
  let userId = customData.userId ?? customData.user_id;
  const firebaseUid = customData.firebaseUid ?? customData.firebase_uid;
  const planType =
    customData.planType ?? customData.plan_type ?? customData.plan;

  if (userId) {
    return { userId: String(userId), planType: normalize(planType) || "monthly" };
  }

  if (firebaseUid) {
    const userResult = await client.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid],
    );
    if (userResult.rows.length > 0) {
      return {
        userId: String(userResult.rows[0].id),
        planType: normalize(planType) || "monthly",
      };
    }
  }

  const customerEmail =
    eventData.customer_email ||
    eventData.customerEmail ||
    eventData.email ||
    eventData.customer?.email;

  if (customerEmail) {
    const byEmailResult = await client.query(
      "SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [customerEmail],
    );
    if (byEmailResult.rows.length > 0) {
      return {
        userId: String(byEmailResult.rows[0].id),
        planType: normalize(planType) || "monthly",
      };
    }
  }

  const lookupId = eventData.id || eventData.subscription_id;
  if (lookupId) {
    const byPaddleId = await client.query(
      "SELECT user_id, plan_type FROM subscriptions WHERE paddle_subscription_id = $1 LIMIT 1",
      [lookupId],
    );
    if (byPaddleId.rows.length > 0) {
      return {
        userId: String(byPaddleId.rows[0].user_id),
        planType: normalize(byPaddleId.rows[0].plan_type) || "monthly",
      };
    }
  }

  return null;
}

async function upsertSubscription(client, userId, { paddleId, status, planType }) {
  const existing = await client.query(
    "SELECT id FROM subscriptions WHERE user_id = $1",
    [userId],
  );

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE subscriptions
       SET paddle_subscription_id = $1,
           status = $2,
           plan_type = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $4`,
      [paddleId, status, planType, userId],
    );
  } else {
    await client.query(
      `INSERT INTO subscriptions (user_id, paddle_subscription_id, status, plan_type)
       VALUES ($1, $2, $3, $4)`,
      [userId, paddleId, status, planType],
    );
  }
}

function resolveCheckoutPageUrl() {
  const base = (
    process.env.WEB_CHECKOUT_URL ||
    process.env.WEB_URL ||
    "http://localhost:5173"
  ).replace(/\/$/, "");
  return `${base}/upgrade`;
}

function buildTransactionPayload({ priceId, userId, firebaseUid, plan, userEmail }) {
  const payload = {
    items: [{ priceId, quantity: 1 }],
    customData: {
      userId: String(userId),
      firebaseUid,
      planType: plan,
    },
    customerEmail: userEmail,
  };

  const checkoutUrl = process.env.WEB_CHECKOUT_URL?.trim();
  if (!checkoutUrl) {
    return payload;
  }

  try {
    const hostname = new URL(checkoutUrl).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return payload;
    }
  } catch {
    return payload;
  }

  return {
    ...payload,
    checkout: { url: resolveCheckoutPageUrl() },
  };
}

function resolveTransactionCheckoutUrl(transaction) {
  return (
    transaction?.checkout?.url ||
    transaction?.checkoutUrl ||
    (transaction?.id
      ? `https://checkout.paddle.com/checkout/${transaction.id}`
      : null)
  );
}

export const createCheckoutSession = async (req, res) => {
  let client;
  try {
    const paddle = getPaddleClient();
    if (!paddle) {
      return res.status(500).json({ error: "Paddle not configured" });
    }

    const plan = normalize(req.body?.plan) === "yearly" ? "yearly" : "monthly";
    const priceId = resolvePriceId(plan);
    if (!priceId) {
      return res.status(500).json({
        error: `Paddle price ID not configured for ${plan} plan`,
      });
    }

    client = await pool.connect();
    const userResult = await client.query(
      "SELECT id, email FROM users WHERE firebase_uid = $1",
      [req.user.firebase_uid],
    );

    if (userResult.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;
    const userEmail =
      req.body?.email || userResult.rows[0].email || req.user.email;

    if (!userEmail) {
      client.release();
      return res.status(400).json({ error: "User email not found" });
    }

    const { hasPremium } = await getUserPremiumAccess(client, userId);
    if (hasPremium) {
      client.release();
      return res.status(400).json({
        error: "Already subscribed",
        message: "You already have an active Bebio Plus subscription.",
      });
    }

    const transaction = await paddle.transactions.create(
      buildTransactionPayload({
        priceId,
        userId,
        firebaseUid: req.user.firebase_uid,
        plan,
        userEmail,
      }),
    );

    if (!transaction?.id) {
      client.release();
      return res.status(500).json({ error: "Failed to create checkout session" });
    }

    await upsertSubscription(client, userId, {
      paddleId: transaction.id,
      status: "pending",
      planType: plan,
    });

    client.release();

    const checkoutUrl = resolveTransactionCheckoutUrl(transaction);
    if (!checkoutUrl) {
      return res.status(500).json({
        error: "Paddle checkout URL not available",
        message:
          "Set a default payment link in Paddle (Checkout → Checkout settings) and ensure WEB_CHECKOUT_URL points to your /upgrade page.",
      });
    }

    return res.json({
      success: true,
      checkout_url: checkoutUrl,
      transaction_id: transaction.id,
      plan,
    });
  } catch (error) {
    if (client) client.release();
    console.error("Error creating Paddle checkout:", error);

    const paddleCode = error?.code;
    if (paddleCode === "transaction_checkout_url_domain_is_not_approved") {
      return res.status(400).json({
        error: "Checkout domain not approved in Paddle",
        message:
          "Set Paddle → Checkout → Default payment link to https://bebeio-web-production.up.railway.app/upgrade, or set WEB_CHECKOUT_URL on the API to that exact origin.",
        code: paddleCode,
      });
    }

    return res.status(500).json({
      error: "Failed to create checkout session",
      details:
        process.env.NODE_ENV !== "production" ? error?.message : undefined,
      code: process.env.NODE_ENV !== "production" ? paddleCode : undefined,
    });
  }
};

export const getSubscriptionStatus = async (req, res) => {
  try {
    const client = await pool.connect();
    const userResult = await client.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [req.user.firebase_uid],
    );

    if (userResult.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;
    const access = await getUserPremiumAccess(client, userId);

    const subscriptionResult = await client.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    client.release();

    if (subscriptionResult.rows.length === 0) {
      return res.json({
        success: true,
        subscription: {
          status: "inactive",
          plan_type: "free",
          hasPremium: false,
        },
      });
    }

    const subscription = subscriptionResult.rows[0];
    return res.json({
      success: true,
      subscription: {
        ...subscription,
        hasPremium: access.hasPremium,
      },
    });
  } catch (error) {
    console.error("Error getting subscription status:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getPaddleConfig = async (_req, res) => {
  return res.json({
    success: true,
    config: {
      hasApiKey: !!process.env.PADDLE_API_KEY,
      environment: process.env.PADDLE_ENVIRONMENT || "sandbox",
      hasMonthlyPrice: !!process.env.PADDLE_PRICE_ID_MONTHLY,
      hasYearlyPrice: !!process.env.PADDLE_PRICE_ID_YEARLY,
      hasWebhookSecret: !!process.env.PADDLE_WEBHOOK_SECRET,
    },
  });
};

export const handleWebhook = async (req, res) => {
  try {
    const signatureHeader = req.headers["paddle-signature"];
    const rawBody =
      req.body instanceof Buffer
        ? req.body
        : Buffer.from(
            typeof req.body === "string"
              ? req.body
              : JSON.stringify(req.body || {}),
          );

    if (!verifyPaddleSignature(rawBody.toString("utf8"), signatureHeader)) {
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    let body;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Invalid JSON in webhook body" });
    }

    const eventType = body.event_type;
    const eventData = body.data || {};
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      if (
        eventType === "subscription.activated" ||
        eventType === "subscription.updated" ||
        eventType === "subscription.resumed"
      ) {
        const resolved = await resolveUserIdFromEventData(client, eventData);
        if (resolved) {
          const status = normalize(eventData.status) || "active";
          await upsertSubscription(client, resolved.userId, {
            paddleId: eventData.id,
            status,
            planType: resolved.planType,
          });
        }
      }

      if (
        eventType === "subscription.canceled" ||
        eventType === "subscription.paused" ||
        eventType === "subscription.past_due"
      ) {
        const resolved = await resolveUserIdFromEventData(client, eventData);
        if (resolved) {
          await upsertSubscription(client, resolved.userId, {
            paddleId: eventData.id,
            status: normalize(eventData.status) || "canceled",
            planType: resolved.planType,
          });
        }
      }

      if (
        eventType === "transaction.completed" ||
        eventType === "transaction.paid" ||
        (eventType === "transaction.updated" &&
          ["completed", "paid"].includes(normalize(eventData.status)))
      ) {
        const resolved = await resolveUserIdFromEventData(client, eventData);
        const subscriptionId = eventData.subscription_id || eventData.subscriptionId;

        if (resolved) {
          const status = subscriptionId ? "active" : "active";
          const paddleId = subscriptionId || eventData.id;
          await upsertSubscription(client, resolved.userId, {
            paddleId,
            status,
            planType: resolved.planType,
          });
        }
      }

      await client.query("COMMIT");
      client.release();
      return res.status(200).json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      client.release();
      throw error;
    }
  } catch (error) {
    console.error("Error handling Paddle webhook:", error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
};
