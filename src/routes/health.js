import { Router } from "express";
import pool from "../config/database.js";
import { verifyFirebaseToken } from "../middleware/auth.js";

const router = Router();
router.use(verifyFirebaseToken);

const formatVaccination = (row) => ({
  id: String(row.id),
  name: row.name,
  scheduledDate: row.scheduled_date,
  done: row.done,
  completedDate: row.completed_date || undefined,
});

const formatAppointment = (row) => ({
  id: String(row.id),
  doctor: row.doctor,
  specialty: row.specialty,
  date: row.date,
  time: row.time,
  type: row.type,
});

const formatMedicalNote = (row) => ({
  id: String(row.id),
  date: row.date,
  title: row.title,
  content: row.content,
});

router.get("/vaccinations", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, scheduled_date, done, completed_date
       FROM vaccinations WHERE user_id = $1 ORDER BY scheduled_date ASC`,
      [req.user.id],
    );
    return res.json({ vaccinations: result.rows.map(formatVaccination) });
  } catch {
    return res.status(500).json({ error: "Failed to load vaccinations" });
  }
});

router.put("/vaccinations/:id", async (req, res) => {
  try {
    const data = req.body || {};
    const result = await pool.query(
      `UPDATE vaccinations
       SET done = COALESCE($3, done),
           completed_date = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING id, name, scheduled_date, done, completed_date`,
      [req.params.id, req.user.id, data.done, data.completedDate || data.completed_date || null],
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Vaccination not found" });
    }
    return res.json({ vaccination: formatVaccination(result.rows[0]) });
  } catch {
    return res.status(500).json({ error: "Failed to update vaccination" });
  }
});

router.post("/vaccinations/bulk", async (req, res) => {
  try {
    const items = Array.isArray(req.body?.vaccinations) ? req.body.vaccinations : [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM vaccinations WHERE user_id = $1`, [req.user.id]);
      for (const item of items) {
        await client.query(
          `INSERT INTO vaccinations (user_id, name, scheduled_date, done, completed_date)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            req.user.id,
            item.name,
            item.scheduledDate || item.scheduled_date,
            Boolean(item.done),
            item.completedDate || item.completed_date || null,
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
    return res.status(500).json({ error: "Failed to save vaccinations" });
  }
});

router.get("/appointments", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, doctor, specialty, date, time, type
       FROM appointments WHERE user_id = $1 ORDER BY date ASC, time ASC`,
      [req.user.id],
    );
    return res.json({ appointments: result.rows.map(formatAppointment) });
  } catch {
    return res.status(500).json({ error: "Failed to load appointments" });
  }
});

router.post("/appointments/bulk", async (req, res) => {
  try {
    const items = Array.isArray(req.body?.appointments) ? req.body.appointments : [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM appointments WHERE user_id = $1`, [req.user.id]);
      for (const item of items) {
        await client.query(
          `INSERT INTO appointments (user_id, doctor, specialty, date, time, type)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.user.id, item.doctor, item.specialty, item.date, item.time, item.type],
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
    return res.status(500).json({ error: "Failed to save appointments" });
  }
});

router.get("/notes", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, date, title, content
       FROM medical_notes WHERE user_id = $1 ORDER BY date DESC`,
      [req.user.id],
    );
    return res.json({ notes: result.rows.map(formatMedicalNote) });
  } catch {
    return res.status(500).json({ error: "Failed to load medical notes" });
  }
});

router.post("/notes", async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.date || !data.title?.trim() || !data.content?.trim()) {
      return res.status(400).json({ error: "date, title, and content are required" });
    }
    const result = await pool.query(
      `INSERT INTO medical_notes (user_id, date, title, content)
       VALUES ($1, $2, $3, $4)
       RETURNING id, date, title, content`,
      [req.user.id, data.date, data.title.trim(), data.content.trim()],
    );
    return res.status(201).json({ note: formatMedicalNote(result.rows[0]) });
  } catch {
    return res.status(500).json({ error: "Failed to create medical note" });
  }
});

router.delete("/notes/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM medical_notes WHERE id = $1 AND user_id = $2`, [
      req.params.id,
      req.user.id,
    ]);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to delete medical note" });
  }
});

export default router;
