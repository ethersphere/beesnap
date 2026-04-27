/**
 * Talks to the Beesnap / Bee proxy backend. All calls hit
 * `${beeApiUrl}` from snap state, default `https://beeport.xyz`.
 *
 * Two responsibilities:
 *  - Stamp info: GET /stamps/{batchId} returns utilization, depth, TTL, etc.
 *    (read-only, no auth).
 *  - Upload: POST /bzz?name=<filename> with the signed-message headers the
 *    backend's `verifySignature` middleware expects.
 *
 * Honest constraints:
 *  - There is no upload progress; Snap `fetch` doesn't expose progress events
 *    and `XMLHttpRequest` is unavailable. Callers should set "uploading…" before
 *    awaiting `uploadFile` and treat the resolved value as completion.
 *  - Files are bounded by what `FileInput` returns as base64 — practically a
 *    few hundred MB at most before performance degrades sharply.
 */

import { DEFAULT_BEE_API_URL, SWARM_DEFERRED_UPLOAD } from './constants';
import { getState, setState } from './state';

export interface StampInfo {
  batchID: string;
  utilization: number;
  usable: boolean;
  depth: number;
  amount: string;
  bucketDepth: number;
  exists: boolean;
  batchTTL: number;
  label?: string;
}

/**
 * Diagnostic payload describing what `fetchStampInfo` saw — surfaced in the
 * Snap UI when a stamp can't be resolved, so the user/dev can tell apart:
 *  - 404 from Bee → "stamp not yet visible to Bee, just wait"
 *  - 502 / connection refused → "the proxy is down or rejecting our request"
 *  - HTML body → "we hit nginx/Cloudflare, not the Bee proxy"
 *  - network error → "request was blocked entirely (CORS / sandbox)"
 */
export interface StampFetchDebug {
  url: string;
  /** HTTP status if we got a response. Undefined for network errors. */
  status?: number;
  statusText?: string;
  contentType?: string | null;
  /** First ~200 chars of the response body, for inline display. */
  body?: string;
  /** Set when the fetch threw before getting a response. */
  networkError?: string;
}

export interface StampFetchOutcome {
  /** Parsed stamp info on 2xx + JSON body; null otherwise. */
  info: StampInfo | null;
  /** Always populated — describes the exact request we made and what came back. */
  debug: StampFetchDebug;
}

/**
 * Fetch stamp metadata for a single batch.
 *
 * Always returns a fully populated `StampFetchOutcome`. `info` is null when
 * Bee doesn't know about the stamp (yet) or when the proxy rejects the call;
 * `debug` describes the exact request and response so the UI can show why.
 */
