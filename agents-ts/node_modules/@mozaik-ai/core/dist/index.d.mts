declare abstract class ContextItem {
    abstract readonly type: string;
    getType(): string;
}

declare class FunctionCallItem extends ContextItem {
    readonly type = "function_call";
    readonly callId: string;
    readonly name: string;
    readonly args: string;
    private constructor();
    static rehydrate(data: {
        callId: string;
        name: string;
        args: string;
    }): FunctionCallItem;
}

declare abstract class ItemContent {
    abstract readonly type: string;
}

declare class OutputText extends ItemContent {
    readonly text: string;
    readonly type = "output_text";
    private constructor();
    static rehydrate(data: {
        text: string;
    }): OutputText;
}

declare class ModelMessageItem extends ContextItem {
    readonly type = "message";
    readonly role = "assistant";
    readonly content: OutputText;
    private constructor();
    static rehydrate(data: {
        text: string;
    }): ModelMessageItem;
}

declare class InputText extends ItemContent {
    readonly text: string;
    readonly type = "input_text";
    private constructor();
    static create(text: string): InputText;
    static rehydrate(data: {
        text: string;
    }): InputText;
}

declare class SummaryText extends ItemContent {
    readonly text: string;
    readonly type = "summary_text";
    private constructor();
    static rehydrate(data: {
        text: string;
    }): SummaryText;
}

declare class ReasoningItem extends ContextItem {
    readonly type = "reasoning";
    readonly content: InputText | undefined;
    readonly encryptedContent: string | undefined;
    readonly summary: SummaryText[];
    private constructor();
    static rehydrate(data: {
        content: InputText | undefined;
        encryptedContent: string | undefined;
        summary: SummaryText[];
    }): ReasoningItem;
}

declare class ModelContext {
    readonly id: string;
    readonly items: ContextItem[];
    constructor(id: string, items: ContextItem[]);
    getItems(): ContextItem[];
    addContextItems(contextItems: ContextItem[]): ModelContext;
    addContextItem(item: ContextItem): ModelContext;
    static create(): ModelContext;
    static rehydrate(data: {
        id: string;
        items: ContextItem[];
    }): ModelContext;
}

declare class UserMessageItem extends ContextItem {
    readonly type = "message";
    readonly role = "user";
    readonly content: InputText;
    private constructor();
    static create(text: string): UserMessageItem;
    static rehydrate(data: {
        text: string;
    }): UserMessageItem;
}

declare class DeveloperMessageItem extends ContextItem {
    readonly type = "message";
    readonly role = "developer";
    readonly content: InputText;
    private constructor();
    static create(text: string): DeveloperMessageItem;
    static rehydrate(data: {
        text: string;
    }): DeveloperMessageItem;
}

declare class FunctionCallOutputItem extends ContextItem {
    readonly type = "function_call_output";
    readonly callId: string;
    readonly output: InputText;
    private constructor();
    static create(callId: string, output: string): FunctionCallOutputItem;
    static rehydrate(data: {
        callId: string;
        output: InputText;
    }): FunctionCallOutputItem;
}

interface FunctionTool {
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, any>;
    strict: boolean;
    invoke: (args: any) => Promise<any>;
}
type Tool = FunctionTool;

type SituationContext$1<TEvent extends SemanticEvent = SemanticEvent> = {
    readonly event: TEvent;
    readonly participant: Participant;
};
declare abstract class SituationSpecification<TEvent extends SemanticEvent = SemanticEvent> {
    abstract isSatisfiedBy(situationContext: SituationContext$1<TEvent>): boolean;
    and(other: SituationSpecification<TEvent>): SituationSpecification<TEvent>;
    or(other: SituationSpecification<TEvent>): SituationSpecification<TEvent>;
    not(): SituationSpecification<TEvent>;
}

interface SituationHandler {
    readonly specification: SituationSpecification;
    readonly processor: SituationProcessor;
}
type SituationContext<TEvent extends SemanticEvent = SemanticEvent> = {
    readonly event: TEvent;
    readonly participant: Participant;
};
interface SituationProcessor {
    apply(context: SituationContext): void | Promise<void>;
}

type ParticipantRole = "agent" | "human";
type ParticipantManifest = {
    readonly id: string;
    readonly name: string;
    readonly role: ParticipantRole;
    readonly capabilities?: readonly string[];
};
declare abstract class Participant {
    private readonly manifest;
    private handlers;
    protected constructor(manifest: ParticipantManifest, handlers: SituationHandler[]);
    getManifest(): ParticipantManifest;
    getId(): string;
    getHandlers(): SituationHandler[];
    setHandlers(handlers: SituationHandler[]): void;
}

