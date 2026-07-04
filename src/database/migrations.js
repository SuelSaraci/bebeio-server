import pool from "../config/database.js";

export const runMigrations = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        firebase_uid TEXT UNIQUE NOT NULL,
        email TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        name TEXT DEFAULT '',
        has_completed_onboarding BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS babies (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        birth_date DATE NOT NULL,
        gender TEXT NOT NULL CHECK (gender IN ('girl', 'boy')),
        birth_weight NUMERIC(5,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS feeding_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        timestamp TIMESTAMP NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('breast', 'bottle', 'solid')),
        side TEXT CHECK (side IN ('left', 'right', 'both')),
        duration INTEGER,
        amount NUMERIC(6,2),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sleep_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('night', 'nap')),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS diaper_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        timestamp TIMESTAMP NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('wet', 'dirty', 'both')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS growth_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        weight NUMERIC(5,2),
        height NUMERIC(5,2),
        head_circ NUMERIC(5,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vaccinations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        scheduled_date DATE NOT NULL,
        done BOOLEAN DEFAULT FALSE,
        completed_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        doctor TEXT NOT NULL,
        specialty TEXT NOT NULL,
        date DATE NOT NULL,
        time TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS milestones (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        expected_weeks TEXT NOT NULL,
        done BOOLEAN DEFAULT FALSE,
        achieved_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS medical_notes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        paddle_subscription_id TEXT,
        status TEXT NOT NULL DEFAULT 'inactive',
        plan_type TEXT NOT NULL DEFAULT 'free',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT TRUE
    `);
    await client.query(`
      ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS feeding_reminders BOOLEAN DEFAULT TRUE
    `);
    await client.query(`
      ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS evening_check_in BOOLEAN DEFAULT TRUE
    `);
    await client.query(`
      ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS health_reminders BOOLEAN DEFAULT TRUE
    `);
    await client.query(`
      ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS ai_messages_used INTEGER DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE appointments
      ADD COLUMN IF NOT EXISTS done BOOLEAN DEFAULT FALSE
    `);
    await client.query(`
      ALTER TABLE appointments
      ADD COLUMN IF NOT EXISTS completed_date DATE
    `);
    await client.query(`
      ALTER TABLE medical_notes
      ADD COLUMN IF NOT EXISTS done BOOLEAN DEFAULT FALSE
    `);
    await client.query(`
      ALTER TABLE medical_notes
      ADD COLUMN IF NOT EXISTS completed_date DATE
    `);

    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)",
    );

    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_feeding_entries_user_ts ON feeding_entries(user_id, timestamp DESC)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_sleep_entries_user_start ON sleep_entries(user_id, start_time DESC)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_diaper_entries_user_ts ON diaper_entries(user_id, timestamp DESC)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_growth_entries_user_date ON growth_entries(user_id, date DESC)",
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("migrations.js")
) {
  runMigrations()
    .then(() => {
      console.log("Migrations completed.");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Migration failed:", error.message);
      process.exit(1);
    });
}
