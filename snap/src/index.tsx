/**
 * Beeport Snap entry point.
 *
 * Exports the four standard handlers MetaMask calls into:
 *   - onInstall      — one-time welcome dialog
 *   - onHomePage     — the page MetaMask shows in the Snap tab
 *   - onUserInput    — every button click / form submit / file pick
 *   - onRpcRequest   — methods the install dapp calls into the Snap
 *
 * Navigation works by re-rendering the Home tree via `snap_updateInterface`
 * with whichever screen the user just navigated to. `interfaceContext` carries
 * any state that needs to survive between renders (e.g. an in-flight Relay
 * quote during the buy flow).
 *
 * The "account" everywhere in this Snap means the *Beeport account* — a key
 * derived from the user's secret recovery phrase (see `lib/wallet.ts`). It is
 * not the user's main MetaMask account. Snaps cannot send transactions on
 * the user's MetaMask account, so we sign + broadcast from this derived key
 * instead.
 */

import {
  OnHomePageHandler,
  OnInstallHandler,
  OnRpcRequestHandler,
  OnUserInputHandler,
  UserInputEventType,
} from '@metamask/snaps-sdk';
import { Box, Heading, Text } from '@metamask/snaps-sdk/jsx';

import { getBeeportAddress } from './lib/wallet';
import { getGnosisBalance } from './lib/ethereum';
import { fetchNodeWalletAddress } from './lib/bee';
import { DEFAULT_BEE_API_URL } from './lib/constants';

/**
 * Mirrors the discriminated-union shape of `SettingsFormProps['walletProbe']`.
 * Defined here as a local type so the SAVE handler stays readable.
 */
type SettingsWalletProbe =
  | { ok: true; nodeAddress: `0x${string}`; from: string }
  | { ok: false; reason: string; from: string };
import {
  rememberAccount,
  getUploads,
  setActivePoll,
  isActivePoll,
  getState,
  setState,
} from './lib/state';
import { describeError } from './lib/utils';

import { Home, NAV_EVENTS } from './components/Home';
import {
  StampsList,
  loadStamps,
  countResolvedStamps,
  type StampsLoadResult,
} from './components/StampsList';
import {
  UploadForm,
  UploadInFlight,
  UploadDone,
  UPLOAD_EVENTS,
  UPLOAD_FIELDS,
  loadUsableStamps,
  runUpload,
  type UploadDoneProps,
} from './components/Upload';
import {
  BuyStampForm,
  BuyStampQuote,
  BuyStampProgress,
  BuyStampDone,
  BUY_EVENTS,
  BUY_FIELDS,
  buildPendingPurchase,
  runPurchase,
  type PendingPurchase,
  type PurchaseResult,
} from './components/BuyStamp';
import { UploadsList } from './components/UploadsList';
import {
  SettingsForm,
  type SettingsFormProps,
  SETTINGS_EVENTS,
  SETTINGS_FIELDS,
  validateBeeApiUrl,
  validateNodeAddress,
} from './components/Settings';

// ── onInstall ────────────────────────────────────────────────────────────────

export const onInstall: OnInstallHandler = async () => {
  // Pre-derive the Beeport account so we can show the user where to send funds.
  let address: string;
  try {
    address = await getBeeportAddress();
  } catch (err) {
    address = '(failed to derive — see Snap logs)';
  }

  await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'alert',
      content: (
        <Box>
          <Heading>Welcome to Beeport</Heading>
          <Text>
            Beeport derives a dedicated account from your secret recovery
            phrase. Send xDAI on Gnosis to it before buying stamps:
          </Text>
          <Text>{address}</Text>
          <Text>
            Open the Beeport tab on the left of MetaMask any time to view this
            address again, see your balance, buy stamps, and upload files.
          </Text>
        </Box>
      ),
    },
  });
};

// ── Helper: load Home props (Beeport address + balance) ─────────────────────

async function loadHomeProps() {
  const beeportAddress = (await getBeeportAddress()) as `0x${string}`;
  // Remember the Beeport address so it shows up consistently across screens.
  await rememberAccount(beeportAddress);
  let beeportBalanceWei: bigint | null = null;
  try {
    beeportBalanceWei = await getGnosisBalance(beeportAddress);
  } catch {
    // Don't block the home screen on a balance fetch failure — surface as null.
    beeportBalanceWei = null;
  }
  return { beeportAddress, beeportBalanceWei };
}

