import { Router } from "express";
import { verifyFirebaseToken } from "../middleware/auth.js";

const router = Router();

router.get("/verify", verifyFirebaseToken, (req, res) => {
  res.json({ user: req.user });
});

export default router;
