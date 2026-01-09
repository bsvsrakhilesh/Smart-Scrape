import OpenAI from "openai";
import { env, requireOpenAI } from "../config/env";

let _client: OpenAI | null = null;

export function openaiClient(): OpenAI {
  requireOpenAI();

  if (!_client) {
    _client = new OpenAI({
      apiKey: env.OPENAI_API_KEY!,
      timeout: env.OPENAI_TIMEOUT_MS,
    });
  }

  return _client;
}

export function defaultModel(): string {
  return env.OPENAI_MODEL;
}
