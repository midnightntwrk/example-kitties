/**
 * @file connect-to-wallet.ts
 * @license GPL-3.0
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

/* global console */
import type { Logger } from 'pino';
import type { InitialAPI, ConnectedAPI, Configuration } from '@midnight-ntwrk/dapp-connector-api';

/**
 * Enumerate the injected Midnight wallet connectors and return the first available one.
 *
 * DApp Connector v4 exposes connectors as a record under `window.midnight`, keyed by
 * wallet id (the legacy `mnLace` key is deprecated). Any Midnight-compatible wallet that
 * follows the connector standard registers itself here, so we stay wallet-agnostic by
 * taking the first entry rather than reaching for a specific wallet.
 */
const getFirstConnector = (): InitialAPI | undefined => {
  if (typeof globalThis === 'undefined' || typeof globalThis.window === 'undefined') {
    return undefined;
  }
  // @ts-ignore - window.midnight is injected by the wallet extension
  const connectors = globalThis.window.midnight as Record<string, InitialAPI> | undefined;
  if (!connectors) {
    return undefined;
  }
  return Object.values(connectors)[0];
};

/** Poll up to `timeoutMs` for an injected connector to appear. */
const waitForConnector = async (logger: Logger, timeoutMs = 5_000): Promise<InitialAPI> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const connector = getFirstConnector();
    if (connector) {
      logger.info({ wallet: connector.name, apiVersion: connector.apiVersion }, 'Wallet connector found');
      return connector;
    }
    if (Date.now() >= deadline) {
      throw new Error('Could not find a Midnight-compatible wallet. Is a wallet extension installed and enabled?');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

/**
 * Connect to the first available Midnight-compatible wallet for the given network and
 * return the connected API plus the wallet's service configuration.
 */
export const connectToWallet = async (
  logger: Logger,
  networkId: string,
): Promise<{ wallet: ConnectedAPI; uris: Configuration }> => {
  const connector = await waitForConnector(logger);

  let wallet: ConnectedAPI;
  try {
    wallet = await connector.connect(networkId);
  } catch (e) {
    logger.error('Unable to connect to wallet connector API');
    throw new Error('Application is not authorized');
  }

  const uris = await wallet.getConfiguration();
  logger.info('Connected to wallet connector API and retrieved service configuration');
  return { wallet, uris };
};
