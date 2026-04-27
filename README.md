# Beeport — MetaMask Snap

Beeport is a MetaMask Snap that lets users buy Swarm postage stamps and upload
files to a Bee node — directly from inside MetaMask, with no separate dApp UI
to bounce through.

This repo (v2.x) replaces the previous Next.js dApp (v1.x). The v1 SwapComponent / RainbowKit / wagmi UI has been retired in favour of a Snap home page rendered with [Snap JSX](https://docs.metamask.io/snaps/features/custom-ui/).

> **What's a Snap?** A Snap is a sandboxed JS module that runs *inside*
> MetaMask. It can render its own home page, sign messages, send transactions
> via the user's existing MetaMask account, persist encrypted state, and call
> `fetch()` against a network the user permitted at install time.
>
> Snaps are not websites and don't replace dApps everywhere — but a Snap *is*
> the right shape for this product because the entire user journey (pick depth,
> buy stamp, sign upload, view history) is short, stateful, and naturally
> belongs next to the user's wallet.

## Repo layout

```
beewallet/
├── snap/                    ← The Snap. New code lives here.
│   ├── snap.manifest.json
│   ├── snap.config.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.tsx         ← onInstall, onHomePage, onUserInput, onRpcRequest
│       ├── components/       ← Snap JSX screens (Home, BuyStamp, Upload, …)
│       └── lib/              ← constants, abis, ethereum, relay, bee, state
├── src/                     ← The install page (Next.js).
│   └── app/
│       ├── page.tsx          ← Calls wallet_requestSnaps. Nothing else.
│       ├── layout.tsx
│       ├── install.css
│       └── components/      ← ⚠️ ORPHANED v1 dApp code. Safe to delete.
├── backend/                 ← UNCHANGED. Same proxy + signature middleware.
├── contracts/               ← UNCHANGED. Solidity for StampsRegistry + SushiSwapStampsRouter.
├── deploy/                  ← UNCHANGED. Hardhat deploy scripts.
└── scripts/                 ← UNCHANGED. Contract verification scripts.
```

The **backend** (`backend/index.js`) is unchanged. The Snap calls the same
`/bzz`, `/stamps` endpoints the v1 dApp called, with the same headers and the
same EIP-191 signature format the backend's `verifySignature` middleware
already validates.

The **contracts** (`StampsRegistry`, `SushiSwapStampsRouter`) are unchanged.
The Snap reads `getOwnerBatches` from the registry and encodes calls to the
postage stamp contract's `createBatchRegistry` exactly as the v1 dApp did.

## Getting started

```bash
# 1. Install root deps + Snap deps
npm install
npm run snap:install

# 2. Run the Snap dev server (serves the bundle to MetaMask Flask)
npm run snap:serve   # http://localhost:8080

# 3. In another terminal, run the install page
npm run dev          # http://localhost:3000

# 4. (Optional) Run the backend locally
npm run backend:dev  # http://localhost:3333
```

Open `http://localhost:3000`, click **Install Snap**, confirm in MetaMask
Flask, then open MetaMask → Snaps → Beeport.

> You need [MetaMask Flask](https://docs.metamask.io/snaps/get-started/install-flask/) for development. Stable MetaMask only supports Snaps published to npm.

## What's implemented (v1.5)

- ✅ **Beeport account** — a key derived deterministically from your secret recovery phrase via `snap_getEntropy` (salted by `beeport-account-v1`). Same recovery phrase always yields the same address, but it never collides with any of your normal MetaMask accounts (MetaMask explicitly forbids Snaps from deriving at the user's BIP44 paths). The Snap signs and broadcasts every transaction with this account.
- ✅ **View my stamps** — reads on-chain registry on Gnosis (for the Beeport account), decorates with utilization + TTL from the Bee node.
- ✅ **Buy a new stamp** — pick depth + duration, fetch live Relay quote, sign + broadcast each Relay step locally with the Beeport key. Gnosis-only in v1.5; cross-chain comes later.
- ✅ **Upload a file** — pick stamp + file, sign auth message with Beeport key, POST to `${beeApiUrl}/bzz`. **No upload progress** (Snap `fetch` doesn't expose it; see honest caveats below).
- ✅ **View my uploads** — local Snap-state record of what the Beeport account has uploaded through this Snap.

## Why the Beeport account exists

Snaps **cannot** call `eth_sendTransaction` on the user's main MetaMask account — it's not in the allowlist for `endowment:ethereum-provider`. So we either:

1. Bounce the user out to a companion dApp page that *can* call `eth_sendTransaction` from a normal `window.ethereum` context (rejected — user wanted everything inside MetaMask).
2. Have the Snap manage its own key, derived from the user's secret recovery phrase, and sign + send transactions itself. **This is what we do.**

The trade-off: stamps bought through this Snap are owned by the Beeport address, not your main MetaMask address. You need to fund the Beeport address (xDAI for gas + paying for stamps) before buying. The home page shows the address with a Copyable so you can send funds to it from any wallet.

Stamps bought before v1.5 (registered to your main MetaMask address in the v1 dApp) **will not appear in the Snap** — they're owned by a different address. You can still see and use them via the v1 dApp if you keep it deployed somewhere.

## Honest caveats

These are real platform limits — not bugs:

- **No upload progress bar.** Snap UI runs only `fetch`, not `XMLHttpRequest`,
  and `fetch` exposes no upload-progress events. The screen says "uploading…"
  until the Bee node responds. For multi-GB uploads this is a noticeably worse
  experience than the v1 dApp's progress bar.
- **No file uploads larger than ~a few hundred MB.** `FileInput` returns the
  file as a base64 string; the bytes round-trip through SES-isolated worker
  memory. Large files degrade hard.
- **No background uploads.** Closing MetaMask while an upload is in flight
  drops the UI; the request itself depends on whether the browser keeps the
  connection alive (it usually doesn't).
- **NEVER mocked.** Per project rule: if the Snap can't reach the registry,
  the Bee node, or Relay, we say so. No fake stamps, no fake uploads, no
  optimistic UI. Failures are visible.

## Snap permissions (initialPermissions)

```jsonc
"endowment:rpc": { "dapps": true, "snaps": false },
"endowment:network-access": {},        // fetch to api.relay.link, beeport.xyz, gnosis RPCs
"endowment:page-home": {},             // the Beeport tab in MetaMask
"snap_dialog": {},                     // welcome dialog on install
"snap_manageState": {},                // upload history, settings
"snap_notify": {},                     // (reserved for future use)
"snap_getEntropy": {}                  // derives the Beeport account (32 bytes, salted by Snap id)
```

The Snap intentionally does **not** request `endowment:ethereum-provider`. The user's main MetaMask account is never accessed by this Snap — all signing and transaction broadcasting goes through the Beeport account.

## Backend & contracts (unchanged)

The backend at `backend/index.js` proxies the Bee node's `/bzz`, `/stamps`,
`/tags`, `/wallet` endpoints and verifies an EIP-191 signature over
`${fileName}:${batchId}` plus on-chain batch ownership before forwarding the
request. The Snap produces these same headers, so no backend change is required.

See `backend/README.md` for the nginx config and `backend/.env.example` for
the env vars (unchanged).

## Manual cleanup of v1 dApp code

The previous Next.js app's source — `src/app/components/*.tsx`,
`src/app/wagmi.ts`, `src/app/providers.tsx`, plus several .css modules — is
no longer imported anywhere. It's safe to `rm -rf` once you've verified the
new install page works:

```bash
rm src/app/wagmi.ts src/app/providers.tsx src/app/page.module.css src/app/globals.css
rm -rf src/app/components
```

Also old root-level deps that the Snap doesn't need are now removed from the
root `package.json` (RainbowKit, wagmi, viem, alchemy-sdk, jszip, etc.). The
`node_modules` cache should be wiped:

```bash
rm -rf node_modules package-lock.json && npm install
```
