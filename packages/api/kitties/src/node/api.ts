/**
 * @file api.ts
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
 */

// Node.js-only wallet wiring for the CLI. Builds a WalletFacade (shielded +
// unshielded + dust sub-wallets) and exposes it as a midnight-js provider.

import {
  HDWallet,
  Roles,
  generateRandomSeed,
  WalletFacade,
  ShieldedWallet,
  DustWallet,
  UnshieldedWallet,
  createKeystore,
  PublicKey,
  NoOpTransactionHistoryStorage,
  type UnshieldedKeystore,
} from '@midnightntwrk/wallet-sdk';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { type MidnightProvider, type UnboundTransaction, type WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import type { CoinPublicKey, EncPublicKey, FinalizedTransaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { ttlOneHour, toHex } from '@midnight-ntwrk/midnight-js-utils';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { Buffer } from 'buffer';
import type { Logger } from 'pino';

import { type Config, contractConfig, StandaloneConfig, PreprodConfig, PreviewConfig } from '../common/config.js';
import { KittiesPrivateStateId, type KittiesProviders, type DeployedKittiesContract } from '../common/types.js';
import { randomBytes } from '../common/utils.js';

/** Sum the value of a set of unshielded UTxOs (the wallet's NIGHT coins). */
const nightFromUtxos = (coins: ReadonlyArray<{ utxo: { value: bigint } }>): bigint =>
  coins.reduce((total, c) => total + c.utxo.value, 0n);

/** Derive the three role keys (shielded, unshielded, dust) from a hex seed. */
const deriveKeys = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize HDWallet from seed. Is the seed a valid hex string?');
  }
  const derived = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== 'keysDerived') {
    throw new Error('Failed to derive keys from seed.');
  }
  hdWallet.hdWallet.clear();
  return derived.keys;
};

/**
 * Build a unified WalletFacade from a seed. Mirrors the documented
 * "generating DUST programmatically" wallet construction.
 */
