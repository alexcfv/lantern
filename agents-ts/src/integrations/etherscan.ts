import type { Tool } from '@mozaik-ai/core';
import { z } from 'zod';

export type EtherscanConfig = {
  apiKey: string;
  chainId: number;
  baseUrl: string;
  timeoutMs: number;
  limit: number;
};

type EtherscanAction = 'txlist' | 'tokentx';

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

export type TransactionSummary = {
  address: string;
  chainId: number;
  regularCount: number;
  tokenCount: number;
  counterparties: string[];
  tokenSymbols: string[];
  firstDate: string | null;
  lastDate: string | null;
  largestEth: number;
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

export class EtherscanClient {
  constructor(private readonly config: EtherscanConfig) {}

  async getTransactionSummary(address: string): Promise<TransactionSummary> {
    if (!this.config.apiKey) {
      throw new Error('ETHERSCAN_API_KEY is not set');
    }

    const [regular, tokens] = await Promise.all([
      this.fetchTransactions(address, 'txlist'),
      this.fetchTransactions(address, 'tokentx'),
    ]);

    const timestamps = [...regular, ...tokens]
      .map((transaction) => toDate(transaction.timeStamp))
      .filter((date): date is string => date !== null)
      .sort();

    const largestEth = regular.reduce(
      (maximum, transaction) => Math.max(maximum, weiToEth(transaction.value)),
      0,
    );

    const lowerAddress = address.toLowerCase();
    const counterparties = [
      ...new Set(
        [...regular, ...tokens]
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

export function createTransactionHistoryTool(client: EtherscanClient): Tool {
  return {
    type: 'function',
    name: 'get_transaction_history',
    description: 'Fetch real transaction history for an Ethereum address from Etherscan.',
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
      const address = z.string().min(1).parse(args.address);
      return client.getTransactionSummary(address);
    },
  };
}