declare class SemanticEvent<TType extends string = string, TPayload = unknown> {
    readonly type: TType;
    readonly producerId: string;
    readonly occurredAt: Date;
    readonly payload: TPayload;
    constructor(type: TType, producerId: string, occurredAt: Date, payload: TPayload);
    static create<TType extends string = string, TPayload = unknown>(type: TType, producerId: string, payload: TPayload): SemanticEvent<TType, TPayload>;
}

interface FunctionCallRunner {
    run(call: FunctionCallItem, tool: Tool): Promise<FunctionCallOutputItem>;
}
interface FunctionCallParams {
    call: FunctionCallItem;
    inferenceInput: InferenceInput;
}

interface InterceptionHandler {
    isSatisfiedBy(transition: ExecutableTransition): boolean;
    handle(transition: ExecutableTransition): Promise<ExecutableTransition>;
}
type InterceptionOutput = {
    type: "continue";
    transition: LoopTransition;
} | {
    type: "pause";
    pendingTransition: LoopTransition;
} | {
    type: "stop";
    reason?: string;
};
interface InterceptionParams {
    pendingTransition: LoopTransition;
}

type LoopStateId = "message_received" | "inference" | "inference_streaming" | "function_call" | "model_message" | "idle";
type ReceivedMessage = {
    content: string;
    input: InferenceInput;
};
interface FunctionCallExecutionOutput {
    item: FunctionCallOutputItem;
}
interface ModelMessageParams {
    answer: ModelMessageItem;
}
interface LoopStateContract {
    message_received: {
        input: ReceivedMessage;
        output: InferenceInput;
    };
    inference: {
        input: InferenceInput;
        output: InferenceOutput;
    };
    inference_streaming: {
        input: InferenceInput;
        output: InferenceOutput;
    };
    function_call: {
        input: FunctionCallParams;
        output: FunctionCallExecutionOutput;
    };
    model_message: {
        input: ModelMessageParams;
        output: void;
    };
    interception: {
        input: InterceptionParams;
        output: InterceptionOutput;
    };
    idle: {
        input: undefined;
        output: void;
    };
}
type ExecutableLoopStateId = Exclude<LoopStateId, "idle">;
type ExecutableTransition = LoopTransition<ExecutableLoopStateId>;
type LoopStateExecution<TStateId extends ExecutableLoopStateId = ExecutableLoopStateId> = {
    [K in TStateId]: {
        stateId: K;
        input: LoopStateContract[K]["input"];
        output: LoopStateContract[K]["output"];
    };
}[TStateId];
type LoopTransition<TStateId extends LoopStateId = LoopStateId> = {
    [K in TStateId]: {
        nextStateId: K;
        input: LoopStateContract[K]["input"];
    };
}[TStateId];

declare class InputTokenDetails {
    readonly cached_tokens: number;
    constructor(cached_tokens: number);
}
declare class OutputTokenDetails {
    readonly reasoning_tokens: number;
    constructor(reasoning_tokens: number);
}
declare class TokenUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly inputTokenDetails: InputTokenDetails;
    readonly outputTokenDetails: OutputTokenDetails;
    constructor(inputTokens: number, outputTokens: number, totalTokens: number, inputTokenDetails: InputTokenDetails, outputTokenDetails: OutputTokenDetails);
}

type InferenceInput = {
    model: string;
    maxOutputTokens?: number;
    reasoningEffort?: string;
    tools?: Tool[];
    streaming?: boolean;
    structuredOutput?: StructuredOutputFormat;
    context: ModelContext;
};
type InferenceItem = FunctionCallItem | ReasoningItem | ModelMessageItem;
type InferenceOutput = {
    items: InferenceItem[];
    tokenUsage: TokenUsage | undefined;
    rowResponse: any;
};
interface InferenceRunner {
    run(request: InferenceInput): Promise<InferenceOutput>;
    stream(request: InferenceInput): AsyncGenerator<SemanticEvent>;
}

interface InferenceEndpointMapper {
    toRequest(inferenceInput: InferenceInput): any;
    toResponse(response: any): InferenceOutput;
}

interface Endpoint {
    endpointMapper: InferenceEndpointMapper;
    infer(requestParams: InferenceInput): Promise<InferenceOutput>;
    stream(requestParams: InferenceInput): AsyncIterable<SemanticEvent>;
}

