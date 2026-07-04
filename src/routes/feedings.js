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
    const entries = result.rows.map(formatEntry);
    console.log(
      "[GET /api/feedings] user=%s count=%d",
      req.user.id,
      entries.length,
    );
    return res.json({ entries });
  } catch (error) {
    console.error("[GET /api/feedings] Error:", error);
    return res.status(500).json({ error: "Failed to load feeding entries" });
  }
});

router.post("/", freeTierLimit("feeding_entries"), async (req, res) => {
  try {
    const data = req.body || {};
    console.log("[POST /api/feedings] user=%s body=%j", req.user.id, data);

    if (!data.type || !data.timestamp) {
      console.warn("[POST /api/feedings] validation failed: missing type or timestamp");
      return res.status(400).json({ error: "type and timestamp are required" });
    }
    if (!["breast", "bottle", "solid"].includes(data.type)) {
      console.warn("[POST /api/feedings] validation failed: invalid type=%s", data.type);
      return res.status(400).json({ error: "invalid feeding type" });
    }

    const parsedTimestamp = new Date(data.timestamp);
    if (Number.isNaN(parsedTimestamp.getTime())) {
      console.warn("[POST /api/feedings] validation failed: invalid timestamp=%s", data.timestamp);
      return res.status(400).json({ error: "invalid timestamp" });
    }

    const result = await pool.query(
      `INSERT INTO feeding_entries (user_id, timestamp, type, side, duration, amount, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, timestamp, type, side, duration, amount, notes`,
      [
        req.user.id,
        parsedTimestamp,
        data.type,
        data.side || null,
        data.duration ?? null,
        data.amount ?? null,
        data.notes?.trim() || null,
      ],
    );

    const entry = formatEntry(result.rows[0]);
    console.log("[POST /api/feedings] created id=%s timestamp=%s", entry.id, entry.timestamp);
    return res.status(201).json({ entry });
  } catch (error) {
    console.error("[POST /api/feedings] Error:", error);
    return res.status(500).json({ error: "Failed to create feeding entry" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    console.log("[DELETE /api/feedings/:id] user=%s id=%s", req.user.id, req.params.id);
    await pool.query(
      `DELETE FROM feeding_entries WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );
    return res.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/feedings/:id] Error:", error);
    return res.status(500).json({ error: "Failed to delete feeding entry" });
  }
});

export default router;
