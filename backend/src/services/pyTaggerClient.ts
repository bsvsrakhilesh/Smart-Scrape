// backend/src/services/pyTaggerClient.ts
import axios from "axios";
import FormData from "form-data";
import fs from "fs";

const TAGGER_URL = process.env.TAGGER_PY_URL || "http://localhost:7071";

function pickJobId(data: any): { jobId: string } {
  const jobId = data?.jobId || data?.job_id || data?.id;
  if (!jobId) throw new Error("AI Tagger did not return a job id");
  return { jobId };
}

export async function createJobFromUrl(url: string, topk = 10, useLLM = true) {
  const form = new URLSearchParams();
  form.append("url", url);
  form.append("topk", String(topk));
  form.append("use_llm", useLLM ? "true" : "false");
  const { data } = await axios.post(`${TAGGER_URL}/jobs`, form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 20000,
  });
  return pickJobId(data);
}

export async function createJobFromFile(path: string, topk = 10, useLLM = true) {
  const b64 = fs.readFileSync(path).toString("base64");
  const form = new URLSearchParams();
  form.append("file_base64", b64);
  form.append("topk", String(topk));
  form.append("use_llm", useLLM ? "true" : "false");
  const { data } = await axios.post(`${TAGGER_URL}/jobs`, form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 60000,
  });
  return pickJobId(data);
}


export async function getJob(jobId: string) {
  const { data } = await axios.get(`${TAGGER_URL}/jobs/${jobId}`, { timeout: 10000 });
  return data as any;
}

export async function healthCheck() {
  // Works with /health added on the Python side
  const { data } = await axios.get(`${TAGGER_URL}/health`, { timeout: 3000 });
  return data;
}
