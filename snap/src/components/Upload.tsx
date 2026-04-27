/**
 * Upload screen.
 *
 * Honest UX caveat: the Snap runtime gives us `fetch`, not `XMLHttpRequest`,
 * and `fetch` exposes no upload-progress events. So the user picks a file,
 * picks a stamp, hits "Upload", and waits — we render "uploading…" until the
 * backend responds. We never show a fake progress bar.
 *
 * The file comes back from `<FileInput />` as a base64 string in
 * `onUserInput`'s event payload. We decode it client-side, sign
 * `${filename}:${batchId}` with personal_sign, and POST the bytes to
 * `${beeApiUrl}/bzz`.
 */

import {
  Box,
  Heading,
  Text,
  Bold,
  Button,
  Form,
  Field,
  Dropdown,
  Option,
  FileInput,
  Section,
  Row,
  Divider,
  Container,
  Footer,
  Banner,
  Copyable,
  Link,
} from '@metamask/snaps-sdk/jsx';
import {
  DEFAULT_BEE_API_URL,
  BEE_GATEWAY_URL,
  MAX_SNAP_UPLOAD_BINARY_BYTES,
} from '../lib/constants';
import {
  fetchStampInfo,
  fetchNodeWalletAddress,
  uploadFile,
  type StampFetchDebug,
} from '../lib/bee';
import { signMessage } from '../lib/ethereum';
import { getBeesnapAddress } from '../lib/wallet';
import { addUpload, getState } from '../lib/state';
import { describeError, shortHash } from '../lib/utils';
import { getOwnerBatches } from '../lib/registry';
import { NAV_EVENTS } from './Home';

export const UPLOAD_EVENTS = {
  /** Name of the Form element — used to look up form state in `snap_getInterfaceState`. */
  FORM: 'upload-form',
  /** Footer button click that triggers the upload. Lives outside the Form so we read state by hand. */
  SUBMIT: 'upload-submit',
  RETRY: 'upload-retry',
  /** After an oversize file pick, reload a clean upload form (drops stuck file state). */
  RESET_PICKER: 'upload-reset-picker',
  /**
   * User passed the pre-picker safety screen — show {@link UploadForm} with
   * {@link FileInput}. MetaMask reads the whole file as soon as the picker
   * confirms, so we never render FileInput before this ack.
   */
  PROCEED_TO_PICKER: 'upload-proceed-to-picker',
} as const;

export const UPLOAD_FIELDS = {
  STAMP: 'upload-field-stamp',
  FILE: 'upload-field-file',
  WEBSITE: 'upload-field-website',
} as const;

export interface UsableStamp {
  /** No 0x prefix — matches Bee API + headers. */
  batchId: string;
  /** With 0x prefix — for display. */
  batchIdHex: string;
  depth: number;
  ttlSeconds: number;
  utilization: number;
  usable: boolean;
}

export async function loadUsableStamps(account: string): Promise<{
  stamps: UsableStamp[];
  registryError?: string;
}> {
  const state = await getState();
  const beeApiUrl = state.settings.beeApiUrl ?? DEFAULT_BEE_API_URL;

  let batches;
  try {
    batches = await getOwnerBatches(account);
  } catch (err) {
    return { stamps: [], registryError: describeError(err) };
  }

  // Probe /wallet so we can drop stamps minted against a different Bee node
  // — those will fail every upload with "issuer does not exist". If the
  // probe fails, we don't filter (better to show all than hide silently).
  const walletProbe = await fetchNodeWalletAddress(beeApiUrl);
  const currentNodeAddress = walletProbe.address;

  const enriched = await Promise.all(
    batches.map(async (b) => {
      const idNoPrefix = b.batchId.slice(2);

      // If we know the current node and this stamp's nodeAddress doesn't
      // match, skip the /stamps round-trip entirely — Bee will 404 anyway.
      if (
        currentNodeAddress !== null &&
        currentNodeAddress.toLowerCase() !== b.nodeAddress.toLowerCase()
      ) {
        return null;
      }

      const { info } = await fetchStampInfo(beeApiUrl, idNoPrefix);
      if (!info) return null;
      return {
        batchId: idNoPrefix,
        batchIdHex: b.batchId,
        depth: info.depth,
        ttlSeconds: info.batchTTL,
        utilization: info.utilization,
        usable: info.usable,
      } as UsableStamp;
    }),
  );

  return {
    stamps: enriched.filter((s): s is UsableStamp => s !== null && s.usable),
  };
}

// ── Pre-picker gate (no FileInput — MetaMask would read bytes before Snap runs) ─

/**
 * Shown when opening Upload from Home with usable stamps. There is no
 * `FileInput` here: MetaMask's UI reads the full file into memory and base64
 * before `onUserInput` runs, so a 60 MB pick can exceed Chromium's 64 MiB IPC
 * cap and brick the extension before our size checks execute.
 */
