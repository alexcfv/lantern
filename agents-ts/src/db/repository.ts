export type WalletFeatures = {
  address: string;
  tx_in_count: number;
  eth_in: number;
  distinct_in_counterparties: number;
  first_in_ts: string;
  last_in_ts: string;
  approval_events: number;
  distinct_token_contracts: number;
};

export type TransactionSummary = {
  count: number;
  largestEth: number;
};

export type ScamWallet = {
  address: string;
  source: string;
};

export interface TxRepository {
  getWalletFeatures(address: string): Promise<WalletFeatures | null>;
  getTransactionSummary(address: string): Promise<TransactionSummary>;
  findScamWallet(address: string): Promise<ScamWallet | null>;
}

export class InMemoryTxRepository implements TxRepository {
  async getWalletFeatures(_address: string): Promise<WalletFeatures | null> {
    return null;
  }

  async getTransactionSummary(_address: string): Promise<TransactionSummary> {
    return { count: 0, largestEth: 0 };
  }

  async findScamWallet(_address: string): Promise<ScamWallet | null> {
    return null;
  }
}
