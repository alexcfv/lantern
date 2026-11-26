import { z } from 'zod';

const isoDate = z.string().refine(
  (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  },
  { message: 'expected a valid date in YYYY-MM-DD format' },
);

export const analyzeResponseSchema = z.object({
  address: z.string().min(1),
  fraud_probability: z.number().min(0).max(1).nullable(),
  verdict: z.string(),
  model: z.string(),
  red_flag: z.boolean().default(false),
  red_flags: z.array(z.string()).default([]),
  reason: z.string().nullable().default(null),
});

export const analystAnswerSchema = z.object({
  summary: z.string().min(1),
  evidence_ids: z.array(z.string()).default([]),
});

export const responderAnswerSchema = z.object({
  answer: z.string().min(1),
});

export const askRequestSchema = z.object({
  address: z.string().min(1),
  tx_in_count: z.number().int().nonnegative(),
  eth_in: z.number().nonnegative(),
  distinct_in_counterparties: z.number().int().nonnegative(),
  first_in_ts: isoDate,
  last_in_ts: isoDate,
  approval_events: z.number().int().nonnegative(),
  distinct_token_contracts: z.number().int().nonnegative(),
  user_request: z.string().min(1),
  prediction: analyzeResponseSchema,
});

export const evidenceItemSchema = z.object({
  id: z.string(),
  claim: z.string(),
  source: z.string(),
  detail: z.string(),
});

export const agentResponseSchema = z.object({
  agent: z.string(),
  content: z.string(),
});

export const askResponseSchema = z.object({
  address: z.string(),
  prediction: analyzeResponseSchema,
  agents: z.array(agentResponseSchema),
  evidence: z.array(evidenceItemSchema).default([]),
});

export type AnalyzeResponse = z.infer<typeof analyzeResponseSchema>;
export type AskRequest = z.infer<typeof askRequestSchema>;
export type AnalystAnswer = z.infer<typeof analystAnswerSchema>;
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;
export type AskResponse = z.infer<typeof askResponseSchema>;
