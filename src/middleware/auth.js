import admin from "../config/firebase.js";
import pool from "../config/database.js";

const createProfileIfMissing = async (client, userId) => {
  await client.query(
    `INSERT INTO user_profiles (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
};

export const verifyFirebaseToken = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Bearer token" });
    }

    const token = header.replace("Bearer ", "").trim();
    const decoded = await admin.auth().verifyIdToken(token);

    const client = await pool.connect();
    try {
      const userResult = await client.query(
        `INSERT INTO users (firebase_uid, email)
         VALUES ($1, $2)
         ON CONFLICT (firebase_uid)
         DO UPDATE SET email = EXCLUDED.email, updated_at = CURRENT_TIMESTAMP
         RETURNING id, firebase_uid, email`,
        [decoded.uid, decoded.email || null],
      );

      const user = userResult.rows[0];
      await createProfileIfMissing(client, user.id);

      req.user = user;
      next();
    } finally {
      client.release();
    }
  } catch (error) {
    return res.status(401).json({
      error: "Invalid auth token",
      details:
        process.env.NODE_ENV === "production" ? undefined : String(error.message),
    });
  }
};
