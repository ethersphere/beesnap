/**
 * Constants for the Beesnap Snap.
 *
 * Values are copied from the original Next.js app's `src/app/components/constants.ts`
 * so the Snap stays compatible with the same backend, registry, and stamps router
 * the existing app uses. Do NOT change addresses without coordinating with the
 * deployed backend and contracts.
 */

// ── Backend / Bee node ────────────────────────────────────────────────────────

/**
 * Default Bee API URL. The Snap can talk to either:
 *
 *  1. A local Bee node directly (e.g. http://localhost:1633). Simplest and
 *     what we default to. Requires the Bee node to be started with
 *     CORS enabled for the Snap's origin (which is `null`):
 *         bee start --cors-allowed-origins "null,*"
 *     or in bee.yaml:
 *         cors-allowed-origins:
 *           - "null"
 *           - "*"
 *
 *  2. A public Bee API proxy (e.g. https://beeport.xyz) — an endpoint that
 *     wraps a Bee node behind nginx and a signature-verification middleware
 *     (see backend/index.js). The proxy requires our custom auth headers
 *     (x-upload-signed-message etc.) and the corresponding CORS allowlist.
 *
 * The Snap auto-detects which mode based on URL — if the URL contains
 * "localhost" or "127.0.0.1" we go direct (no auth headers); otherwise we
 * include the auth headers for the proxy.
 *
 * Override in Settings.
 */
export const DEFAULT_BEE_API_URL = 'http://localhost:1633';

/**
 * Maximum decoded file size we allow for Snap uploads.
 *
 * Chromium caps `chrome.runtime.sendMessage` (and the same structured-clone
 * path MetaMask uses to talk to Snaps) at **64 MiB per message**. File bytes
 * are moved as base64 inside JSON, which grows payload by roughly 4/3, so the
 * hard ceiling on raw file size is well below 64 MiB. This constant stays on
 * the safe side so file pick + `snap_getInterfaceState` + upload do not trip
 * the browser limit. Apps cannot raise that cap — it is fixed in Chromium.
 */
export const MAX_SNAP_UPLOAD_BINARY_BYTES = 40 * 1024 * 1024;

/** Public Bee gateway used for hyperlinks to uploaded references. */
export const BEE_GATEWAY_URL = 'https://bzz.link/bzz/';

// ── Gnosis chain ──────────────────────────────────────────────────────────────

export const GNOSIS_CHAIN_ID = 100;
export const GNOSIS_CHAIN_ID_HEX = '0x64';

/** Public Gnosis RPCs used for read-only contract calls. Tried in order. */
export const GNOSIS_RPCS = [
  'https://rpc.gnosischain.com',
  'https://rpc.gnosis.gateway.fm',
  'https://gnosis-pokt.nodies.app',
  'https://gnosis.drpc.org',
];

// ── Contract addresses on Gnosis ──────────────────────────────────────────────

/** Custom registry that maps batchId → owner. Used for both batch ownership lookups and listing a user's stamps. */
export const GNOSIS_CUSTOM_REGISTRY_ADDRESS =
  '0x5EBfBeFB1E88391eFb022d5d33302f50a46bF4f3';

export const GNOSIS_BZZ_ADDRESS = '0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da';

export const GNOSIS_WXDAI_ADDRESS =
  '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d';

export const GNOSIS_STAMP_ADDRESS = '0x45a1502382541Cd610CC9068e88727426b696293';

export const GNOSIS_PRICE_ORACLE_ADDRESS =
  '0x47EeF336e7fE5bED98499A4696bce8f28c1B0a8b';

/**
 * Native Circle USDC on Gnosis. This is what Relay routes to from any source
 * chain; SushiSwapStampsRouter then swaps USDC → BZZ and creates the stamp atomically.
 */
export const RELAY_BRIDGE_TOKEN_ON_GNOSIS =
  '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0';
export const RELAY_BRIDGE_TOKEN_DECIMALS = 6;
export const RELAY_BRIDGE_TOKEN_SYMBOL = 'USDC';

export const SUSHI_STAMPS_ROUTER_ADDRESS =
  '0xf244cC25EAD03a99de8B407A3237aaf54D1b779C';

/** SushiSwap V3 factory on Gnosis (pool discovery for USDC → BZZ quotes). */
export const SUSHI_FACTORY_ADDRESS =
  '0xf78031cbca409f2fb6876bdfdbc1b2df24cf9bef';

/**
 * Gnosis: minimum native xDAI on the Beesnap address to skip Relay `topupGas`
 * on the destination (cross-chain buys). Mirrors the web app.
 */
export const GAS_TOPUP_THRESHOLD_XDAI = 1.0;
export const GAS_TOPUP_THRESHOLD_WEI = 1_000_000_000_000_000_000n; // 1.0 xDAI
/** Relay API: micro-USD string ($1 = 1_000_000). */
export const GAS_TOPUP_AMOUNT_USD = '1000000';

