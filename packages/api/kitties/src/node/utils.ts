import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { parseCoinPublicKeyToHex } from '@midnight-ntwrk/midnight-js-utils';
import { ShieldedAddress, MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import { parseAddress } from '../common/utils.js';
/**
 * Safe wrapper for parseAddress to handle potential errors (Node.js version with full wallet support)
 * @param input - The input string to parse
 * @returns The parsed address or throws an error
 */
export function safeParseAddressWithWallet(input: string): Uint8Array {
  if (!input || typeof input !== 'string') {
    throw new Error('Input must be a non-empty string');
  }
  return convertWalletPublicKeyToBytes(input);
}

// Helper function to convert wallet public key to bytes format
// This handles the conversion from Bech32m format (or other formats) to the 32-byte format expected by the contract
export function convertWalletPublicKeyToBytes(input: unknown): Uint8Array {
  // Validate input is a string
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Input must be a non-empty string');
  }

  const inputStr = input.trim();

  try {
    // First, try to parse as a coin public key (shield-cpk format)
    if (inputStr.includes('shield-cpk')) {
      const hexKey = parseCoinPublicKeyToHex(inputStr, getNetworkId());
      return parseAddress(hexKey);
    }
    // If it's a shield-addr format, extract the coin public key from the shielded address
    else if (inputStr.includes('shield-addr')) {
      const bech32 = MidnightBech32m.parse(inputStr);
      // Extract network from the bech32 address
      const networkContext = bech32.network;
      const shieldedAddress = ShieldedAddress.codec.decode(networkContext, bech32);
      // Get the coin public key string and parse it to hex
      const coinPublicKeyStr = shieldedAddress.coinPublicKeyString();
      const hexKey = parseCoinPublicKeyToHex(coinPublicKeyStr, getNetworkId());
      return parseAddress(hexKey);
    }
    // If it's already a bare hex coin public key, accept exactly 32 bytes
    // (64 hex chars). The contract identifies owners by ZswapCoinPublicKey, so
    // a recipient must resolve to a 32-byte shielded coin public key.
    else if (/^[0-9a-fA-F]{64}$/.test(inputStr)) {
      return parseAddress(inputStr);
    }
    // Anything else is not a valid recipient. In particular the unshielded
    // address (mn_addr_...) is for receiving tNIGHT from the faucet, not for
    // kitty ownership, so reject it with a clear message rather than silently
    // mis-decoding it as hex.
    else {
      throw new Error('unrecognized recipient format');
    }
  } catch (error) {
    throw new Error(
      `Unable to parse recipient "${input}". A recipient must be a shielded coin public key: ` +
        'a shield-addr (mn_shield-addr_...) address, a shield-cpk coin public key, or a 64-character hex coin public key. ' +
        'The unshielded mn_addr_... address is for receiving tNIGHT and cannot own a kitty.',
    );
  }
}