export function UploadIntro() {
  const limitLabel = formatBytes(MAX_SNAP_UPLOAD_BINARY_BYTES);
  return (
    <Container>
      <Box>
        <Heading>Before you choose a file</Heading>
        <Banner severity="danger" title="Hard size limit">
          <Text>
            {`MetaMask reads the entire file into the extension as soon as you confirm the picker — before Beesnap runs. Files over about ${limitLabel} are not safe here: they can pass the OS dialog then exceed the browser's ~64 MB extension message limit, which freezes or breaks the Snap until you reload MetaMask.`}
          </Text>
        </Banner>
        <Text>
          {`Use only files up to ${limitLabel} on the next screen. For bigger data, upload with swarm/bee tools against your node instead of this Snap.`}
        </Text>
      </Box>
      <Footer>
        <Button name={NAV_EVENTS.HOME}>Back</Button>
        <Button name={UPLOAD_EVENTS.PROCEED_TO_PICKER}>Continue to file picker</Button>
      </Footer>
    </Container>
  );
}

// ── Form screen ──────────────────────────────────────────────────────────────

export interface UploadFormProps {
  stamps: UsableStamp[];
  registryError?: string;
  /**
   * If a file has been picked since the form first loaded, this carries its
   * display info so we can render a "Selected:" confirmation. The file
   * itself is held by the framework in form state — we don't pass it here.
   */
  selected?: { name: string; size: number; contentType: string };
  /**
   * User picked a file over `MAX_SNAP_UPLOAD_BINARY_BYTES` — show error and
   * offer "Choose another file" instead of Upload until they reset.
   */
  fileSizeRejected?: { name: string; size: number };
}

export function UploadForm(props: UploadFormProps) {
  const { stamps, registryError, selected, fileSizeRejected } = props;
  const limitLabel = formatBytes(MAX_SNAP_UPLOAD_BINARY_BYTES);

  if (registryError) {
    return (
      <Container>
        <Box>
          <Heading>Upload a file</Heading>
          <Banner severity="danger" title="Couldn't read the registry">
            <Text>{registryError}</Text>
          </Banner>
        </Box>
        <Footer>
          <Button name={NAV_EVENTS.HOME}>Back</Button>
        </Footer>
      </Container>
    );
  }

  if (stamps.length === 0) {
    return (
      <Container>
        <Box>
          <Heading>Upload a file</Heading>
          <Text>
            You don't have any usable storage yet. Buy some to start uploading.
          </Text>
        </Box>
        <Footer>
          <Button name={NAV_EVENTS.BUY}>Buy storage</Button>
          <Button name={NAV_EVENTS.HOME}>Back</Button>
        </Footer>
      </Container>
    );
  }

  return (
    <Container>
      <Box>
        <Heading>Upload a file</Heading>
        <Text>
          Choose which postage batch (by its ID) should pay for the upload, then
          select a file. The Snap signs an authentication message, then your Bee
          node stores the data.
        </Text>

        <Banner severity="info" title="Maximum file size">
          <Text>
            MetaMask can only move about {limitLabel} per file through the Snap
            (browser limit). For larger files, split the data or upload outside
            the wallet.
          </Text>
        </Banner>

        {fileSizeRejected ? (
          <Banner severity="danger" title="File is too large">
            <Text>
              {`${fileSizeRejected.name} (${formatBytes(fileSizeRejected.size)}) exceeds the ${limitLabel} limit for Snap uploads. If MetaMask stopped responding, reload the extension or use "Choose another file" below.`}
            </Text>
          </Banner>
        ) : null}

        {/*
          Form wraps the inputs purely so the framework keeps their values in
          interface state. The actual "Upload" button lives in the Footer
          (full-width, more tappable) — same pattern as the Buy form's "Get
          quote". On click the router reads form state via
          `snap_getInterfaceState[UPLOAD_EVENTS.FORM]`.
        */}
        <Form name={UPLOAD_EVENTS.FORM}>
          <Field label="Storage batch">
            <Dropdown name={UPLOAD_FIELDS.STAMP}>
              {stamps.map((s) => (
                <Option value={s.batchId}>
                  {shortHash(s.batchIdHex, 8, 6)}
                </Option>
              ))}
            </Dropdown>
          </Field>

          <Field
            label={`File (max ${limitLabel})`}
            error={
              fileSizeRejected
                ? 'Pick a smaller file or reset — large files can crash MetaMask before this Snap runs.'
                : undefined
            }
          >
            {/* No `accept` prop = accept any file type. The SDK treats each
                entry in `accept` as a literal MIME or extension match, so a
                wildcard MIME pattern would silently reject every real file
                (it has no MIME wildcard semantics). Omitting `accept` is
                the correct "all files" pattern. */}
            <FileInput name={UPLOAD_FIELDS.FILE} />
          </Field>
        </Form>

        {/* "Selected:" confirmation. The FileInput's own visual state isn't
            reliable in this Flask version (it stays on "Drop your file
            here" even after a file is picked), so we render an explicit
            banner from `selected` — populated by the FileUploadEvent
            handler, which re-renders this same form using identical field
            names so the file stays in form state. */}
        {selected ? (
          <Banner severity="success" title="File selected">
            <Text>
              {`${selected.name} · ${formatBytes(selected.size)}${selected.contentType ? ` · ${selected.contentType}` : ''}`}
            </Text>
          </Banner>
        ) : null}

        <Banner severity="info" title="No progress bar">
          <Text>
            The Snap runtime can't show real upload progress. After you press
            Upload, the screen will say "uploading…" until the Bee node
            responds — that may take a while for large files.
          </Text>
        </Banner>
      </Box>
      <Footer>
        <Button name={NAV_EVENTS.HOME}>Back</Button>
        {fileSizeRejected ? (
          <Button name={UPLOAD_EVENTS.RESET_PICKER}>Choose another file</Button>
        ) : (
          <Button name={UPLOAD_EVENTS.SUBMIT}>Upload</Button>
        )}
      </Footer>
    </Container>
  );
}