// Swarm `nodeAddress` for new stamps comes from GET `${beeApiUrl}/wallet` only
// (see `syncStoredNodeAddressWithWallet` in bee.ts) — never a hardcoded preset.

// ── Relay API ─────────────────────────────────────────────────────────────────

export const RELAY_API_BASE = 'https://api.relay.link';
export const DEFAULT_SLIPPAGE_PERCENT = 5;
export const RELAY_STATUS_CHECK_INTERVAL_MS = 5000;
export const RELAY_STATUS_MAX_ATTEMPTS = 24;
export const TRANSACTION_TIMEOUT_MS = 5 * 60 * 1000;

/** Native sentinel for source token in Relay requests when the user pays with the chain's native gas token. */
export const RELAY_NATIVE_TOKEN = '0x0000000000000000000000000000000000000000';

// ── Storage / time options (depth and duration). Copied verbatim. ─────────────

export type StorageOption = { depth: number; size: string };
export const STORAGE_OPTIONS: StorageOption[] = [
  { depth: 19, size: '110MB' },
  { depth: 20, size: '680MB' },
  { depth: 21, size: '2.6GB' },
  { depth: 22, size: '7.7GB' },
  { depth: 23, size: '20GB' },
  { depth: 24, size: '47GB' },
  { depth: 25, size: '105GB' },
  { depth: 26, size: '227GB' },
  { depth: 27, size: '476GB' },
];

export type TimeOption = { days: number; display: string };
export const TIME_OPTIONS: TimeOption[] = [
  { days: 1, display: '1 day' },
  { days: 2, display: '2 days' },
  { days: 7, display: '7 days' },
  { days: 15, display: '15 days' },
  { days: 30, display: '30 days' },
  { days: 90, display: '90 days' },
  { days: 180, display: '180 days' },
  { days: 365, display: '1 year' },
  { days: 365 * 2, display: '2 years' },
  { days: 365 * 5, display: '5 years' },
  { days: 365 * 10, display: '10 years' },
];

// ── Source chains the user can pay from. Limited to a sane subset for v1. ─────

export type SourceChain = {
  id: number;
  name: string;
  symbol: string;
  rpcUrl: string;
  /** Block explorer base URL — used only for status messages, not for tx execution. */
  explorerUrl: string;
};

/**
 * v1 source-chain list. The full app supports 25+ chains; this is a curated
 * subset that has reliable Relay liquidity and that fits in a Snap dropdown.
 * Add more chains here when needed — Relay does the heavy lifting per chain.
 */
/**
 * Public RPC URLs per chain id (primary + fallbacks) for `eth_sendRawTransaction`
 * and receipts. Key must include every `SOURCE_CHAINS` id.
 */
export const CHAIN_RPCS: Record<number, string[]> = {
  100: [
    'https://rpc.gnosischain.com',
    'https://rpc.gnosis.gateway.fm',
    'https://gnosis.drpc.org',
  ],
  1: ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth'],
  8453: ['https://mainnet.base.org', 'https://base.drpc.org'],
  42161: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.drpc.org'],
  10: ['https://mainnet.optimism.io', 'https://optimism.drpc.org'],
  137: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'],
};

export const SOURCE_CHAINS: SourceChain[] = [
  {
    id: 100,
    name: 'Gnosis',
    symbol: 'xDAI',
    rpcUrl: 'https://rpc.gnosischain.com',
    explorerUrl: 'https://gnosisscan.io',
  },
  {
    id: 1,
    name: 'Ethereum',
    symbol: 'ETH',
    rpcUrl: 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
  },
  {
    id: 8453,
    name: 'Base',
    symbol: 'ETH',
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
  },
  {
    id: 42161,
    name: 'Arbitrum',
    symbol: 'ETH',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
  },
  {
    id: 10,
    name: 'Optimism',
    symbol: 'ETH',
    rpcUrl: 'https://mainnet.optimism.io',
    explorerUrl: 'https://optimistic.etherscan.io',
  },
  {
    id: 137,
    name: 'Polygon',
    symbol: 'POL',
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
  },
];

export const HEX_CHAIN_ID = (chainId: number): `0x${string}` =>
  `0x${chainId.toString(16)}` as `0x${string}`;

// ── Misc ──────────────────────────────────────────────────────────────────────

export const SWARM_BUCKET_DEPTH = 16;
export const SWARM_BATCH_IMMUTABLE = false;
export const SWARM_DEFERRED_UPLOAD = 'false';

/** Initial balance per chunk used when creating a new stamp (matches existing app default). */
export const SWARM_BATCH_INITIAL_BALANCE_DEFAULT = '477774720';
