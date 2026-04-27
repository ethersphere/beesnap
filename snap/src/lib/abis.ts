/**
 * Contract ABIs the Snap reads/encodes against. Trimmed to only the entries
 * the Snap actually uses; unchanged from the original app.
 */

export const REGISTRY_ABI = [
  {
    inputs: [{ internalType: 'address', name: '_owner', type: 'address' }],
    name: 'getOwnerBatches',
    outputs: [
      {
        components: [
          { internalType: 'bytes32', name: 'batchId', type: 'bytes32' },
          { internalType: 'uint256', name: 'totalAmount', type: 'uint256' },
          { internalType: 'uint256', name: 'normalisedBalance', type: 'uint256' },
          { internalType: 'address', name: 'nodeAddress', type: 'address' },
          { internalType: 'address', name: 'payer', type: 'address' },
          { internalType: 'uint8', name: 'depth', type: 'uint8' },
          { internalType: 'uint8', name: 'bucketDepth', type: 'uint8' },
          { internalType: 'bool', name: 'immutable_', type: 'bool' },
          { internalType: 'uint256', name: 'timestamp', type: 'uint256' },
        ],
        internalType: 'struct StampsRegistry.BatchInfo[]',
        name: '',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const PRICE_ORACLE_ABI = [
  {
    name: 'currentPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint32' }],
  },
] as const;

export const ERC20_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Postage stamps contract ABI — only the entries the Snap encodes for
 * createBatchRegistry (used by Relay's `txs` array on Gnosis-direct buys).
 */
export const POSTAGE_STAMP_ABI = [
  {
    inputs: [
      { name: '_owner', type: 'address' },
      { name: '_nodeAddress', type: 'address' },
      { name: '_initialBalancePerChunk', type: 'uint256' },
      { name: '_depth', type: 'uint8' },
      { name: '_bucketDepth', type: 'uint8' },
      { name: '_nonce', type: 'bytes32' },
      { name: '_immutable', type: 'bool' },
    ],
    name: 'createBatchRegistry',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;
