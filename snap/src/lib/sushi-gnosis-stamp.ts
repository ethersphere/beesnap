/**
 * USDC (Relay bridge token) → BZZ max-in + path for the "Relay → USDC on Gnosis →
 * SushiSwapStampsRouter.createBatch" flow. Matches `SushiQuotes.findSushiRoutes` +
 * quote, using `gnosisEthCall` instead of a viem public client.
 */

import { decodeFunctionResult, encodeFunctionData, encodePacked, parseAbi } from 'viem';
import { gnosisEthCall } from './ethereum';
import {
  GNOSIS_BZZ_ADDRESS,
  GNOSIS_WXDAI_ADDRESS,
  SUSHI_FACTORY_ADDRESS,
  SUSHI_STAMPS_ROUTER_ADDRESS,
  RELAY_BRIDGE_TOKEN_ON_GNOSIS,
} from './constants';
import { SUSHI_STAMPS_ROUTER_ABI } from './abis';

const GNOSIS_USDC_BRIDGED = '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83';
const FEE_TIERS = [3000, 500, 10000, 100] as const;
const ZERO = '0x0000000000000000000000000000000000000000';

const POOL_LIQ_ABI = parseAbi(['function liquidity() view returns (uint128)']);
const FACTORY_ABI = parseAbi([
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
]);

type Route = {
  path: `0x${string}`;
  isNative: boolean;
  fees: number[];
  description: string;
};

function encodeSingleHopPath(tokenIn: string, fee: number): `0x${string}` {
  return encodePacked(
    ['address', 'uint24', 'address'],
    [GNOSIS_BZZ_ADDRESS as `0x${string}`, fee, tokenIn as `0x${string}`],
  );
}

function encodeTwoHopPath(
  tokenIn: string,
  fee1: number,
  mid: string,
  fee2: number,
): `0x${string}` {
  return encodePacked(
    ['address', 'uint24', 'address', 'uint24', 'address'],
    [
      GNOSIS_BZZ_ADDRESS as `0x${string}`,
      fee2,
      mid as `0x${string}`,
      fee1,
      tokenIn as `0x${string}`,
    ],
  );
}

async function poolHasLiquidity(pool: `0x${string}`): Promise<boolean> {
  if (!pool || pool.toLowerCase() === ZERO) return false;
  try {
    const data = encodeFunctionData({
      abi: POOL_LIQ_ABI,
      functionName: 'liquidity',
    });
    const r = await gnosisEthCall(pool, data);
    return BigInt(r) > 0n;
  } catch {
    return false;
  }
}

