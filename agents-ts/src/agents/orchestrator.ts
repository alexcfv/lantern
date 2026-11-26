import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createAgent,
  createHuman,
  defineRuntime,
  RuntimeState,
  SemanticEvent,
  SituationSpecification,
  supportedModels,
  type SituationContext,
  type SituationHandler,
  type Tool,
} from '@mozaik-ai/core';
import { loadSettings } from '../config.js';
import { createTransactionHistoryTool, EtherscanClient } from '../integrations/etherscan.js';
import { patchGeminiFunctionCalling } from './gemini-tool-compat.js';
import { responderAnswerSchema } from '../schemas.js';
import type { AskRequest, AskResponse, EvidenceItem } from '../schemas.js';

type RequestPayload = {
  requestId: string;
  address: string;
  question: string;
  prediction: AskRequest['prediction'];
};

type EnrichmentRequestedPayload = {
  requestId: string;
  address: string;
  question: string;
};

type EnrichmentFacts = {
  summary: string;
  evidence: EvidenceItem[];
};

type EnrichmentCompletedPayload = EnrichmentFacts & {
  requestId: string;
  address: string;
};

type AnalysisCompletedPayload = {
  requestId: string;
  response: AskResponse;
};

type AnalysisFailedPayload = {
  requestId: string;
  error: string;
};

class FromParticipant extends SituationSpecification {
  constructor(
    private readonly type: string,
    private readonly producerId: string,
  ) {
    super();
  }

  isSatisfiedBy({ event }: SituationContext): boolean {
    return event.type === this.type && event.producerId === this.producerId;
  }
}

function readModelAnswer(payload: unknown): string {
  const answer = (payload as { answer?: { content?: { text?: unknown } } }).answer;
  return typeof answer?.content?.text === 'string' ? answer.content.text : JSON.stringify(payload);
}

function readResponderAnswer(payload: unknown): string {
  const text = readModelAnswer(payload);
  try {
    return responderAnswerSchema.parse(JSON.parse(text)).answer;
  } catch {
    return text;
  }
}

function buildModelEvidence(prediction: AskRequest['prediction']): EvidenceItem[] {
  const detail = `model: ${prediction.model}`;
  const items: EvidenceItem[] = [
    {
      id: 'model.verdict',
      claim: `Verdict: ${prediction.verdict}.`,
      source: 'Model',
      detail,
    },
  ];

  if (prediction.fraud_probability !== null) {
    items.push({
      id: 'model.fraud_probability',
      claim: `Fraud probability: ${prediction.fraud_probability}.`,
      source: 'Model',
      detail,
    });
  }

  items.push({
    id: 'model.red_flags',
    claim: prediction.red_flags.length
      ? `Red flags: ${prediction.red_flags.join(', ')}.`
      : 'No red flags were detected.',
    source: 'Model',
    detail: prediction.reason ?? detail,
  });

  return items;
}

class ForRequest extends SituationSpecification {
  constructor(
    private readonly type: string,
    private readonly requestId: string,
  ) {
    super();
  }

  isSatisfiedBy({ event, participant }: SituationContext): boolean {
    const payload = event.payload as { requestId?: string } | undefined;
    return (
      event.type === this.type &&
      payload?.requestId === this.requestId &&
      event.producerId !== participant.getId()
    );
  }
}

class AppState extends RuntimeState {
  readonly answers = new Map<string, AskResponse>();
}

const { initializeRuntime, join, leave, runLoop, sendEvent } = defineRuntime<AppState>();

const settings = loadSettings();
const selectedModel = supportedModels.find(
  ({ specification }) => specification.name === settings.model,
);
if (!selectedModel) {
  throw new Error(`unsupported AGENT_MODEL: ${settings.model}`);
}
const agentModelName = selectedModel.specification.name;
if (selectedModel.specification.provider === 'google') {
  patchGeminiFunctionCalling(selectedModel.endpoint);
}
if (!settings.geminiApiKey) {
  console.warn('GEMINI_API_KEY is not set; LLM calls will fail until it is configured');
}

initializeRuntime({
  state: new AppState(),
  inferenceRunnerConfig: { supportedModels: [selectedModel] },
});

const defaultEtherscanClient = new EtherscanClient({
  apiKey: settings.etherscanApiKey,
  chainId: settings.etherscanChainId,
  baseUrl: settings.etherscanBaseUrl,
  timeoutMs: settings.etherscanTimeoutMs,
  limit: 100,
});

