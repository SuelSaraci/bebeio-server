import { Router } from "express";
import pool from "../config/database.js";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { freeTierLimit } from "../utils/freeTierLimit.js";
import { formatDateOnly } from "../utils/formatDate.js";

const router = Router();
router.use(verifyFirebaseToken);

const formatMilestone = (row) => ({
  id: String(row.id),
  title: row.title,
  expectedWeeks: row.expected_weeks,
  done: row.done,
  achievedDate: formatDateOnly(row.achieved_date),
});

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, expected_weeks, done, achieved_date
       FROM milestones WHERE user_id = $1 ORDER BY id ASC`,
      [req.user.id],
    );
    return res.json({ milestones: result.rows.map(formatMilestone) });
  } catch {
    return res.status(500).json({ error: "Failed to load milestones" });
  }
});

router.post("/", freeTierLimit("milestones"), async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.title?.trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    const result = await pool.query(
      `INSERT INTO milestones (user_id, title, expected_weeks, done, achieved_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, expected_weeks, done, achieved_date`,
      [
        req.user.id,
        data.title.trim(),
        data.expectedWeeks || data.expected_weeks || "—",
        Boolean(data.done),
        data.achievedDate || data.achieved_date || null,
      ],
    );
    return res.status(201).json({ milestone: formatMilestone(result.rows[0]) });
  } catch {
    return res.status(500).json({ error: "Failed to create milestone" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const data = req.body || {};
    const done = data.done;
    const achievedDate =
      done === false
        ? null
        : data.achievedDate || data.achieved_date || null;

    const result = await pool.query(
      `UPDATE milestones
       SET done = COALESCE($3, done),
           achieved_date = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING id, title, expected_weeks, done, achieved_date`,
      [req.params.id, req.user.id, done, achievedDate],
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Milestone not found" });
    }
    return res.json({ milestone: formatMilestone(result.rows[0]) });
  } catch {
    return res.status(500).json({ error: "Failed to update milestone" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM milestones WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Milestone not found" });
    }
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to delete milestone" });
  }
});

router.post("/bulk", async (req, res) => {
  try {
    const items = Array.isArray(req.body?.milestones) ? req.body.milestones : [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM milestones WHERE user_id = $1`, [req.user.id]);
      for (const item of items) {
        await client.query(
          `INSERT INTO milestones (user_id, title, expected_weeks, done, achieved_date)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            req.user.id,
            item.title,
            item.expectedWeeks || item.expected_weeks,
            Boolean(item.done),
            item.achievedDate || item.achieved_date || null,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to save milestones" });
  }
});

export default router;
