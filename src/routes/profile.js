import { Router } from "express";
import pool from "../config/database.js";
import { verifyFirebaseToken } from "../middleware/auth.js";

const router = Router();
router.use(verifyFirebaseToken);

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT name, has_completed_onboarding
       FROM user_profiles WHERE user_id = $1`,
      [req.user.id],
    );

    const profile = result.rows[0];
    if (!profile) {
      return res.json({ profile: null });
    }

    return res.json({ profile });
  } catch (error) {
    console.error("[GET /api/profile] Error:", error);
    return res.status(500).json({ error: "Failed to load profile" });
  }
});

router.put("/", async (req, res) => {
  try {
    const data = req.body || {};
    const forceOnboardingReset = data.force_onboarding_reset === true;

    const existingProfile = await pool.query(
      `SELECT has_completed_onboarding FROM user_profiles WHERE user_id = $1`,
      [req.user.id],
    );

    const existingHasCompletedOnboarding = Boolean(
      existingProfile.rows[0]?.has_completed_onboarding,
    );
    const requestedHasCompletedOnboarding =
      typeof data.has_completed_onboarding === "boolean"
        ? data.has_completed_onboarding
        : undefined;
    const nextHasCompletedOnboarding = forceOnboardingReset
      ? false
      : requestedHasCompletedOnboarding === true || existingHasCompletedOnboarding;

    await pool.query(
      `UPDATE user_profiles
       SET name = $2,
           has_completed_onboarding = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [req.user.id, data.name ?? "", nextHasCompletedOnboarding],
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("[PUT /api/profile] Error:", error);
    return res.status(500).json({
      error: "Failed to update profile",
      details:
        process.env.NODE_ENV === "production" ? undefined : String(error.message),
    });
  }
});

export default router;