// ── onHomePage ───────────────────────────────────────────────────────────────

export const onHomePage: OnHomePageHandler = async () => {
  const props = await loadHomeProps();
  return { content: <Home {...props} /> };
};

// ── onRpcRequest ─────────────────────────────────────────────────────────────

/**
 * The install dapp calls `wallet_invokeSnap` with one of these methods:
 *  - hello: smoke-test, returns the Beeport address.
 *  - getAccount: returns the Beeport address.
 *  - openHome: hint the dapp can use to tell the user "open MetaMask → Beeport".
 */
export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  switch (request.method) {
    case 'hello':
    case 'getAccount': {
      const address = await getBeeportAddress();
      const result: Record<string, string | boolean> = {
        ok: true,
        beeportAddress: address,
        origin,
      };
      return result;
    }
    case 'openHome': {
      const result: Record<string, string | boolean> = {
        ok: true,
        instruction: 'Open the Beeport tab in MetaMask.',
      };
      return result;
    }
    default:
      throw new Error(`Method not found: ${String(request.method)}`);
  }
};

// ── onUserInput (the router) ─────────────────────────────────────────────────

/**
 * Every interactive element the user touches lands here. We dispatch on
 * `event.name` (for buttons + form events). For form submissions, the field
 * values arrive on `event.value`.
 *
 * We update the visible UI by calling `snap_updateInterface` with the current
 * interface id (passed in `id`).
 */
export const onUserInput: OnUserInputHandler = async ({ id, event, context }) => {
  try {
    if (event.type === UserInputEventType.ButtonClickEvent) {
      await handleButton(id, event.name ?? '', context);
      return;
    }
    if (event.type === UserInputEventType.FormSubmitEvent) {
      await handleForm(id, event.name ?? '', event.value as Record<string, any>, context);
      return;
    }
    if (event.type === UserInputEventType.FileUploadEvent) {
      // FileInput's own visual state isn't reliably updating in our Flask
      // version, so we explicitly re-render the upload form with a
      // "Selected: …" banner. We use the SAME field names, so the file the
      // user just picked is preserved in form state by the framework — the
      // re-render just adds extra UI alongside it.
      const file = (event as any).file as
        | { name: string; size: number; contentType: string; contents: string }
        | null;
      if (file) {
        const account = await getBeeportAddress();
        const data = await loadUsableStamps(account);
        await update(
          id,
          <UploadForm
            {...data}
            selected={{
              name: file.name,
              size: file.size,
              contentType: file.contentType,
            }}
          />,
        );
      }
      return;
    }
  } catch (err) {
    // Surface any unhandled error in the existing interface so the user isn't
    // stranded in a blank screen.
    await snap.request({
      method: 'snap_updateInterface',
      params: {
        id,
        ui: (
          <Box>
            <Heading>Something went wrong</Heading>
            <Text>{describeError(err)}</Text>
          </Box>
        ),
      },
    });
  }
};

