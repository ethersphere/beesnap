# @beesnap/snap

> A [MetaMask Snap](https://docs.metamask.io/snaps/) for buying storage on
> [Swarm](https://www.ethswarm.org) and uploading files to a Bee node —
> directly from inside MetaMask, with no separate dApp tab.

[![npm](https://img.shields.io/npm/v/%40beesnap%2Fsnap.svg)](https://www.npmjs.com/package/@beesnap/snap)
[![license](https://img.shields.io/npm/l/%40beesnap%2Fsnap.svg)](./LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-ethersphere%2Fbeesnap-181717?logo=github)](https://github.com/ethersphere/beesnap)

> ⚠️ **Early preview.** Beesnap is not yet on MetaMask's stable Snap allowlist. To install today you need [MetaMask Flask](https://docs.metamask.io/snaps/get-started/install-flask/) — the developer build. We'll update this notice when stable support lands.

---

## Install

Don't `npm install` this directly. It's distributed as a MetaMask Snap and must be installed via MetaMask itself. Visit the official install page:

> **<https://beesnap.swarmtools.eth.limo>**

The page detects MetaMask and prompts you to install Beesnap with `wallet_requestSnaps`. Once installed, open MetaMask → menu → **Snaps** → **Beesnap**.

## What it does

- **Buy storage on Swarm.** Pick a depth (capacity) and duration. Beesnap fetches a live cross-chain quote from [Relay](https://relay.link), signs the purchase locally, and creates the postage batch on Gnosis.
- **Upload files.** Pick storage you own, pick a file. Beesnap signs an authentication message and posts the file to your Bee node. Returns a Swarm reference + gateway link.
- **View storage and uploads.** Both lists read directly from the on-chain registry / Bee API, with auto-refresh for newly-bought storage.
- **Settings.** Override the Bee API URL, see your derived account's xDAI balance.

## How it works

```
                ┌──────────────────────────────────────┐
   You          │   MetaMask Flask                     │
                │                                      │
   ┌────┐       │   ┌──────────────────────────────┐   │
   │site│──────▶│   │   Beesnap Snap (this pkg)    │   │
   └────┘ install   │   Home / Buy / Upload / …    │   │
                │   └──────────────────────────────┘   │
                │           │                          │
                │           │ fetch + sign             │
                └───────────┼──────────────────────────┘
                            ▼
              ┌───────────────────────────────┐
              │  Default: beeport.xyz proxy   │
              │  or local / remote Bee URL    │
              └───────────────────────────────┘
                            │
                  ┌─────────┴──────────┐
                  ▼                    ▼
          Relay API quote      Gnosis RPC
          (cross-chain)        (registry, signing)
```

The Snap signs and broadcasts every transaction itself with a Snap-derived account (`snap_getEntropy`). It never reads your normal MetaMask accounts' private keys — Snaps cannot call `eth_sendTransaction` on user accounts, so this design is the only way to do "buy + upload entirely inside MetaMask."

## Beesnap account

Beesnap derives a dedicated Ethereum address from your MetaMask secret recovery phrase. **It is not the same as any of your normal MetaMask accounts.**

- The address is shown on the Beesnap home page in MetaMask (with a copy button).
- It's deterministic — same recovery phrase + same Snap id = same address every time.
- To use Beesnap, send xDAI on Gnosis to that address from any wallet. That funds storage purchases and gas.

## Required permissions

| Permission | Why |
|---|---|
| `endowment:rpc` | Lets the install page call `wallet_invokeSnap` |
| `endowment:network-access` | Talks to Bee, Relay, and Gnosis RPC |
| `endowment:page-home` | Renders the Beesnap tab inside MetaMask |
| `snap_dialog` | Welcome dialog on first install |
| `snap_manageState` | Persistent encrypted local state (upload history, settings) |
| `snap_getEntropy` | Derives the Beesnap address from your recovery phrase |

Beesnap deliberately does **not** request `endowment:ethereum-provider` — it never touches your normal MetaMask accounts.

## Bee API URL (default and overrides)

By default Beesnap uses **[https://beeport.xyz](https://beeport.xyz)** as the Bee API. In **Settings → Bee API URL** you can point to your **local** Bee node (for example `http://localhost:1633`) or **any other** Bee-compatible endpoint you control.

If you run a Bee node yourself (not a proxy that already allows Snaps), it must allow Snap requests (they arrive with `Origin: null`). Start Bee with:

```bash
bee start --cors-allowed-origins "null,*"
```

Or in `bee.yaml`:

```yaml
cors-allowed-origins:
  - "null"
  - "*"
```

## Repository

- Source: <https://github.com/ethersphere/beesnap>
- Issues / feedback: <https://github.com/ethersphere/beesnap/issues>
- Swarm docs: <https://docs.ethswarm.org>
- MetaMask Snaps docs: <https://docs.metamask.io/snaps>

## License

[BSD-3-Clause](./LICENSE)
