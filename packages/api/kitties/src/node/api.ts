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

// Ensure globalThis.crypto exists before any crypto-dependent code runs. Some
// Node runtimes (notably the ts-node ESM loader used by the CLI) do not expose
// it as a global. This side-effect import must come first.
import './crypto-polyfill.js';

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
  type FacadeState,
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
import * as Rx from 'rxjs';
import type { Logger } from 'pino';

import { type Config, contractConfig, StandaloneConfig, PreprodConfig, PreviewConfig } from '../common/config.js';
import { KittiesPrivateStateId, type KittiesProviders, type DeployedKittiesContract } from '../common/types.js';
import { randomBytes } from '../common/utils.js';

/**
 * A sub-wallet's progress object is "strictly complete" once it has caught up to
 * the chain tip. The facade exposes a combined `FacadeState.isSynced` for the
 * all-three case (used as the sync gate below); this per-progress helper is for
 * the spots that need a single sub-wallet's status: the progress log and the
 * NIGHT wait, which only depends on the unshielded sub-wallet.
 */
const isProgressStrictlyComplete = (progress: { isStrictlyComplete(): boolean }): boolean =>
  progress.isStrictlyComplete();

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
    // Matches the canonical testkit-js DEFAULT_DUST_OPTIONS exactly. The two
    // load-bearing values are additionalFeeOverhead (0n: any positive overhead
    // makes the balancer demand more DUST than has generated, failing with
    // "could not balance dust") and ledgerParams (required for the balancer's
    // fee math; omitting it yields a wrong fee).
    costParameters: {
      ledgerParams: ledger.LedgerParameters.initialParameters(),
      additionalFeeOverhead: 0n,
      feeBlocksMargin: 5,
    },
  };

  const dustParameters = ledger.LedgerParameters.initialParameters().dust;
  const wallet = await WalletFacade.init({
    configuration: { ...shieldedConfig, ...unshieldedConfig, ...dustConfig },
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) => DustWallet(cfg).startWithSecretKey(dustSecretKey, dustParameters),
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
  static async build(
    logger: Logger,
    config: Config,
    seed: string,
    showSeed = false,
  ): Promise<MidnightWalletProvider> {
    const { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = await buildWalletFacade(config, seed);
    const provider = new MidnightWalletProvider(
      logger,
      wallet,
      shieldedSecretKeys,
      dustSecretKey,
      unshieldedKeystore,
    );

    // Only surface the seed at the moment a wallet is created, so the user can
    // record it. Never display it on restore-from-seed or on subsequent runs:
    // a seed is sensitive and re-displaying it is an exposure risk.
    if (showSeed) {
      logger.info(`New wallet seed (write this down, it will not be shown again): ${seed}`);
    }
    // Print the unshielded address up front so it can be funded from the faucet
    // while the wallet syncs. The faucet sends tNIGHT to the unshielded address.
    logger.info(`Unshielded address (fund this from the faucet): ${unshieldedKeystore.getBech32Address()}`);
    if (config.faucetUrl) {
      logger.info(`Faucet: ${config.faucetUrl}`);
    }
    logger.info('Waiting for wallet to sync...');
    let state = await provider.waitForFullSync();

    const nightBalance = nightFromUtxos(state.unshielded.availableCoins);
    if (nightBalance <= 0n) {
      logger.info('No NIGHT yet. Waiting to receive NIGHT at the unshielded address above...');
      await provider.waitForNight();
      state = await provider.waitForFullSync();
    }
    logger.info('NIGHT received.');

    // Register NIGHT for DUST generation if the wallet has no DUST yet, then
    // re-sync. DUST then accrues from the registered NIGHT over block-time and
    // the balancer draws on it at transaction time. Mirrors the canonical
    // testkit waitForFunds: register-if-zero, re-sync, no spendable-dust wait.
    await provider.ensureDustRegistered(state);

    return provider;
  }

  /**
   * Resolves with the first wallet state that is fully synced, gating on the
   * facade's own `FacadeState.isSynced` (all three sub-wallets strictly complete).
   * Reading balances or UTxOs before this can yield a partial view.
   */
  private async waitForFullSync(): Promise<FacadeState> {
    // No timeout: sync time depends on the network and chain depth and is not
    // predictable, so the wallet waits until all three sub-wallets reach the
    // chain tip rather than failing after an arbitrary deadline. Mirrors the
    // reference example-bboard sync helpers, which impose no timeout. The
    // throttled progress log keeps the wait visible.
    return Rx.firstValueFrom(
      this.wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.tap((s: FacadeState) =>
          this.logger.info(
            `Syncing: shielded=${isProgressStrictlyComplete(s.shielded.state.progress)} ` +
              `unshielded=${isProgressStrictlyComplete(s.unshielded.progress)} ` +
              `dust=${isProgressStrictlyComplete(s.dust.state.progress)}`,
          ),
        ),
        Rx.filter((s: FacadeState) => s.isSynced),
      ),
    );
  }

  /** Resolves once the unshielded wallet holds a positive NIGHT balance. */
  private async waitForNight(): Promise<bigint> {
    // No timeout: the user funds the unshielded address from the faucet, which
    // can take an unpredictable amount of time. Wait until NIGHT arrives rather
    // than failing after an arbitrary deadline. Mirrors example-bboard's
    // waitForUnshieldedFunds, which has no timeout.
    return Rx.firstValueFrom(
      this.wallet.state().pipe(
        Rx.throttleTime(10_000),
        Rx.filter((s: FacadeState) => isProgressStrictlyComplete(s.unshielded.progress)),
        Rx.map((s: FacadeState) => nightFromUtxos(s.unshielded.availableCoins)),
        Rx.filter((balance) => balance > 0n),
      ),
    );
  }

  /**
   * Ensure the wallet can pay fees: register NIGHT UTxOs for DUST generation if
   * none are registered yet, then wait for DUST to actually generate.
   *
   * On a freshly booted standalone node, genesis NIGHT may already be registered
   * for DUST generation, so `dust.balance(new Date())` reads non-zero from
   * projection even though almost no DUST has *generated* yet (little block-time
   * has elapsed). The balancer draws on generated DUST, so deploying immediately
   * fails with "could not balance dust". Mirrors the official
   * generating-dust-programmatically guide: register only the unregistered NIGHT
   * UTxOs (if any), then always wait until the wallet is synced AND
   * `dust.balance(new Date()) > 0n`, which only becomes true once the node has
   * sealed enough blocks to generate spendable DUST (typically 1-2 minutes).
   */
  private async ensureDustRegistered(syncedState: FacadeState): Promise<void> {
    const nightRaw = ledger.unshieldedToken().raw;
    const unregistered = syncedState.unshielded.availableCoins.filter(
      (coin) => coin.utxo.type === nightRaw && coin.meta.registeredForDustGeneration === false,
    );

    if (unregistered.length > 0) {
      this.logger.info(`Registering ${unregistered.length} NIGHT UTxO(s) for DUST generation...`);
      const recipe = await this.wallet.registerNightUtxosForDustGeneration(
        unregistered,
        this.unshieldedKeystore.getPublicKey(),
        (payload) => this.unshieldedKeystore.signData(payload),
      );
      const finalized = await this.wallet.finalizeRecipe(recipe);
      const txId = await this.wallet.submitTransaction(finalized);
      this.logger.info(`DUST registration submitted: ${txId}`);
    } else {
      this.logger.info('NIGHT already registered for DUST generation.');
    }

    await this.waitForGeneratedDust();
  }

  /**
   * Resolve once the wallet is fully synced and holds a positive generated DUST
   * balance. On a cold standalone node this gates on block-time: DUST generates
   * from registered NIGHT as the node seals blocks, so this can take 1-2 minutes
   * on first run. Mirrors the official generating-dust-programmatically guide's
   * post-registration wait (`isSynced && dust.balance(now) > 0n`).
   */
  private async waitForGeneratedDust(timeoutMs = 300_000): Promise<void> {
    this.logger.info('Waiting for DUST to generate (this may take 1-2 minutes on a fresh node)...');
    // On a cold standalone node the wall-clock projection `dust.balance(now)`
    // can read non-zero before the chain has actually generated spendable DUST
    // at its latest block (the balancer draws on generated, not projected,
    // DUST). Gating on the balance alone can therefore pass instantly and the
    // deploy still fails. To guarantee real block-time elapses, require the
    // generated DUST balance to be observed positive across a settle window so
    // the node has sealed enough blocks for the balancer to draw on it.
    const settleMs = 30_000;
    let firstPositiveAt: number | undefined;
    await Rx.firstValueFrom(
      this.wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.tap((s: FacadeState) => this.logger.info(`DUST balance: ${s.dust.balance(new Date())}`)),
        Rx.filter((s: FacadeState) => s.isSynced && s.dust.balance(new Date()) > 0n),
        Rx.filter(() => {
          const now = Date.now();
          if (firstPositiveAt === undefined) {
            firstPositiveAt = now;
            return false;
          }
          return now - firstPositiveAt >= settleMs;
        }),
        Rx.timeout({
          each: timeoutMs,
          with: () => Rx.throwError(() => new Error(`DUST did not generate within ${timeoutMs}ms`)),
        }),
      ),
    );
    this.logger.info('DUST ready.');
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
  MidnightWalletProvider.build(logger, config, toHex(randomBytes(32)), true);

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
