// backend/src/services/pyTaggerClient.ts
import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";

const TAGGER_URL = process.env.TAGGER_PY_URL || "http://localhost:7071";
const GET_JOB_TIMEOUT_MS = Number(process.env.TAGS_JOB_GET_TIMEOUT_MS || 25000);
const CREATE_JOB_TIMEOUT_MS = Number(
  process.env.TAGS_JOB_CREATE_TIMEOUT_MS || 120000,
);
const SHARED_FILE_ROOTS = String(
  process.env.TAGGER_SHARED_FILE_ROOTS || "/data",
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function pickJobId(data: any): { jobId: string } {
  const jobId = data?.jobId || data?.job_id || data?.id;
  if (!jobId) throw new Error("AI Tagger did not return a job id");
  return { jobId };
}

function isPathWithinRoot(candidatePath: string, rootPath: string) {
  try {
    const candidate = path.resolve(candidatePath);
    const root = path.resolve(rootPath);
    const rel = path.relative(root, candidate);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

function canUseSharedFilePointer(filePath: string) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  return SHARED_FILE_ROOTS.some((root) => isPathWithinRoot(filePath, root));
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
  const fileName = path.basename(filePath) || "upload.bin";
  let pointerError: unknown = null;

  if (canUseSharedFilePointer(filePath)) {
    try {
      const form = new URLSearchParams();
      form.append("file_path", filePath);
      form.append("file_name", fileName);
      form.append("topk", String(topk));
      form.append("use_llm", useLLM ? "true" : "false");

      const { data } = await axios.post(`${TAGGER_URL}/jobs`, form, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: CREATE_JOB_TIMEOUT_MS,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      return pickJobId(data);
    } catch (e) {
      pointerError = e;
    }
  }

  try {
    const form = new FormData();
    form.append("topk", String(topk));
    form.append("use_llm", useLLM ? "true" : "false");
    form.append("file", fs.createReadStream(filePath), fileName);

    const { data } = await axios.post(`${TAGGER_URL}/jobs`, form, {
      headers: form.getHeaders(),
      timeout: CREATE_JOB_TIMEOUT_MS,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    return pickJobId(data);
  } catch (e: any) {
    const pointerMsg =
      pointerError && (pointerError as any)?.message
        ? `; shared-path attempt failed first: ${(pointerError as any).message}`
        : "";

    throw new Error(
      `AI Tagger file job creation failed for ${fileName}: ${
        e?.message || e
      }${pointerMsg}`,
    );
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
