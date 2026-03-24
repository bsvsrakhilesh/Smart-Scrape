import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate";
import { institutionalInspectArticleHandler } from "../controllers/institutionalNode.controller";

const r = Router();

const inspectArticleBody = z.object({
  url: z.string().url(),
});

r.post(
  "/icn/inspect/article",
  validate({ body: inspectArticleBody }),
  institutionalInspectArticleHandler,
);

export default r;
