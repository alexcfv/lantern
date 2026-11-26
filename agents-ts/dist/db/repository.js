export class InMemoryTxRepository {
    async getWalletFeatures(_address) {
        return null;
    }
    async getTransactionSummary(_address) {
        return { count: 0, largestEth: 0 };
    }
    async findScamWallet(_address) {
        return null;
    }
}
