import type { Tool } from '@mozaik-ai/core';
import { z } from 'zod';
import type { EvidenceItem } from '../schemas.js';

export type EtherscanConfig = {
  apiKey: string;
  chainId: number;
  baseUrl: string;
  timeoutMs: number;
  limit: number;
};

type EtherscanAction = 'txlist' | 'tokentx' | 'txlistinternal';

const etherscanTxSchema = z.object({
  hash: z.string().optional(),
  from: z.string(),
  to: z.string(),
  value: z.string(),
  timeStamp: z.string(),
  tokenSymbol: z.string().optional(),
});

const etherscanResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  result: z.union([z.array(etherscanTxSchema), z.string()]),
});

type EtherscanTx = z.infer<typeof etherscanTxSchema>;

export type TransactionSummary = {
  address: string;
  chainId: number;
  regularCount: number;
  tokenCount: number;
  internalCount: number;
  counterparties: string[];
  tokenSymbols: string[];
  firstDate: string | null;
  lastDate: string | null;
  largestEth: number;
  receivedEth: number;
  sentEth: number;
  sentReceivedRatio: number | null;
  sentPercent: number | null;
  burstGapMinutes: number | null;
};

function weiToEth(value: string): number {
  try {
    return Number(BigInt(value)) / 1e18;
  } catch {
    return 0;
  }
}

function toDate(timestamp: string): string | null {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function isEmptyResult(message: string, result: string): boolean {
  return `${message} ${result}`.toLowerCase().includes('no transactions found');
}

function sumEth(
  transactions: EtherscanTx[],
  address: string,
  direction: 'in' | 'out',
): number {
  const lowerAddress = address.toLowerCase();
  return transactions
    .filter((transaction) =>
      direction === 'in'
        ? transaction.to.toLowerCase() === lowerAddress
        : transaction.from.toLowerCase() === lowerAddress,
    )
    .reduce((sum, transaction) => sum + weiToEth(transaction.value), 0);
}

function findBurstGapMinutes(
  transactions: EtherscanTx[],
  address: string,
): number | null {
  const lowerAddress = address.toLowerCase();
  const windowSeconds = 600;
  const inflows = transactions
    .filter(
      (transaction) =>
        transaction.to.toLowerCase() === lowerAddress && weiToEth(transaction.value) > 0,
    )
    .map((transaction) => Number(transaction.timeStamp))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0)
    .sort((left, right) => left - right);
  const outflows = transactions
    .filter(
      (transaction) =>
        transaction.from.toLowerCase() === lowerAddress && weiToEth(transaction.value) > 0,
    )
    .map((transaction) => Number(transaction.timeStamp))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0)
    .sort((left, right) => left - right);

  if (inflows.length < 2 || outflows.length === 0) return null;

  let burst = { count: 0, end: 0 };
  for (let start = 0; start < inflows.length; start += 1) {
    let end = start + 1;
    while (end < inflows.length && inflows[end] - inflows[start] <= windowSeconds) {
      end += 1;
    }
    if (end - start > burst.count) {
      burst = { count: end - start, end: inflows[end - 1] };
    }
  }

  if (burst.count < 2) return null;
  const nextOutflow = outflows.find((timestamp) => timestamp > burst.end);
  if (nextOutflow === undefined) return null;
  return Math.round(((nextOutflow - burst.end) / 60) * 100) / 100;
}

export class EtherscanClient {
  constructor(private readonly config: EtherscanConfig) {}

  async getTransactionSummary(address: string): Promise<TransactionSummary> {
    if (!this.config.apiKey) {
      throw new Error('ETHERSCAN_API_KEY is not set');
    }

    const [regular, tokens, internal] = await Promise.all([
      this.fetchTransactions(address, 'txlist'),
      this.fetchTransactions(address, 'tokentx'),
      this.fetchTransactions(address, 'txlistinternal'),
    ]);

    const ethTransactions = [...regular, ...internal];
    const timestamps = [...regular, ...tokens, ...internal]
      .map((transaction) => toDate(transaction.timeStamp))
      .filter((date): date is string => date !== null)
      .sort();

    const largestEth = ethTransactions.reduce(
      (maximum, transaction) => Math.max(maximum, weiToEth(transaction.value)),
      0,
    );
    const receivedEth = sumEth(ethTransactions, address, 'in');
    const sentEth = sumEth(ethTransactions, address, 'out');
    const sentReceivedRatio = receivedEth > 0 ? sentEth / receivedEth : null;

    const lowerAddress = address.toLowerCase();
    const counterparties = [
      ...new Set(
        [...regular, ...tokens, ...internal]
          .map((transaction) =>
            transaction.from.toLowerCase() === lowerAddress ? transaction.to : transaction.from,
          )
          .filter((party) => party.length > 0)
          .map((party) => party.toLowerCase()),
      ),
    ];

    return {
      address,
      chainId: this.config.chainId,
      regularCount: regular.length,
      tokenCount: tokens.length,
      internalCount: internal.length,
      counterparties,
      tokenSymbols: [
        ...new Set(
          tokens
            .map((transaction) => transaction.tokenSymbol)
            .filter((symbol): symbol is string => Boolean(symbol)),
        ),
      ],
      firstDate: timestamps[0] ?? null,
      lastDate: timestamps.at(-1) ?? null,
      largestEth,
      receivedEth,
      sentEth,
      sentReceivedRatio,
      sentPercent: sentReceivedRatio === null ? null : sentReceivedRatio * 100,
      burstGapMinutes: findBurstGapMinutes(ethTransactions, address),
    };
  }

