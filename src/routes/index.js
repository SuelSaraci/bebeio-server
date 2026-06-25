import { Router } from "express";
import authRoutes from "./auth.js";
import profileRoutes from "./profile.js";
import babyRoutes from "./baby.js";
import feedingRoutes from "./feedings.js";
import sleepRoutes from "./sleep.js";
import diaperRoutes from "./diapers.js";
import growthRoutes from "./growth.js";
import healthRoutes from "./health.js";
import milestoneRoutes from "./milestones.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/profile", profileRoutes);
router.use("/baby", babyRoutes);
router.use("/feedings", feedingRoutes);
router.use("/sleep", sleepRoutes);
router.use("/diapers", diaperRoutes);
router.use("/growth", growthRoutes);
router.use("/health", healthRoutes);
router.use("/milestones", milestoneRoutes);

export default router;
