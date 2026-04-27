/**
 * "View my stamps" screen. Pulls the user's batch list from the on-chain
 * registry and decorates each entry with utilization + TTL pulled from the
 * Bee /stamps API via the backend proxy.
 *
 * Hard rule: no mock data. If the registry call fails we say so. If the per-
 * stamp Bee call fails we render only what the registry knows and label the
 * runtime fields as unavailable.
 */

import {
  Box,
  Heading,
  Text,
  Button,
  Section,
  Row,
  Divider,
  Address,
  Container,
  Footer,
  Banner,
  Copyable,
} from '@metamask/snaps-sdk/jsx';
import { getOwnerBatches, RegistryBatch } from '../lib/registry';
import {
  fetchStampInfo,
  fetchNodeWalletAddress,
  StampInfo,
  type StampFetchDebug,
} from '../lib/bee';
import { DEFAULT_BEE_API_URL } from '../lib/constants';
import { getState } from '../lib/state';
import { describeError, formatTTL, getStampUsagePercent } from '../lib/utils';
import { NAV_EVENTS } from './Home';

/** What we know about a single stamp after one round of fetching. */
export interface StampEntry {
  /** Bee /stamps response (null when not yet resolved). */
  info: StampInfo | null;
  /** Diagnostics from the most recent fetch attempt. */
  debug: StampFetchDebug;
  /**
   * Whether this stamp's `nodeAddress` matches the current Bee node's
   * walletAddress (per /wallet). Stamps where this is false were minted
   * against a different Bee node and aren't usable from the current one —
   * the Bee node will return "issuer does not exist" on every operation.
   * If we couldn't reach /wallet at all, this is `null` (unknown).
   */
  boundToCurrentNode: boolean | null;
}

export interface StampsLoadResult {
  /** Entries returned by the on-chain registry. Always present (or [] on no stamps). */
  batches: RegistryBatch[];
  /** Per-batch outcome, indexed by batchId without 0x prefix. */
  stamps: Record<string, StampEntry>;
  /** Top-level error if the registry read itself failed. UI should bail out and show this. */
  registryError?: string;
  /** Whether at least one /stamps call failed; UI shows a non-blocking warning. */
  hadStampError: boolean;
}

/**
 * Count how many of `batches` have a corresponding non-null Bee `/stamps`
 * response. Used by the auto-poll loop to decide whether a fresh fetch
 * actually improved on the previous render — avoids redundant updates.
 */
export function countResolvedStamps(d: StampsLoadResult): number {
  return Object.values(d.stamps).filter((s) => s.info !== null).length;
}

export async function loadStamps(account: string): Promise<StampsLoadResult> {
  const state = await getState();
  const beeApiUrl = state.settings.beeApiUrl ?? DEFAULT_BEE_API_URL;
  console.log(`[stamps] loading for account ${account} via ${beeApiUrl}`);

  let batches: RegistryBatch[];
  try {
    batches = await getOwnerBatches(account);
    console.log(
      `[stamps] registry returned ${batches.length} batch(es):`,
      batches.map((b) => ({
        batchId: b.batchId,
        depth: b.depth,
        nodeAddress: b.nodeAddress,
      })),
    );
  } catch (err) {
    console.error(`[stamps] registry read failed:`, err);
    return {
      batches: [],
      stamps: {},
      registryError: describeError(err),
      hadStampError: false,
    };
  }

  // Probe /wallet once so we can flag stamps minted against a different node.
  // If the call fails, every stamp's `boundToCurrentNode` is left `null`
  // ("unknown") and we don't filter or warn about them.
  let currentNodeAddress: `0x${string}` | null = null;
  try {
    const probe = await fetchNodeWalletAddress(beeApiUrl);
    currentNodeAddress = probe.address;
    console.log(`[stamps] current Bee node address: ${currentNodeAddress ?? 'unknown'}`);
  } catch (err) {
    console.warn(`[stamps] /wallet probe failed:`, err);
  }

  // Fetch per-stamp info in parallel. We tolerate per-stamp failures.
  const stamps: Record<string, StampEntry> = {};
  let hadStampError = false;
  await Promise.all(
    batches.map(async (b) => {
      const idNoPrefix = b.batchId.slice(2);
      const boundToCurrentNode =
        currentNodeAddress === null
          ? null
          : currentNodeAddress.toLowerCase() === b.nodeAddress.toLowerCase();

      try {
        const outcome = await fetchStampInfo(beeApiUrl, idNoPrefix);
        stamps[idNoPrefix] = { ...outcome, boundToCurrentNode };
        if (outcome.info === null) {
          // Don't count "wrong node" as a "still resolving" warning — those
          // will never resolve from this Bee, by design.
          if (boundToCurrentNode !== false) hadStampError = true;
          console.warn(
            `[stamps] no Bee data for ${b.batchId} yet`,
            outcome.debug,
          );
        } else {
          console.log(`[stamps] resolved ${b.batchId}:`, {
            usable: outcome.info.usable,
            depth: outcome.info.depth,
            utilization: outcome.info.utilization,
            batchTTL: outcome.info.batchTTL,
          });
        }
      } catch (err) {
        console.error(`[stamps] fetchStampInfo threw for ${b.batchId}:`, err);
        stamps[idNoPrefix] = {
          info: null,
          debug: {
            url: `${beeApiUrl}/stamps/${idNoPrefix}`,
            networkError: describeError(err),
          },
          boundToCurrentNode,
        };
        if (boundToCurrentNode !== false) hadStampError = true;
      }
    }),
  );

  console.log(
    `[stamps] done. ${
      Object.values(stamps).filter((s) => s.info !== null).length
    }/${batches.length} resolved.`,
  );
  return { batches, stamps, registryError: undefined, hadStampError };
}

