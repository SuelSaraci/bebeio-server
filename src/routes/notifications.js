import { Router } from "express";
import pool from "../config/database.js";
import { verifyFirebaseToken } from "../middleware/auth.js";

const router = Router();
router.use(verifyFirebaseToken);

router.get("/preferences", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT notifications_enabled, feeding_reminders, evening_check_in, health_reminders
       FROM user_profiles WHERE user_id = $1`,
      [req.user.id],
    );
    const row = result.rows[0];
    return res.json({
      preferences: {
        enabled: row?.notifications_enabled ?? true,
        feedingReminders: row?.feeding_reminders ?? true,
        eveningCheckIn: row?.evening_check_in ?? true,
        healthReminders: row?.health_reminders ?? true,
      },
    });
  } catch (error) {
    console.error("[GET /api/notifications/preferences] Error:", error);
    return res.status(500).json({ error: "Failed to load notification preferences" });
  }
});

router.put("/preferences", async (req, res) => {
  try {
    const data = req.body || {};
    await pool.query(
      `UPDATE user_profiles
       SET notifications_enabled = COALESCE($2, notifications_enabled),
           feeding_reminders = COALESCE($3, feeding_reminders),
           evening_check_in = COALESCE($4, evening_check_in),
           health_reminders = COALESCE($5, health_reminders),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [
        req.user.id,
        typeof data.enabled === "boolean" ? data.enabled : null,
        typeof data.feedingReminders === "boolean" ? data.feedingReminders : null,
        typeof data.eveningCheckIn === "boolean" ? data.eveningCheckIn : null,
        typeof data.healthReminders === "boolean" ? data.healthReminders : null,
      ],
    );
    return res.json({ success: true });
  } catch (error) {
    console.error("[PUT /api/notifications/preferences] Error:", error);
    return res.status(500).json({ error: "Failed to update notification preferences" });
  }
});

router.post("/token", async (req, res) => {
  try {
    const { token, platform } = req.body || {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Push token is required" });
    }
    const normalizedPlatform = platform === "ios" ? "ios" : "android";

    await pool.query(
      `INSERT INTO push_tokens (user_id, token, platform, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (token)
       DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, token.trim(), normalizedPlatform],
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("[POST /api/notifications/token] Error:", error);
    return res.status(500).json({ error: "Failed to save push token" });
  }
});

router.delete("/token", async (req, res) => {
  try {
    await pool.query(`DELETE FROM push_tokens WHERE user_id = $1`, [req.user.id]);
    return res.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/notifications/token] Error:", error);
    return res.status(500).json({ error: "Failed to remove push token" });
  }
});

export default router;
