import { config as loadDotenv } from 'dotenv';

loadDotenv();

export type Settings = {
  port: number;
  timeoutMs: number;
  model: string;
};

export function loadSettings(): Settings {
  return {
    port: Number(process.env.PORT ?? 3000),
    timeoutMs: Number(process.env.AGENTS_TIMEOUT_MS ?? 10_000),
    model: process.env.AGENT_MODEL ?? 'gemini-3.5-flash-lite',
  };
}
