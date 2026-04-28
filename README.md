# Beesnap

MetaMask Snap for **Swarm** postage: buy stamps and upload to a **Bee** node from inside the wallet, plus a minimal **Next.js** page that only installs the Snap.

The interactive UI lives in `snap/` ([Snap custom UI / JSX](https://docs.metamask.io/snaps/features/custom-ui/)). The previous full web dApp was removed; the install site under `src/app/` is intentionally tiny.

## Repository layout

| Path | Role |
|------|------|
| `snap/` | Snap bundle: `onInstall`, home page, buy flow, stamps, upload, settings |
| `src/app/` | Install page: `wallet_requestSnaps` only |
| `backend/` | Bee proxy + signature checks (unchanged contract with Snap) |
| `contracts/`, `deploy/`, `scripts/` | Gnosis contracts and Hardhat tooling |
| `misc/` | Optional maintenance scripts (registry export, etc.) |
| `docs/` | **Legacy** guides for the old pre-Snap UI — kept as reference only |

## Requirements

- **Node** 20+
- **MetaMask** with Snaps (stable channel supports published Snaps; [Flask](https://docs.metamask.io/snaps/get-started/install-flask/) for local dev)

## Local development

```bash
# Root + Snap dependencies
npm install
npm run snap:install

# Terminal 1 — Snap: dev server for the bundle on 8080 + rebuilds on change
# (`snap:dev` and `snap:watch` are the same; `cd snap` also has `dev` and `watch`)
npm run snap:dev

# Terminal 2 — website that calls wallet_requestSnaps (Next.js, not the Snap file host)
npm run dev
```

- **8080 — Snap only:** `snap:dev` already starts the server MetaMask needs. You do **not** run `serve` in addition, unless you switch workflow to “serve the last `dist/`” via `npm run snap:build` then `npm run snap:serve` (same port — pick one process).
- **3000 — install page only:** root `npm run dev` is the Next.js site at [http://localhost:3000](http://localhost:3000) with the Install button. It does not host the Snap; MetaMask still loads the bundle from 8080.
- Local id: `local:http://localhost:8080` (see `src/app/page.tsx` and `snap/snap.config.ts`).
- **Optional** — `npm run backend:dev` (see `backend/README.md`).

### Troubleshooting: “executor failed to initialize / … worker failed to load”

1. **Snap server must be running** — the install page does not host the bundle. Keep `npm run snap:dev` (or, after a build, `npm run snap:serve`) in another terminal. Open `http://localhost:8080` in a browser to confirm the server responds. If you see **`EADDRINUSE` on 8080**, stop the other process using that port or change `server.port` in `snap/snap.config.ts` and set the same value in `NEXT_PUBLIC_SNAP_ID` for the Next app.
2. **Many different Snaps fail** in MetaMask: usually a **MetaMask or browser** issue, not this repo. Try: restart the browser, update the extension, or a clean profile.
3. **Production** — set `NEXT_PUBLIC_SNAP_ID=npm:@beesnap/snap` and `NEXT_PUBLIC_SNAP_VERSION` to the published Snap version (see [Publishing new versions](#publishing-new-versions) below).

## Publishing new versions

Two things ship separately: the **Snap** (npm; MetaMask downloads it by id + version) and the **install page** (static files under `out/` after a production build, then zip or rsync to your host).

### Snap on npm (`snap/`, package `@beesnap/snap`)

1. **Bump the version** — Use the same semver in `snap/package.json` and in `snap/snap.manifest.json` (`version`). Optionally run `npm install` inside `snap/` so `package-lock.json` stays in sync.
2. **Build** — From the repo root: `npm run snap:build` (or `cd snap && npm run build`). This compiles `snap/dist/bundle.js` and fixes `snap.manifest.json` if the bundle `shasum` is out of date.
3. **Commit** — Commit the version bumps, manifest, and any lockfile changes so the tree matches what you publish.
4. **Publish** — `cd snap && npm publish --access public`. Scoped packages need `--access public`. If npm enforces 2FA, pass a one-time password: `npm publish --access public --otp=<code>`.
5. **Check** — Confirm the new version appears on [npmjs.com/package/@beesnap/snap](https://www.npmjs.com/package/@beesnap/snap).

### Install site: `out/` export, version env, zip, upload

The install UI lives in `src/app/`. For **production**, `next.config.mjs` enables `output: 'export'`, so `next build` writes a **static site into `out/`** (that directory is gitignored).

1. **Point the build at the Snap you want users to install** — `wallet_requestSnaps` uses the id and version baked in at build time (`src/app/page.tsx`). Set:
   - `NEXT_PUBLIC_SNAP_ID=npm:@beesnap/snap`
   - `NEXT_PUBLIC_SNAP_VERSION=<same semver as on npm>` (must match the version you published, or MetaMask may refuse / install the wrong build).

   Put these in **`.env.production.local`** at the repo root (Next loads it for production builds), or export them for a one-off build, e.g.  
   `NEXT_PUBLIC_SNAP_ID=npm:@beesnap/snap NEXT_PUBLIC_SNAP_VERSION=0.1.2 npm run build`.

2. **Build** — From the repo root: `npm run build`. Verify `out/index.html` and the `_next` assets exist.

3. **Package for upload** — Example: `cd out && zip -r ../beesnap-install-site.zip .` (the zip name is gitignored at the repo root) then upload the zip to your server and unpack into the web root, or sync `out/` directly (rsync, CI artifact, etc.) wherever you serve the install link (often alongside nginx / beeport; see `backend/README.md`).

Whenever you release a **new Snap version on npm**, repeat this install-site flow with the **updated `NEXT_PUBLIC_SNAP_VERSION`** so the published page requests the new build.

## What the Snap does (high level)

- Derives a **dedicated account** from the user’s recovery phrase via `snap_getEntropy` (see `snap/src/lib/wallet.ts` for the fixed salt).
- **Buy storage** with Relay: pay from several EVM chains, settle on Gnosis; **Gnosis (xDAI)** is the chain where the stamp and registry live.
- **Home** shows native balances on the same “pay from” networks as the buy dropdown.
- **View storage**, **upload** with Swarm/ Bee APIs, and **view upload history** (Snap state).

Limits (real platform constraints) are still true: e.g. no fine-grained **upload progress** in Snap `fetch`, and very large files are impractical.

## Permissions

See `snap/snap.manifest.json` `initialPermissions`. The Snap does **not** use `endowment:ethereum-provider` for the user’s main MetaMask account — it signs and sends from the **Snap-derived** key over allowed RPC URLs.

## Backend and contracts

The Bee proxy, registry, and Sushi/Relay paths the Snap uses are the same family as the original app. Details: `backend/README.md`, `contracts/README.md`.

## License / repo

Project metadata is in the root `package.json`. For issues, use the linked GitHub tracker.
