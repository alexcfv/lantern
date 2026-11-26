import { z } from 'zod';
export const analyzeResponseSchema = z.object({
    address: z.string().min(1),
    fraud_probability: z.number().min(0).max(1).nullable(),
    verdict: z.string(),
    model: z.string(),
});
export const askRequestSchema = z.object({
    address: z.string().min(1),
    tx_in_count: z.number().int().nonnegative(),
    eth_in: z.number().nonnegative(),
    distinct_in_counterparties: z.number().int().nonnegative(),
    first_in_ts: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    last_in_ts: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    approval_events: z.number().int().nonnegative(),
    distinct_token_contracts: z.number().int().nonnegative(),
    user_request: z.string().min(1),
    prediction: analyzeResponseSchema,
});
export const agentResponseSchema = z.object({
    agent: z.string(),
    content: z.string(),
});
export const askResponseSchema = z.object({
    address: z.string(),
    prediction: analyzeResponseSchema,
    agents: z.array(agentResponseSchema),
});
