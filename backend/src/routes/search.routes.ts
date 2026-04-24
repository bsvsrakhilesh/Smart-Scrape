import { Router } from "express";
import { validate } from "../middlewares/validate";
import {
  searchHandler,
  searchPlanHandler,
  searchRerankHandler,
} from "../controllers/search.controller";
import {
  planBodySchema,
  querySchema,
  rerankBodySchema,
} from "./search.schemas";

const router = Router();

router.get("/", validate({ query: querySchema }), searchHandler);
router.post(
  "/rerank",
  validate({ body: rerankBodySchema }),
  searchRerankHandler,
);
router.post("/plan", validate({ body: planBodySchema }), searchPlanHandler);

export default router;