export function StampsList(props: StampsLoadResult) {
  const { batches, stamps, registryError, hadStampError } = props;

  if (registryError) {
    return (
      <Container>
        <Box>
          <Heading>My storage</Heading>
          <Banner severity="danger" title="Couldn't read the registry">
            <Text>{registryError}</Text>
            <Text>
              The on-chain registry on Gnosis is unreachable. Try again in a
              moment.
            </Text>
          </Banner>
        </Box>
        <Footer>
          <Button name={NAV_EVENTS.HOME}>Back</Button>
        </Footer>
      </Container>
    );
  }

  if (batches.length === 0) {
    return (
      <Container>
        <Box>
          <Heading>My storage</Heading>
          <Text>You don't own any storage yet.</Text>
          <Button name={NAV_EVENTS.BUY}>Buy your first storage</Button>
        </Box>
        <Footer>
          <Button name={NAV_EVENTS.HOME}>Back</Button>
        </Footer>
      </Container>
    );
  }

  return (
    <Container>
      <Box>
        <Heading>My storage</Heading>
        <Text>
          {String(batches.length)}{' '}
          {batches.length === 1 ? 'item' : 'items'} registered to this account.
        </Text>

        {hadStampError ? (
          <Banner severity="warning" title="Some details still resolving">
            <Text>
              Bee hasn't picked up one or more items yet — usually 1–3 minutes
              after a fresh purchase. The screen will refresh automatically for
              the next 2 minutes, or tap Refresh to re-check now.
            </Text>
          </Banner>
        ) : (
          <Text>{' '}</Text>
        )}

        {batches.map((b, i) => {
          const idNoPrefix = b.batchId.slice(2);
          const entry = stamps[idNoPrefix];
          const info = entry?.info ?? null;
          const usagePct = info
            ? getStampUsagePercent(info.utilization, info.depth)
            : null;
          const ttl = info ? formatTTL(info.batchTTL) : 'unknown';
          return (
            <Section key={`s-${i}`}>
              <Heading size="sm">{`Storage #${i + 1}`}</Heading>
              <Row label="ID">
                <Copyable value={b.batchId} />
              </Row>
              <Row label="Capacity">
                <Text>{`depth ${b.depth}`}</Text>
              </Row>
              <Row label="Used">
                <Text>
                  {usagePct === null
                    ? 'unavailable'
                    : `${usagePct.toFixed(2)}%`}
                </Text>
              </Row>
              <Row label="Expires in">
                <Text>{ttl}</Text>
              </Row>
              <Row label="Node">
                <Address address={b.nodeAddress as `0x${string}`} />
              </Row>

              {/* If this storage was minted against a different Bee node,
                  the current node will reject every operation against it
                  ("issuer does not exist"). Surface that clearly so the
                  user knows it's not a transient error. */}
              {entry?.boundToCurrentNode === false ? (
                <Banner
                  severity="warning"
                  title="Bound to a different Bee node"
                >
                  <Text>
                    This storage was created against another Bee node and
                    can't be used from your current one. Either point the
                    Snap at the original Bee node in Settings, or buy new
                    storage on this node.
                  </Text>
                </Banner>
              ) : null}

              <Divider />
            </Section>
          );
        })}
      </Box>
      <Footer>
        <Button name={NAV_EVENTS.HOME}>Back</Button>
        <Button name={NAV_EVENTS.STAMPS}>Refresh</Button>
      </Footer>
    </Container>
  );
}
