import { Router } from "express";
import pool from "../config/database.js";
import { verifyFirebaseToken } from "../middleware/auth.js";

const router = Router();
router.use(verifyFirebaseToken);

const formatBaby = (row) => {
  if (!row) return null;
  return {
    id: String(row.id),
    name: row.name,
    birthDate: row.birth_date,
    gender: row.gender,
    birthWeight: Number(row.birth_weight),
  };
};

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, birth_date, gender, birth_weight
       FROM babies WHERE user_id = $1`,
      [req.user.id],
    );
    return res.json({ baby: formatBaby(result.rows[0]) });
  } catch (error) {
    console.error("[GET /api/baby] Error:", error);
    return res.status(500).json({ error: "Failed to load baby profile" });
  }
});

router.put("/", async (req, res) => {
  try {
    const data = req.body || {};
    const name = String(data.name || "").trim();
    const gender = data.gender;
    const birthDate = data.birthDate || data.birth_date;
    const birthWeight = Number(data.birthWeight ?? data.birth_weight);

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }
    if (!["girl", "boy"].includes(gender)) {
      return res.status(400).json({ error: "gender must be girl or boy" });
    }
    if (!birthDate) {
      return res.status(400).json({ error: "birthDate is required" });
    }
    if (!birthWeight || birthWeight < 0.5 || birthWeight > 6) {
      return res.status(400).json({ error: "birthWeight must be between 0.5 and 6 kg" });
    }

    const result = await pool.query(
      `INSERT INTO babies (user_id, name, birth_date, gender, birth_weight)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         name = EXCLUDED.name,
         birth_date = EXCLUDED.birth_date,
         gender = EXCLUDED.gender,
         birth_weight = EXCLUDED.birth_weight,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, name, birth_date, gender, birth_weight`,
      [req.user.id, name, birthDate, gender, birthWeight],
    );

    await pool.query(
      `UPDATE user_profiles
       SET has_completed_onboarding = TRUE, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [req.user.id],
    );

    return res.json({ baby: formatBaby(result.rows[0]) });
  } catch (error) {
    console.error("[PUT /api/baby] Error:", error);
    return res.status(500).json({
      error: "Failed to save baby profile",
      details:
        process.env.NODE_ENV === "production" ? undefined : String(error.message),
    });
  }
});

export default router;
