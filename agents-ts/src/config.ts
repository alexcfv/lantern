import { config as loadDotenv } from 'dotenv';

loadDotenv();

export type Settings = {
  port: number;
  timeoutMs: number;
  model: string;
  geminiApiKey: string;
  etherscanApiKey: string;
  etherscanChainId: number;
  etherscanBaseUrl: string;
  etherscanTimeoutMs: number;
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
    etherscanApiKey: process.env.ETHERSCAN_API_KEY?.trim() ?? '',
    etherscanChainId: readNumber('ETHERSCAN_CHAIN_ID', 1, 1, 1_000_000),
    etherscanBaseUrl: process.env.ETHERSCAN_BASE_URL ?? 'https://api.etherscan.io',
    etherscanTimeoutMs: readNumber('ETHERSCAN_TIMEOUT_MS', 5000, 1000, 60_000),
  };
}
