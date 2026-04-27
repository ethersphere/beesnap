import type { SnapConfig } from '@metamask/snaps-cli';
import { resolve } from 'path';

const config: SnapConfig = {
  bundler: 'webpack',
  input: resolve(__dirname, 'src/index.tsx'),
  server: {
    port: 8081,
  },
  polyfills: {
    buffer: true,
    crypto: true,
    stream: true,
  },
  stats: {
    builtIns: {
      // viem references some Node built-ins (assert, util) that the Snaps
      // bundler conservatively flags. We acknowledge them here.
      ignore: ['assert', 'util'],
    },
    buffer: false,
  },
};

export default config;
