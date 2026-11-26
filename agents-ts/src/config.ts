import { config as loadDotenv } from 'dotenv';

loadDotenv();

export type Settings = {
  port: number;
  timeoutMs: number;
  model: string;
  geminiApiKey: string;
};

function readNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
  return value;
}

export function loadSettings(): Settings {
  return {
    port: readNumber('PORT', 3000, 1, 65535),
    timeoutMs: readNumber('AGENTS_TIMEOUT_MS', 8000, 1000, 3_600_000),
    model: process.env.AGENT_MODEL ?? 'gemini-3.5-flash-lite',
    geminiApiKey: process.env.GEMINI_API_KEY?.trim() ?? '',
  };
}
