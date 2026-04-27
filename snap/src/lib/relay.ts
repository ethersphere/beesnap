/**
 * Relay API client for the Snap.
 *
 * Mirrors `src/app/components/RelayQuotes.ts#getRelayQuote` from the original
 * app: builds a Relay quote whose `txs` array creates a postage batch on
 * Gnosis (and approves BZZ when needed), then walks the returned `steps[]`
 * with `eth_sendTransaction` and the public Gnosis RPC for receipts.
 *
 * v1 simplification vs the original app:
 *  - Always uses the direct `originCurrency → BZZ` route via `getRelayQuote`
 *    style requests when paying on Gnosis with BZZ-compatible tokens.
 *  - For other chains, mirrors `getRelayCrossChainWithSushiQuote`: bridge
 *    native gas token → USDC on Gnosis, then SushiSwapStampsRouter.createBatch.
 */

import { encodeFunctionData, parseAbi } from 'viem';
import {
  GNOSIS_CHAIN_ID,
  GNOSIS_BZZ_ADDRESS,
  GNOSIS_CUSTOM_REGISTRY_ADDRESS,
  RELAY_API_BASE,
  RELAY_STATUS_CHECK_INTERVAL_MS,
  RELAY_STATUS_MAX_ATTEMPTS,
  TRANSACTION_TIMEOUT_MS,
  DEFAULT_SLIPPAGE_PERCENT,
  RELAY_BRIDGE_TOKEN_ON_GNOSIS,
  SUSHI_STAMPS_ROUTER_ADDRESS,
  GAS_TOPUP_THRESHOLD_WEI,
  GAS_TOPUP_AMOUNT_USD,
} from './constants';
import { POSTAGE_STAMP_ABI, SUSHI_STAMPS_ROUTER_ABI } from './abis';
import { getGnosisBalance } from './ethereum';
import { getBridgeUsdcToBzzPathAndMaxIn } from './sushi-gnosis-stamp';

// ── Types matching the Relay API ─────────────────────────────────────────────

export interface RelayQuoteRequest {
  user: string;
  recipient: string;
  originChainId: number;
  destinationChainId: number;
  originCurrency: string;
  destinationCurrency: string;
  amount: string;
  tradeType: 'EXACT_INPUT' | 'EXACT_OUTPUT';
  txs?: Array<{ to: string; value: string; data: string }>;
  slippageTolerance?: string;
  refundOnOrigin?: boolean;
  topupGas?: boolean;
  topupGasAmount?: string;
}

export interface RelayStepItem {
  status: 'incomplete' | 'complete';
  data?: {
    from: string;
    to: string;
    data: string;
    value: string;
    gas?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    chainId: number;
  };
  check?: { endpoint: string; method: string };
}

export interface RelayStep {
  id: string;
  action: string;
  description: string;
  kind: string;
  items: RelayStepItem[];
}

export interface RelayQuoteResponse {
  steps: RelayStep[];
  fees: {
    gas: { amount: string; amountFormatted: string; amountUsd: string };
    relayer: { amount: string; amountFormatted: string; amountUsd: string };
  };
  details: {
    currencyIn: { amount: string; amountFormatted: string; amountUsd: string };
    currencyOut: { amount: string; amountFormatted: string; amountUsd: string };
    timeEstimate: number;
  };
}

// ── Quote builders ───────────────────────────────────────────────────────────

export interface BuyStampQuoteInput {
  /** Source chain the user is paying from. */
  selectedChainId: number;
  /** Source token address — `0x000…000` for the chain's native gas token. */
  fromToken: string;
  /** User's EOA address. */
  address: string;
  /** Exact BZZ amount needed (wei, base 16 chunks × depth × oracle price). */
  bzzAmount: string;
  /** Swarm node address to register the batch under. */
  nodeAddress: string;
  /** initialBalancePerChunk for the batch (BZZ wei per chunk). */
  initialBalancePerChunk: string;
  depth: number;
  bucketDepth: number;
  /** Random 32-byte 0x-hex nonce (also used for batchId derivation). */
  nonce: `0x${string}`;
  immutable: boolean;
  /** Slippage in percent. */
  slippagePercent?: number;
}