async function findDirectBzzPool(
  tokenIn: string,
): Promise<{ pool: `0x${string}`; fee: number } | null> {
  for (const fee of FEE_TIERS) {
    try {
      const pData = encodeFunctionData({
        abi: FACTORY_ABI,
        functionName: 'getPool',
        args: [tokenIn as `0x${string}`, GNOSIS_BZZ_ADDRESS as `0x${string}`, fee],
      });
      const raw = await gnosisEthCall(SUSHI_FACTORY_ADDRESS, pData);
      const pool = decodeFunctionResult({
        abi: FACTORY_ABI,
        functionName: 'getPool',
        data: raw as `0x${string}`,
      });
      if (!pool || String(pool).toLowerCase() === ZERO) continue;
      const p = String(pool) as `0x${string}`;
      if (await poolHasLiquidity(p)) {
        return { pool: p, fee };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

const poolPairCache: Record<string, { pool: `0x${string}`; fee: number } | null> = {};

async function findPoolBetween(
  tokenA: string,
  tokenB: string,
): Promise<{ pool: `0x${string}`; fee: number } | null> {
  const key = [tokenA.toLowerCase(), tokenB.toLowerCase()].sort().join(':');
  if (key in poolPairCache) {
    return poolPairCache[key];
  }

  for (const fee of FEE_TIERS) {
    try {
      const pData = encodeFunctionData({
        abi: FACTORY_ABI,
        functionName: 'getPool',
        args: [tokenA as `0x${string}`, tokenB as `0x${string}`, fee],
      });
      const raw = await gnosisEthCall(SUSHI_FACTORY_ADDRESS, pData);
      const pool = decodeFunctionResult({
        abi: FACTORY_ABI,
        functionName: 'getPool',
        data: raw as `0x${string}`,
      });
      if (!pool || String(pool).toLowerCase() === ZERO) continue;
      const p = String(pool) as `0x${string}`;
      if (await poolHasLiquidity(p)) {
        const v = { pool: p, fee };
        poolPairCache[key] = v;
        return v;
      }
    } catch {
      /* */
    }
  }
  poolPairCache[key] = null;
  return null;
}

/** Same ordering as the web's `findSushiRoutes` for a non-xDAI ERC-20. */
export async function findSushiRoutesForFromToken(
  fromToken: string,
): Promise<Route[]> {
  const routes: Route[] = [];
  const effective = fromToken;

  const direct = await findDirectBzzPool(effective);
  if (direct) {
    routes.push({
      path: encodeSingleHopPath(effective, direct.fee),
      isNative: false,
      fees: [direct.fee],
      description: `USDC (or token) direct → BZZ`,
    });
  }

  if (effective.toLowerCase() !== GNOSIS_USDC_BRIDGED.toLowerCase()) {
    const [a, b] = await Promise.all([
      findPoolBetween(effective, GNOSIS_USDC_BRIDGED),
      findDirectBzzPool(GNOSIS_USDC_BRIDGED),
    ]);
    if (a && b) {
      routes.push({
        path: encodeTwoHopPath(effective, a.fee, GNOSIS_USDC_BRIDGED, b.fee),
        isNative: false,
        fees: [a.fee, b.fee],
        description: `token → USDC (bridged) → BZZ`,
      });
    }
  }

  if (effective.toLowerCase() !== GNOSIS_WXDAI_ADDRESS.toLowerCase()) {
    const [a, b] = await Promise.all([
      findPoolBetween(effective, GNOSIS_WXDAI_ADDRESS),
      findDirectBzzPool(GNOSIS_WXDAI_ADDRESS),
    ]);
    if (a && b) {
      routes.push({
        path: encodeTwoHopPath(effective, a.fee, GNOSIS_WXDAI_ADDRESS, b.fee),
        isNative: false,
        fees: [a.fee, b.fee],
        description: `token → WXDAI → BZZ`,
      });
    }
  }

  return routes;
}

/**
 * For Relay bridge USDC (Circle native on Gnosis), returns max USDC in (with
 * slippage) to receive `bzzAmountOut` BZZ via Sushi, plus the encoded V3 path.
 */
export async function getBridgeUsdcToBzzPathAndMaxIn(
  bzzAmountOut: bigint,
  slippagePercent: number,
): Promise<{ maxAmountIn: bigint; path: `0x${string}`; routeDescription: string }> {
  const fromToken = RELAY_BRIDGE_TOKEN_ON_GNOSIS;
  const routes = await findSushiRoutesForFromToken(fromToken);

  if (routes.length === 0) {
    throw new Error(
      'No SushiSwap pool route from USDC to BZZ on Gnosis. Try again later or use a smaller size.',
    );
  }

  let lastErr: unknown;
  for (const candidate of routes) {
    const isSingle = candidate.fees.length === 1;
    try {
      let data: `0x${string}`;
      if (isSingle) {
        data = encodeFunctionData({
          abi: SUSHI_STAMPS_ROUTER_ABI,
          functionName: 'quoteSingleHop',
          args: [fromToken as `0x${string}`, candidate.fees[0]!, bzzAmountOut],
        });
      } else {
        data = encodeFunctionData({
          abi: SUSHI_STAMPS_ROUTER_ABI,
          functionName: 'quoteMultiHop',
          args: [candidate.path, bzzAmountOut],
        });
      }

      const raw = await gnosisEthCall(SUSHI_STAMPS_ROUTER_ADDRESS, data);
      const amountInBefore = decodeFunctionResult({
        abi: SUSHI_STAMPS_ROUTER_ABI,
        functionName: isSingle ? 'quoteSingleHop' : 'quoteMultiHop',
        data: raw as `0x${string}`,
      });
      const amountIn = amountInBefore as unknown as bigint;

      const bps = BigInt(Math.round(slippagePercent * 100));
      const maxAmountIn = (amountIn * (10000n + bps)) / 10000n;

      return {
        maxAmountIn,
        path: candidate.path,
        routeDescription: candidate.description,
      };
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(
    `Could not quote USDC → BZZ: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}
