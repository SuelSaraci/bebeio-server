import { Router } from "express";
import pool from "../config/database.js";
import { verifyFirebaseToken } from "../middleware/auth.js";

const router = Router();
router.use(verifyFirebaseToken);

const formatEntry = (row) => ({
  id: String(row.id),
  date: row.date,
  weight: row.weight != null ? Number(row.weight) : undefined,
  height: row.height != null ? Number(row.height) : undefined,
  headCirc: row.head_circ != null ? Number(row.head_circ) : undefined,
});

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, date, weight, height, head_circ
       FROM growth_entries
       WHERE user_id = $1
       ORDER BY date DESC`,
      [req.user.id],
    );
    return res.json({ entries: result.rows.map(formatEntry) });
  } catch {
    return res.status(500).json({ error: "Failed to load growth entries" });
  }
});

router.post("/", async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.date) {
      return res.status(400).json({ error: "date is required" });
    }

    const result = await pool.query(
      `INSERT INTO growth_entries (user_id, date, weight, height, head_circ)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, date, weight, height, head_circ`,
      [
        req.user.id,
        data.date,
        data.weight ?? null,
        data.height ?? null,
        data.headCirc ?? data.head_circ ?? null,
      ],
    );

    return res.status(201).json({ entry: formatEntry(result.rows[0]) });
  } catch {
    return res.status(500).json({ error: "Failed to create growth entry" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM growth_entries WHERE id = $1 AND user_id = $2`, [
      req.params.id,
      req.user.id,
    ]);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to delete growth entry" });
  }
});

export default router;
