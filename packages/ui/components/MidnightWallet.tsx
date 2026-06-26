/**
 * @file MidnightWallet.tsx
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
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Logger } from 'pino';
import { type ImpureKittiesCircuits, contractConfig } from '@repo/kitties-api';
import {
  type ProofProvider,
  type PublicDataProvider,
  type UnboundTransaction,
  type ZKConfigProvider,
  type WalletProvider,
  type MidnightProvider,
} from '@midnight-ntwrk/midnight-js-types';
import {
  Binding,
  type FinalizedTransaction,
  Proof,
  SignatureEnabled,
  Transaction,
  type TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { fromHex, toHex } from '@midnight-ntwrk/compact-runtime';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { useRuntimeConfiguration } from '../config/RuntimeConfiguration';
import type { ConnectedAPI, Configuration } from '@midnight-ntwrk/dapp-connector-api';
import { useLocalState } from '../hooks/useLocalState';
import { MidnightWalletErrorType, WalletWidget } from './WalletWidget';
import { connectToWallet } from '@repo/kitties-api/browser';
import { noopProofClient, proofClient } from '@repo/kitties-api/browser-api';
import { WrappedPublicDataProvider } from '@repo/kitties-api/browser';
import { WrappedPrivateStateProvider } from '@repo/kitties-api/browser';
import { CachedFetchZkConfigProvider } from '@repo/kitties-api/browser-api';

// Replace isChromeBrowser and window/fetch usages with safe checks for build/SSR
function isChromeBrowser(): boolean {
  if (typeof navigator !== 'undefined') {
    const userAgent = navigator.userAgent.toLowerCase();
    return userAgent.includes('chrome') && !userAgent.includes('edge') && !userAgent.includes('opr');
  }
  return false;
}

interface MidnightWalletState {
  isConnected: boolean;
  proofServerIsOnline: boolean;
  address?: string;
  widget?: React.ReactNode;
  walletAPI?: WalletAPI;
  privateStateProvider: any;
  zkConfigProvider: ZKConfigProvider<ImpureKittiesCircuits>;
  proofProvider: ProofProvider;
  publicDataProvider: PublicDataProvider;
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
  providers: any;
  shake: () => void;
  callback: (action: ProviderCallbackAction) => void;
}

export interface WalletAPI {
  wallet: ConnectedAPI;
  coinPublicKey: string;
  encryptionPublicKey: string;
  uris: Configuration;
}

export const getErrorType = (error: Error): MidnightWalletErrorType => {
  if (error.message.includes('Could not find a Midnight-compatible wallet')) {
    return MidnightWalletErrorType.WALLET_NOT_FOUND;
  }
  if (error.message.includes('Incompatible version of Midnight-compatible wallet')) {
    return MidnightWalletErrorType.INCOMPATIBLE_API_VERSION;
  }
  if (error.message.includes('Wallet connector API has failed to respond')) {
    return MidnightWalletErrorType.TIMEOUT_API_RESPONSE;
  }
  if (error.message.includes('Could not find wallet connector API')) {
    return MidnightWalletErrorType.TIMEOUT_FINDING_API;
  }
  if (error.message.includes('Unable to enable connector API')) {
    return MidnightWalletErrorType.ENABLE_API_FAILED;
  }
  if (error.message.includes('Application is not authorized')) {
    return MidnightWalletErrorType.UNAUTHORIZED;
  }
  return MidnightWalletErrorType.UNKNOWN_ERROR;
};
const MidnightWalletContext = createContext<MidnightWalletState | null>(null);

export const useMidnightWallet = (): MidnightWalletState => {
  const walletState = useContext(MidnightWalletContext);
  if (!walletState) {
    throw new Error('MidnightWallet not loaded');
  }
  return walletState;
};

interface MidnightWalletProviderProps {
  children: React.ReactNode;
  logger: Logger;
}

export type ProviderCallbackAction =
  | 'downloadProverStarted'
  | 'downloadProverDone'
  | 'proveTxStarted'
  | 'proveTxDone'
  | 'balanceTxStarted'
  | 'balanceTxDone'
  | 'submitTxStarted'
  | 'submitTxDone'
  | 'watchForTxDataStarted'
  | 'watchForTxDataDone';

export const MidnightWalletProvider: React.FC<MidnightWalletProviderProps> = ({ logger, children }) => {
  const [isConnecting, setIsConnecting] = React.useState<boolean>(false);
  const [walletError, setWalletError] = React.useState<MidnightWalletErrorType | undefined>(undefined);
  const [address, setAddress] = React.useState<string | undefined>(undefined);
  const [proofServerIsOnline, setProofServerIsOnline] = React.useState<boolean>(false);
  const config = useRuntimeConfiguration();
  const [isRotate, setRotate] = React.useState(false);
  const localState = useLocalState() as ReturnType<typeof useLocalState>;
  const [walletAPI, setWalletAPI] = useState<WalletAPI | undefined>(undefined);
  const [floatingOpen] = React.useState(true);

  const providerCallback: (action: ProviderCallbackAction) => void = (_action: ProviderCallbackAction): void => {
    // no-op
  };

  // Persistent (IndexedDB-backed) private state. This is the production-grade
  // choice: private state survives reloads rather than being lost on refresh.
  //
  // SECURITY NOTE: `privateStoragePasswordProvider` encrypts the private state
  // at rest. Here it is derived deterministically from the connected wallet's
  // coin public key so the example runs without extra prompts. A production
  // dapp should instead source this password from a real user secret (e.g. a
  // passphrase the user enters) so the at-rest encryption is bound to something
  // only the user knows.
  const privateStateProvider = useMemo(
    () =>
      new WrappedPrivateStateProvider(
        levelPrivateStateProvider({
          privateStateStoreName: contractConfig.privateStateStoreName,
          accountId: walletAPI?.coinPublicKey ?? 'anonymous',
          privateStoragePasswordProvider: () => btoa(walletAPI?.coinPublicKey ?? 'anonymous') + '!',
        }),
        logger,
      ),
    [logger, walletAPI?.coinPublicKey],
  );

  const zkConfigProvider = useMemo(
    () =>
      new CachedFetchZkConfigProvider<ImpureKittiesCircuits>(
        window.location.origin,
        fetch.bind(window),
        providerCallback,
      ),
    [],
  );
  const publicDataProvider = useMemo(
    () =>
      new WrappedPublicDataProvider(
        indexerPublicDataProvider(config.INDEXER_URI, config.INDEXER_WS_URI),
        providerCallback,
        logger,
      ),
    [],
  );

  function shake(): void {
    setRotate(true);
    setTimeout(() => {
      setRotate(false);
    }, 3000);
  }

  const proofProvider = useMemo(() => {
    if (walletAPI && walletAPI.uris.proverServerUri) {
      return proofClient(walletAPI.uris.proverServerUri, zkConfigProvider);
    } else {
      return noopProofClient();
    }
  }, [walletAPI, zkConfigProvider]);

  // Bridges the DApp Connector v4 wallet into the midnight-js WalletProvider
  // interface. v4 exchanges transactions as serialized hex strings, so we
  // serialize before handing off and deserialize the balanced result.
  const walletProvider: WalletProvider = useMemo(() => {
    if (walletAPI) {
      return {
        getCoinPublicKey(): string {
          return walletAPI.coinPublicKey;
        },
        getEncryptionPublicKey(): string {
          return walletAPI.encryptionPublicKey;
        },
        async balanceTx(tx: UnboundTransaction, _ttl?: Date): Promise<FinalizedTransaction> {
          providerCallback('balanceTxStarted');
          try {
            const serializedTx = toHex(tx.serialize());
            const balanced = await walletAPI.wallet.balanceUnsealedTransaction(serializedTx);
            return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
              'signature',
              'proof',
              'binding',
              fromHex(balanced.tx),
            );
          } finally {
            providerCallback('balanceTxDone');
          }
        },
      };
    } else {
      return {
        getCoinPublicKey(): string {
          return '';
        },
        getEncryptionPublicKey(): string {
          return '';
        },
        balanceTx(_tx: UnboundTransaction, _ttl?: Date): Promise<FinalizedTransaction> {
          return Promise.reject(new Error('readonly'));
        },
      };
    }
  }, [walletAPI]);

  const midnightProvider: MidnightProvider = useMemo(() => {
    if (walletAPI) {
      return {
        async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
          providerCallback('submitTxStarted');
          try {
            await walletAPI.wallet.submitTransaction(toHex(tx.serialize()));
            return tx.identifiers()[0];
          } finally {
            providerCallback('submitTxDone');
          }
        },
      };
    } else {
      return {
        submitTx(_tx: FinalizedTransaction): Promise<TransactionId> {
          return Promise.reject(new Error('readonly'));
        },
      };
    }
  }, [walletAPI]);

  const [walletState, setWalletState] = React.useState<MidnightWalletState>({
    isConnected: false,
    proofServerIsOnline: false,
    address: undefined,
    widget: undefined,
    walletAPI,
    privateStateProvider,
    zkConfigProvider,
    proofProvider,
    publicDataProvider,
    walletProvider,
    midnightProvider,
    shake,
    providers: {
      privateStateProvider,
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      walletProvider,
      midnightProvider,
    },
    callback: providerCallback,
  });

  async function checkProofServerStatus(proverServerUri: string): Promise<void> {
    if (typeof fetch === 'undefined') {
      setProofServerIsOnline(false);
      return;
    }
    try {
      const response = await fetch(proverServerUri);
      if (!response.ok) {
        setProofServerIsOnline(false);
      }
      const text = await response.text();
      setProofServerIsOnline(text.includes("We're alive 🎉!"));
    } catch (error) {
      setProofServerIsOnline(false);
    }
  }

  async function connect(_manual: boolean): Promise<void> {
    localState.setLaceAutoConnect(true);
    setIsConnecting(true);
    let walletResult;
    try {
      walletResult = await connectToWallet(logger, config.NETWORK_ID);
    } catch (e) {
      const walletError = getErrorType(e as Error);
      setWalletError(walletError);
      setIsConnecting(false);
    }
    if (!walletResult) {
      setIsConnecting(false);
      return;
    }
    if (walletResult.uris.proverServerUri) {
      await checkProofServerStatus(walletResult.uris.proverServerUri);
    }
    try {
      const shieldedAddresses = await walletResult.wallet.getShieldedAddresses();
      const { unshieldedAddress } = await walletResult.wallet.getUnshieldedAddress();
      setAddress(unshieldedAddress);
      console.log('Connected wallet address:', unshieldedAddress);
      setWalletAPI({
        wallet: walletResult.wallet,
        coinPublicKey: shieldedAddresses.shieldedCoinPublicKey,
        encryptionPublicKey: shieldedAddresses.shieldedEncryptionPublicKey,
        uris: walletResult.uris,
      });
    } catch (e) {
      setWalletError(MidnightWalletErrorType.TIMEOUT_API_RESPONSE);
    }
    setIsConnecting(false);
  }

  useEffect(() => {
    setWalletState((state) => ({
      ...state,
      walletAPI,
      privateStateProvider,
      zkConfigProvider,
      proofProvider,
      publicDataProvider,
      walletProvider,
      midnightProvider,
      providers: {
        privateStateProvider,
        publicDataProvider,
        zkConfigProvider,
        proofProvider,
        walletProvider,
        midnightProvider,
      },
    }));
  }, [
    walletAPI,
    privateStateProvider,
    zkConfigProvider,
    proofProvider,
    publicDataProvider,
    walletProvider,
    midnightProvider,
  ]);

  useEffect(() => {
    setWalletState((state) => ({
      ...state,
      isConnected: !!address,
      proofServerIsOnline,
      address,
      widget: WalletWidget(
        () => connect(true), // manual connect
        isRotate,
        false, // openWallet - always false since dialog is disabled
        isChromeBrowser(),
        proofServerIsOnline,
        isConnecting,
        logger,
        floatingOpen,
        address,
        walletError,
      ),
      shake,
    }));
  }, [isConnecting, walletError, address, isRotate, proofServerIsOnline]);

  useEffect(() => {
    if (!walletState.isConnected && !isConnecting && !walletError && localState.isLaceAutoConnect()) {
      void connect(false); // auto connect
    }
  }, [walletState.isConnected, isConnecting]);

  return <MidnightWalletContext.Provider value={walletState}>{children}</MidnightWalletContext.Provider>;
};