// ── In-flight ─────────────────────────────────────────────────────────────────

export function UploadInFlight(props: { filename: string }) {
  return (
    <Container>
      <Box>
        <Heading>Uploading…</Heading>
        <Text>
          Sending <Bold>{props.filename}</Bold> to your Bee node. Please wait.
        </Text>
        <Banner severity="info" title="Don't close MetaMask">
          <Text>
            We can't surface progress while the upload is in flight. This screen
            updates only when the Bee node responds.
          </Text>
        </Banner>
      </Box>
    </Container>
  );
}

// ── Done ──────────────────────────────────────────────────────────────────────

export interface UploadDoneProps {
  success: boolean;
  filename: string;
  reference?: string;
  errorMessage?: string;
  /**
   * Diagnostics from the upload attempt. On failure this carries the URL we
   * POSTed to, the HTTP status, response body, or the network-error message
   * so the user can see exactly what went wrong instead of a bare
   * "Failed to fetch."
   */
  debug?: StampFetchDebug;
}

export function UploadDone(props: UploadDoneProps) {
  if (props.success && props.reference) {
    const gatewayUrl = `${BEE_GATEWAY_URL}${props.reference}`;
    return (
      <Container>
        <Box>
          <Heading>Upload complete</Heading>
          <Banner severity="success" title="File is on Swarm">
            <Text>{props.filename}</Text>
          </Banner>
          <Section>
            <Heading size="sm">Reference</Heading>
            {/* Copyable truncates the value with a built-in copy button —
                no horizontal overflow regardless of how long the hash is. */}
            <Copyable value={props.reference} />
            <Heading size="sm">Open in browser</Heading>
            {/* Show a short label rather than the full URL — bzz.link/bzz/<6chars>… —
                while the link itself opens the full gateway URL. */}
            <Link href={gatewayUrl}>
              {`bzz.link/bzz/${shortHash(props.reference, 6, 4)}`}
            </Link>
          </Section>
        </Box>
        <Footer>
          <Button name={NAV_EVENTS.HOME}>Home</Button>
          <Button name={NAV_EVENTS.UPLOADS}>View uploads</Button>
        </Footer>
      </Container>
    );
  }
  return (
    <Container>
      <Box>
        <Heading>Upload failed</Heading>
        <Banner severity="danger" title="Something went wrong">
          <Text>{props.errorMessage ?? 'Unknown error.'}</Text>
        </Banner>

        {props.debug ? (
          <Section>
            <Heading size="sm">Diagnostics</Heading>
            <Row label="URL">
              <Text>{props.debug.url}</Text>
            </Row>
            {props.debug.networkError ? (
              <Row label="Network error">
                <Text>{props.debug.networkError}</Text>
              </Row>
            ) : (
              <Box>
                <Row label="Status">
                  <Text>
                    {`${props.debug.status ?? '?'} ${props.debug.statusText ?? ''}`}
                  </Text>
                </Row>
                {props.debug.contentType ? (
                  <Row label="Content-Type">
                    <Text>{props.debug.contentType}</Text>
                  </Row>
                ) : null}
                {props.debug.body ? (
                  <Row label="Body">
                    <Text>{props.debug.body}</Text>
                  </Row>
                ) : null}
              </Box>
            )}
            <Divider />
            <Text>
              "Failed to fetch" with no status almost always means the Bee
              proxy's CORS preflight rejected the request. Check that the
              server's Access-Control-Allow-Headers includes
              x-upload-signed-message, x-uploader-address, x-file-name,
              x-message-content, swarm-postage-batch-id, swarm-pin,
              swarm-deferred-upload, and swarm-collection.
            </Text>
          </Section>
        ) : null}
      </Box>
      <Footer>
        <Button name={UPLOAD_EVENTS.RETRY}>Try again</Button>
        <Button name={NAV_EVENTS.HOME}>Back to home</Button>
      </Footer>
    </Container>
  );
}

