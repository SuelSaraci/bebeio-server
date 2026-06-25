import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import routes from "./routes/index.js";
import { runMigrations } from "./database/migrations.js";
import "./config/firebase.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 5002);
const isProduction = process.env.NODE_ENV === "production";

const parseAllowedOrigins = () => {
  const raw = process.env.CORS_ORIGIN || "*";
  if (raw === "*") return null;
  return raw.split(",").map((item) => item.trim());
};

const allowedOrigins = parseAllowedOrigins();

if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(
  cors({
    origin(origin, callback) {
      if (!allowedOrigins || !origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS blocked"));
      }
    },
  }),
);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts, please try again later." },
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use(express.json({ limit: "2mb" }));
app.use("/api", apiLimiter);
app.use("/api/auth", authLimiter);
app.use("/api", routes);

app.use((error, _req, res, _next) => {
  res.status(500).json({
    error: "Server error",
    details: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
});

runMigrations()
  .then(() => {
    app.listen(port, () => {
      console.log(`Bebio API running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to boot server:", error);
    process.exit(1);
  });
