import { config as loadDotenv } from 'dotenv';
loadDotenv();
export function loadSettings() {
    return {
        port: Number(process.env.PORT ?? 3000),
        timeoutMs: Number(process.env.AGENTS_TIMEOUT_MS ?? 10_000),
        model: process.env.AGENT_MODEL ?? 'gemini-3.5-flash-lite',
    };
}
