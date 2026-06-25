import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const toBool = (value, fallback = false) => {
  if (value == null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
};

const buildConnectionString = () => {
  const isProduction = process.env.NODE_ENV === "production";
  const preferredUrl = isProduction
    ? process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL
    : process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;

  if (preferredUrl) return preferredUrl;

  const dbHost = process.env.DB_HOST || "localhost";
  const dbPort = process.env.DB_PORT || 5432;
  const dbName = process.env.DB_NAME || "postgres";
  const dbUser = process.env.DB_USER || "postgres";
  const dbPassword = process.env.DB_PASSWORD || "";

  return `postgresql://${dbUser}${dbPassword ? `:${dbPassword}` : ""}@${dbHost}:${dbPort}/${dbName}`;
};

const connectionString = buildConnectionString();
const isRailway =
  connectionString.includes("railway.app") ||
  connectionString.includes("rlwy.net") ||
  String(process.env.DB_HOST || "").includes("railway") ||
  String(process.env.DATABASE_URL || "").includes("railway") ||
  String(process.env.DATABASE_PUBLIC_URL || "").includes("railway");
const sslEnabled = toBool(process.env.DB_SSL, isRailway);

const pool = new Pool({
  connectionString,
  ssl: sslEnabled
    ? {
        rejectUnauthorized: false,
      }
    : false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

pool.on("error", (error) => {
  console.error("Postgres pool error:", error);
});

export default pool;
