/**
 * Gnosis chain access for the Beeport Snap.
 *
 * v1.0 used the user's MetaMask account through `endowment:ethereum-provider`
 * for `eth_sendTransaction` and `personal_sign`. That approach doesn't work:
 * Snaps cannot call `eth_sendTransaction`. So in v1.5 we sign *and* send
 * everything ourselves using the Beeport account derived in `wallet.ts`,
 * broadcasting raw txs over public Gnosis RPCs via `fetch`.
 *
 * Three things this module does:
 *   1. Read-only `eth_call` against Gnosis (public RPC roundtrip).
 *   2. Sign + broadcast a transaction with the Beeport account.
 *   3. Sign an EIP-191 message with the Beeport account (used for upload auth).
 *   4. Wait for a Gnosis tx receipt.
 *
 * Errors are surfaced verbatim (per project rule: no mock data, no fake
 * success). If every public RPC fails, the call throws and the caller is
 * responsible for showing the message to the user.
 */

import { GNOSIS_CHAIN_ID, GNOSIS_RPCS } from './constants';
import { getBeeportAccount } from './wallet';

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

/** Wait for a transaction receipt by polling Gnosis RPC. */
export async function waitForGnosisReceipt(
  txHash: string,
  timeoutMs = 5 * 60 * 1000,
  intervalMs = 4000,
): Promise<{ status: 'success' | 'reverted' }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const rpc of GNOSIS_RPCS) {
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
  throw new Error(`Timed out waiting for receipt ${txHash}`);
}

// ── Generic JSON-RPC helper for write methods ────────────────────────────────

async function gnosisRpcCall<T>(
  method: string,
  params: unknown[],
): Promise<T> {
  let lastErr: unknown = null;
  for (const rpc of GNOSIS_RPCS) {
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
    `${method} on Gnosis failed across all public RPCs: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

// ── Read methods we need to sign + send a tx ─────────────────────────────────

/** xDAI balance of any address (decimal-string wei). */
export async function getGnosisBalance(address: string): Promise<bigint> {
  const hex = await gnosisRpcCall<string>('eth_getBalance', [address, 'latest']);
  return BigInt(hex);
}

async function getNonce(address: string): Promise<number> {
  const hex = await gnosisRpcCall<string>('eth_getTransactionCount', [
    address,
    'pending',
  ]);
  return Number.parseInt(hex, 16);
}

async function getGasPrice(): Promise<bigint> {
  const hex = await gnosisRpcCall<string>('eth_gasPrice', []);
  return BigInt(hex);
}

async function estimateGas(args: {
  from: string;
  to: string;
  data?: string;
  value?: string;
}): Promise<bigint> {
  try {
    const hex = await gnosisRpcCall<string>('eth_estimateGas', [
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
    throw new Error(
      `eth_estimateGas reverted for ${args.to}. Common causes: not enough xDAI/BZZ in your Beeport account, the same stamp was already created on a previous attempt (try refreshing "View my stamps"), or the call would fail on-chain. Original: ${original}`,
    );
  }
}

// ── Sign + send transaction ──────────────────────────────────────────────────

export interface SendTxInput {
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
 * Sign a transaction locally with the Beeport account and broadcast it via
 * `eth_sendRawTransaction` against a public Gnosis RPC.
 *
 * Returns the resulting transaction hash. The caller usually wants to follow
 * up with `waitForGnosisReceipt`.
 */
export async function sendTx(input: SendTxInput): Promise<string> {
  const account = await getBeeportAccount();

  const [nonce, gasPrice] = await Promise.all([
    getNonce(account.address),
    getGasPrice(),
  ]);

  const gasLimit =
    input.gas ??
    (await estimateGas({
      from: account.address,
      to: input.to,
      data: input.data,
      value: input.value,
    }));

  // Add a 25% buffer to estimateGas because Gnosis blocks can vary and a
  // failed tx still costs the user gas. 25% is what most production wallets
  // use as a default safety margin.
  const gasLimitBuffered = (gasLimit * 125n) / 100n;

  // EIP-1559 fee parameters. Gnosis supports 1559 since the Donate hardfork.
  // We set maxFeePerGas to gasPrice * 1.5 and tip to maxFee / 10 — the same
  // shape the v1 dApp used implicitly via wagmi defaults.
  const maxFeePerGas =
    input.maxFeePerGas ?? (gasPrice * 150n) / 100n;
  const maxPriorityFeePerGas =
    input.maxPriorityFeePerGas ?? maxFeePerGas / 10n;

  const valueBig = input.value ? BigInt(input.value) : 0n;

  const signed = await account.signTransaction({
    chainId: GNOSIS_CHAIN_ID,
    type: 'eip1559',
    nonce,
    gas: gasLimitBuffered,
    maxFeePerGas,
    maxPriorityFeePerGas,
    to: input.to as `0x${string}`,
    value: valueBig,
    data: (input.data as `0x${string}`) ?? '0x',
  });

  const txHash = await gnosisRpcCall<string>('eth_sendRawTransaction', [signed]);
  return txHash;
}

// ── Sign personal_sign-style messages ────────────────────────────────────────

/**
 * EIP-191 personal_sign with the Beeport account. Used for upload auth
 * signatures the backend's verifySignature middleware checks.
 */
export async function signMessage(message: string): Promise<string> {
  const account = await getBeeportAccount();
  return account.signMessage({ message });
}
