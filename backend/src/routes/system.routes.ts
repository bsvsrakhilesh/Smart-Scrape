import { Router } from "express";
import { requireRole } from "../middlewares/authContext";
import { getSystemStatusHandler } from "../controllers/system.controller";

const r = Router();

r.get("/system/status", requireRole("admin"), getSystemStatusHandler);

export default r;