export async function runAnalysis(
  request: AskRequest,
  timeoutMs = settings.timeoutMs,
  etherscan: EtherscanClient = defaultEtherscanClient,
): Promise<AskResponse> {
  const requestId = randomUUID();

  const modelEvidence = buildModelEvidence(request.prediction);
  let etherscanEvidence: EvidenceItem[] = [];
  let responderId = '';
  let analystFacts = 'No additional facts were requested.';

  let resolveAnswer!: (answer: AskResponse) => void;
  let rejectAnswer!: (error: Error) => void;
  const answer = new Promise<AskResponse>((resolve, reject) => {
    resolveAnswer = resolve;
    rejectAnswer = reject;
  });

  let resolveEnrichment!: (facts: EnrichmentFacts) => void;
  let rejectEnrichment!: (error: Error) => void;
  const enrichment = new Promise<EnrichmentFacts>((resolve, reject) => {
    resolveEnrichment = resolve;
    rejectEnrichment = reject;
  });
  enrichment.catch(() => undefined);

  const gateway = createHuman({ name: 'Gateway', capabilities: [], handlers: [] });

  const askTxAnalystTool: Tool = {
    type: 'function',
    name: 'ask_tx_analyst',
    description:
      'Ask TxAnalyst about the provided wallet only: its activity, history, counterparties, or tokens. Never use it for other addresses, global lists, or general crypto questions. Always scope the question to the provided wallet.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'A specific question for TxAnalyst.',
        },
      },
      required: ['question'],
      additionalProperties: false,
    },
    strict: true,
    invoke: async (args: { question?: unknown }) => {
      const question = z.string().min(1).parse(args?.question ?? request.user_request);
      const payload: EnrichmentRequestedPayload = {
        requestId,
        address: request.address,
        question,
      };
      sendEvent(
        SemanticEvent.create('enrichment.requested', responderId, payload),
        responderId,
      );

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('tx analyst timeout')),
          Math.max(1000, timeoutMs - 1000),
        );
      });
      try {
        const facts = await Promise.race([enrichment, timeout]);
        return { summary: facts.summary, evidence: facts.evidence };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };

  const responderHandlers: SituationHandler[] = [
    {
      specification: new ForRequest('analysis.requested', requestId),
      processor: {
        apply({ participant }) {
          responderId = participant.getId();
          try {
            const message = [
              `User question: ${request.user_request}`,
              `Address: ${request.address}`,
              `ML verdict (do not recompute): ${JSON.stringify(request.prediction)}`,
              `Evidence already available (cite only these IDs): ${JSON.stringify(modelEvidence)}`,
              'Answer in English. Only answer questions about the provided wallet and the supplied ML verdict. If the question is unrelated, asks about other wallets, or asks for a global list, say you can only analyze the provided wallet. If the question needs wallet history, counterparties, or tokens, call ask_tx_analyst and use its answer. Do not invent facts and do not use any data outside the provided evidence and TxAnalyst.',
            ].join('\n');

            runLoop(responderId, message, {
              model: agentModelName,
              context: responder.getMemory().getContext(),
              tools: responder.getTools(),
              structuredOutput: {
                name: 'responder_answer',
                strict: true,
                schema: {
                  type: 'object',
                  properties: {
                    answer: { type: 'string', minLength: 1 },
                  },
                  required: ['answer'],
                  additionalProperties: false,
                },
              },
            });
          } catch (error) {
            const payload: AnalysisFailedPayload = {
              requestId,
              error: error instanceof Error ? error.message : String(error),
            };
            sendEvent(
              SemanticEvent.create('analysis.failed', responderId, payload),
              responderId,
            );
          }
        },
      },
    },
    {
      specification: new ForRequest('enrichment.completed', requestId),
      processor: {
        apply({ event }) {
          const facts = event.payload as EnrichmentCompletedPayload;
          analystFacts = facts.summary;
          etherscanEvidence = facts.evidence;
          resolveEnrichment(facts);
        },
      },
    },
    {
      specification: new ForRequest('analysis.failed', requestId),
      processor: {
        apply({ event }) {
          const error = new Error((event.payload as AnalysisFailedPayload).error);
          rejectEnrichment(error);
          rejectAnswer(error);
        },
      },
    },
  ];

  const responder = createAgent({
    name: 'Responder',
    capabilities: ['inference'],
    instruction:
      'Answer the user in English using only the ML verdict and, when needed, facts about the provided wallet from TxAnalyst. Do not answer questions about other wallets or global lists. Never recompute the verdict.',
    tools: [askTxAnalystTool],
    handlers: responderHandlers,
  });

  const analystHandlers: SituationHandler[] = [
    {
      specification: new ForRequest('enrichment.requested', requestId),
      processor: {
        apply({ participant }) {
          try {
            const message = [
              `Address: ${request.address}`,
              `User question: ${request.user_request}`,
              `ML verdict: ${JSON.stringify(request.prediction)}`,
              'Use get_transaction_history only for the address provided above and only when the question requires its real transaction history. Answer in English. Return concise facts about this wallet only, never a verdict. If the question is unrelated or asks about other addresses or global lists, say you can only analyze the provided wallet.',
            ].join('\n');

            runLoop(participant.getId(), message, {
              model: agentModelName,
              context: analyst.getMemory().getContext(),
              tools: analyst.getTools(),
            });
          } catch (error) {
            const payload: AnalysisFailedPayload = {
              requestId,
              error: error instanceof Error ? error.message : String(error),
            };
            sendEvent(
              SemanticEvent.create('analysis.failed', participant.getId(), payload),
              participant.getId(),
            );
          }
        },
      },
    },
  ];

  const analyst = createAgent({
    name: 'TxAnalyst',
    capabilities: ['etherscan'],
    instruction:
      'Answer in English. Return only facts about the provided wallet from Etherscan, never a verdict. Do not inspect other addresses.',
    tools: [
      createTransactionHistoryTool(etherscan, request.address, (items) => {
        etherscanEvidence = items;
      }),
    ],
    handlers: analystHandlers,
  });

  const analystObserver = createHuman({
    name: 'AnalystObserver',
    capabilities: [],
    handlers: [
      {
        specification: new FromParticipant('model.answer', analyst.getId()),
        processor: {
          apply({ event, participant }) {
            const summary = readModelAnswer(event.payload);
            const payload: EnrichmentCompletedPayload = {
              requestId,
              address: request.address,
              summary,
              evidence: etherscanEvidence,
            };
            sendEvent(
              SemanticEvent.create('enrichment.completed', participant.getId(), payload),
              participant.getId(),
            );
          },
        },
      },
    ],
  });

  const responderObserver = createHuman({
    name: 'ResponderObserver',
    capabilities: [],
    handlers: [
      {
        specification: new FromParticipant('model.answer', responder.getId()),
        processor: {
          apply({ event, participant }) {
            const content = readResponderAnswer(event.payload);
            const result: AskResponse = {
              address: request.address,
              prediction: request.prediction,
              agents: [
                { agent: 'TxAnalyst', content: analystFacts },
                { agent: 'Responder', content },
              ],
              evidence: [...modelEvidence, ...etherscanEvidence],
            };
            const payload: AnalysisCompletedPayload = { requestId, response: result };
            sendEvent(
              SemanticEvent.create('analysis.completed', participant.getId(), payload),
              participant.getId(),
            );
          },
        },
      },
    ],
  });

  const observer = createHuman({
    name: 'Observer',
    capabilities: [],
    handlers: [
      {
        specification: new ForRequest('analysis.completed', requestId),
        processor: {
          apply({ event }) {
            resolveAnswer((event.payload as AnalysisCompletedPayload).response);
          },
        },
      },
      {
        specification: new ForRequest('analysis.failed', requestId),
        processor: {
          apply({ event }) {
            rejectAnswer(new Error((event.payload as AnalysisFailedPayload).error));
          },
        },
      },
    ],
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('analysis timeout')), timeoutMs);
  });

  join(gateway);
  join(responder);
  join(analyst);
  join(analystObserver);
  join(responderObserver);
  join(observer);

  const requestPayload: RequestPayload = {
    requestId,
    address: request.address,
    question: request.user_request,
    prediction: request.prediction,
  };
  sendEvent(
    SemanticEvent.create('analysis.requested', gateway.getId(), requestPayload),
    gateway.getId(),
  );

  try {
    return await Promise.race([answer, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    leave(observer);
    leave(responderObserver);
    leave(analystObserver);
    leave(analyst);
    leave(responder);
    leave(gateway);
  }
}
