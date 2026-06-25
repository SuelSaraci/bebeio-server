import { Router } from "express";
import pool from "../config/database.js";
import { verifyFirebaseToken } from "../middleware/auth.js";

const router = Router();
router.use(verifyFirebaseToken);

const formatEntry = (row) => ({
  id: String(row.id),
  start: new Date(row.start_time).toISOString(),
  end: new Date(row.end_time).toISOString(),
  type: row.type,
  notes: row.notes || undefined,
});

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, start_time, end_time, type, notes
       FROM sleep_entries
       WHERE user_id = $1
       ORDER BY start_time DESC`,
      [req.user.id],
    );
    return res.json({ entries: result.rows.map(formatEntry) });
  } catch {
    return res.status(500).json({ error: "Failed to load sleep entries" });
  }
});

router.post("/", async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.start || !data.end || !data.type) {
      return res.status(400).json({ error: "start, end, and type are required" });
    }
    if (!["night", "nap"].includes(data.type)) {
      return res.status(400).json({ error: "invalid sleep type" });
    }

    const result = await pool.query(
      `INSERT INTO sleep_entries (user_id, start_time, end_time, type, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, start_time, end_time, type, notes`,
      [
        req.user.id,
        new Date(data.start),
        new Date(data.end),
        data.type,
        data.notes?.trim() || null,
      ],
    );

    return res.status(201).json({ entry: formatEntry(result.rows[0]) });
  } catch {
    return res.status(500).json({ error: "Failed to create sleep entry" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM sleep_entries WHERE id = $1 AND user_id = $2`, [
      req.params.id,
      req.user.id,
    ]);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to delete sleep entry" });
  }
});

export default router;
