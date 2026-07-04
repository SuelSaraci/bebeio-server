import { Router } from "express";
import { verifyFirebaseToken } from "../middleware/auth.js";
import {
  createCheckoutSession,
  getSubscriptionStatus,
  getPaddleConfig,
  handleWebhook,
} from "../controllers/paddleSubscriptionController.js";

const router = Router();

router.use(verifyFirebaseToken);
router.post("/create", createCheckoutSession);
router.get("/status", getSubscriptionStatus);
router.get("/config", getPaddleConfig);

export default router;
export { handleWebhook };
