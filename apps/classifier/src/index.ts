import express, { type Request, type Response } from "express";
import { z } from "zod";

import { getEnv, type Urgency } from "@beacon/shared";

const env = getEnv();

const categoryFloor: Record<string, Urgency> = {
  security: "critical",
  outage: "critical",
  billing: "high",
  payment: "high"
};

const bumpWords = ["failed", "declined", "breach", "down", "expired", "urgent"];

const rank: Urgency[] = ["low", "normal", "high", "critical"];


function stronger(a: Urgency, b: Urgency): Urgency {
  return rank.indexOf(a) >= rank.indexOf(b) ? a : b;
}


function classify(input: {
  category: string;
  title: string;
  body: string;
  hint?: Urgency;
}): Urgency {
  let urgency: Urgency = input.hint ?? "normal";

  // category floor
  const prefix = input.category.split(".")[0]?.toLowerCase() ?? "";
  const floor = categoryFloor[prefix];
  if (floor) {
    urgency = stronger(urgency, floor);
  }

  // keyword bump
  const text = `${input.title} ${input.body}`.toLowerCase();
  if (bumpWords.some((w) => text.includes(w)) && urgency !== "critical") {
    urgency = stronger(urgency, "high");
  }

  return urgency;
}


const classifyRequest = z.object({
  category: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  hint: z.enum(["critical", "high", "normal", "low"]).optional()
});

const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/classify", (req: Request, res: Response) => {
  const parsed = classifyRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid payload", details: z.flattenError(parsed.error) });
    return;
  }

  res.json({ urgency: classify(parsed.data) });
});

app.listen(env.CLASSIFIER_PORT, () => {
  console.log(`beacon classifier listening on :${env.CLASSIFIER_PORT}`);
});
