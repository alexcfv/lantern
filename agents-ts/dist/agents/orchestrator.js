import { randomUUID } from 'node:crypto';
import { createAgent, createHuman, defineRuntime, RuntimeState, SemanticEvent, SituationSpecification, } from '@mozaik-ai/core';
import { InMemoryTxRepository } from '../db/repository.js';
class ForRequest extends SituationSpecification {
    type;
    requestId;
    constructor(type, requestId) {
        super();
        this.type = type;
        this.requestId = requestId;
    }
    isSatisfiedBy({ event, participant }) {
        const payload = event.payload;
        return (event.type === this.type &&
            payload?.requestId === this.requestId &&
            event.producerId !== participant.getId());
    }
}
class AppState extends RuntimeState {
    answers = new Map();
}
const { initializeRuntime, join, leave, sendEvent } = defineRuntime();
initializeRuntime({ state: new AppState() });
const defaultRepository = new InMemoryTxRepository();
export async function runAnalysis(request, timeoutMs = 10_000, repository = defaultRepository) {
    const requestId = randomUUID();
    let resolveAnswer;
    let rejectAnswer;
    const answer = new Promise((resolve, reject) => {
        resolveAnswer = resolve;
        rejectAnswer = reject;
    });
    const gateway = createHuman({ name: 'Gateway', capabilities: [], handlers: [] });
    const responderHandlers = [
        {
            specification: new ForRequest('analysis.requested', requestId),
            processor: {
                apply({ participant }) {
                    const payload = {
                        requestId,
                        address: request.address,
                        question: request.user_request,
                    };
                    sendEvent(SemanticEvent.create('enrichment.requested', participant.getId(), payload), participant.getId());
                },
            },
        },
        {
            specification: new ForRequest('enrichment.completed', requestId),
            processor: {
                apply({ event, participant }) {
                    const facts = event.payload;
                    const agents = [
                        { agent: 'TxAnalyst', content: facts.summary },
                        {
                            agent: 'Responder',
                            content: `Адрес ${facts.address}: вердикт модели «${request.prediction.verdict}». ${facts.summary}`,
                        },
                    ];
                    const result = {
                        address: request.address,
                        prediction: request.prediction,
                        agents,
                    };
                    const payload = { requestId, response: result };
                    sendEvent(SemanticEvent.create('analysis.completed', participant.getId(), payload), participant.getId());
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
    const analystHandlers = [
        {
            specification: new ForRequest('enrichment.requested', requestId),
            processor: {
                async apply({ participant }) {
                    try {
                        const [features, transactions, scam] = await Promise.all([
                            repository.getWalletFeatures(request.address),
                            repository.getTransactionSummary(request.address),
                            repository.findScamWallet(request.address),
                        ]);
                        const payload = {
                            requestId,
                            address: request.address,
                            summary: `Скам-лист: ${scam ? 'найдена запись' : 'нет записи'}. История: ${transactions.count} транзакций. Фичи в БД: ${features ? 'есть' : 'нет'}.`,
                        };
                        sendEvent(SemanticEvent.create('enrichment.completed', participant.getId(), payload), participant.getId());
                    }
                    catch (error) {
                        const payload = {
                            requestId,
                            error: error instanceof Error ? error.message : String(error),
                        };
                        sendEvent(SemanticEvent.create('analysis.failed', participant.getId(), payload), participant.getId());
                    }
                },
            },
        },
    ];
    const analyst = createAgent({
        name: 'TxAnalyst',
        capabilities: ['db'],
        instruction: 'Return only facts from the repository, never a verdict.',
        tools: [],
        handlers: analystHandlers,
    });
    const observer = createHuman({
        name: 'Observer',
        capabilities: [],
        handlers: [
            {
                specification: new ForRequest('analysis.completed', requestId),
                processor: {
                    apply({ event }) {
                        resolveAnswer(event.payload.response);
                    },
                },
            },
            {
                specification: new ForRequest('analysis.failed', requestId),
                processor: {
                    apply({ event }) {
                        rejectAnswer(new Error(event.payload.error));
                    },
                },
            },
        ],
    });
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('analysis timeout')), timeoutMs);
    });
    join(gateway);
    join(responder);
    join(analyst);
    join(observer);
    const requestPayload = {
        requestId,
        address: request.address,
        question: request.user_request,
        prediction: request.prediction,
    };
    sendEvent(SemanticEvent.create('analysis.requested', gateway.getId(), requestPayload), gateway.getId());
    try {
        return await Promise.race([answer, timeout]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
        leave(observer);
        leave(analyst);
        leave(responder);
        leave(gateway);
    }
}