const buildWalletFacade = async (config: Config, seed: string) => {
  setNetworkId(config.networkId);

  const keys = deriveKeys(seed);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

  const indexerClientConnection = {
    indexerHttpUrl: config.indexer,
    indexerWsUrl: config.indexerWS,
  };
  const shieldedConfig = {
    networkId: getNetworkId(),
    indexerClientConnection,
    provingServerUrl: new URL(config.proofServer),
    relayURL: new URL(config.node.replace(/^http/, 'ws')),
  };
  const unshieldedConfig = {
    networkId: getNetworkId(),
    indexerClientConnection,
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
  };
  const dustConfig = {
    ...shieldedConfig,
    costParameters: {
      additionalFeeOverhead: config.networkId === 'undeployed' ? 500_000_000_000_000_000n : 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
  };

  const wallet = await WalletFacade.init({
    configuration: { ...shieldedConfig, ...unshieldedConfig, ...dustConfig },
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) => DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

/**
 * Provider implementing the midnight-js v4 wallet interfaces on top of the
 * WalletFacade recipe-based balancing flow.
 */
export class MidnightWalletProvider implements WalletProvider, MidnightProvider {
  private constructor(
    private readonly logger: Logger,
    readonly wallet: WalletFacade,
    private readonly shieldedSecretKeys: ledger.ZswapSecretKeys,
    private readonly dustSecretKey: ledger.DustSecretKey,
    private readonly unshieldedKeystore: UnshieldedKeystore,
  ) {}

  getCoinPublicKey(): CoinPublicKey {
    return this.shieldedSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.shieldedSecretKeys.encryptionPublicKey;
  }

  async balanceTx(tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> {
    const recipe = await this.wallet.balanceUnboundTransaction(
      tx,
      { shieldedSecretKeys: this.shieldedSecretKeys, dustSecretKey: this.dustSecretKey },
      { ttl },
    );
    const signed = await this.wallet.signRecipe(recipe, (payload) => this.unshieldedKeystore.signData(payload));
    return this.wallet.finalizeRecipe(signed);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.wallet.submitTransaction(tx);
  }

  async close(): Promise<void> {
    await this.wallet.stop();
  }

  /**
   * Build the provider from a seed, wait for the wallet to sync and receive
   * NIGHT, and (on non-undeployed networks) register NIGHT for DUST generation
   * so transaction fees can be paid.
   */
  static async build(logger: Logger, config: Config, seed: string): Promise<MidnightWalletProvider> {
    const { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = await buildWalletFacade(config, seed);
    const provider = new MidnightWalletProvider(logger, wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore);

    logger.info(`Wallet seed: ${seed}`);
    logger.info('Waiting for wallet to sync...');
    const state = await wallet.waitForSyncedState();
    logger.info(`Shielded address: ${state.shielded.address.coinPublicKeyString()}`);

    const nightBalance = nightFromUtxos(state.unshielded.availableCoins);
    if (nightBalance <= 0n) {
      if (config.faucetUrl) {
        logger.info(`No NIGHT yet. Fund this wallet's unshielded address from the faucet: ${config.faucetUrl}`);
      }
      logger.info('Waiting to receive NIGHT...');
      await provider.waitForNight();
    }
    logger.info('NIGHT received.');

    // Undeployed/standalone is genesis-funded and does not require DUST registration.
    if (config.networkId !== 'undeployed') {
      await provider.ensureDustRegistered();
    }

    return provider;
  }

  /** Resolves once the unshielded wallet holds a positive NIGHT balance. */
  private async waitForNight(): Promise<bigint> {
    for (;;) {
      const state = await this.wallet.waitForSyncedState();
      const balance = nightFromUtxos(state.unshielded.availableCoins);
      if (balance > 0n) {
        return balance;
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }

  /**
   * Register the wallet's NIGHT UTxOs for DUST generation so fees can be paid.
   * No-op on undeployed (genesis-funded). Skips UTxOs already registered.
   */
  private async ensureDustRegistered(): Promise<void> {
    const state = await this.wallet.waitForSyncedState();
    const nightUtxos = state.unshielded.availableCoins.filter((c) => !c.meta.registeredForDustGeneration);
    if (nightUtxos.length === 0) {
      // Either already registered or no NIGHT to register.
      return;
    }
    this.logger.info('Registering NIGHT for DUST generation (needed to pay fees)...');
    const { fee } = await this.wallet.estimateRegistration(nightUtxos);
    await this.wallet.waitForGeneratedDust(nightUtxos, fee);
    const recipe = await this.wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      this.unshieldedKeystore.getPublicKey(),
      (payload) => this.unshieldedKeystore.signData(payload),
    );
    const signed = await this.wallet.signRecipe(recipe, (payload) => this.unshieldedKeystore.signData(payload));
    const finalized = await this.wallet.finalizeRecipe(signed);
    await this.wallet.submitTransaction(finalized);
    this.logger.info('DUST registration submitted.');
  }
}

/** Assemble the full provider set midnight-js needs for deploy/connect. */
export const configureProviders = async (
  walletProvider: MidnightWalletProvider,
  config: Config,
  zkConfigProvider: any,
): Promise<KittiesProviders> => {
  const accountId = toHex(walletProvider.getCoinPublicKey() as unknown as Uint8Array);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof KittiesPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      accountId,
      // Deterministic local password derived from the account id. Satisfies the
      // complexity rule (>=3 char classes, no 3 identical consecutive chars).
      privateStoragePasswordProvider: () => Buffer.from(accountId, 'hex').toString('base64') + '!',
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  } as KittiesProviders;
};

export const buildWalletAndWaitForFunds = async (
  config: Config,
  seed: string,
  _filename: string,
  logger: Logger,
): Promise<MidnightWalletProvider> => MidnightWalletProvider.build(logger, config, seed);

export const buildFreshWallet = async (config: Config, logger: Logger): Promise<MidnightWalletProvider> =>
  MidnightWalletProvider.build(logger, config, toHex(randomBytes(32)));

/** Generate a fresh random wallet seed as a hex string. */
export const newWalletSeed = (): string => toHex(Buffer.from(generateRandomSeed()));

export {
  type KittiesProviders,
  type DeployedKittiesContract,
  type Config,
  StandaloneConfig,
  PreprodConfig,
  PreviewConfig,
};
