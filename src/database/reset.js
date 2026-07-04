import pool from "../config/database.js";
import { runMigrations } from "./migrations.js";

/** Tables in dependency order (children first). */
const TABLES = [
  "medical_notes",
  "milestones",
  "appointments",
  "vaccinations",
  "growth_entries",
  "diaper_entries",
  "sleep_entries",
  "feeding_entries",
  "babies",
  "user_profiles",
  "users",
];

const maskConnectionString = (url) => {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "****";
    return parsed.toString();
  } catch {
    return "(connection string)";
  }
};

export const dropAllTables = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const table of TABLES) {
      await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("reset.js");

if (isMain) {
  const args = new Set(process.argv.slice(2));
  const confirmed =
    args.has("--yes") || String(process.env.CONFIRM_DB_RESET || "").toLowerCase() === "true";

  if (!confirmed) {
    console.error("This will permanently delete all user data and drop every app table.");
    console.error("");
    console.error("To confirm, run one of:");
    console.error("  CONFIRM_DB_RESET=true yarn db:reset");
    console.error("  yarn db:reset --yes");
    console.error("");
    console.error("To drop tables and recreate the schema:");
    console.error("  yarn db:fresh");
    process.exit(1);
  }

  const connectionString =
    process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || "(from DB_* env vars)";

  console.log("Target database:", maskConnectionString(connectionString));
  console.log("Dropping tables:", TABLES.join(", "));

  dropAllTables()
    .then(async () => {
      console.log("All tables dropped.");
      if (args.has("--migrate")) {
        await runMigrations();
        console.log("Migrations completed — empty schema is ready.");
      } else {
        console.log("Run `yarn migrate` to recreate tables.");
      }
      await pool.end();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error("Database reset failed:", error.message);
      await pool.end();
      process.exit(1);
    });
}