/**
 * Build the postage-stamp createBatchRegistry calldata that Relay will execute
 * on Gnosis once the bridge step settles.
 */
function buildCreateBatchCalldata(input: BuyStampQuoteInput): string {
  return encodeFunctionData({
    abi: POSTAGE_STAMP_ABI,
    functionName: 'createBatchRegistry',
    args: [
      input.address as `0x${string}`,
      input.nodeAddress as `0x${string}`,
      BigInt(input.initialBalancePerChunk),
      input.depth,
      input.bucketDepth,
      input.nonce,
      input.immutable,
    ],
  });
}

const ERC20_APPROVE_ABI = parseAbi([
  'function approve(address spender, uint256 amount) external returns (bool)',
]);

const MAX_UINT256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

/**
 * Request a Relay quote for buying a stamp directly with BZZ-compatible
 * routing — i.e. Relay routes `originCurrency → BZZ on Gnosis`, then runs the
 * `txs` (BZZ infinite approve + createBatchRegistry) atomically on arrival.
 *
 * Gnosis: direct to BZZ + createBatchRegistry. Other chains: USDC on Gnosis +
 * Sushi `createBatch` (see `getCrossChainStampQuote`).
 */
export async function getStampQuote(input: BuyStampQuoteInput): Promise<{
  quote: RelayQuoteResponse;
  totalAmountUSD: number;
  estimatedTimeSeconds: number;
}> {
  if (input.selectedChainId !== GNOSIS_CHAIN_ID) {
    return getCrossChainStampQuote(input);
  }

  const contractCall = buildCreateBatchCalldata(input);

  // Always prepend an infinite BZZ approval so the registry can pull funds.
  // (The on-chain check would let us skip this when allowance is already
  // ≥ amount, but for a Snap v1 we keep it simple — infinite approve costs ~$0.001
  // on Gnosis and is a one-time cost per token.)
  const approvalData = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: 'approve',
    args: [GNOSIS_CUSTOM_REGISTRY_ADDRESS as `0x${string}`, BigInt(MAX_UINT256)],
  });

  const txs: RelayQuoteRequest['txs'] = [
    { to: GNOSIS_BZZ_ADDRESS, value: '0', data: approvalData },
    { to: GNOSIS_CUSTOM_REGISTRY_ADDRESS, value: '0', data: contractCall },
  ];

  const slippageBps = Math.round(
    (input.slippagePercent ?? DEFAULT_SLIPPAGE_PERCENT) * 100,
  ).toString();

  const body: RelayQuoteRequest = {
    user: input.address,
    recipient: input.address,
    originChainId: input.selectedChainId,
    destinationChainId: GNOSIS_CHAIN_ID,
    originCurrency: input.fromToken,
    destinationCurrency: GNOSIS_BZZ_ADDRESS,
    amount: input.bzzAmount,
    tradeType: 'EXACT_OUTPUT',
    txs,
    slippageTolerance: slippageBps,
    refundOnOrigin: true,
  };

  const res = await fetch(`${RELAY_API_BASE}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let parsed: { errorCode?: string; message?: string } = {};
    try {
      parsed = JSON.parse(errText);
    } catch {
      /* not json */
    }
    throw new Error(
      parsed.message ??
        parsed.errorCode ??
        `Relay quote failed (${res.status}): ${errText.slice(0, 200)}`,
    );
  }

  const quote = (await res.json()) as RelayQuoteResponse;
  const totalAmountUSD = Number(quote.details.currencyIn.amountUsd ?? 0);
  const estimatedTimeSeconds = Math.ceil(
    quote.details.timeEstimate ?? 0,
  );

  return { quote, totalAmountUSD, estimatedTimeSeconds };
}

/**
 * Non-Gnosis: Relay bridges source native token → USDC on Gnosis, then the
 * Multicaller runs USDC.approve + SushiSwapStampsRouter.createBatch (same as
 * `getRelayCrossChainWithSushiQuote` in the web app).
 */
async function getCrossChainStampQuote(
  input: BuyStampQuoteInput,
): Promise<{
  quote: RelayQuoteResponse;
  totalAmountUSD: number;
  estimatedTimeSeconds: number;
}> {
  const bzzOut = BigInt(input.bzzAmount);
  const slip = input.slippagePercent ?? DEFAULT_SLIPPAGE_PERCENT;

  const { maxAmountIn, path } = await getBridgeUsdcToBzzPathAndMaxIn(
    bzzOut,
    slip,
  );

  const approvalData = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: 'approve',
    args: [SUSHI_STAMPS_ROUTER_ADDRESS as `0x${string}`, maxAmountIn],
  });

  const createBatchData = encodeFunctionData({
    abi: SUSHI_STAMPS_ROUTER_ABI,
    functionName: 'createBatch',
    args: [
      path,
      maxAmountIn,
      bzzOut,
      {
        owner: input.address as `0x${string}`,
        nodeAddress: input.nodeAddress as `0x${string}`,
        initialBalancePerChunk: BigInt(input.initialBalancePerChunk),
        depth: input.depth,
        bucketDepth: input.bucketDepth,
        nonce: input.nonce,
        immutable_: input.immutable,
      },
    ],
  });

  const txs: RelayQuoteRequest['txs'] = [
    { to: RELAY_BRIDGE_TOKEN_ON_GNOSIS, value: '0', data: approvalData },
    { to: SUSHI_STAMPS_ROUTER_ADDRESS, value: '0', data: createBatchData },
  ];

  const bal = await getGnosisBalance(input.address);
  const shouldTopupGas = bal < GAS_TOPUP_THRESHOLD_WEI;
  const slippageBps = Math.round(slip * 100).toString();

  const body: RelayQuoteRequest = {
    user: input.address,
    recipient: input.address,
    originChainId: input.selectedChainId,
    destinationChainId: GNOSIS_CHAIN_ID,
    originCurrency: input.fromToken,
    destinationCurrency: RELAY_BRIDGE_TOKEN_ON_GNOSIS,
    amount: maxAmountIn.toString(),
    tradeType: 'EXACT_OUTPUT',
    txs,
    slippageTolerance: slippageBps,
    refundOnOrigin: true,
    topupGas: shouldTopupGas,
    ...(shouldTopupGas && { topupGasAmount: GAS_TOPUP_AMOUNT_USD }),
  };

  const res = await fetch(`${RELAY_API_BASE}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let parsed: { errorCode?: string; message?: string } = {};
    try {
      parsed = JSON.parse(errText);
    } catch {
      /* not json */
    }
    throw new Error(
      parsed.message ??
        parsed.errorCode ??
        `Relay cross-chain quote failed (${res.status}): ${errText.slice(0, 200)}`,
    );
  }

  const quote = (await res.json()) as RelayQuoteResponse;
  const totalAmountUSD = Number(quote.details.currencyIn.amountUsd ?? 0);
  const estimatedTimeSeconds = Math.ceil(quote.details.timeEstimate ?? 0);

  return { quote, totalAmountUSD, estimatedTimeSeconds };
}