type GenerativeModel = {
    endpoint: Endpoint;
    specification: ModelSpecification;
};
type ModelSpecification = {
    name: string;
    provider: string;
    supportsReasoningEffort: boolean;
    supportedReasoningEfforts: string[];
    supportsStreaming: boolean;
    contextWindowSize: number;
    supportedContextItemTypes: string[];
    maxOutputTokens: number;
    supportsFunctionCalling: boolean;
    supportsStructuredOutput: boolean;
};

interface RequestValidationRule {
    readonly name: string;
    isValid(inferenceInput: InferenceInput, model: ModelSpecification): boolean;
}

type StructuredOutputFormat = {
    name?: string;
    schema: Record<string, any>;
    strict?: boolean;
};

interface ModelContextRepository {
    save(context: ModelContext): Promise<void>;
    get(id: string): Promise<ModelContext>;
    getByProjectId(projectId: string): Promise<ModelContext[]>;
}

interface McpServerConfig {
    /** The MCP server URL, e.g. https://api.githubcopilot.com/mcp/ */
    url: string;
    /** Bearer token sent as `Authorization: Bearer <token>` (e.g. a GitHub token). */
    authToken?: string;
    /** Extra headers merged into every request (overridden by `authToken` for Authorization). */
    headers?: Record<string, string>;
    /** Client name reported to the server (defaults to "mozaik"). */
    name?: string;
}
interface McpToolSpec {
    name: string;
    description: string;
    /** JSON Schema for the tool's arguments (maps 1:1 to FunctionTool.parameters). */
    inputSchema: Record<string, any>;
}
/**
 * A thin wrapper over the MCP TypeScript SDK using the Streamable HTTP transport — what
 * remote MCP servers (e.g. GitHub's `api.githubcopilot.com/mcp/`) speak. One client per
 * server; lazily connects on first use. Infrastructure-only: the domain never sees this.
 */
declare class McpClient {
    private readonly config;
    private readonly client;
    private readonly transport;
    private connected;
    constructor(config: McpServerConfig);
    connect(): Promise<void>;
    /** The tools this server exposes. */
    listTools(): Promise<McpToolSpec[]>;
    /** Call a tool by name; returns its text output. Throws if the server flags an error. */
    callTool(name: string, args: Record<string, any>): Promise<string>;
    close(): Promise<void>;
}

/** The slice of an MCP client the registry needs — lets tests inject a fake. */
interface McpClientLike {
    listTools(): Promise<Array<{
        name: string;
        description: string;
        inputSchema: Record<string, any>;
    }>>;
    callTool(name: string, args: Record<string, any>): Promise<string>;
    close(): Promise<void>;
}
/**
 * Connects to one or more MCP servers and exposes their tools as mozaik `FunctionTool`s.
 * Each tool's `invoke()` proxies the call back to its MCP server. Because they are plain
 * FunctionTools, every provider mapper and the existing function-call loop handle them
 * with no changes — MCP support adds no new tool type and touches no provider code.
 *
 * `strict` is false: MCP servers publish arbitrary JSON Schemas that won't always satisfy
 * a provider's strict function-calling mode.
 */
declare class McpToolRegistry {
    private readonly servers;
    private readonly createClient;
    private readonly clients;
    constructor(servers: McpServerConfig[], createClient?: (config: McpServerConfig) => McpClientLike);
    /** Discover every tool across the configured servers, as FunctionTools ready to pass to a model. */
    discoverTools(): Promise<FunctionTool[]>;
    /** Close all underlying MCP connections. */
    close(): Promise<void>;
}

declare class SystemMessageItem extends ContextItem {
    readonly type = "message";
    readonly role = "system";
    readonly content: InputText;
    private constructor();
    static create(text: string): SystemMessageItem;
    static rehydrate(data: {
        text: string;
    }): SystemMessageItem;
}

declare class Memory {
    private readonly context;
    private constructor();
    getContext(): ModelContext;
    static create(): Memory;
}

declare class Agent extends Participant {
    private memory;
    private developerMessage;
    private tools;
    constructor(manifest: ParticipantManifest, developerMessage: string, tools: Tool[], memory: Memory, handlers: SituationHandler[]);
    static create({ name, instruction, tools, capabilities, handlers, }: {
        instruction: string;
        tools: Tool[];
        name: string;
        capabilities: readonly string[];
        handlers: SituationHandler[];
    }): Agent;
    getTools(): Tool[];
    getDeveloperMessage(): string;
    getMemory(): Memory;
}

