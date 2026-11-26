import express from 'express';
import { runAnalysis } from './agents/orchestrator.js';
import { loadSettings } from './config.js';
import { askRequestSchema } from './schemas.js';
const settings = loadSettings();
const defaultRunner = (request) => runAnalysis(request, settings.timeoutMs);
export function createApp(runner = defaultRunner) {
    const app = express();
    app.use(express.json());
    app.get('/health', (_request, response) => {
        response.status(200).json({ status: 'ok' });
    });
    app.post('/ask', async (request, response) => {
        const parsed = askRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            return response.status(400).json({
                error: 'invalid request',
                details: parsed.error.issues.map((issue) => ({
                    field: issue.path.join('.'),
                    message: issue.message,
                })),
            });
        }
        try {
            const result = await runner(parsed.data);
            return response.status(200).json(result);
        }
        catch (error) {
            return response.status(502).json({
                error: 'agents unavailable',
                details: error instanceof Error ? error.message : String(error),
            });
        }
    });
    return app;
}
