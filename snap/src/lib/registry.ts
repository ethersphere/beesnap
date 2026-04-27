/**
 * Reads the on-chain stamps registry on Gnosis to list all batches owned by
 * a given address. Uses viem's encode/decode helpers + a public Gnosis RPC.
 *
 * The registry is the source of truth for "what stamps does this user own."
 * Per-stamp runtime info (utilization, TTL) still comes from the Bee node via
 * the backend proxy in `bee.ts`.
 */

import {
  decodeFunctionResult,
  encodeFunctionData,
} from 'viem';
import { REGISTRY_ABI } from './abis';
import { GNOSIS_CUSTOM_REGISTRY_ADDRESS } from './constants';
import { gnosisEthCall } from './ethereum';

export interface RegistryBatch {
  /** 32-byte batch ID, hex with 0x prefix. */
  batchId: `0x${string}`;
  /** Total amount paid (BZZ wei). */
  totalAmount: bigint;
  normalisedBalance: bigint;
  nodeAddress: string;
  payer: string;
  depth: number;
  bucketDepth: number;
  immutable: boolean;
  /** Unix seconds — when the stamp was registered. */
  timestamp: number;
}

/** Fetch every batch the registry has recorded for `owner`. */
export async function getOwnerBatches(owner: string): Promise<RegistryBatch[]> {
  const data = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: 'getOwnerBatches',
    args: [owner as `0x${string}`],
  });

  const raw = await gnosisEthCall(GNOSIS_CUSTOM_REGISTRY_ADDRESS, data);

  const decoded = decodeFunctionResult({
    abi: REGISTRY_ABI,
    functionName: 'getOwnerBatches',
    data: raw as `0x${string}`,
  });

  // viem returns the tuple array as `readonly { ... }[]`. Convert + normalise.
  return (decoded as readonly any[]).map((b) => ({
    batchId: b.batchId as `0x${string}`,
    totalAmount: BigInt(b.totalAmount),
    normalisedBalance: BigInt(b.normalisedBalance),
    nodeAddress: b.nodeAddress as string,
    payer: b.payer as string,
    depth: Number(b.depth),
    bucketDepth: Number(b.bucketDepth),
    immutable: Boolean(b.immutable_),
    timestamp: Number(b.timestamp),
  }));
}
