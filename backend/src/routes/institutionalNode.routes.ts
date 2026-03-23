import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate";
import {
  institutionalNodeHealthHandler,
  institutionalNodeSessionStatusHandler,
  institutionalNodeOpenLoginHandler,
} from "../controllers/institutionalNode.controller";

const r = Router();

const openLoginBody = z.object({
  provider: z
    .enum(["openathens", "proquest", "nexis", "pressreader", "custom"])
    .optional(),
  url: z.string().url().optional().nullable(),
});

r.get("/icn/health", institutionalNodeHealthHandler);
r.get("/icn/session/status", institutionalNodeSessionStatusHandler);
r.post(
  "/icn/session/open-login",
  validate({ body: openLoginBody }),
  institutionalNodeOpenLoginHandler,
);

export default r;
