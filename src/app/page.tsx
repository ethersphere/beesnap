'use client';

/**
 * Beesnap Snap install page.
 *
 * One job: detect MetaMask, request the Beesnap Snap (`wallet_requestSnaps`),
 * and tell the user to open the Beesnap tab in MetaMask. There is no
 * connect-button or upload UI here — that all moved into the Snap.
 *
 * The snap id default `local:http://localhost:8080` matches `snap/snap.config.ts`
 * so this page works end-to-end in dev.
 * For production you set `NEXT_PUBLIC_SNAP_ID=npm:@beesnap/snap` in the env.
 */
import { useEffect, useState } from 'react';

const SNAP_ID = process.env.NEXT_PUBLIC_SNAP_ID || 'local:http://localhost:8080';
const SNAP_VERSION = process.env.NEXT_PUBLIC_SNAP_VERSION || '0.1.5';

const IS_LOCAL_SNAP = SNAP_ID.startsWith('local:');

type WalletStatus =
  | 'idle'
  | 'no-metamask'
  | 'snap-not-supported'
  | 'ready'
  | 'installing'
  | 'installed'
  | 'error';

/** Minimal EIP-1193 surface used for Snaps install checks. */
type SnapsRecord = Record<string, { version?: string }>;

interface EthereumProvider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export default function InstallPage() {
  const [status, setStatus] = useState<WalletStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.ethereum) {
      setStatus('no-metamask');
      return;
    }
    // Check for `wallet_getSnaps` — only MetaMask exposes it.
    window.ethereum
      .request({ method: 'wallet_getSnaps' })
      .then((raw) => {
        const snaps = raw as SnapsRecord;
        if (snaps && snaps[SNAP_ID]) {
          setStatus('installed');
        } else {
          setStatus('ready');
        }
      })
      .catch(() => setStatus('snap-not-supported'));
  }, []);

  const onInstall = async () => {
    if (!window.ethereum) return;
    setErrorMsg(null);
    setStatus('installing');
    try {
      const result = (await window.ethereum.request({
        method: 'wallet_requestSnaps',
        params: {
          [SNAP_ID]: { version: SNAP_VERSION },
        },
      })) as SnapsRecord;
      if (result && result[SNAP_ID]) {
        setStatus('installed');
      } else {
        setStatus('error');
        setErrorMsg('MetaMask returned no result.');
      }
    } catch (err: unknown) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="install-card">
      <header className="install-header">
        <img
          className="install-logo"
          src="./favicon.png"
          alt="Beesnap"
          width={56}
          height={56}
          decoding="async"
        />
        <h1>Beesnap</h1>
      </header>
      <p className="lead">
        Swarm bee snap integration with MetaMask — buy postage stamps and upload files from your
        wallet.
      </p>

      {IS_LOCAL_SNAP ? (
        <div className="install-prereq" role="note">
          <p>
            <strong>1. Snap bundle on port 8080</strong> — in one terminal, from the repo root, run{' '}
            <code>npm run snap:dev</code> and leave it running. That starts the dev server MetaMask
            uses to load the Snap (with rebuilds on change). You do <em>not</em> need to run a
            separate <code>serve</code> process for this workflow.
          </p>
          <p>
            <strong>When to use a static serve instead</strong> — if you run{' '}
            <code>cd snap &amp;&amp; npm run build</code> and then serve the result, use{' '}
            <code>npm run snap:serve</code> (from the root scripts), and stop the other 8080 process
            so only one is bound to the port. Do not run <code>snap:dev</code> and{' '}
            <code>snap:serve</code> on the same port at once.
          </p>
          <p>
            <strong>2. This install page on port 3000</strong> — in a second terminal, run{' '}
            <code>npm run dev</code> at the repo root, open this site, and click{' '}
            <strong>Install Snap</strong>. The Next.js app is only the installer; MetaMask still
            downloads the Snap from <code>http://localhost:8080</code>, not from port 3000.
          </p>
          <p>
            <strong>Sanity check:</strong> open <code>http://localhost:8080</code> in a browser. If
            that URL does not load, installation may fail with &quot;executor failed to
            initialize&quot;.
          </p>
        </div>
      ) : null}

      <Status status={status} errorMsg={errorMsg} />

      {status === 'ready' && (
        <button className="primary" onClick={onInstall}>
          Install Snap
        </button>
      )}
      {status === 'installing' && (
        <button className="primary" disabled>
          Confirm in MetaMask…
        </button>
      )}
      {status === 'installed' && (
        <div className="installed-block">
          <p>The Beesnap Snap is installed.</p>
          <p>
            Open MetaMask, click the menu (top left), pick <b>Snaps</b>, then select <b>Beesnap</b>.
            From there you can buy stamps, upload files, and view what you have uploaded.
          </p>
        </div>
      )}
      {status === 'error' && (
        <button className="primary" onClick={onInstall}>
          Try again
        </button>
      )}
      {status === 'no-metamask' && (
        <a
          className="primary as-link"
          href="https://metamask.io/download/"
          target="_blank"
          rel="noreferrer noopener"
        >
          Get MetaMask
        </a>
      )}

      <footer className="install-footer">
        <p>
          Snap id: <code>{SNAP_ID}</code>
        </p>
        <p>
          Version: <code>{SNAP_VERSION}</code>
        </p>
      </footer>
    </div>
  );
}

function Status({ status, errorMsg }: { status: WalletStatus; errorMsg: string | null }) {
  switch (status) {
    case 'idle':
      return <p className="status">Checking MetaMask…</p>;
    case 'no-metamask':
      return (
        <p className="status warn">
          MetaMask is not installed in this browser. Install MetaMask first.
        </p>
      );
    case 'snap-not-supported':
      return (
        <p className="status warn">
          Your MetaMask version does not support Snaps. Update MetaMask to the latest stable
          version.
        </p>
      );
    case 'ready':
      return (
        <p className="status">
          MetaMask detected. Click <b>Install Snap</b> to add Beesnap.
        </p>
      );
    case 'installing':
      return <p className="status">Confirm the install in MetaMask…</p>;
    case 'installed':
      return <p className="status ok">Beesnap Snap is installed.</p>;
    case 'error':
      return (
        <p className="status error">Could not install the Snap: {errorMsg ?? 'unknown error'}</p>
      );
  }
}
