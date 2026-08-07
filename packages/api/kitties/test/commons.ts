/**
 * @file commons.ts
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

import {
  type Config,
  StandaloneConfig,
  PreprodConfig,
  PreviewConfig,
  currentDir,
  buildWalletAndWaitForFunds,
  type MidnightWalletProvider,
} from '@repo/kitties-api';
import {
  DockerComposeEnvironment,
  GenericContainer,
  type StartedDockerComposeEnvironment,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';
import path from 'path';
import type { Logger } from 'pino';
import { expect } from 'vitest';

// Genesis-funded wallet seed for the local standalone (undeployed) network.
const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

export interface TestConfiguration {
  seed: string;
  entrypoint: string;
  dappConfig: Config;
  psMode: string;
  cacheFileName: string;
}

export class LocalTestConfig implements TestConfiguration {
  seed = GENESIS_MINT_WALLET_SEED;
  entrypoint = 'dist/standalone.js';
  psMode = 'undeployed';
  cacheFileName = '';
  dappConfig = new StandaloneConfig();
}

export function parseArgs(required: string[]): TestConfiguration {
  let entry = '';
  if (required.includes('entry')) {
    if (process.env.TEST_ENTRYPOINT !== undefined) {
      entry = process.env.TEST_ENTRYPOINT;
    } else {
      throw new Error('TEST_ENTRYPOINT environment variable is not defined.');
    }
  }

  let seed = '';
  if (required.includes('seed')) {
    if (process.env.TEST_WALLET_SEED !== undefined) {
      seed = process.env.TEST_WALLET_SEED;
    } else {
      throw new Error('TEST_WALLET_SEED environment variable is not defined.');
    }
  }

  let cfg: Config = new PreprodConfig();
  let env = '';
  let psMode = 'preprod';
  let cacheFileName = '';
  if (required.includes('env')) {
    if (process.env.TEST_ENV !== undefined) {
      env = process.env.TEST_ENV;
    } else {
      throw new Error('TEST_ENV environment variable is not defined.');
    }
    switch (env) {
      case 'preprod':
        cfg = new PreprodConfig();
        psMode = 'preprod';
        cacheFileName = `${seed.substring(0, 7)}-${psMode}.state`;
        break;
      case 'preview':
        cfg = new PreviewConfig();
        psMode = 'preview';
        cacheFileName = `${seed.substring(0, 7)}-${psMode}.state`;
        break;
      default:
        throw new Error(`Unknown env value=${env}`);
    }
  }

  return {
    seed,
    entrypoint: entry,
    dappConfig: cfg,
    psMode,
    cacheFileName,
  };
}

export class TestEnvironment {
  private readonly logger: Logger;
  private env: StartedDockerComposeEnvironment | undefined;
  private dockerEnv: DockerComposeEnvironment | undefined;
  private container: StartedTestContainer | undefined;
  private walletProvider: MidnightWalletProvider | undefined;
  private testConfig: TestConfiguration;

  constructor(logger: Logger) {
    this.logger = logger;
    this.testConfig = new LocalTestConfig();
  }

  start = async (): Promise<TestConfiguration> => {
    if (process.env.RUN_ENV_TESTS === 'true') {
      this.testConfig = parseArgs(['seed', 'env']);
      this.logger.info(`Test wallet seed: ${this.testConfig.seed}`);
      this.logger.info('Proof server starting...');
      this.container = await TestEnvironment.getProofServerContainer();
      this.testConfig.dappConfig = {
        ...this.testConfig.dappConfig,
        proofServer: `http://${this.container.getHost()}:${this.container.getMappedPort(6300).toString()}`,
      };
    } else {
      this.testConfig = new LocalTestConfig();
      this.logger.info('Test containers starting...');
      const composeFile = process.env.COMPOSE_FILE ?? 'standalone.yml';
      this.logger.info(`Using compose file: ${composeFile}`);
      this.dockerEnv = new DockerComposeEnvironment(path.resolve(currentDir, '..'), composeFile)
        .withWaitStrategy('kitties-proof-server', Wait.forHealthCheck())
        .withWaitStrategy('kitties-indexer', Wait.forHealthCheck())
        .withWaitStrategy('kitties-node', Wait.forHealthCheck());
      this.env = await this.dockerEnv.up();

      this.testConfig.dappConfig = {
        ...this.testConfig.dappConfig,
        indexer: TestEnvironment.mapContainerPort(this.env, this.testConfig.dappConfig.indexer, 'kitties-indexer'),
        indexerWS: TestEnvironment.mapContainerPort(this.env, this.testConfig.dappConfig.indexerWS, 'kitties-indexer'),
        node: TestEnvironment.mapContainerPort(this.env, this.testConfig.dappConfig.node, 'kitties-node'),
        proofServer: TestEnvironment.mapContainerPort(
          this.env,
          this.testConfig.dappConfig.proofServer,
          'kitties-proof-server',
        ),
      };
    }
    this.logger.info(`Configuration:${JSON.stringify(this.testConfig)}`);
    this.logger.info('Test containers started');
    return this.testConfig;
  };

  static mapContainerPort = (env: StartedDockerComposeEnvironment, url: string, containerName: string) => {
    const mappedUrl = new URL(url);
    const container = env.getContainer(containerName);

    mappedUrl.port = String(container.getFirstMappedPort());

    return mappedUrl.toString().replace(/\/+$/, '');
  };

  static getProofServerContainer = async () =>
    await new GenericContainer('midnightntwrk/proof-server:8.0.3')
      .withExposedPorts(6300)
      .withCommand(['midnight-proof-server', '-v'])
      .withEnvironment({ RUST_BACKTRACE: 'full' })
      .withWaitStrategy(Wait.forHealthCheck())
      .start();

  shutdown = async () => {
    if (this.walletProvider !== undefined) {
      await this.walletProvider.close();
    }
    if (this.env !== undefined) {
      this.logger.info('Test containers closing');
      await this.env.down();
    }
    if (this.container !== undefined) {
      this.logger.info('Test container closing');
      await this.container.stop();
    }
  };

  getWalletProvider = async (): Promise<MidnightWalletProvider> => {
    this.logger.info('Setting up wallet');
    this.walletProvider = await buildWalletAndWaitForFunds(
      this.testConfig.dappConfig,
      this.testConfig.seed,
      this.testConfig.cacheFileName,
      this.logger,
    );
    expect(this.walletProvider).not.toBeNull();
    return this.walletProvider;
  };
}
