/**
 * "View my uploads" — pulls from `snap_manageState`.
 *
 * The Swarm network has no centralized index of uploads, so this list is
 * exclusively the Snap's local record of what *this* MetaMask account has
 * uploaded through *this* Snap. Uploads done through the old Next.js app
 * lived in the browser's localStorage and won't carry over.
 *
 * No mock entries: empty state when there are none.
 */

import {
  Box,
  Heading,
  Text,
  Button,
  Section,
  Row,
  Container,
  Footer,
  Divider,
  Copyable,
  Link,
} from '@metamask/snaps-sdk/jsx';
import { BEE_GATEWAY_URL } from '../lib/constants';
import { UploadRecord } from '../lib/state';
import { formatDateMs, shortHash } from '../lib/utils';
import { NAV_EVENTS } from './Home';

export function UploadsList(props: {
  uploads: UploadRecord[];
}) {
  const { uploads } = props;

  if (uploads.length === 0) {
    return (
      <Container>
        <Box>
          <Heading>My uploads</Heading>
          <Text>
            No uploads from this Snap yet. Once you upload a file, it'll show up
            here with its reference and gateway link.
          </Text>
        </Box>
        <Footer>
          <Button name={NAV_EVENTS.UPLOAD}>Upload a file</Button>
          <Button name={NAV_EVENTS.HOME}>Back</Button>
        </Footer>
      </Container>
    );
  }

  return (
    <Container>
      <Box>
        <Heading>My uploads</Heading>
        <Text>
          {String(uploads.length)}{' '}
          {uploads.length === 1 ? 'upload' : 'uploads'} on this account.
        </Text>

        {uploads.map((u, i) => {
          const url = `${BEE_GATEWAY_URL}${u.reference}`;
          const expires =
            u.expiryDate > 0 ? formatDateMs(u.expiryDate) : 'unknown';
          return (
            <Section key={`u-${i}`}>
              <Heading size="sm">{u.filename || 'Untitled'}</Heading>
              <Row label="Reference">
                <Copyable value={u.reference} />
              </Row>
              <Row label="Gateway">
                <Link href={url}>{shortHash(url, 28, 12)}</Link>
              </Row>
              <Row label="Stamp">
                <Text>{shortHash(u.batchId, 8, 6)}</Text>
              </Row>
              <Row label="Uploaded">
                <Text>{formatDateMs(u.uploadedAt)}</Text>
              </Row>
              <Row label="Expires">
                <Text>{expires}</Text>
              </Row>
              <Divider />
            </Section>
          );
        })}
      </Box>
      <Footer>
        <Button name={NAV_EVENTS.HOME}>Back</Button>
      </Footer>
    </Container>
  );
}
