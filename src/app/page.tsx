'use client';

/**
 * Beeport Snap install page.
 *
 * One job: detect MetaMask, request the Beeport Snap (`wallet_requestSnaps`),
 * and tell the user to open the Beeport tab in MetaMask. There is no
 * connect-button or upload UI here — that all moved into the Snap.
 *
 * The snap id default `local:http://localhost:8080` matches the Snap's dev
 * server (`mm-snap serve`) so this page works end-to-end during development.
 * For production you set `NEXT_PUBLIC_SNAP_ID=npm:@beeport/snap` in the env.
 */
import { useEffect, useState } from 'react';

const SNAP_ID =
  process.env.NEXT_PUBLIC_SNAP_ID || 'local:http://localhost:8080';
const SNAP_VERSION = process.env.NEXT_PUBLIC_SNAP_VERSION || '0.1.0';

type WalletStatus =
  | 'idle'
  | 'no-metamask'
  | 'snap-not-supported'
  | 'ready'
  | 'installing'
  | 'installed'
  | 'error';

declare global {
  interface Window {
    ethereum?: any;
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
      .then((snaps: Record<string, { version?: string }>) => {
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
      const result = await window.ethereum.request({
        method: 'wallet_requestSnaps',
        params: {
          [SNAP_ID]: { version: SNAP_VERSION },
        },
      });
      if (result && result[SNAP_ID]) {
        setStatus('installed');
      } else {
        setStatus('error');
        setErrorMsg('MetaMask returned no result.');
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err?.message ?? String(err));
    }
  };

  return (
    <div className="install-card">
      <h1>Beeport Snap</h1>
      <p className="lead">
        Buy Swarm postage stamps and upload files — directly from MetaMask.
      </p>

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
          <p>The Beeport Snap is installed.</p>
          <p>
            Open MetaMask, click the menu (top left), pick <b>Snaps</b>, then
            select <b>Beeport</b>. From there you can buy stamps, upload files,
            and view what you've uploaded.
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

function Status({
  status,
  errorMsg,
}: {
  status: WalletStatus;
  errorMsg: string | null;
}) {
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
          Your MetaMask version doesn't support Snaps. Update MetaMask to the
          latest stable version.
        </p>
      );
    case 'ready':
      return (
        <p className="status">
          MetaMask detected. Click <b>Install Snap</b> to add Beeport.
        </p>
      );
    case 'installing':
      return <p className="status">Confirm the install in MetaMask…</p>;
    case 'installed':
      return <p className="status ok">Beeport Snap is installed.</p>;
    case 'error':
      return (
        <p className="status error">
          Couldn't install the Snap: {errorMsg ?? 'unknown error'}
        </p>
      );
  }
}
