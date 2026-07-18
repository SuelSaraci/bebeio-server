import pool from "../src/config/database.js";

const REVIEWER_EMAIL = (
  process.env.REVIEWER_EMAIL || "reviewer@bebio.test"
).trim().toLowerCase();

const MANUAL_PADDLE_ID = "review_manual";

async function seedReviewerPremium() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT id, email FROM users WHERE LOWER(email) = $1 LIMIT 1`,
      [REVIEWER_EMAIL],
    );

    if (userResult.rows.length === 0) {
      throw new Error(
        `No user found for ${REVIEWER_EMAIL}. Sign up in the app first, then run this script again.`,
      );
    }

    const userId = userResult.rows[0].id;

    await client.query(
      `INSERT INTO subscriptions (user_id, paddle_subscription_id, status, plan_type)
       VALUES ($1, $2, 'active', 'monthly')
       ON CONFLICT (user_id) DO UPDATE SET
         paddle_subscription_id = EXCLUDED.paddle_subscription_id,
         status = 'active',
         plan_type = 'monthly',
         updated_at = CURRENT_TIMESTAMP`,
      [userId, MANUAL_PADDLE_ID],
    );

    await client.query(
      `INSERT INTO user_profiles (user_id, name, has_completed_onboarding)
       VALUES ($1, 'Reviewer', TRUE)
       ON CONFLICT (user_id) DO UPDATE SET
         has_completed_onboarding = TRUE,
         updated_at = CURRENT_TIMESTAMP`,
      [userId],
    );

    const babyResult = await client.query(
      `SELECT id FROM babies WHERE user_id = $1 LIMIT 1`,
      [userId],
    );

    if (babyResult.rows.length === 0) {
      await client.query(
        `INSERT INTO babies (user_id, name, birth_date, gender, birth_weight)
         VALUES ($1, 'Demo Baby', CURRENT_DATE - INTERVAL '3 months', 'girl', 3.2)`,
        [userId],
      );
    }

    await client.query("COMMIT");

    console.log(`Reviewer premium ready for ${REVIEWER_EMAIL} (user_id=${userId}).`);
    console.log("Subscription: active / monthly (Bebio Plus)");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedReviewerPremium().catch((error) => {
  console.error("seed-reviewer-premium failed:", error.message);
  process.exit(1);
});
