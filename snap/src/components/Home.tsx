/**
 * Root home screen.
 *
 * Shows the Snap-derived account address (from your seed phrase) plus its
 * xDAI balance, so the user always knows whether they need to fund the account
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

export const NAV_EVENTS = {
  HOME: 'nav-home',
  STAMPS: 'nav-stamps',
  BUY: 'nav-buy',
  UPLOAD: 'nav-upload',
  UPLOADS: 'nav-uploads',
  SETTINGS: 'nav-settings',
} as const;

export interface HomeProps {
  /** The Snap-derived Beesnap account. Always present once Snap is installed. */
  beesnapAddress: `0x${string}`;
  /** xDAI balance of that account in wei. null = couldn't fetch. */
  beesnapBalanceWei: bigint | null;
}

/** Threshold below which we warn the user to top up. ~$0.05 worth of xDAI. */
const LOW_BALANCE_THRESHOLD_WEI = 50_000_000_000_000_000n; // 0.05 xDAI

export function Home({ beesnapAddress, beesnapBalanceWei }: HomeProps) {
  const balanceLabel =
    beesnapBalanceWei === null
      ? 'unavailable'
      : `${formatXdai(beesnapBalanceWei)} xDAI`;
  const lowBalance =
    beesnapBalanceWei !== null &&
    beesnapBalanceWei < LOW_BALANCE_THRESHOLD_WEI;

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
            unique to this Snap. Send xDAI here to fund stamp purchases and
            uploads.
          </Text>
          <Row label="Address">
            <Address address={beesnapAddress} />
          </Row>
          <Row label="Copy">
            <Copyable value={beesnapAddress} />
          </Row>
          <Row label="Balance">
            <Text>{balanceLabel}</Text>
          </Row>
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
 * Format wei as a fixed-precision xDAI amount. xDAI has 18 decimals, same as
 * ETH. We render to 4 decimals because that's enough for the user to see the
 * difference between "fully funded" and "almost empty" without overwhelming
 * them with all 18 digits.
 */
function formatXdai(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const fractional = wei % 10n ** 18n;
  // Pad to 18, take leading 4 digits for display.
  const fracStr = fractional.toString().padStart(18, '0').slice(0, 4);
  return `${whole.toString()}.${fracStr}`;
}
