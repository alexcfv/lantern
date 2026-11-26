import { randomUUID } from 'node:crypto';
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
} from '@mozaik-ai/core';
import { loadSettings } from '../config.js';
import { createTransactionHistoryTool, EtherscanClient } from '../integrations/etherscan.js';
import { patchGeminiFunctionCalling } from './gemini-tool-compat.js';
import type { AgentResponse, AskRequest, AskResponse } from '../schemas.js';

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

type EnrichmentCompletedPayload = {
  requestId: string;
  address: string;
  summary: string;
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

  let resolveAnswer!: (answer: AskResponse) => void;
  let rejectAnswer!: (error: Error) => void;
  const answer = new Promise<AskResponse>((resolve, reject) => {
    resolveAnswer = resolve;
    rejectAnswer = reject;
  });

  const gateway = createHuman({ name: 'Gateway', capabilities: [], handlers: [] });

  const responderHandlers: SituationHandler[] = [
    {
      specification: new ForRequest('analysis.requested', requestId),
      processor: {
        apply({ participant }) {
          const payload: EnrichmentRequestedPayload = {
            requestId,
            address: request.address,
            question: request.user_request,
          };
          sendEvent(
            SemanticEvent.create('enrichment.requested', participant.getId(), payload),
            participant.getId(),
          );
        },
      },
    },
    {
      specification: new ForRequest('enrichment.completed', requestId),
      processor: {
        apply({ event, participant }) {
          const facts = event.payload as EnrichmentCompletedPayload;
          const agents: AgentResponse[] = [
            { agent: 'TxAnalyst', content: facts.summary },
            {
              agent: 'Responder',
              content: `Адрес ${facts.address}: вердикт модели «${request.prediction.verdict}». ${facts.summary}`,
            },
          ];
          const result: AskResponse = {
            address: request.address,
            prediction: request.prediction,
            agents,
          };
          const payload: AnalysisCompletedPayload = { requestId, response: result };
          sendEvent(
            SemanticEvent.create('analysis.completed', participant.getId(), payload),
            participant.getId(),
          );
        },
      },
    },
  ];

  const responder = createAgent({
    name: 'Responder',
    capabilities: ['inference'],
    instruction: 'Answer the user using the ML verdict and facts from TxAnalyst.',
    tools: [],
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
              'Use get_transaction_history only when the user question requires real transaction history. Return concise facts, never a verdict.',
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
    instruction: 'Return only facts from Etherscan, never a verdict.',
    tools: [createTransactionHistoryTool(etherscan)],
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
    leave(analystObserver);
    leave(analyst);
    leave(responder);
    leave(gateway);
  }
}