declare function createAgent({ name, capabilities, instruction, tools, handlers, }: {
    name: string;
    capabilities: readonly string[];
    instruction: string;
    tools: Tool[];
    handlers: SituationHandler[];
}): Agent;

declare class Human extends Participant {
    constructor(manifest: ParticipantManifest, handlers: SituationHandler[]);
    static create({ name, capabilities, handlers, }: {
        name: string;
        capabilities: readonly string[];
        handlers: SituationHandler[];
    }): Human;
}

declare function createHuman({ name, capabilities, handlers, }: {
    name: string;
    capabilities: readonly string[];
    handlers: SituationHandler[];
}): Human;

declare abstract class RuntimeState {
    participants: Map<string, Participant>;
    addParticipant(participant: Participant): void;
    removeParticipant(participant: Participant): void;
    getParticipant(id: string): Participant | undefined;
    getParticipants(): readonly Participant[];
}

declare class EventProcessor {
    process(event: SemanticEvent, consumer: Participant): void;
}

declare class RuntimeService<TRuntimeState extends RuntimeState> {
    readonly state: TRuntimeState;
    private readonly processor;
    private readonly inferenceRunner;
    private readonly functionCallRunner;
    constructor(state: TRuntimeState, processor: EventProcessor, inferenceRunner: InferenceRunner, functionCallRunner: FunctionCallRunner);
    join(participant: Participant): void;
    leave(participant: Participant): void;
    publish(event: SemanticEvent): void;
    getParticipant(id: string): Participant | undefined;
    getInferenceRunner(): InferenceRunner;
    getFunctionCallRunner(): FunctionCallRunner;
}

type InferenceRunnerConfig = {
    supportedModels?: GenerativeModel[];
    runner?: InferenceRunner;
};
declare function defineRuntime<TRuntimeState extends RuntimeState>(): {
    initializeRuntime: (config: {
        state: TRuntimeState;
        inferenceRunnerConfig?: InferenceRunnerConfig;
    }) => RuntimeService<TRuntimeState>;
    resolveRuntime: () => RuntimeService<TRuntimeState>;
    resolveParticipant: (id: string) => Participant;
    join: (participant: Participant) => void;
    leave: (participant: Participant) => void;
    sendMessage: (message: string, senderId: string) => void;
    sendEvent: (event: SemanticEvent, senderId: string) => void;
    runLoop: (agentId: string, message: string, inferenceInput: InferenceInput, interceptionHandler?: InterceptionHandler) => void;
};

declare const supportedModels: GenerativeModel[];

/**
 * Optional connection config. When omitted, the `openai` SDK reads
 * `OPENAI_API_KEY` and `OPENAI_BASE_URL` from the environment.
 */
interface OpenAIResponsesConfig {
    baseURL?: string;
    apiKey?: string;
}
declare class OpenAIResponses implements Endpoint {
    endpointMapper: InferenceEndpointMapper;
    private _client?;
    private readonly clientConfig;
    constructor(endpointMapper?: InferenceEndpointMapper, config?: OpenAIResponsesConfig);
    private get client();
    infer(inferenceInput: InferenceInput): Promise<InferenceOutput>;
    stream(inferenceInput: InferenceInput): AsyncIterable<SemanticEvent>;
}

/**
 * Optional connection config. When omitted, the `openai` SDK reads
 * `OPENAI_API_KEY` and `OPENAI_BASE_URL` from the environment, so the
 * default-constructed runtime targets whatever `OPENAI_BASE_URL` points
 * at (real OpenAI when unset). Provider presets (e.g. DeepSeek) pass an
 * explicit base URL + credential.
 */
interface OpenAICompatibleConfig {
    baseURL?: string;
    apiKey?: string;
    /**
     * Extra request-body fields merged into every `chat.completions`
     * call. This is how provider-specific quirks are handled **without
     * a per-provider subclass in mozaik** — the consumer supplies the
     * vendor-only fields (e.g. DeepSeek's `{ thinking: { type } }`,
     * safety flags, routing hints). Standard fields the runtime already
     * sets (`model`, `messages`, `tools`, `reasoning_effort`) take
     * precedence and are not overwritten.
     */
    extraBody?: Record<string, unknown>;
}
/**
 * Generic adapter for any **OpenAI Chat Completions**-compatible
 * endpoint — real OpenAI, DeepSeek, Xiaomi MiMo, OpenRouter, vLLM,
 * Ollama, etc. It speaks `/chat/completions` (not the Responses API),
 * which is the dialect third-party OpenAI-compatible providers expose.
 *
 * The base URL and credential are configurable; everything else (the
 * `ModelContext` ⇄ chat-message conversion, tool-call round-trip, token
 * usage extraction) is provider-agnostic. Provider-specific request
 * shaping (e.g. DeepSeek's `thinking` field) is supplied by the
 * consumer via {@link OpenAICompatibleConfig.extraBody} — mozaik stays
 * generic and gains no per-provider subclasses.
 *
 * Was `DeepSeekChatCompletions`; generalized so consumers can point it
 * at any OpenAI-compatible endpoint.
 */
