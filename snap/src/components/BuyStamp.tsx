/**
 * Buy a new postage stamp.
 *
 * Flow (each phase is a distinct snap_updateInterface tree):
 *   1. Form     — pick source chain, capacity, duration. Submit → quote.
 *   2. Quote    — show BZZ amount, fee breakdown, ETA. Confirm → execute.
 *   3. Progress — text status as each Relay step is signed and confirmed.
 *   4. Done     — success or error summary. Back returns to Home.
 *
 * State for the in-flight purchase is held in interface context (passed via
 * `snap_updateInterface`'s `context` arg) so we don't need a global store.
 */

import {
  Box,
  Heading,
  Text,
  Button,
  Form,
  Field,
  Dropdown,
  Option,
  Section,
  Row,
  Divider,
  Container,
  Footer,
  Banner,
} from '@metamask/snaps-sdk/jsx';
import {
  STORAGE_OPTIONS,
  TIME_OPTIONS,
  SOURCE_CHAINS,
  RELAY_NATIVE_TOKEN,
  SWARM_BUCKET_DEPTH,
  SWARM_BATCH_IMMUTABLE,
} from '../lib/constants';
import { generateNonce, describeError, shortHash, readBatchId } from '../lib/utils';
import { computeStampBzzAmount } from '../lib/pricing';
import { executeRelaySteps, getStampQuote, RelayQuoteResponse } from '../lib/relay';
import { getState } from '../lib/state';
import { syncStoredNodeAddressWithWallet } from '../lib/bee';
import { NAV_EVENTS } from './Home';

// ── Event names ──────────────────────────────────────────────────────────────

export const BUY_EVENTS = {
  FORM: 'buy-form',
  QUOTE_SUBMIT: 'buy-quote-submit',
  CONFIRM: 'buy-confirm',
  CANCEL: 'buy-cancel',
  RETRY: 'buy-retry',
} as const;

export const BUY_FIELDS = {
  CHAIN: 'buy-field-chain',
  DEPTH: 'buy-field-depth',
  DAYS: 'buy-field-days',
} as const;

// ── Phase 1: Form ────────────────────────────────────────────────────────────

export function BuyStampForm() {
  return (
    <Container>
      <Box>
        <Heading>Buy new storage</Heading>
        <Text>
          Choose how much storage you need, how long it should last, and which chain to pay the gas
          on.
        </Text>

        {/*
          The Form wraps the dropdowns so the Snap framework keeps their
          values in interface state. The "Get quote" button lives in the
          Footer (not as a form submit) so it gets the standard Snap
          full-width tappable styling. On click we read the dropdown
          values via `snap_getInterfaceState` in the router and proceed
          exactly as if the form had been submitted.
        */}
        <Form name={BUY_EVENTS.FORM}>
          <Field label="Pay from">
            <Dropdown name={BUY_FIELDS.CHAIN}>
              {SOURCE_CHAINS.map(c => (
                <Option value={String(c.id)}>{`${c.name} (${c.symbol})`}</Option>
              ))}
            </Dropdown>
          </Field>

          <Field label="Storage capacity">
            <Dropdown name={BUY_FIELDS.DEPTH}>
              {STORAGE_OPTIONS.map(o => (
                <Option value={String(o.depth)}>{o.size}</Option>
              ))}
            </Dropdown>
          </Field>

          <Field label="Duration">
            <Dropdown name={BUY_FIELDS.DAYS}>
              {TIME_OPTIONS.map(o => (
                <Option value={String(o.days)}>{o.display}</Option>
              ))}
            </Dropdown>
          </Field>
        </Form>

        <Banner severity="warning" title="Fund your Beesnap address on the chain you pay from">
          <Text>
            The address on the home screen is the same on every network. Gnosis (xDAI) pays the
            stamp in one step; on other networks you need the native token for gas (e.g. ETH) on the
            chain you select — for the final steps on Gnosis, Relay can top up xDAI if the balance
            is low (extra fee may apply).
          </Text>
        </Banner>
      </Box>
      <Footer>
        <Button name={NAV_EVENTS.HOME}>Back</Button>
        <Button name={BUY_EVENTS.QUOTE_SUBMIT}>Get quote</Button>
      </Footer>
    </Container>
  );
}

