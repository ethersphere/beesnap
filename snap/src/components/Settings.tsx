/**
 * Settings screen.
 *
 *  - beeApiUrl — overrides DEFAULT_BEE_API_URL when pointing at a Bee proxy.
 *  - nodeAddress — read-only in UI; always populated from GET `${beeApiUrl}/wallet`
 *    (see `syncStoredNodeAddressWithWallet` in bee.ts). Not user-editable so we
 *    never stamp against a guessed address.
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
import { DEFAULT_BEE_API_URL } from '../lib/constants';
import { NAV_EVENTS } from './Home';

export const SETTINGS_EVENTS = {
  SAVE: 'settings-save',
  RESET_BEE: 'settings-reset-bee',
} as const;

export const SETTINGS_FIELDS = {
  BEE_API_URL: 'settings-bee-api-url',
} as const;

export interface SettingsFormProps {
  beeApiUrl: string;
  /** Last persisted node address from GET /wallet (may be empty if unreachable). */
  nodeAddress: string;
  savedJustNow?: boolean;
  validationError?: string;
  walletProbe?:
    | { ok: true; nodeAddress: `0x${string}`; from: string }
    | { ok: false; reason: string; from: string };
  liveDefaultNode?: { ok: true; address: `0x${string}` } | { ok: false; reason: string };
}

export function SettingsForm(p: SettingsFormProps) {
  return (
    <Container>
      <Box>
        <Heading>Settings</Heading>
        <Text>Set your Bee API base URL.</Text>

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
          <Banner severity="success" title="Node address from Bee">
            <Text>{`From ${p.walletProbe.from}: ${p.walletProbe.nodeAddress}`}</Text>
          </Banner>
        ) : null}
        {p.walletProbe && !p.walletProbe.ok ? (
          <Banner severity="warning" title="Could not read node address">
            <Text>
              {`Tried ${p.walletProbe.from} — ${p.walletProbe.reason}. Set a reachable Bee API URL and save again.`}
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

          <Box direction="vertical">
            <Button type="submit" name={SETTINGS_EVENTS.SAVE}>
              Save
            </Button>
          </Box>
        </Form>

        <Section>
          <Heading size="sm">Current Bee node</Heading>
          <Row label="Bee API URL in use">
            <Text>{p.beeApiUrl || DEFAULT_BEE_API_URL}</Text>
          </Row>
          <Row label="Node address (from /wallet)">
            <Text>
              {p.nodeAddress
                ? p.nodeAddress
                : p.liveDefaultNode?.ok
                  ? p.liveDefaultNode.address
                  : p.liveDefaultNode
                    ? `unavailable (${p.liveDefaultNode.reason})`
                    : 'not loaded yet — open Home or save'}
            </Text>
          </Row>
        </Section>

        <Box direction="vertical">
          <Button name={SETTINGS_EVENTS.RESET_BEE}>Reset Bee API URL</Button>
        </Box>

        <Banner severity="info" title="Why would I change this?">
          <Text>
            The Bee API must allow cross-origin requests from Snaps. If "View my storage" shows
            "Failed to fetch", point this at a Bee proxy you control (or one with permissive CORS)
            and save.
          </Text>
        </Banner>
      </Box>
      <Footer>
        <Button name={NAV_EVENTS.HOME}>Back</Button>
      </Footer>
    </Container>
  );
}

export function validateBeeApiUrl(input: string): { error: string } | { ok: true; value: string } {
  let trimmed = input.trim();
  if (trimmed === '') return { ok: true, value: '' };
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) {
    return {
      error: 'Bee API URL must start with http:// or https:// (e.g. https://beeport.xyz).',
    };
  }
  while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);
  return { ok: true, value: trimmed };
}
