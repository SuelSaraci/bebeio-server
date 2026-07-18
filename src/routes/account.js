import { Router } from "express";
import admin from "../config/firebase.js";
import pool from "../config/database.js";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { Paddle, Environment } from "@paddle/paddle-node-sdk";

const router = Router();

const getPaddleClient = () => {
  if (!process.env.PADDLE_API_KEY) return null;
  const environment =
    process.env.PADDLE_ENVIRONMENT === "production"
      ? Environment.production
      : Environment.sandbox;
  return new Paddle(process.env.PADDLE_API_KEY, { environment });
};

async function cancelActiveSubscription(client, userId) {
  const subscriptionResult = await client.query(
    `SELECT paddle_subscription_id, status
     FROM subscriptions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );

  if (subscriptionResult.rows.length === 0) return;

  const subscription = subscriptionResult.rows[0];
  const status = String(subscription.status || "").trim().toLowerCase();
  const activeLikeStatuses = ["active", "trialing", "past_due", "paused"];

  if (!activeLikeStatuses.includes(status)) return;

  const paddleSubscriptionId = subscription.paddle_subscription_id;
  if (paddleSubscriptionId) {
    const paddle = getPaddleClient();
    if (paddle) {
      try {
        await paddle.subscriptions.cancel(paddleSubscriptionId, {
          effectiveFrom: "next_billing_period",
        });
      } catch (error) {
        console.warn("Could not cancel Paddle subscription during account deletion:", error);
      }
    }
  }

  await client.query(
    `UPDATE subscriptions
     SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $2`,
    ["canceled", userId],
  );
}

router.delete("/", verifyFirebaseToken, async (req, res) => {
  const { id: userId, firebase_uid: firebaseUid } = req.user;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await cancelActiveSubscription(client, userId);

    await client.query("DELETE FROM push_tokens WHERE user_id = $1", [userId]);

    const deleteResult = await client.query(
      "DELETE FROM users WHERE id = $1 RETURNING id",
      [userId],
    );

    if (deleteResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting account data:", error);
    return res.status(500).json({ error: "Failed to delete account data" });
  } finally {
    client.release();
  }

  try {
    await admin.auth().deleteUser(firebaseUid);
  } catch (error) {
    console.error("Error deleting Firebase user after DB cleanup:", error);
    return res.status(500).json({
      error: "Account data was removed but sign-in could not be fully revoked. Please contact support.",
    });
  }

  return res.status(204).send();
});

export default router;
