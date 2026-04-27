/**
 * Computes the BZZ amount required to fund a stamp of a given depth + duration.
 *
 * Formula (from the original app, unchanged):
 *   chunks               = 2 ** depth
 *   pricePerChunkPerBlock = oracle.currentPrice()  (uint32 plana, BZZ per chunk per block)
 *   blocksPerSecond       = 0.2  (Gnosis ≈ 5s blocks)
 *   ttlBlocks             = days * 86400 * 0.2
 *   bzzWei                = chunks * pricePerChunkPerBlock * ttlBlocks
 *
 * BZZ has 16 decimals on Gnosis. The price oracle's currentPrice is denominated
 * in BZZ wei per chunk per block.
 *
 * We don't display USD here — that comes from the Relay quote's `currencyIn.amountUsd`.
 */

import { decodeFunctionResult, encodeFunctionData } from 'viem';
import { PRICE_ORACLE_ABI } from './abis';
import { GNOSIS_PRICE_ORACLE_ADDRESS } from './constants';
import { gnosisEthCall } from './ethereum';

const FALLBACK_PRICE_PER_CHUNK_PER_BLOCK = 65000n;
const BLOCKS_PER_SECOND = 0.2;

export async function fetchCurrentPrice(): Promise<bigint> {
  try {
    const data = encodeFunctionData({
      abi: PRICE_ORACLE_ABI,
      functionName: 'currentPrice',
    });
    const raw = await gnosisEthCall(GNOSIS_PRICE_ORACLE_ADDRESS, data);
    const decoded = decodeFunctionResult({
      abi: PRICE_ORACLE_ABI,
      functionName: 'currentPrice',
      data: raw as `0x${string}`,
    });
    return BigInt(decoded as number);
  } catch (err) {
    console.error('fetchCurrentPrice fallback:', err);
    return FALLBACK_PRICE_PER_CHUNK_PER_BLOCK;
  }
}

/**
 * Returns initialBalancePerChunk (BZZ wei per chunk) for the requested
 * `days`, plus the total BZZ amount the user owes.
 */
export async function computeStampBzzAmount(opts: { depth: number; days: number }): Promise<{
  initialBalancePerChunk: bigint;
  totalBzz: bigint;
  pricePerChunkPerBlock: bigint;
}> {
  const price = await fetchCurrentPrice();
  const ttlBlocks = BigInt(Math.floor(opts.days * 86400 * BLOCKS_PER_SECOND));
  const initialBalancePerChunk = price * ttlBlocks;
  const chunks = 1n << BigInt(opts.depth);
  const totalBzz = initialBalancePerChunk * chunks;
  return {
    initialBalancePerChunk,
    totalBzz,
    pricePerChunkPerBlock: price,
  };
}