// ── Status polling ───────────────────────────────────────────────────────────

/**
 * Poll a Relay status endpoint until it returns success / failure / refund.
 * Mirrors the original app's `monitorRelayStatus` semantics, including the
 * "don't count `unknown` toward max attempts" behavior.
 */
export async function monitorRelayStatus(
  endpoint: string,
  onProgress: (msg: string) => void,
): Promise<void> {
  const maxAttempts = RELAY_STATUS_MAX_ATTEMPTS;
  let attempts = 0;
  let unknownCount = 0;
  const maxUnknown = 24;

  while (attempts < maxAttempts) {
    let res: Response;
    try {
      res = await fetch(`${RELAY_API_BASE}${endpoint}`);
    } catch (err) {
      attempts += 1;
      await sleep(RELAY_STATUS_CHECK_INTERVAL_MS);
      continue;
    }
    if (!res.ok) {
      attempts += 1;
      await sleep(RELAY_STATUS_CHECK_INTERVAL_MS);
      continue;
    }

    const data = (await res.json()) as { status?: string };
    switch (data.status) {
      case 'success':
        onProgress('Cross-chain swap completed');
        return;
      case 'waiting':
        onProgress('Confirming source transaction…');
        unknownCount = 0;
        break;
      case 'pending':
        onProgress('Bridging to Gnosis…');
        unknownCount = 0;
        break;
      case 'failure':
        throw new Error('Relay reported the cross-chain swap failed.');
      case 'refund':
        throw new Error(
          'The cross-chain swap failed and your funds were refunded.',
        );
      case 'unknown':
        unknownCount += 1;
        onProgress('Waiting for transaction to be indexed…');
        if (unknownCount >= maxUnknown) {
          throw new Error(
            'Relay status indexing timed out. The transaction may still settle — check your wallet.',
          );
        }
        await sleep(RELAY_STATUS_CHECK_INTERVAL_MS);
        continue; // skip attempts++ for unknown
      default:
        onProgress(`Relay status: ${data.status ?? '?'}`);
    }

    await sleep(RELAY_STATUS_CHECK_INTERVAL_MS);
    attempts += 1;
  }
  throw new Error(`Relay status monitoring timed out after ${maxAttempts} polls.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Step execution ───────────────────────────────────────────────────────────

import { sendTx, waitForChainReceipt } from './ethereum';
import { describeError } from './utils';

export interface ExecuteContext {
  /** Called as steps progress so the UI can show what's happening. */
  onStatus: (msg: string) => void;
}

/**
 * Walk every step in a Relay quote, signing + broadcasting each tx with the
 * Snap-derived account (via `sendTx`) and polling Relay's status endpoint between
 * steps where applicable.
 *
 * For each `data.chainId` from Relay, signs and sends on that chain, then
 * waits for a receipt (Gnosis, Ethereum, or an L2).
 */
export async function executeRelaySteps(
  quote: RelayQuoteResponse,
  ctx: ExecuteContext,
): Promise<void> {
  for (let i = 0; i < quote.steps.length; i += 1) {
    const step = quote.steps[i];
    ctx.onStatus(friendlyStepMessage(step));

    if (!step.items || step.items.length === 0) continue;

    for (let j = 0; j < step.items.length; j += 1) {
      const item = step.items[j];

      if (item.status === 'complete') continue;

      if (item.status === 'incomplete' && item.data) {
        const data = item.data;

        let txHash: string;
        try {
          txHash = await sendTx({
            chainId: data.chainId,
            to: data.to,
            data: data.data,
            value: data.value && data.value !== '0' ? toHexBig(data.value) : '0x0',
            gas: data.gas ? BigInt(data.gas) : undefined,
            maxFeePerGas: data.maxFeePerGas
              ? BigInt(data.maxFeePerGas)
              : undefined,
            maxPriorityFeePerGas: data.maxPriorityFeePerGas
              ? BigInt(data.maxPriorityFeePerGas)
              : undefined,
          });
        } catch (err) {
          throw new Error(`Step "${step.id}" failed: ${describeError(err)}`);
        }

        ctx.onStatus(`Waiting for transaction confirmation…`);

        const receipt = await waitForChainReceipt(
          txHash,
          data.chainId,
          TRANSACTION_TIMEOUT_MS,
        );
        if (receipt.status !== 'success') {
          throw new Error(`Transaction reverted: ${txHash}`);
        }

        if (item.check) {
          ctx.onStatus('Verifying with Relay…');
          await monitorRelayStatus(item.check.endpoint, ctx.onStatus);
        }
      } else if (item.status === 'incomplete' && !item.data && item.check) {
        // Item without tx data — pure status step.
        await monitorRelayStatus(item.check.endpoint, ctx.onStatus);
      }
    }
  }
}

function friendlyStepMessage(step: RelayStep): string {
  const desc = (step.description ?? '').toLowerCase();
  if (desc.includes('depositing') && desc.includes('relayer'))
    return 'Depositing funds…';
  if (desc.includes('swap') && desc.includes('bzz')) return 'Processing swap…';
  if (desc.includes('approve')) return 'Approving token…';
  return `Step: ${step.id}`;
}

/** Convert a decimal-string big number into a 0x-prefixed hex string. */
function toHexBig(value: string): string {
  if (value.startsWith('0x')) return value;
  return `0x${BigInt(value).toString(16)}`;
}
