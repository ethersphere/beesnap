/**
 * Root home screen.
 *
 * Shows the Snap-derived account address (from your seed phrase) plus native
 * balances on every “pay from” chain, so the user can fund the right network
 * before buying stamps. Then four primary navigation buttons that hand off to
 * the buy / upload / stamps-list / uploads-list screens via `onUserInput`.
 */

import {
  Box,
  Heading,
  Text,
  Button,
  Footer,
  Divider,
  Section,
  Container,
  Row,
  Copyable,
  Banner,
  Address,
} from '@metamask/snaps-sdk/jsx';

import { GNOSIS_CHAIN_ID } from '../lib/constants';

export const NAV_EVENTS = {
  HOME: 'nav-home',
  STAMPS: 'nav-stamps',
  BUY: 'nav-buy',
  UPLOAD: 'nav-upload',
  UPLOADS: 'nav-uploads',
  SETTINGS: 'nav-settings',
} as const;

export type HomeChainBalance = {
  chainId: number;
  name: string;
  symbol: string;
  /** Native token balance in wei. null = couldn't fetch. */
  wei: bigint | null;
};

export interface HomeProps {
  /** The Snap-derived Beesnap account. Always present once Snap is installed. */
  beesnapAddress: `0x${string}`;
  /**
   * Native balance per `SOURCE_CHAINS` network (Gnosis, Ethereum, Base, …).
   */
  chainBalances: HomeChainBalance[];
}

/** Threshold below which we warn the user to top up. ~$0.05 worth of xDAI on Gnosis. */
const LOW_BALANCE_THRESHOLD_WEI = 50_000_000_000_000_000n; // 0.05 xDAI

export function Home({ beesnapAddress, chainBalances }: HomeProps) {
  const gnosisWei = chainBalances.find(
    (c) => c.chainId === GNOSIS_CHAIN_ID,
  )?.wei;
  const lowBalance =
    gnosisWei !== null &&
    gnosisWei !== undefined &&
    gnosisWei < LOW_BALANCE_THRESHOLD_WEI;

  return (
    <Container>
      <Box>
        <Heading>Beesnap</Heading>
        <Text>
          Buy storage on Swarm and upload files to your Bee node — without
          leaving MetaMask.
        </Text>

        <Divider />

        <Section>
          <Heading size="sm">Your Beesnap account</Heading>
          <Text>
            This address is derived from your secret recovery phrase and is
            unique to this Snap. Gnosis (xDAI) pays the stamp; when you use Buy
            from other networks, fund the native token on that chain. Balances
            below are the same address on each network.
          </Text>
          <Row label="Address">
            <Address address={beesnapAddress} />
          </Row>
          <Row label="Copy">
            <Copyable value={beesnapAddress} />
          </Row>
          {chainBalances.map((c) => {
            const label = `${c.name} (${c.symbol})`;
            const v =
              c.wei === null
                ? 'unavailable'
                : `${formatNativeWei(c.wei)} ${c.symbol}`;
            return (
              <Row key={`bal-${String(c.chainId)}`} label={label}>
                <Text>{v}</Text>
              </Row>
            );
          })}
        </Section>

        {lowBalance ? (
          <Banner severity="warning" title="Low balance">
            <Text>
              Your Beesnap account has less than 0.05 xDAI. Send some xDAI on
              Gnosis to the address above before trying to buy a stamp.
            </Text>
          </Banner>
        ) : null}

        <Divider />

        <Heading size="md">What would you like to do?</Heading>

        <Box direction="vertical">
          <Button name={NAV_EVENTS.STAMPS}>View my storage</Button>
          <Button name={NAV_EVENTS.BUY}>Buy new storage</Button>
          <Button name={NAV_EVENTS.UPLOAD}>Upload a file</Button>
          <Button name={NAV_EVENTS.UPLOADS}>View my uploads</Button>
          <Button name={NAV_EVENTS.SETTINGS}>Settings</Button>
        </Box>
      </Box>
      <Footer>
        <Button name={NAV_EVENTS.HOME}>Refresh</Button>
      </Footer>
    </Container>
  );
}

/**
 * Format 18-decimal native wei (ETH, xDAI, POL, …) for display. Four fractional
 * digits: enough to see "funded" vs "empty" without overwhelming the UI.
 */
function formatNativeWei(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const fractional = wei % 10n ** 18n;
  const fracStr = fractional.toString().padStart(18, '0').slice(0, 4);
  return `${whole.toString()}.${fracStr}`;
}