// ── Execution helper ──────────────────────────────────────────────────────────

/**
 * Decode the base64 file payload that FileInput hands us, sign the auth
 * message with the Snap-derived account, and POST to /bzz. Returns a result the
 * entry-point router can feed straight into <UploadDone />.
 *
 * The uploader is implicit (the Snap-derived account); callers don't pass it.
 */
export async function runUpload(opts: {
  batchId: string;
  filename: string;
  contentType: string;
  base64: string;
  isWebsite: boolean;
}): Promise<UploadDoneProps> {
  try {
    const approxBytes = approxDecodedBytesFromBase64(opts.base64);
    if (approxBytes > MAX_SNAP_UPLOAD_BINARY_BYTES) {
      return {
        success: false,
        filename: opts.filename,
        errorMessage: `This file is about ${formatBytes(approxBytes)} after decoding, which exceeds the ${formatBytes(MAX_SNAP_UPLOAD_BINARY_BYTES)} limit enforced by the MetaMask / Snap message size cap.`,
      };
    }

    const state = await getState();
    const beeApiUrl = state.settings.beeApiUrl ?? DEFAULT_BEE_API_URL;
    const uploaderAddress = await getBeesnapAddress();

    const messageToSign = `${opts.filename}:${opts.batchId}`;
    const signature = await signMessage(messageToSign);

    const bytes = base64ToBytes(opts.base64);
    if (bytes.length > MAX_SNAP_UPLOAD_BINARY_BYTES) {
      return {
        success: false,
        filename: opts.filename,
        errorMessage: `File is ${formatBytes(bytes.length)}; maximum for Snap uploads is ${formatBytes(MAX_SNAP_UPLOAD_BINARY_BYTES)}.`,
      };
    }

    const outcome = await uploadFile({
      beeApiUrl,
      batchId: opts.batchId,
      filename: opts.filename,
      contentType: opts.contentType || 'application/octet-stream',
      bytes,
      uploaderAddress,
      signature,
      isWebsite: opts.isWebsite,
    });

    if (!outcome.ok) {
      // Build a human-readable headline from the debug payload, then hand
      // the raw debug object to the UI so it can render the full block.
      const headline = outcome.debug.networkError
        ? `Network error: ${outcome.debug.networkError}`
        : `Upload rejected (${outcome.debug.status ?? '?'} ${outcome.debug.statusText ?? ''}): ${outcome.debug.body ?? ''}`.trim();
      return {
        success: false,
        filename: opts.filename,
        errorMessage: headline,
        debug: outcome.debug,
      };
    }

    // Pull stamp info to record an honest expiry date in our local history.
    const { info } = await fetchStampInfo(beeApiUrl, opts.batchId);
    const expiryDate =
      info && info.batchTTL > 0
        ? Date.now() + info.batchTTL * 1000
        : 0;

    await addUpload(uploaderAddress, {
      reference: outcome.reference,
      batchId: opts.batchId,
      expiryDate,
      filename: opts.filename,
      fileSize: bytes.length,
      isWebsite: opts.isWebsite,
      uploadedAt: Date.now(),
    });

    return {
      success: true,
      filename: opts.filename,
      reference: outcome.reference,
    };
  } catch (err) {
    return {
      success: false,
      filename: opts.filename,
      errorMessage: describeError(err),
    };
  }
}

/** Compact byte-size formatter for the "Selected:" banner. */
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Strip data-URL prefix and return raw base64 payload. */
function rawBase64Payload(b64: string): string {
  const idx = b64.indexOf(',');
  return idx >= 0 ? b64.slice(idx + 1) : b64;
}

/** Upper bound on decoded byte length without allocating the full buffer. */
function approxDecodedBytesFromBase64(b64: string): number {
  const raw = rawBase64Payload(b64);
  const len = raw.length;
  const pad =
    len >= 2 && raw[len - 2] === '=' ? 2 : len >= 1 && raw[len - 1] === '=' ? 1 : 0;
  return Math.max(0, Math.floor((len * 3) / 4) - pad);
}

/** Decode a base64 string to a Uint8Array. atob is available inside Snap. */
function base64ToBytes(b64: string): Uint8Array {
  // FileInput sometimes returns "data:<mime>;base64,...." — strip prefix.
  const cleaned = rawBase64Payload(b64);
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
