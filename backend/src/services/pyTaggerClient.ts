// backend/src/services/pyTaggerClient.ts
import axios from "axios";
import FormData from "form-data";
import fs from "fs";

const TAGGER_URL = process.env.TAGGER_PY_URL || "http://localhost:7071";
const GET_JOB_TIMEOUT_MS = Number(process.env.TAGS_JOB_GET_TIMEOUT_MS || 25000);

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

export async function createJobFromFile(
  filePath: string,
  topk = 10,
  useLLM = true,
) {
  try {
    const form = new FormData();
    form.append("topk", String(topk));
    form.append("use_llm", useLLM ? "true" : "false");
    form.append("file", fs.createReadStream(filePath));

    const { data } = await axios.post(`${TAGGER_URL}/jobs`, form, {
      headers: form.getHeaders(),
      timeout: 120000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    return pickJobId(data);
  } catch (e) {
    const b64 = fs.readFileSync(filePath).toString("base64");
    const form = new URLSearchParams();
    form.append("file_base64", b64);
    form.append("file_name", filePath.split("/").pop() || "upload.bin");
    form.append("topk", String(topk));
    form.append("use_llm", useLLM ? "true" : "false");

    const { data } = await axios.post(`${TAGGER_URL}/jobs`, form, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 120000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    return pickJobId(data);
  }
}

export async function getJob(jobId: string) {
  const { data } = await axios.get(`${TAGGER_URL}/jobs/${jobId}`, {
    timeout: GET_JOB_TIMEOUT_MS,
  });
  return data as any;
}

export async function healthCheck() {
  const { data } = await axios.get(`${TAGGER_URL}/health`, { timeout: 3000 });
  return data;
}