declare class OpenAIChatCompletions implements Endpoint {
    endpointMapper: InferenceEndpointMapper;
    private _client?;
    private readonly clientConfig;
    private readonly extraBody;
    constructor(endpointMapper?: InferenceEndpointMapper, config?: OpenAICompatibleConfig);
    private get client();
    private buildRequest;
    infer(inferenceInput: InferenceInput): Promise<InferenceOutput>;
    stream(inferenceInput: InferenceInput): AsyncIterable<SemanticEvent>;
}

interface AnthropicConnectionConfig {
    baseURL?: string;
    apiKey?: string;
}
/**
 * Native Anthropic adapter on the `@anthropic-ai/sdk` (`messages.create`).
 * Maps domain context to Anthropic's `messages`/`content` blocks shape,
 * system prompt, tools, adaptive thinking, and structured output config.
 */
declare class AnthropicMessages implements Endpoint {
    endpointMapper: InferenceEndpointMapper;
    private _client?;
    private readonly clientConfig;
    constructor(endpointMapper?: InferenceEndpointMapper, config?: AnthropicConnectionConfig);
    private get client();
    infer(inferenceInput: InferenceInput): Promise<InferenceOutput>;
    stream(inferenceInput: InferenceInput): AsyncIterable<SemanticEvent>;
}

interface GeminiConnectionConfig {
    baseURL?: string;
    apiKey?: string;
}
/**
 * Native Gemini adapter on the `@google/genai` SDK (`generateContent` /
 * `generateContentStream`). Unlike an OpenAI-compat shim this maps our
 * domain context to Gemini's native `contents`/`parts` shape, system
 * instruction, `functionDeclarations`, and `thinkingConfig`, and reads
 * thought parts + native usage metadata back out. Another `ModelRuntime`
 * — no runner or port changes.
 */
declare class GeminiGenerateContent implements Endpoint {
    endpointMapper: InferenceEndpointMapper;
    private _client?;
    private readonly clientConfig;
    constructor(endpointMapper?: InferenceEndpointMapper, config?: GeminiConnectionConfig);
    private get client();
    infer(inferenceInput: InferenceInput): Promise<InferenceOutput>;
    stream(inferenceInput: InferenceInput): AsyncIterable<SemanticEvent>;
}

declare class InferenceInputValidator {
    private readonly rules;
    constructor(rules?: RequestValidationRule[]);
    validate(inferenceInput: InferenceInput, model: ModelSpecification): void;
}

declare class DefaultInferenceRunner implements InferenceRunner {
    private readonly supportedModels;
    private readonly requestValidator;
    constructor(supportedModels: GenerativeModel[], requestValidator: InferenceInputValidator);
    run(input: InferenceInput): Promise<InferenceOutput>;
    stream(input: InferenceInput): AsyncGenerator<SemanticEvent>;
}

export { Agent, AnthropicMessages, ContextItem, DefaultInferenceRunner, DeveloperMessageItem, type Endpoint, type ExecutableLoopStateId, type ExecutableTransition, FunctionCallItem, FunctionCallOutputItem, GeminiGenerateContent, Human, type InferenceInput, type InferenceOutput, type InferenceRunner, type InferenceRunnerConfig, InputTokenDetails, type InterceptionHandler, type LoopStateExecution, type LoopTransition, McpClient, type McpServerConfig, McpToolRegistry, type McpToolSpec, ModelContext, type ModelContextRepository, ModelMessageItem, OpenAIChatCompletions, OpenAIResponses, OutputTokenDetails, Participant, ReasoningItem, RuntimeState, SemanticEvent, type SituationContext, type SituationHandler, type SituationProcessor, SituationSpecification, type StructuredOutputFormat, SystemMessageItem, TokenUsage, type Tool, UserMessageItem, createAgent, createHuman, defineRuntime, supportedModels };
