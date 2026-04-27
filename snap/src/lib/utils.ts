import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  toHex,
} from 'viem';

/**
 * Calculates the deterministic batch ID from (sender, nonce). Matches the
 * existing app's `readBatchId` helper exactly so the batch the Snap creates
 * resolves to the same id the registry stores under.
 */
export function readBatchId(nonce: `0x${string}`, sender: string): string {
  const encoded = encodeAbiParameters(
    parseAbiParameters(['address', 'bytes32']),
    [sender as `0x${string}`, nonce],
  );
  return keccak256(encoded).slice(2);
}

/** Generates a fresh 32-byte hex nonce. */
export function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  // crypto.getRandomValues is available in the Snap runtime (SES exposes it).
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** Format a Unix timestamp (seconds) as a short, locale-agnostic date string. */
export function formatDate(timestampSec: number): string {
  if (!timestampSec || Number.isNaN(timestampSec)) return '—';
  const d = new Date(timestampSec * 1000);
  // Snap rendering is locale-neutral; render in YYYY-MM-DD for clarity.
  return d.toISOString().slice(0, 10);
}

/** Format milliseconds-since-epoch the same way. */
export function formatDateMs(ms: number): string {
  if (!ms || Number.isNaN(ms)) return '—';
  return new Date(ms).toISOString().slice(0, 10);
}

/** Human-readable TTL — matches the original `formatExpiryTime` shape. */
export function formatTTL(ttlSeconds: number): string {
  if (ttlSeconds < 0) {
    const expired = Math.abs(ttlSeconds);
    const days = Math.floor(expired / 86400);
    if (days >= 1) return `Expired ${days}d ago`;
    const hours = Math.floor(expired / 3600);
    if (hours >= 1) return `Expired ${hours}h ago`;
    return 'Expired';
  }
  const days = Math.floor(ttlSeconds / 86400);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} left`;
  const hours = Math.floor(ttlSeconds / 3600);
  if (hours >= 1) return `${hours}h left`;
  const minutes = Math.floor(ttlSeconds / 60);
  return `${minutes}m left`;
}

/** Compute the real used capacity percentage from raw utilization + depth. */
export function getStampUsagePercent(
  utilization: number,
  depth: number,
  bucketDepth = 16,
): number {
  if (!Number.isFinite(utilization) || !Number.isFinite(depth)) return 0;
  return (utilization / Math.pow(2, depth - bucketDepth)) * 100;
}

/** Truncate a long hash for display: `0x1234…abcd`. */
export function shortHash(s: string, head = 6, tail = 4): string {
  if (!s) return '';
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** Convert a normal string to a 0x-prefixed hex bytes32 sentinel (right-padded with zeros). */
export function ensureHexPrefix(s: string): `0x${string}` {
  return (s.startsWith('0x') ? s : `0x${s}`) as `0x${string}`;
}

/** Best-effort error-message extractor (handles RPC errors that nest the real cause). */
export function describeError(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    // MetaMask wraps RPC errors with .data.message — surface that when present.
    const data = (err as any).data;
    if (data?.message) return String(data.message);
    const cause = (err as any).cause;
    if (cause) {
      const inner = describeError(cause);
      if (inner && inner !== 'Unknown error') {
        return `${err.message || err.toString()} (${inner})`;
      }
    }
    return err.message || err.toString();
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * True when `err` looks like Chromium's extension messaging size limit
 * (MetaMask → Snap payloads), so we can show a targeted recovery message.
 */
export function isLikelyExtensionMessageSizeError(err: unknown): boolean {
  const msg = describeError(err).toLowerCase();
  return (
    msg.includes('64mib') ||
    msg.includes('64 mib') ||
    msg.includes('maximum allowed size') ||
    msg.includes('message exceeded') ||
    msg.includes('exceeded maximum')
  );
}
