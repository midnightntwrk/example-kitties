/**
 * @file crypto-polyfill.ts
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
 */

/**
 * Ensures the Web Crypto API is available as `globalThis.crypto` in Node.
 *
 * Node exposes `globalThis.crypto` by default from v19 onwards, but some
 * runtimes do not. In particular, running the CLI through the `ts-node/esm`
 * loader leaves `globalThis.crypto` undefined, which breaks any code that
 * relies on the Web Crypto global (for example `crypto.getRandomValues`).
 *
 * This module installs `node:crypto`'s `webcrypto` onto `globalThis` when the
 * global is missing. It is Node-only and is never bundled for the browser,
 * where the global always exists. Import it for its side effect at the very
 * top of each Node entry point, before any code that may use the global.
 */
import { webcrypto } from 'node:crypto';

const globalWithCrypto = globalThis as { crypto?: Crypto };

if (!globalWithCrypto.crypto || typeof globalWithCrypto.crypto.getRandomValues !== 'function') {
  globalWithCrypto.crypto = webcrypto as unknown as Crypto;
}
