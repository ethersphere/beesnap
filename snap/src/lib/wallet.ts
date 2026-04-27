/**
 * The "Beeport account" — a private key derived deterministically from the
 * user's secret recovery phrase via `snap_getEntropy`.
 *
 * Why `snap_getEntropy` and not `snap_getBip32Entropy`?
 *   MetaMask explicitly forbids Snaps from deriving at the user's normal
 *   Ethereum BIP44 path (`m/44'/60'/0'/0/0`) — if it didn't, a malicious
 *   Snap could recover the user's main MetaMask private keys. So BIP44
 *   under coin_type 60 is off-limits.
 *
 *   `snap_getEntropy` is designed exactly for this case: it returns 32 bytes
 *   that are deterministic (same SRP + same Snap id + same salt = same
 *   bytes), unique to this Snap (salted by the Snap's id), and explicitly
 *   guaranteed by MetaMask to never collide with any of the user's other
 *   keys. We use those 32 bytes directly as a secp256k1 private key.
 *
 * Tradeoff vs BIP44: this private key is not portable to a normal wallet —
 * you can't import it into MetaMask as a regular account. That's fine; the
 * Beeport account exists only inside this Snap.
 *
 * The salt below is intentional: bumping it (e.g. to `beeport-account-v2`)
 * would derive a NEW Beeport address. Don't change it without a migration
 * plan, because any stamps and uploads under the old address would become
 * invisible.
 */

import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

const ENTROPY_SALT = 'beeport-account-v1';

let cachedAccount: PrivateKeyAccount | null = null;

/**
 * Returns the Beeport account, deriving it on first call.
 *
 * The returned `PrivateKeyAccount` from viem can:
 *  - sign messages (for upload auth)
 *  - sign transactions (for buying stamps)
 *  - expose `.address` for display + on-chain lookups
 */
export async function getBeeportAccount(): Promise<PrivateKeyAccount> {
  if (cachedAccount) return cachedAccount;

  const entropyHex = (await snap.request({
    method: 'snap_getEntropy',
    params: { version: 1, salt: ENTROPY_SALT },
  })) as string;

  if (!entropyHex || typeof entropyHex !== 'string') {
    throw new Error(
      'snap_getEntropy returned no value. Is the manifest permission declared?',
    );
  }

  // The result is a 0x-prefixed 32-byte hex string. Use it as a secp256k1
  // private key directly — viem will derive the public key + address.
  cachedAccount = privateKeyToAccount(entropyHex as `0x${string}`);
  return cachedAccount;
}

/** Convenience: just the address as a checksum-cased 0x string. */
export async function getBeeportAddress(): Promise<`0x${string}`> {
  const acct = await getBeeportAccount();
  return acct.address;
}