export async function fetchStampInfo(
  beeApiUrl: string,
  batchId: string,
): Promise<StampFetchOutcome> {
  const id = batchId.startsWith('0x') ? batchId.slice(2) : batchId;
  const url = `${beeApiUrl}/stamps/${id}`;
  console.log(`[bee] GET ${url}`);

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bee] network error for ${url}:`, err);
    return {
      info: null,
      debug: { url, networkError: msg },
    };
  }

  const contentType = res.headers.get('content-type');
  console.log(
    `[bee] ${url} → ${res.status} ${res.statusText} (content-type: ${contentType ?? 'none'})`,
  );

  let bodyText: string;
  try {
    bodyText = await res.text();
  } catch (err) {
    console.error(`[bee] failed to read body for ${url}:`, err);
    return {
      info: null,
      debug: {
        url,
        status: res.status,
        statusText: res.statusText,
        contentType,
        networkError: 'failed to read response body',
      },
    };
  }

  console.log(`[bee] ${url} body:`, bodyText.slice(0, 500));

  const debug: StampFetchDebug = {
    url,
    status: res.status,
    statusText: res.statusText,
    contentType,
    body: bodyText.slice(0, 200),
  };

  if (!res.ok) {
    console.warn(
      `[bee] non-OK status ${res.status} for ${url}; treating as "stamp not yet visible to Bee"`,
    );
    return { info: null, debug };
  }

  try {
    const info = JSON.parse(bodyText) as StampInfo;
    return { info, debug };
  } catch (err) {
    console.error(
      `[bee] OK status but body was not valid JSON for ${url}:`,
      err,
      bodyText.slice(0, 200),
    );
    return { info: null, debug };
  }
}

/**
 * Result of probing `${beeApiUrl}/wallet`. The endpoint returns the Bee
 * node's own wallet address, which is the right value to record as a
 * stamp's `nodeAddress` so chunks land at that node.
 *
 * The Bee API returns the address WITHOUT a 0x prefix (we add it).
 * Returns `null` for `address` if the call failed for any reason; the
 * `debug` payload carries the raw status / body so the UI can explain.
 */
export interface NodeWalletProbe {
  address: `0x${string}` | null;
  debug: StampFetchDebug;
}

export async function fetchNodeWalletAddress(
  beeApiUrl: string,
): Promise<NodeWalletProbe> {
  const url = `${beeApiUrl}/wallet`;
  console.log(`[bee] GET ${url}`);

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bee] /wallet network error:`, err);
    return { address: null, debug: { url, networkError: msg } };
  }

  const contentType = res.headers.get('content-type');
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch (err) {
    console.error(`[bee] /wallet body read failed:`, err);
  }

  const debug: StampFetchDebug = {
    url,
    status: res.status,
    statusText: res.statusText,
    contentType,
    body: bodyText.slice(0, 200),
  };

  if (!res.ok) {
    console.warn(`[bee] /wallet returned ${res.status}; not auto-updating node address`);
    return { address: null, debug };
  }

  let parsed: { walletAddress?: string };
  try {
    parsed = JSON.parse(bodyText);
  } catch (err) {
    console.error(`[bee] /wallet body was not JSON:`, err);
    return { address: null, debug };
  }

  if (!parsed.walletAddress || typeof parsed.walletAddress !== 'string') {
    console.warn(`[bee] /wallet response had no walletAddress field`);
    return { address: null, debug };
  }

  const raw = parsed.walletAddress.trim();
  // The Bee API returns it without 0x; tolerate either form.
  const withPrefix = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`;
  if (!/^0x[a-fA-F0-9]{40}$/.test(withPrefix)) {
    console.warn(`[bee] /wallet returned invalid address shape: ${raw}`);
    return { address: null, debug };
  }
  console.log(`[bee] /wallet → node address ${withPrefix}`);
  return { address: withPrefix, debug };
}

export interface UploadParams {
  beeApiUrl: string;
  /** Postage batch ID without 0x prefix (the format Bee + the backend expect). */
  batchId: string;
  /** Filename — used in the URL `?name=` and as part of the signed message. */
  filename: string;
  /** Content-Type to send. application/octet-stream is a safe default. */
  contentType: string;
  /** Raw bytes of the file. */
  bytes: Uint8Array;
  /** Address of the user signing the upload. */
  uploaderAddress: string;
  /** EIP-191 signature over `${filename}:${batchId}`. */
  signature: string;
  /** When true, sets the Swarm-Index-Document header so the upload is browsable as a website. */
  isWebsite?: boolean;
}

export interface UploadResult {
  reference: string;
}

/**
 * Outcome of a single upload attempt. Mirrors the diagnostics pattern from
 * `fetchStampInfo` so the UI can surface exactly what happened: URL hit,
 * HTTP status, response body, network error. The user no longer has to
 * stare at a bare "Failed to fetch" with zero context.
 */
export type UploadOutcome =
  | { ok: true; reference: string; debug: StampFetchDebug }
  | { ok: false; debug: StampFetchDebug };

/**
 * Upload a single file's bytes to Bee via the backend. Returns an
 * `UploadOutcome` discriminated union — never throws on HTTP-level or
 * network-level failures, so the UI can render exact diagnostics instead of
 * an opaque error.
 *
 * The backend's verifySignature middleware will reject the request if the
 * signature doesn't recover to `uploaderAddress` or that address isn't the
 * batch payer; in either case, the response body has the JSON reason.
 */
export async function uploadFile(
  params: UploadParams,
): Promise<UploadOutcome> {
  const {
    beeApiUrl,
    batchId,
    filename,
    contentType,
    bytes,
    uploaderAddress,
    signature,
    isWebsite,
  } = params;

  const messageContent = `${filename}:${batchId}`;

  // Headers required by Bee itself, no matter where we're posting.
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'swarm-postage-batch-id': batchId,
    'swarm-pin': 'false',
    'swarm-deferred-upload': SWARM_DEFERRED_UPLOAD,
    'swarm-collection': 'false',
  };

  // Proxy-only auth headers. The backend's verifySignature middleware
  // expects these; a raw Bee node ignores them and they trigger an extra CORS
  // preflight burden if Bee's CORS allowlist isn't tuned. So when going
  // straight to a local Bee, leave them off entirely. Same heuristic as the
  // v1 dApp's FileUploadUtils.ts:
  //   const isLocalhost = beeApiUrl.includes('localhost') || beeApiUrl.includes('127.0.0.1');
  const isLocalhost =
    beeApiUrl.includes('localhost') || beeApiUrl.includes('127.0.0.1');
  if (!isLocalhost) {
    headers['x-upload-signed-message'] = signature;
    headers['x-uploader-address'] = uploaderAddress;
    headers['x-file-name'] = filename;
    headers['x-message-content'] = messageContent;
  }

  if (isWebsite) {
    headers['Swarm-Index-Document'] = 'index.html';
    headers['Swarm-Error-Document'] = 'error.html';
  }

  const url = `${beeApiUrl}/bzz?name=${encodeURIComponent(filename)}`;
  console.log(`[bee] POST ${url} (${bytes.length} bytes)`);

  // Body shape: see "Sandbox does not expose Blob" caveat above. Plain
  // ArrayBuffer is what `fetch` accepts and what the Snap sandbox provides.
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: buf,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bee] upload network error for ${url}:`, err);
    return { ok: false, debug: { url, networkError: msg } };
  }

  const responseContentType = res.headers.get('content-type');
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch (err) {
    console.error(`[bee] failed to read upload response body:`, err);
  }

  console.log(
    `[bee] ${url} → ${res.status} ${res.statusText} (content-type: ${responseContentType ?? 'none'}) body:`,
    bodyText.slice(0, 500),
  );

  const debug: StampFetchDebug = {
    url,
    status: res.status,
    statusText: res.statusText,
    contentType: responseContentType,
    body: bodyText.slice(0, 200),
  };

  if (!res.ok) {
    return { ok: false, debug };
  }

  let parsed: { reference?: string };
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // 200 OK but body wasn't JSON we can parse. Treat as failure with the
    // body excerpt so the user sees exactly what came back.
    return { ok: false, debug };
  }

  if (!parsed.reference) {
    return { ok: false, debug };
  }

  return { ok: true, reference: parsed.reference, debug };
}

/** Old compiled-in default — never use as a real node; clear if still persisted. */
const LEGACY_PRESET_NODE_ADDRESS = '0x5cb4839B7d7b0ab6BaAbFEdD6749497ECa65b2Ca';

/**
 * GET `${effectiveBeeBase}/wallet` and store `settings.nodeAddress`. Call on
 * home load and whenever the Bee base URL is saved. Removes the historical
 * hardcoded preset on upgrade.
 */
export async function syncStoredNodeAddressWithWallet(): Promise<void> {
  const state = await getState();
  const na = state.settings.nodeAddress;
  if (
    na &&
    na.toLowerCase() === LEGACY_PRESET_NODE_ADDRESS.toLowerCase()
  ) {
    delete state.settings.nodeAddress;
  }

  const base = state.settings.beeApiUrl?.trim() || DEFAULT_BEE_API_URL;
  const probe = await fetchNodeWalletAddress(base);
  if (probe.address) {
    state.settings.nodeAddress = probe.address;
  }
  await setState(state);
}
