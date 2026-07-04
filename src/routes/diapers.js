import { Router } from "express";
import pool from "../config/database.js";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { freeTierLimit } from "../utils/freeTierLimit.js";

const router = Router();
router.use(verifyFirebaseToken);

const formatEntry = (row) => ({
  id: String(row.id),
  timestamp: new Date(row.timestamp).toISOString(),
  type: row.type,
});

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, timestamp, type
       FROM diaper_entries
       WHERE user_id = $1
       ORDER BY timestamp DESC`,
      [req.user.id],
    );
    return res.json({ entries: result.rows.map(formatEntry) });
  } catch {
    return res.status(500).json({ error: "Failed to load diaper entries" });
  }
});

router.post("/", freeTierLimit("diaper_entries"), async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.type || !data.timestamp) {
      return res.status(400).json({ error: "type and timestamp are required" });
    }
    if (!["wet", "dirty", "both"].includes(data.type)) {
      return res.status(400).json({ error: "invalid diaper type" });
    }

    const result = await pool.query(
      `INSERT INTO diaper_entries (user_id, timestamp, type)
       VALUES ($1, $2, $3)
       RETURNING id, timestamp, type`,
      [req.user.id, new Date(data.timestamp), data.type],
    );

    return res.status(201).json({ entry: formatEntry(result.rows[0]) });
  } catch {
    return res.status(500).json({ error: "Failed to create diaper entry" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM diaper_entries WHERE id = $1 AND user_id = $2`, [
      req.params.id,
      req.user.id,
    ]);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to delete diaper entry" });
  }
});

export default router;
