/**
 * Gnosis chain access for the Beesnap Snap.
 *
 * v1.0 used the user's MetaMask account through `endowment:ethereum-provider`
 * for `eth_sendTransaction` and `personal_sign`. That approach doesn't work:
 * Snaps cannot call `eth_sendTransaction`. So in v1.5 we sign *and* send
 * everything ourselves using the Snap-derived account from `wallet.ts`,
 * broadcasting raw txs over public Gnosis RPCs via `fetch`.
 *
 * Three things this module does:
 *   1. Read-only `eth_call` against Gnosis (public RPC roundtrip).
 *   2. Sign + broadcast a transaction with the Snap-derived account.
 *   3. Sign an EIP-191 message with that account (used for upload auth).
 *   4. Wait for a Gnosis tx receipt.
 *
 * Errors are surfaced verbatim (per project rule: no mock data, no fake
 * success). If every public RPC fails, the call throws and the caller is
 * responsible for showing the message to the user.
 */

import { CHAIN_RPCS, GNOSIS_CHAIN_ID, GNOSIS_RPCS } from './constants';
import { getBeesnapAccount } from './wallet';

function rpcsForChain(chainId: number): string[] {
  const list = CHAIN_RPCS[chainId];
  if (list && list.length > 0) {
    return list;
  }
  if (chainId === GNOSIS_CHAIN_ID) {
    return GNOSIS_RPCS;
  }
  throw new Error(
    `No RPC list configured for chainId ${chainId}. Add it to CHAIN_RPCS in constants.ts.`,
  );
}

// ── eth_call (read-only) ─────────────────────────────────────────────────────

/**
 * eth_call against Gnosis. Tries each public RPC in order; surfaces the last
 * error if every RPC fails.
 */
export async function gnosisEthCall(
  to: string,
  data: string,
): Promise<string> {
  let lastErr: unknown = null;
  for (const rpc of GNOSIS_RPCS) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to, data }, 'latest'],
        }),
      });
      if (!res.ok) {
        lastErr = new Error(`${rpc} returned ${res.status}`);
        continue;
      }
      const json = (await res.json()) as {
        result?: string;
        error?: { message: string };
      };
      if (json.error) {
        lastErr = new Error(json.error.message);
        continue;
      }
      if (typeof json.result !== 'string') {
        lastErr = new Error('eth_call returned no result');
        continue;
      }
      return json.result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `eth_call to Gnosis failed across all public RPCs: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

// ── Receipt polling ──────────────────────────────────────────────────────────

/**
 * Wait for a transaction receipt on any chain the Snap is configured to use.
 */
export async function waitForChainReceipt(
  txHash: string,
  chainId: number,
  timeoutMs = 5 * 60 * 1000,
  intervalMs = 4000,
): Promise<{ status: 'success' | 'reverted' }> {
  const rpcs = rpcsForChain(chainId);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const rpc of rpcs) {
      try {
        const res = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getTransactionReceipt',
            params: [txHash],
          }),
        });
        const json = (await res.json()) as {
          result?: { status: string };
          error?: { message: string };
        };
        if (json.result && json.result.status) {
          return {
            status: json.result.status === '0x1' ? 'success' : 'reverted',
          };
        }
      } catch {
        // Try the next RPC.
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for receipt ${txHash} (chain ${chainId})`);
}

/** Wait for a Gnosis (100) transaction receipt. */
export async function waitForGnosisReceipt(
  txHash: string,
  timeoutMs = 5 * 60 * 1000,
  intervalMs = 4000,
): Promise<{ status: 'success' | 'reverted' }> {
  return waitForChainReceipt(txHash, GNOSIS_CHAIN_ID, timeoutMs, intervalMs);
}

// ── Generic JSON-RPC helper for write methods ────────────────────────────────