// ── Phase 2: Quote ────────────────────────────────────────────────────────────

/** Stable shape we pass around in interface context. */
export interface PendingPurchase {
  chainId: number;
  chainName: string;
  depth: number;
  depthSize: string;
  days: number;
  daysDisplay: string;
  /** BZZ wei to pay (decimal string). */
  bzzAmount: string;
  /** initialBalancePerChunk as decimal string (used by createBatchRegistry). */
  initialBalancePerChunk: string;
  /** Batch nonce (random 32-byte hex). */
  nonce: `0x${string}`;
  /** Predicted batch id (no 0x prefix). User can copy this before tx confirms. */
  predictedBatchId: string;
  /** USD pretty-print of the Relay quote. */
  totalAmountUSD: number;
  /** ETA seconds from Relay. */
  estimatedTimeSeconds: number;
  /** Full Relay quote response — used during execution. */
  quote: RelayQuoteResponse;
  /** User's address. */
  account: string;
}

/**
 * Build the data structure that backs the Quote screen. Pure logic; called
 * after the user submits the form.
 */
export async function buildPendingPurchase(opts: {
  account: string;
  chainId: number;
  depth: number;
  days: number;
}): Promise<PendingPurchase | { error: string }> {
  try {
    await syncStoredNodeAddressWithWallet();

    const chain = SOURCE_CHAINS.find(c => c.id === opts.chainId);
    const depthOpt = STORAGE_OPTIONS.find(s => s.depth === opts.depth);
    const dayOpt = TIME_OPTIONS.find(t => t.days === opts.days);
    if (!chain || !depthOpt || !dayOpt) {
      return { error: 'Invalid selection. Please go back and choose again.' };
    }

    const state = await getState();
    const nodeAddress = state.settings.nodeAddress?.trim();
    if (!nodeAddress) {
      return {
        error:
          'No Swarm node address yet. Open Home (or Settings) so we can reach your Bee API and read GET /wallet, then try again.',
      };
    }

    const { initialBalancePerChunk, totalBzz } = await computeStampBzzAmount({
      depth: opts.depth,
      days: opts.days,
    });

    const nonce = generateNonce();
    const predictedBatchId = readBatchId(nonce, opts.account);

    const { quote, totalAmountUSD, estimatedTimeSeconds } = await getStampQuote({
      selectedChainId: opts.chainId,
      fromToken: RELAY_NATIVE_TOKEN,
      address: opts.account,
      bzzAmount: totalBzz.toString(),
      nodeAddress,
      initialBalancePerChunk: initialBalancePerChunk.toString(),
      depth: opts.depth,
      bucketDepth: SWARM_BUCKET_DEPTH,
      nonce,
      immutable: SWARM_BATCH_IMMUTABLE,
    });

    return {
      chainId: opts.chainId,
      chainName: chain.name,
      depth: opts.depth,
      depthSize: depthOpt.size,
      days: opts.days,
      daysDisplay: dayOpt.display,
      bzzAmount: totalBzz.toString(),
      initialBalancePerChunk: initialBalancePerChunk.toString(),
      nonce,
      predictedBatchId,
      totalAmountUSD,
      estimatedTimeSeconds,
      quote,
      account: opts.account,
    };
  } catch (err) {
    return { error: describeError(err) };
  }
}

