/**
 * @file config.ts
 * @author Ricardo Rius
 * @license GPL-3.0
 *
 * Copyright (C) 2025 Ricardo Rius
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * DISCLAIMER: This software is provided "as is" without any warranty.
 * Use at your own risk. The author assumes no responsibility for any
 * damages or losses arising from the use of this software.
 */

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { getDirPath } from './path-resolver.js';
import { existsSync, readFileSync, isNodeEnvironment, pathUtils } from './env.js';

// Get current directory in a way that works in both ESM and CJS
export const currentDir = getDirPath();

/**
 * Find the workspace root directory by searching for specific markers.
 * This function is designed to be robust across different environments:
 * - Works in both ESM and CommonJS modules
 * - Handles monorepos (yarn/pnpm/npm workspaces, nx, turbo)
 * - Falls back gracefully if root can't be determined
 * - Supports browser environments with sensible defaults
 */
function findWorkspaceRoot(startDir: string): string {
  // In browser environments, we can't access the file system
  // so we return a sensible default path
  if (!isNodeEnvironment) {
    return '/workspace';
  }

  const cachedRoot = (globalThis as any).__workspaceRootCache;
  if (cachedRoot) {
    return cachedRoot;
  }

  const searchDirs = [
    startDir,
    process.cwd(),
    pathUtils.resolve(process.cwd(), '..'),
    pathUtils.resolve(startDir, '..'),
  ];
  const visited = new Set<string>();

  const rootMarkers = [
    'turbo.json',
    'nx.json',
    'lerna.json',
    'pnpm-workspace.yaml',
    'rush.json',
    '.git',
    '.eslintrc.js',
    '.eslintrc.json',
    'tsconfig.base.json',
    'jest.config.js',
    'babel.config.js',
    'yarn.lock',
    'package-lock.json',
    'pnpm-lock.yaml',
  ];

  for (const dir of searchDirs) {
    let cursor = pathUtils.resolve(dir);

    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);

      for (const marker of rootMarkers) {
        if (existsSync(pathUtils.join(cursor, marker))) {
          (globalThis as any).__workspaceRootCache = cursor;
          return cursor;
        }
      }

      const packageJsonPath = pathUtils.join(cursor, 'package.json');
      if (existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
          if (packageJson.workspaces) {
            (globalThis as any).__workspaceRootCache = cursor;
            return cursor;
          }
        } catch {
          // Ignore JSON parsing errors, continue searching
        }
      }

      const packagesDir = pathUtils.join(cursor, 'packages');
      const appsDir = pathUtils.join(cursor, 'apps');
      if (existsSync(packagesDir) && existsSync(appsDir)) {
        (globalThis as any).__workspaceRootCache = cursor;
        return cursor;
      }

      const parentDir = pathUtils.dirname(cursor);
      if (parentDir === cursor) {
        break;
      }
      cursor = parentDir;
    }
  }

  return startDir;
}

const workspaceRoot = findWorkspaceRoot(currentDir);

export const contractConfig = {
  privateStateStoreName: 'kitties-private-state',
  zkConfigPath: isNodeEnvironment
    ? pathUtils.resolve(workspaceRoot, 'packages', 'contracts', 'kitties', 'src', 'managed', 'kitties')
    : '/dist', // Browser fallback - relative path
};

/**
 * Named Midnight networks this project targets. Mainnet is not yet available.
 * `setNetworkId` takes a plain string in midnight-js v4; these are the canonical values.
 */
export type MidnightNetwork = 'undeployed' | 'preprod' | 'preview';

export interface Config {
  logDir: string;
  networkId: MidnightNetwork;
  indexer: string;
  indexerWS: string;
  node: string;
  proofServer: string;
  /** Faucet UI for funding the wallet with tNIGHT. Undefined on undeployed (genesis-funded). */
  faucetUrl?: string;
}

const logPath = (network: string): string =>
  pathUtils.resolve(currentDir, '..', 'logs', network, `${new Date().toISOString()}.log`);

/** Local standalone node + proof server. Genesis-funded, no DUST registration needed. */
export class StandaloneConfig implements Config {
  logDir = logPath('standalone');
  networkId = 'undeployed' as const;
  indexer = 'http://127.0.0.1:8088/api/v4/graphql';
  indexerWS = 'ws://127.0.0.1:8088/api/v4/graphql/ws';
  node = 'http://127.0.0.1:9944';
  proofServer = 'http://127.0.0.1:6300';
  constructor() {
    setNetworkId(this.networkId);
  }
}

/** Preprod: stable shared testnet, the right default for most development. */
export class PreprodConfig implements Config {
  logDir = logPath('preprod');
  networkId = 'preprod' as const;
  indexer = 'https://indexer.preprod.midnight.network/api/v4/graphql';
  indexerWS = 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';
  node = 'https://rpc.preprod.midnight.network';
  proofServer = 'http://127.0.0.1:6300';
  faucetUrl = 'https://midnight-tmnight-preprod.nethermind.dev/';
  constructor() {
    setNetworkId(this.networkId);
  }
}

/** Preview: receives new features ahead of preprod. */
export class PreviewConfig implements Config {
  logDir = logPath('preview');
  networkId = 'preview' as const;
  indexer = 'https://indexer.preview.midnight.network/api/v4/graphql';
  indexerWS = 'wss://indexer.preview.midnight.network/api/v4/graphql/ws';
  node = 'https://rpc.preview.midnight.network';
  proofServer = 'http://127.0.0.1:6300';
  faucetUrl = 'https://midnight-tmnight-preview.nethermind.dev/';
  constructor() {
    setNetworkId(this.networkId);
  }
}

// Browser-compatible configuration interface
export interface BrowserConfig {
  readonly networkId: MidnightNetwork;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly proofServer: string;
  readonly loggingLevel: string;
}

export class BrowserStandaloneConfig implements BrowserConfig {
  networkId = 'undeployed' as const;
  indexer = 'http://127.0.0.1:8088/api/v4/graphql';
  indexerWS = 'ws://127.0.0.1:8088/api/v4/graphql/ws';
  proofServer = 'http://127.0.0.1:6300';
  loggingLevel = 'info';
  constructor() {
    setNetworkId(this.networkId);
  }
}

export class BrowserPreprodConfig implements BrowserConfig {
  networkId = 'preprod' as const;
  indexer = 'https://indexer.preprod.midnight.network/api/v4/graphql';
  indexerWS = 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';
  proofServer = 'http://127.0.0.1:6300';
  loggingLevel = 'info';
  constructor() {
    setNetworkId(this.networkId);
  }
}

export class BrowserPreviewConfig implements BrowserConfig {
  networkId = 'preview' as const;
  indexer = 'https://indexer.preview.midnight.network/api/v4/graphql';
  indexerWS = 'wss://indexer.preview.midnight.network/api/v4/graphql/ws';
  proofServer = 'http://127.0.0.1:6300';
  loggingLevel = 'info';
  constructor() {
    setNetworkId(this.networkId);
  }
}

export type ConfigEnvironment = 'standalone' | 'preprod' | 'preview';

export function createBrowserConfig(environment: ConfigEnvironment = 'preprod'): BrowserConfig {
  switch (environment) {
    case 'standalone':
      return new BrowserStandaloneConfig();
    case 'preprod':
      return new BrowserPreprodConfig();
    case 'preview':
      return new BrowserPreviewConfig();
    default:
      throw new Error(`Unknown environment: ${environment}`);
  }
}

export function getDefaultBrowserConfig(): BrowserConfig {
  return createBrowserConfig('preprod');
}