async function handleButton(
  id: string,
  name: string,
  context: Record<string, any> | null,
): Promise<void> {
  // Any navigation cancels whatever poll might be running for this interface
  // id. The running poll's next iteration will see a different gen (or none)
  // and abort before calling snap_updateInterface again.
  await setActivePoll(id, null);

  // ── Top-level navigation ────────────────────────────────────────────────────
  if (name === NAV_EVENTS.HOME) {
    const props = await loadHomeProps();
    await update(id, <Home {...props} />);
    return;
  }
  if (name === NAV_EVENTS.STAMPS) {
    const account = await getBeeportAddress();
    await update(id, <Loading title="Loading your stamps" />);
    const data = await loadStamps(account);
    await update(id, <StampsList {...data} />);

    // Auto-poll: if any stamp didn't resolve from Bee on the first read, keep
    // re-checking for up to 2 minutes. The Bee node usually picks up a freshly
    // minted stamp within 1–3 minutes; this saves the user from clicking
    // Refresh themselves.
    if (data.batches.length > 0 && countResolvedStamps(data) < data.batches.length) {
      void runStampsPoll(id, account, data);
    }
    return;
  }
  if (name === NAV_EVENTS.UPLOADS) {
    const account = await getBeeportAddress();
    const uploads = await getUploads(account);
    await update(id, <UploadsList uploads={uploads} />);
    return;
  }
  if (name === NAV_EVENTS.BUY) {
    await update(id, <BuyStampForm />);
    return;
  }
  if (name === NAV_EVENTS.UPLOAD) {
    const account = await getBeeportAddress();
    await update(id, <Loading title="Loading your stamps" />);
    const data = await loadUsableStamps(account);
    await update(id, <UploadForm {...data} />);
    return;
  }
  if (name === NAV_EVENTS.SETTINGS) {
    const state = await getState();
    const effectiveBee = state.settings.beeApiUrl || DEFAULT_BEE_API_URL;
    const probe = await fetchNodeWalletAddress(effectiveBee);
    const liveDefaultNode: SettingsFormProps['liveDefaultNode'] = probe.address
      ? { ok: true, address: probe.address }
      : {
          ok: false,
          reason: probe.debug.networkError
            ? probe.debug.networkError
            : `${probe.debug.status ?? '?'} ${probe.debug.statusText ?? ''}`.trim() || 'no response',
        };
    await update(
      id,
      <SettingsForm
        beeApiUrl={state.settings.beeApiUrl ?? ''}
        nodeAddress={state.settings.nodeAddress ?? ''}
        liveDefaultNode={liveDefaultNode}
      />,
    );
    return;
  }

  // ── Settings actions ────────────────────────────────────────────────────────
  if (name === SETTINGS_EVENTS.RESET_BEE) {
    const state = await getState();
    delete state.settings.beeApiUrl;
    await setState(state);
    await update(
      id,
      <SettingsForm
        beeApiUrl=""
        nodeAddress={state.settings.nodeAddress ?? ''}
        savedJustNow
      />,
    );
    return;
  }
  if (name === SETTINGS_EVENTS.RESET_NODE) {
    const state = await getState();
    delete state.settings.nodeAddress;
    await setState(state);
    await update(
      id,
      <SettingsForm
        beeApiUrl={state.settings.beeApiUrl ?? ''}
        nodeAddress=""
        savedJustNow
      />,
    );
    return;
  }

  // ── Buy flow ────────────────────────────────────────────────────────────────
  if (name === BUY_EVENTS.CANCEL) {
    await update(id, <BuyStampForm />);
    return;
  }
  if (name === BUY_EVENTS.RETRY) {
    await update(id, <BuyStampForm />);
    return;
  }
  if (name === BUY_EVENTS.QUOTE_SUBMIT) {
    // Get-quote button now lives in the Footer (not a form submit), so we
    // pull the dropdown selections from interface state instead of from a
    // FormSubmitEvent payload.
    const formState = (await snap.request({
      method: 'snap_getInterfaceState',
      params: { id },
    })) as Record<string, any>;
    const formValues = (formState[BUY_EVENTS.FORM] ?? {}) as Record<string, any>;
    await runBuyQuote(id, formValues);
    return;
  }
  if (name === BUY_EVENTS.CONFIRM) {
    const pending = context?.pending as PendingPurchase | undefined;
    if (!pending) {
      throw new Error('Lost track of your stamp purchase. Please start over.');
    }
    await update(
      id,
      <BuyStampProgress
        message="Preparing transactions…"
        predictedBatchId={pending.predictedBatchId}
      />,
      { pending },
    );

    // Run the purchase. Pump status updates back into the same interface.
    const onStatus = async (msg: string): Promise<void> => {
      await update(
        id,
        <BuyStampProgress
          message={msg}
          predictedBatchId={pending.predictedBatchId}
        />,
        { pending },
      );
    };
    const result: PurchaseResult = await runPurchase(pending, onStatus);
    await update(id, <BuyStampDone {...result} />);
    return;
  }

  // ── Upload flow ─────────────────────────────────────────────────────────────
  if (name === UPLOAD_EVENTS.RETRY) {
    const account = await getBeeportAddress();
    await update(id, <Loading title="Loading your storage" />);
    const data = await loadUsableStamps(account);
    await update(id, <UploadForm {...data} />);
    return;
  }
  if (name === UPLOAD_EVENTS.SUBMIT) {
    // Upload button now lives in the Footer (not as a form submit), so we
    // pull the dropdown + file from interface state instead of an
    // event payload.
    const formState = (await snap.request({
      method: 'snap_getInterfaceState',
      params: { id },
    })) as Record<string, any>;
    const formValues = (formState[UPLOAD_EVENTS.FORM] ?? {}) as Record<string, any>;
    await runUploadFromForm(id, formValues);
    return;
  }

  // Unknown event — be loud rather than silent.
  throw new Error(`Unknown button event: ${name}`);
}

