import { Paddle, Environment } from "@paddle/paddle-node-sdk";

const PREMIUM_PLANS = new Set(["monthly", "yearly", "plus", "lifetime"]);
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

const getPaddleClient = () => {
  if (!process.env.PADDLE_API_KEY) return null;

  const environment =
    process.env.PADDLE_ENVIRONMENT === "production"
      ? Environment.production
      : Environment.sandbox;

  return new Paddle(process.env.PADDLE_API_KEY, { environment });
};

const normalize = (value) => String(value || "").trim().toLowerCase();

export function isPremiumSubscription(status, planType) {
  return (
    ACTIVE_STATUSES.has(normalize(status)) &&
    PREMIUM_PLANS.has(normalize(planType))
  );
}

export async function getUserPremiumAccess(client, userId) {
  const activeResult = await client.query(
    `SELECT plan_type, status, paddle_subscription_id
     FROM subscriptions
     WHERE user_id = $1
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [userId],
  );

  if (activeResult.rows.length === 0) {
    return { hasPremium: false, planType: "free", status: "inactive" };
  }

  const row = activeResult.rows[0];
  const status = normalize(row.status);
  const planType = normalize(row.plan_type);

  if (isPremiumSubscription(status, planType)) {
    return { hasPremium: true, planType, status };
  }

  const paddleId = row.paddle_subscription_id;
  if (
    status === "pending" &&
    paddleId &&
    (paddleId.startsWith("txn_") || paddleId.startsWith("sub_"))
  ) {
    const paddle = getPaddleClient();
    if (!paddle) {
      return { hasPremium: false, planType, status };
    }

    try {
      if (paddleId.startsWith("txn_")) {
        const transaction = await paddle.transactions.get(paddleId);
        const txStatus = normalize(transaction?.status);
        const subscriptionId = transaction?.subscriptionId;

        if (
          (txStatus === "completed" || txStatus === "paid") &&
          subscriptionId
        ) {
          const subscription = await paddle.subscriptions.get(subscriptionId);
          const subStatus = normalize(subscription?.status);
          const resolvedPlan = normalize(
            transaction?.customData?.planType ||
              transaction?.customData?.plan_type ||
              planType,
          );

          if (isPremiumSubscription(subStatus, resolvedPlan)) {
            await client.query(
              `UPDATE subscriptions
               SET paddle_subscription_id = $1,
                   status = $2,
                   plan_type = $3,
                   updated_at = CURRENT_TIMESTAMP
               WHERE user_id = $4`,
              [subscriptionId, subStatus, resolvedPlan, userId],
            );
            return {
              hasPremium: true,
              planType: resolvedPlan,
              status: subStatus,
            };
          }
        }
      } else if (paddleId.startsWith("sub_")) {
        const subscription = await paddle.subscriptions.get(paddleId);
        const subStatus = normalize(subscription?.status);
        if (isPremiumSubscription(subStatus, planType)) {
          await client.query(
            `UPDATE subscriptions
             SET status = $1, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $2`,
            [subStatus, userId],
          );
          return { hasPremium: true, planType, status: subStatus };
        }
      }
    } catch (error) {
      console.warn(
        `[subscription] Could not reconcile pending subscription for user ${userId}:`,
        error?.message || error,
      );
    }
  }

  return { hasPremium: false, planType, status };
}