export function BuyStampQuote(p: PendingPurchase) {
  return (
    <Container>
      <Box>
        <Heading>Confirm your purchase</Heading>

        <Section>
          <Row label="Pay from">
            <Text>{p.chainName}</Text>
          </Row>
          <Row label="Capacity">
            <Text>{`${p.depthSize} (ID ${p.depth})`}</Text>
          </Row>
          <Row label="Duration">
            <Text>{p.daysDisplay}</Text>
          </Row>
          <Row label="Total cost">
            <Text>{`$${p.totalAmountUSD.toFixed(2)}`}</Text>
          </Row>
          <Row label="ETA">
            <Text>{`~${p.estimatedTimeSeconds}s`}</Text>
          </Row>
          <Divider />
          <Row label="Future ID">
            <Text>{shortHash(p.predictedBatchId, 8, 6)}</Text>
          </Row>
        </Section>

        <Banner severity="info" title="What happens next">
          <Text>
            MetaMask will ask you to sign{' '}
            {String(p.quote.steps.reduce((n, s) => n + (s.items?.length ?? 0), 0))} transaction(s).
            The final one creates your storage on Swarm.
          </Text>
        </Banner>
      </Box>
      <Footer>
        <Button name={BUY_EVENTS.CANCEL}>Cancel</Button>
        <Button name={BUY_EVENTS.CONFIRM}>Confirm and pay</Button>
      </Footer>
    </Container>
  );
}

// ── Phase 3: Progress ─────────────────────────────────────────────────────────

export interface PurchaseProgress {
  message: string;
  predictedBatchId: string;
}

export function BuyStampProgress(p: PurchaseProgress) {
  return (
    <Container>
      <Box>
        <Heading>Setting up your storage…</Heading>
        <Text>{p.message}</Text>
        <Divider />
        <Section>
          <Row label="Future ID">
            <Text>{shortHash(p.predictedBatchId, 8, 6)}</Text>
          </Row>
        </Section>
        <Banner severity="warning" title="Don't close MetaMask">
          <Text>
            Closing this window during a multi-step Relay transfer can interrupt the flow. The
            transactions themselves cannot be lost — but progress updates will stop.
          </Text>
        </Banner>
      </Box>
    </Container>
  );
}

// ── Phase 4: Done ─────────────────────────────────────────────────────────────

export interface PurchaseResult {
  success: boolean;
  predictedBatchId: string;
  errorMessage?: string;
}

export function BuyStampDone(r: PurchaseResult) {
  if (r.success) {
    return (
      <Container>
        <Box>
          <Heading>Storage created</Heading>
          <Banner severity="success" title="All done">
            <Text>Your storage is now active on Swarm.</Text>
          </Banner>
          <Section>
            <Row label="ID">
              <Text>{shortHash(r.predictedBatchId, 8, 6)}</Text>
            </Row>
          </Section>
          <Text>
            It can take a minute for the Bee node to pick this up. Open "View my storage" to check.
          </Text>
        </Box>
        <Footer>
          <Button name={NAV_EVENTS.STAMPS}>View my storage</Button>
          <Button name={NAV_EVENTS.HOME}>Back to home</Button>
        </Footer>
      </Container>
    );
  }
  return (
    <Container>
      <Box>
        <Heading>Purchase failed</Heading>
        <Banner severity="danger" title="Something went wrong">
          <Text>{r.errorMessage ?? 'Unknown error.'}</Text>
        </Banner>
      </Box>
      <Footer>
        <Button name={BUY_EVENTS.RETRY}>Try again</Button>
        <Button name={NAV_EVENTS.HOME}>Back to home</Button>
      </Footer>
    </Container>
  );
}

// ── Execution helper (called from the entry-point router) ─────────────────────

export async function runPurchase(
  pending: PendingPurchase,
  onStatus: (msg: string) => Promise<void>
): Promise<PurchaseResult> {
  try {
    await executeRelaySteps(pending.quote, {
      onStatus: msg => {
        // Fire-and-forget: the entry-point router awaits these via a queue.
        void onStatus(msg);
      },
    });
    return { success: true, predictedBatchId: pending.predictedBatchId };
  } catch (err) {
    return {
      success: false,
      predictedBatchId: pending.predictedBatchId,
      errorMessage: describeError(err),
    };
  }
}