async function handleForm(
  id: string,
  name: string,
  values: Record<string, any>,
  _context: Record<string, any> | null,
): Promise<void> {
  // Submitting any form is a navigation — cancel the running poll, if any.
  await setActivePoll(id, null);

  // (BUY_EVENTS.QUOTE_SUBMIT used to be a Form submit; it's now a Footer
  // Button click handled in handleButton via runBuyQuote. Keeping no-op here
  // in case an older build still surfaces the FormSubmitEvent.)

  // ── Settings form → save ────────────────────────────────────────────────────
  if (name === SETTINGS_EVENTS.SAVE) {
    const beeRaw = String(values[SETTINGS_FIELDS.BEE_API_URL] ?? '').trim();
    const nodeRaw = String(values[SETTINGS_FIELDS.NODE_ADDRESS] ?? '').trim();

    // Validate + normalize the Bee URL (strips trailing slashes silently).
    const beeRes = validateBeeApiUrl(beeRaw);
    if ('error' in beeRes) {
      await update(
        id,
        <SettingsForm
          beeApiUrl={beeRaw}
          nodeAddress={nodeRaw}
          validationError={beeRes.error}
        />,
      );
      return;
    }
    const beeClean = beeRes.value;

    const nodeErr = validateNodeAddress(nodeRaw);
    if (nodeErr) {
      await update(
        id,
        <SettingsForm
          beeApiUrl={beeClean}
          nodeAddress={nodeRaw}
          validationError={nodeErr}
        />,
      );
      return;
    }

    // Did the Bee URL change? If yes, probe /wallet to auto-detect the
    // node address for that backend. The user's manually-typed nodeRaw
    // (if any) is treated as an override that wins over the probe.
    const state = await getState();
    const previousBee = state.settings.beeApiUrl ?? '';
    const beeChanged = beeClean !== previousBee;

    let walletProbe: SettingsWalletProbe | undefined;
    let resolvedNode = nodeRaw;

    if (beeChanged && nodeRaw === '') {
      const probeUrl = beeClean === '' ? DEFAULT_BEE_API_URL : beeClean;
      const probe = await fetchNodeWalletAddress(probeUrl);
      if (probe.address) {
        resolvedNode = probe.address;
        walletProbe = {
          ok: true,
          nodeAddress: probe.address,
          from: `${probeUrl}/wallet`,
        };
      } else {
        walletProbe = {
          ok: false,
          reason: probe.debug.networkError
            ? `network: ${probe.debug.networkError}`
            : `${probe.debug.status ?? '?'} ${probe.debug.statusText ?? ''}`.trim(),
          from: `${probeUrl}/wallet`,
        };
      }
    }

    // Persist. Empty string means "clear the override and use the default".
    if (beeClean === '') delete state.settings.beeApiUrl;
    else state.settings.beeApiUrl = beeClean;
    if (resolvedNode === '') delete state.settings.nodeAddress;
    else state.settings.nodeAddress = resolvedNode;
    await setState(state);

    await update(
      id,
      <SettingsForm
        beeApiUrl={state.settings.beeApiUrl ?? ''}
        nodeAddress={state.settings.nodeAddress ?? ''}
        savedJustNow
        walletProbe={walletProbe}
      />,
    );
    return;
  }

  // (UPLOAD_EVENTS.SUBMIT used to be a Form submit; it's now a Footer
  // Button click handled in handleButton via runUploadFromForm. Keeping no-op
  // here in case an older build still surfaces the FormSubmitEvent.)

  throw new Error(`Unknown form: ${name}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Re-render an existing interface, optionally replacing context. */
async function update(
  id: string,
  ui: any,
  context?: Record<string, any>,
): Promise<void> {
  const params: any = { id, ui };
  if (context) params.context = context;
  await snap.request({
    method: 'snap_updateInterface',
    params,
  });
}

/**
 * Shared "read the upload form, validate, run the upload" logic. Called
 * from the Footer-button code path (which reads form state via
 * `snap_getInterfaceState`).
 */
async function runUploadFromForm(
  id: string,
  formValues: Record<string, any>,
): Promise<void> {
  const batchId = String(formValues[UPLOAD_FIELDS.STAMP] ?? '');
  const file = formValues[UPLOAD_FIELDS.FILE] as
    | { name: string; contentType: string; size: number; contents: string }
    | null
    | undefined;

  if (!batchId) {
    throw new Error('Please pick storage to pay with.');
  }
  if (!file || !file.contents) {
    throw new Error('Please choose a file to upload.');
  }

  await update(id, <UploadInFlight filename={file.name} />);
  const result: UploadDoneProps = await runUpload({
    batchId,
    filename: file.name,
    contentType: file.contentType,
    base64: file.contents,
    isWebsite: false,
  });
  await update(id, <UploadDone {...result} />);
}

/**
 * Shared "build a Relay quote and render the confirm screen" logic. Used
 * both from the form-submit code path and from the Footer-button code path
 * (which reads form state via snap_getInterfaceState).
 */
async function runBuyQuote(
  id: string,
  formValues: Record<string, any>,
): Promise<void> {
  const account = await getBeeportAddress();
  const chainId = Number(formValues[BUY_FIELDS.CHAIN]);
  const depth = Number(formValues[BUY_FIELDS.DEPTH]);
  const days = Number(formValues[BUY_FIELDS.DAYS]);
  if (!chainId || !depth || !days) {
    throw new Error('Please pick a chain, capacity, and duration.');
  }

  await update(id, <Loading title="Pricing your storage via Relay" />);
  const result = await buildPendingPurchase({
    account,
    chainId,
    depth,
    days,
  });
  if ('error' in result) {
    await update(
      id,
      <BuyStampDone
        success={false}
        predictedBatchId=""
        errorMessage={result.error}
      />,
    );
    return;
  }
  await update(id, <BuyStampQuote {...result} />, { pending: result });
}

function Loading({ title }: { title: string }) {
  return (
    <Box>
      <Heading>{title}…</Heading>
      <Text>One moment.</Text>
    </Box>
  );
}

// ── Background poll for newly-bought stamps ──────────────────────────────────

/**
 * After rendering StampsList with some stamps still unresolved (Bee hasn't
 * picked them up yet), poll a few times in the background and re-render the
 * screen if a fetch returns more data than before.
 *
 * Cancellation: each iteration re-reads `activePolls[id]` from state. When
 * the user navigates anywhere else, `handleButton` clears that entry, and
 * the next iteration short-circuits before calling `snap_updateInterface`.
 *
 * Bounded: at most 4 attempts at 30s each = 2 minutes total. We stop as soon
 * as every stamp is resolved.
 */
const POLL_INTERVAL_MS = 30_000;
const POLL_MAX_ATTEMPTS = 4;

async function runStampsPoll(
  id: string,
  account: string,
  initial: StampsLoadResult,
): Promise<void> {
  const gen = Date.now();
  await setActivePoll(id, gen);

  let prev = initial;

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);

    if (!(await isActivePoll(id, gen))) {
      // User navigated away; nothing more to do.
      return;
    }

    let fresh: StampsLoadResult;
    try {
      fresh = await loadStamps(account);
    } catch {
      // A transient error during polling shouldn't kill the loop. Try again.
      continue;
    }

    // Re-check after the (possibly slow) fetch — the user may have nav'd
    // away while we were waiting on Bee/registry.
    if (!(await isActivePoll(id, gen))) return;

    const before = countResolvedStamps(prev);
    const after = countResolvedStamps(fresh);
    if (after > before) {
      await update(id, <StampsList {...fresh} />);
      prev = fresh;
    }

    if (after === fresh.batches.length) {
      // Everything resolved — no point in continuing.
      await setActivePoll(id, null);
      return;
    }
  }

  // Out of attempts. Clear the marker so future navigations don't think
  // there's still a poll running.
  await setActivePoll(id, null);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