export async function chainJsonRpcCall<T>(
  chainId: number,
  method: string,
  params: unknown[],
): Promise<T> {
  let lastErr: unknown = null;
  for (const rpc of rpcsForChain(chainId)) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!res.ok) {
        lastErr = new Error(`${rpc} returned ${res.status}`);
        continue;
      }
      const json = (await res.json()) as {
        result?: T;
        error?: { message: string; code?: number };
      };
      if (json.error) {
        // Don't try other RPCs for genuine RPC errors (e.g. nonce too low,
        // insufficient funds, revert) — those won't differ across nodes.
        throw new Error(json.error.message);
      }
      if (typeof json.result === 'undefined') {
        lastErr = new Error(`${method} returned no result`);
        continue;
      }
      return json.result;
    } catch (err) {
      lastErr = err;
      // If the error came from json.error above we don't want to retry, but
      // we already threw so we won't get here. If we got here it was a
      // network/parse error and we DO want to try the next RPC.
    }
  }
  throw new Error(
    `${method} on chain ${chainId} failed across all public RPCs: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

// ── Read methods we need to sign + send a tx ─────────────────────────────────

/** Native balance (wei) of `address` on a chain in {@link CHAIN_RPCS}. */
export async function getNativeBalance(
  address: string,
  chainId: number,
): Promise<bigint> {
  const hex = await chainJsonRpcCall<string>(chainId, 'eth_getBalance', [
    address,
    'latest',
  ]);
  return BigInt(hex);
}

/** xDAI (native) balance on Gnosis. */
export async function getGnosisBalance(address: string): Promise<bigint> {
  return getNativeBalance(address, GNOSIS_CHAIN_ID);
}

async function getNonce(chainId: number, address: string): Promise<number> {
  const hex = await chainJsonRpcCall<string>(chainId, 'eth_getTransactionCount', [
    address,
    'pending',
  ]);
  return Number.parseInt(hex, 16);
}

async function getGasPrice(chainId: number): Promise<bigint> {
  const hex = await chainJsonRpcCall<string>(chainId, 'eth_gasPrice', []);
  return BigInt(hex);
}

async function estimateGas(
  chainId: number,
  args: { from: string; to: string; data?: string; value?: string },
): Promise<bigint> {
  try {
    const hex = await chainJsonRpcCall<string>(chainId, 'eth_estimateGas', [
      {
        from: args.from,
        to: args.to,
        data: args.data ?? '0x',
        value: args.value ?? '0x0',
      },
    ]);
    return BigInt(hex);
  } catch (err) {
    // Estimate reverts almost always mean the on-chain call would revert.
    // Common causes here: insufficient BZZ balance / allowance, batch with
    // the same nonce already exists (retry of a buy that partially landed),
    // depth too low, or the registry's createBatch preconditions failing.
    //
    // We add a hint to the original error so the user (and we) get a real
    // troubleshooting starting point in the UI rather than just "reverted".
    const original = err instanceof Error ? err.message : String(err);
    const hint =
      chainId === GNOSIS_CHAIN_ID
        ? ' not enough xDAI/BZZ on Gnosis, duplicate stamp, or the call would fail on-chain. '
        : ' not enough native gas on the source chain, or the call would fail on chain. ';
    throw new Error(
      `eth_estimateGas reverted for ${args.to}.${hint}Original: ${original}`,
    );
  }
}

// ── Sign + send transaction ──────────────────────────────────────────────────

export interface SendTxInput {
  /**
   * Chain the transaction is broadcast on (must match Relay step `data.chainId`).
   */
  chainId: number;
  /** Target contract or EOA. */
  to: string;
  /** 0x-hex calldata, or omitted for a plain ETH/xDAI transfer. */
  data?: string;
  /** 0x-hex value (wei). Defaults to 0. */
  value?: string;
  /** Override gas limit (decimal bigint). If omitted we estimate. */
  gas?: bigint;
  /** Override max-fee-per-gas (decimal bigint). If omitted we use eth_gasPrice + headroom. */
  maxFeePerGas?: bigint;
  /** Override priority fee (decimal bigint). Defaults to maxFeePerGas / 10. */
  maxPriorityFeePerGas?: bigint;
}

/**
 * Sign a transaction with the Snap-derived account and broadcast via
 * `eth_sendRawTransaction` on the given chain.
 *
 * Returns the transaction hash; follow with `waitForChainReceipt` for the
 * same `chainId`.
 */
export async function sendTx(input: SendTxInput): Promise<string> {
  const { chainId } = input;
  const account = await getBeesnapAccount();

  const [nonce, gasPrice] = await Promise.all([
    getNonce(chainId, account.address),
    getGasPrice(chainId),
  ]);

  const gasLimit =
    input.gas ??
    (await estimateGas(chainId, {
      from: account.address,
      to: input.to,
      data: input.data,
      value: input.value,
    }));

  // Add a 25% buffer to estimateGas because Gnosis blocks can vary and a
  // failed tx still costs the user gas. 25% is what most production wallets
  // use as a default safety margin.
  const gasLimitBuffered = (gasLimit * 125n) / 100n;

  // EIP-1559 on all networks we use (Gnosis, mainnet, L2s, Polygon).
  const maxFeePerGas =
    input.maxFeePerGas ?? (gasPrice * 150n) / 100n;
  const maxPriorityFeePerGas =
    input.maxPriorityFeePerGas ?? maxFeePerGas / 10n;

  const valueBig = input.value ? BigInt(input.value) : 0n;

  const signed = await account.signTransaction({
    chainId,
    type: 'eip1559',
    nonce,
    gas: gasLimitBuffered,
    maxFeePerGas,
    maxPriorityFeePerGas,
    to: input.to as `0x${string}`,
    value: valueBig,
    data: (input.data as `0x${string}`) ?? '0x',
  });

  const txHash = await chainJsonRpcCall<string>(
    chainId,
    'eth_sendRawTransaction',
    [signed],
  );
  return txHash;
}

// ── Sign personal_sign-style messages ────────────────────────────────────────

/**
 * EIP-191 personal_sign with the Snap-derived account. Used for upload auth
 * signatures the backend's verifySignature middleware checks.
 */
export async function signMessage(message: string): Promise<string> {
  const account = await getBeesnapAccount();
  return account.signMessage({ message });
}
