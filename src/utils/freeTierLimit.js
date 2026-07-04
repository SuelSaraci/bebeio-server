import pool from "../config/database.js";
import { getUserPremiumAccess } from "./subscriptionAccess.js";

export const FREE_TIER_LIMIT = 3;

const COUNT_QUERIES = {
  feeding_entries: `SELECT COUNT(*)::int AS count FROM feeding_entries WHERE user_id = $1`,
  sleep_entries: `SELECT COUNT(*)::int AS count FROM sleep_entries WHERE user_id = $1`,
  diaper_entries: `SELECT COUNT(*)::int AS count FROM diaper_entries WHERE user_id = $1`,
  growth_entries: `SELECT COUNT(*)::int AS count FROM growth_entries WHERE user_id = $1`,
  milestones: `SELECT COUNT(*)::int AS count FROM milestones WHERE user_id = $1`,
  vaccinations: `SELECT COUNT(*)::int AS count FROM vaccinations WHERE user_id = $1`,
  appointments: `SELECT COUNT(*)::int AS count FROM appointments WHERE user_id = $1`,
  medical_notes: `SELECT COUNT(*)::int AS count FROM medical_notes WHERE user_id = $1`,
};

export function sendFreeLimitReached(res) {
  return res.status(403).json({
    error: "Free tier limit reached. Upgrade to Bebio Plus for unlimited access.",
    code: "FREE_LIMIT_REACHED",
  });
}

async function getResourceCount(client, userId, resource) {
  const query = COUNT_QUERIES[resource];
  if (!query) {
    throw new Error(`Unknown free-tier resource: ${resource}`);
  }
  const result = await client.query(query, [userId]);
  return Number(result.rows[0]?.count ?? 0);
}

export async function userHasPremium(client, userId) {
  const access = await getUserPremiumAccess(client, userId);
  return Boolean(access.hasPremium);
}

/** Block create when a free user already has FREE_TIER_LIMIT items. */
export async function assertCanCreateResource(client, userId, resource) {
  if (await userHasPremium(client, userId)) return;
  const count = await getResourceCount(client, userId, resource);
  if (count >= FREE_TIER_LIMIT) {
    const error = new Error("FREE_LIMIT_REACHED");
    error.code = "FREE_LIMIT_REACHED";
    throw error;
  }
}

/** Block bulk replace when it would grow a free user's list past the limit. */
export async function assertCanGrowBulkList(
  client,
  userId,
  resource,
  nextCount,
) {
  if (await userHasPremium(client, userId)) return;
  const currentCount = await getResourceCount(client, userId, resource);
  if (nextCount <= currentCount) return;
  if (nextCount > FREE_TIER_LIMIT) {
    const error = new Error("FREE_LIMIT_REACHED");
    error.code = "FREE_LIMIT_REACHED";
    throw error;
  }
}

export async function getAiMessagesUsed(client, userId) {
  const result = await client.query(
    `SELECT COALESCE(ai_messages_used, 0)::int AS count
     FROM user_profiles WHERE user_id = $1`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function assertCanSendAiMessage(client, userId) {
  if (await userHasPremium(client, userId)) return;
  const used = await getAiMessagesUsed(client, userId);
  if (used >= FREE_TIER_LIMIT) {
    const error = new Error("FREE_LIMIT_REACHED");
    error.code = "FREE_LIMIT_REACHED";
    throw error;
  }
}

export async function incrementAiMessagesUsed(client, userId) {
  await client.query(
    `UPDATE user_profiles
     SET ai_messages_used = COALESCE(ai_messages_used, 0) + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1`,
    [userId],
  );
}

export function freeTierLimit(resource) {
  return async (req, res, next) => {
    const client = await pool.connect();
    try {
      await assertCanCreateResource(client, req.user.id, resource);
      next();
    } catch (error) {
      if (error.code === "FREE_LIMIT_REACHED") {
        return sendFreeLimitReached(res);
      }
      console.error("[freeTierLimit] Error:", error);
      return res.status(500).json({ error: "Failed to verify subscription limit" });
    } finally {
      client.release();
    }
  };
}

export function handleFreeLimitError(error, res) {
  if (error?.code === "FREE_LIMIT_REACHED") {
    return sendFreeLimitReached(res);
  }
  return null;
}
