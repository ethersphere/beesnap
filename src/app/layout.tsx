/*
 * Minimal Next.js layout for the Beesnap Snap install page.
 *
 * Everything related to wallet connections, swap UI, and uploads has moved
 * into the Snap (`/snap`). What's left here is a single page whose only job
 * is to call `wallet_requestSnaps` so users can install the Snap.
 *
 * Old files under `src/app/` (providers.tsx, wagmi.ts, components/*) are
 * orphaned dead code from the v0 dApp. They are no longer imported. Delete
 * them manually when you're satisfied with the new install flow.
 */
import type { Metadata } from 'next';
import './install.css';

export const metadata: Metadata = {
  title: 'Beesnap — Install',
  description:
    'Swarm bee snap integration with MetaMask Snaps. Install Beesnap to buy Swarm postage stamps and upload files from your wallet.',
  icons: {
    icon: './favicon.png',
    shortcut: './favicon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta property="og:title" content="Beesnap" />
        <meta
          property="og:description"
          content="Swarm bee snap integration with MetaMask Snaps — postage stamps and uploads from inside your wallet."
        />
      </head>
      <body>
        <main className="install-shell">{children}</main>
      </body>
    </html>
  );
}
