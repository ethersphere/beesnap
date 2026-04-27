/**
 * Next.js layout for the Beesnap Snap install page.
 * Only `page.tsx` + `install.css` are used; the app UI lives in `snap/`.
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
  openGraph: {
    title: 'Beesnap',
    description:
      'Swarm bee snap integration with MetaMask Snaps — postage stamps and uploads from inside your wallet.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="install-shell">{children}</main>
      </body>
    </html>
  );
}