  private async fetchTransactions(
    address: string,
    action: EtherscanAction,
  ): Promise<z.infer<typeof etherscanTxSchema>[]> {
    const url = new URL('/v2/api', this.config.baseUrl);
    url.searchParams.set('chainid', String(this.config.chainId));
    url.searchParams.set('module', 'account');
    url.searchParams.set('action', action);
    url.searchParams.set('address', address.trim());
    url.searchParams.set('startblock', '0');
    url.searchParams.set('endblock', '99999999');
    url.searchParams.set('page', '1');
    url.searchParams.set('offset', String(this.config.limit));
    url.searchParams.set('sort', 'asc');
    url.searchParams.set('apikey', this.config.apiKey);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Etherscan ${action} failed with HTTP ${response.status}`);
    }

    const parsed = etherscanResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(`Etherscan ${action} returned an invalid response`);
    }

    if (Array.isArray(parsed.data.result)) {
      return parsed.data.result;
    }
    if (isEmptyResult(parsed.data.message, parsed.data.result)) {
      return [];
    }

    throw new Error(`Etherscan ${action} failed: ${parsed.data.result || parsed.data.message}`);
  }
}

export function buildEtherscanEvidence(summary: TransactionSummary): EvidenceItem[] {
  const period =
    summary.firstDate && summary.lastDate
      ? `First activity on ${summary.firstDate}, last activity on ${summary.lastDate}.`
      : 'No dated Etherscan activity was found.';

  return [
    {
      id: 'etherscan.activity_period',
      claim: period,
      source: 'Etherscan data',
      detail: `Timestamps from txlist/tokentx/txlistinternal, chain ${summary.chainId}.`,
    },
    {
      id: 'etherscan.transaction_counts',
      claim: `${summary.regularCount} regular transactions, ${summary.internalCount} internal transactions, and ${summary.tokenCount} token transactions.`,
      source: 'Etherscan data',
      detail: 'Counted by our code from txlist/txlistinternal/tokentx.',
    },
    {
      id: 'etherscan.counterparties',
      claim: `${summary.counterparties.length} distinct counterparties.`,
      source: 'Etherscan data',
      detail: 'Unique from/to addresses counted by our code.',
    },
    {
      id: 'etherscan.token_symbols',
      claim: `${summary.tokenSymbols.length} distinct token symbols.`,
      source: 'Etherscan data',
      detail: 'Unique tokenSymbol values counted by our code from tokentx.',
    },
    {
      id: 'etherscan.largest_eth',
      claim: `Largest ETH transaction: ${summary.largestEth}.`,
      source: 'Etherscan data',
      detail: 'wei converted to ETH by our code from txlist/txlistinternal.',
    },
    {
      id: 'etherscan.sent_received_ratio',
      claim:
        summary.sentPercent === null
          ? 'Received ETH is zero, so the sent/received ratio is unavailable.'
          : `Sent ${summary.sentPercent.toFixed(1)}% of received ETH.`,
      source: 'Etherscan data',
      detail: 'Sent and received ETH counted by our code from normal and internal transactions.',
    },
    {
      id: 'etherscan.burst_gap',
      claim:
        summary.burstGapMinutes === null
          ? 'No inflow burst followed by an outflow was found.'
          : `An outflow followed the inflow burst after ${summary.burstGapMinutes} minutes.`,
      source: 'Etherscan data',
      detail: 'Burst = most inflows inside a 10-minute window; gap to the next outflow counted by our code.',
    },
  ];
}

export function createTransactionHistoryTool(
  client: EtherscanClient,
  allowedAddress?: string,
  onEvidence?: (evidence: EvidenceItem[]) => void,
): Tool {
  return {
    type: 'function',
    name: 'get_transaction_history',
    description:
      'Fetch real transaction history for the requested wallet only. Never use this for other addresses or global lists.',
    parameters: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Ethereum address to inspect.',
        },
      },
      required: ['address'],
      additionalProperties: false,
    },
    strict: true,
    invoke: async (args: { address?: unknown }) => {
      const address = z.string().min(1).parse(args.address).trim();
      if (allowedAddress && address.toLowerCase() !== allowedAddress.toLowerCase()) {
        throw new Error('Only the requested wallet can be inspected');
      }

      const summary = await client.getTransactionSummary(address);
      const evidence = buildEtherscanEvidence(summary);
      onEvidence?.(evidence);
      return { ...summary, evidence };
    },
  };
}
