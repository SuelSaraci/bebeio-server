import { Router } from "express";
import pool from "../config/database.js";
import { verifyFirebaseToken } from "../middleware/auth.js";

const router = Router();
router.use(verifyFirebaseToken);

const formatEntry = (row) => ({
  id: String(row.id),
  timestamp: new Date(row.timestamp).toISOString(),
  type: row.type,
  side: row.side || undefined,
  duration: row.duration ?? undefined,
  amount: row.amount != null ? Number(row.amount) : undefined,
  notes: row.notes || undefined,
});

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, timestamp, type, side, duration, amount, notes
       FROM feeding_entries
       WHERE user_id = $1
       ORDER BY timestamp DESC`,
      [req.user.id],
    );
    return res.json({ entries: result.rows.map(formatEntry) });
  } catch {
    return res.status(500).json({ error: "Failed to load feeding entries" });
  }
});

router.post("/", async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.type || !data.timestamp) {
      return res.status(400).json({ error: "type and timestamp are required" });
    }
    if (!["breast", "bottle", "solid"].includes(data.type)) {
      return res.status(400).json({ error: "invalid feeding type" });
    }

    const result = await pool.query(
      `INSERT INTO feeding_entries (user_id, timestamp, type, side, duration, amount, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, timestamp, type, side, duration, amount, notes`,
      [
        req.user.id,
        new Date(data.timestamp),
        data.type,
        data.side || null,
        data.duration ?? null,
        data.amount ?? null,
        data.notes?.trim() || null,
      ],
    );

    return res.status(201).json({ entry: formatEntry(result.rows[0]) });
  } catch {
    return res.status(500).json({ error: "Failed to create feeding entry" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM feeding_entries WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to delete feeding entry" });
  }
});

export default router;
