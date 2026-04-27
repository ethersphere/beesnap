/**
 * Settings screen.
 *
 * Lets the user override the two endpoints that the rest of the Snap reads
 * via `state.settings`:
 *  - beeApiUrl  — overrides DEFAULT_BEE_API_URL (https://beeport.xyz). Useful
 *                 when the default doesn't allow Snap fetches (CORS), when
 *                 you're running a local Bee proxy, or when you want to point
 *                 at a private deployment.
 *  - nodeAddress — overrides DEFAULT_NODE_ADDRESS for the postage stamp's
 *                  recorded node address. Most users never change this.
 *
 * Both fields have a "Reset" button that clears the override; the rest of the
 * Snap will fall back to the compiled-in defaults.
 *
 * Validation is intentionally light: we only check that beeApiUrl looks like
 * a URL and that nodeAddress (if set) looks like a 0x… address. The Snap's
 * actual fetch will surface real errors via the inline diagnostics on the
 * stamps screen.
 */

import {
  Box,
  Heading,
  Text,
  Button,
  Form,
  Field,
  Input,
  Section,
  Row,
  Container,
  Footer,
  Banner,
} from '@metamask/snaps-sdk/jsx';
import { DEFAULT_BEE_API_URL, DEFAULT_NODE_ADDRESS } from '../lib/constants';
import { NAV_EVENTS } from './Home';

// ── Event names ──────────────────────────────────────────────────────────────

export const SETTINGS_EVENTS = {
  SAVE: 'settings-save',
  RESET_BEE: 'settings-reset-bee',
  RESET_NODE: 'settings-reset-node',
} as const;

export const SETTINGS_FIELDS = {
  BEE_API_URL: 'settings-bee-api-url',
  NODE_ADDRESS: 'settings-node-address',
} as const;

// ── Form screen ──────────────────────────────────────────────────────────────

export interface SettingsFormProps {
  /** Current overrides — empty string means "use default". */
  beeApiUrl: string;
  nodeAddress: string;
  /** Set after a successful save so we can show a confirmation banner. */
  savedJustNow?: boolean;
  /** Set when validation rejected a save attempt. */
  validationError?: string;
  /**
   * After a save, this carries the result of probing /wallet on the new
   * Bee API URL. Lets the UI show "node address auto-detected as 0x…" or
   * "couldn't reach /wallet, kept previous node address."
   */
  walletProbe?:
    | { ok: true; nodeAddress: `0x${string}`; from: string }
    | { ok: false; reason: string; from: string };
  /**
   * What `${effectiveBeeUrl}/wallet` returned when we loaded the Settings
   * screen. Shown in the "Defaults" section so the user sees the node's
   * actual address, not a hardcoded sentinel that may not match this
   * node at all.
   */
  liveDefaultNode?: { ok: true; address: `0x${string}` } | { ok: false; reason: string };
}

export function SettingsForm(p: SettingsFormProps) {
  return (
    <Container>
      <Box>
        <Heading>Settings</Heading>
        <Text>
          Override the endpoints the Snap talks to. Leave a field empty to use
          the compiled-in default.
        </Text>

        {p.savedJustNow ? (
          <Banner severity="success" title="Saved">
            <Text>Your settings are now active.</Text>
          </Banner>
        ) : null}
        {p.validationError ? (
          <Banner severity="danger" title="Invalid input">
            <Text>{p.validationError}</Text>
          </Banner>
        ) : null}
        {p.walletProbe?.ok ? (
          <Banner severity="success" title="Node address detected">
            <Text>
              {`From ${p.walletProbe.from}: node address set to ${p.walletProbe.nodeAddress}.`}
            </Text>
          </Banner>
        ) : null}
        {p.walletProbe && !p.walletProbe.ok ? (
          <Banner severity="warning" title="Couldn't auto-detect node address">
            <Text>
              {`Tried ${p.walletProbe.from} but it returned: ${p.walletProbe.reason}. Kept your previous node address. You can edit it manually below.`}
            </Text>
          </Banner>
        ) : null}

        <Form name={SETTINGS_EVENTS.SAVE}>
          <Field label="Bee API URL">
            <Input
              name={SETTINGS_FIELDS.BEE_API_URL}
              type="text"
              placeholder={DEFAULT_BEE_API_URL}
              value={p.beeApiUrl}
            />
          </Field>

          <Field label="Swarm node address">
            <Input
              name={SETTINGS_FIELDS.NODE_ADDRESS}
              type="text"
              placeholder={DEFAULT_NODE_ADDRESS}
              value={p.nodeAddress}
            />
          </Field>

          <Box direction="vertical">
            <Button type="submit" name={SETTINGS_EVENTS.SAVE}>
              Save
            </Button>
          </Box>
        </Form>

        <Section>
          <Heading size="sm">Live values from the current Bee node</Heading>
          <Row label="Bee API URL in use">
            <Text>{p.beeApiUrl || DEFAULT_BEE_API_URL}</Text>
          </Row>
          <Row label="Node address">
            <Text>
              {p.liveDefaultNode?.ok
                ? p.liveDefaultNode.address
                : p.liveDefaultNode
                  ? `unreachable (${p.liveDefaultNode.reason})`
                  : 'checking…'}
            </Text>
          </Row>
        </Section>

        <Box direction="vertical">
          <Button name={SETTINGS_EVENTS.RESET_BEE}>Reset Bee API URL</Button>
          <Button name={SETTINGS_EVENTS.RESET_NODE}>Reset node address</Button>
        </Box>

        <Banner severity="info" title="Why would I change these?">
          <Text>
            The default Bee API at beeport.xyz must allow cross-origin requests
            from MetaMask Snaps for this Snap to read stamps and upload files.
            If your "View my stamps" diagnostics show "Failed to fetch", point
            this at a Bee proxy you control (or a public one with permissive
            CORS) and try again.
          </Text>
        </Banner>
      </Box>
      <Footer>
        <Button name={NAV_EVENTS.HOME}>Back</Button>
      </Footer>
    </Container>
  );
}

// ── Validation + persistence helpers ─────────────────────────────────────────

/**
 * Validate + normalize a Bee API URL. Returns either a user-facing error
 * string OR the cleaned URL (with any trailing slashes stripped).
 *
 * We're permissive here: a trailing slash isn't really wrong — the rest of
 * our code just doesn't tolerate it. So instead of rejecting it, we strip
 * it silently. The user typed `https://beeport.xyz/`; we save `https://beeport.xyz`.
 */
export function validateBeeApiUrl(
  input: string,
): { error: string } | { ok: true; value: string } {
  let trimmed = input.trim();
  if (trimmed === '') return { ok: true, value: '' }; // empty = "use default"
  // Must start with http:// or https:// and have a host.
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) {
    return {
      error:
        'Bee API URL must start with http:// or https:// (e.g. https://beeport.xyz).',
    };
  }
  // Strip any trailing slashes so `${url}/stamps/...` doesn't double up.
  while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);
  return { ok: true, value: trimmed };
}

export function validateNodeAddress(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null; // empty = "use default"
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    return 'Node address must be a 0x-prefixed 40-character hex string.';
  }
  return null;
}
