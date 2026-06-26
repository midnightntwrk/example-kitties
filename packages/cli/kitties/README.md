# CLI Usage Guide

The Kitties CLI provides an interactive command-line interface for deploying, managing, and interacting with CryptoKitties contracts on the Midnight blockchain.

## Table of Contents

### Getting Started
- [Installation & Setup](#installation--setup)
  - [Prerequisites](#prerequisites)
  - [Proof Server](#proof-server)
  - [Running the CLI](#running-the-cli)
- [Initial Setup](#initial-setup)
  - [Deploy or Connect](#1-deploy-or-connect)
  - [Main Menu](#2-main-menu)

### Core Operations
- [Creating Kitties](#creating-kitties)
- [Viewing Kitties](#viewing-kitties)
- [Marketplace Operations](#marketplace-operations)
- [Transfer Operations](#transfer-operations)
- [Breeding System](#breeding-system)
- [NFT Standard Operations](#nft-standard-operations)
- [Contract Statistics](#contract-statistics)

### Usage & Best Practices
- [Address Format](#address-format)
- [Error Handling](#error-handling)
- [Tips & Best Practices](#tips--best-practices)
  - [Getting Started](#getting-started-1)
  - [Marketplace Strategy](#marketplace-strategy)
  - [Breeding Tips](#breeding-tips)
  - [Address Management](#address-management)

### Advanced Usage
- [Troubleshooting](#troubleshooting)
  - [Connection Issues](#connection-issues)
  - [Transaction Failures](#transaction-failures)
  - [Performance Issues](#performance-issues)
- [Configuration Files](#configuration-files)
- [Development Usage](#development-usage)
- [Advanced Usage](#advanced-usage-1)

---

## Installation & Setup

### Prerequisites
- Node.js v22+
- Yarn package manager
- Docker (to run the proof server)
- Access to a Midnight network (preprod by default)

### Proof Server

Contract operations require a local proof server to generate zero-knowledge proofs. The proof server receives raw private witness data, so it runs locally on a machine you control rather than as a shared service.

The recommended approach is to run the proof server as a long-lived detached container, separate from the CLI. This keeps the proof server alive across multiple CLI sessions and avoids the port conflicts that occur when each run starts and stops its own container.

Start the proof server from the project root:

```bash
docker compose -f packages/cli/proof-server-testnet.yml up -d
```

Confirm it is healthy before continuing:

```bash
curl http://localhost:6300/version
```

When finished for the day, stop it:

```bash
docker compose -f packages/cli/proof-server-testnet.yml down
```

### Running the CLI

The CLI targets three networks, matching the Midnight progression of `undeployed -> preprod -> preview`. Preprod is the right default for most development. Preview receives new features first. Undeployed runs entirely against a local stack with no faucet step.

For preprod or preview, start the detached proof server first (see above), then run the matching command from the project root:

```bash
yarn kitties-cli-preprod
yarn kitties-cli-preview
```

For undeployed, the local command starts the full standalone stack (proof server, indexer, and node) automatically, so no separate proof server is needed:

```bash
yarn kitties-cli-standalone
```

A preprod convenience variant starts a proof server automatically via Testcontainers and shuts it down on exit. It is slower to start and binds port 6300 for the duration of the run, so it fails if a proof server is already running. Prefer the detached workflow above; use this only for a quick one-off session:

```bash
yarn kitties-cli-preprod-ps
```

## Initial Setup

### 1. Deploy or Connect
When you start the CLI, you'll see:

```
You can do one of the following:
  1. Deploy a new kitties contract
  2. Join an existing kitties contract  
  3. Exit
Which would you like to do?
```

**Deploy New Contract:**
- Creates a fresh kitties contract
- You become the owner
- Contract starts with 0 kitties

**Join Existing Contract:**
- Enter the contract address in hex format
- Connect to a previously deployed contract
- View and interact with existing kitties

### 2. Main Menu
After connecting, you'll see the main operations menu:

```
You can do one of the following:
  1. Create a new kitty
  2. View my kitties
  3. View kitties for sale
  4. Transfer a kitty
  5. Transfer a kitty from owner
  6. Set kitty price
  7. Create buy offer
  8. Breed kitties
  9. View kitty details
  10. View contract stats
  11. View all offers for a kitty
  12. Approve offer
  13. NFT Operations
  14. Exit
```

## Core Operations

### Creating Kitties

**Option 1: Create a new kitty**
- Mints a new kitty with random DNA
- Assigns random gender (alternating)
- Sets generation to 0 (original)
- You become the owner

```
Creating a new kitty...
✅ Kitty created successfully!
```

### Viewing Kitties

**Option 2: View my kitties**
- Shows all kitties you own
- Displays kitty ID, DNA, gender, generation
- Shows sale status and price

```
=== Your Kitties (2) ===
Kitty #1:
  DNA: 1a2b3c4d5e6f7890abcdef1234567890
  Gender: Female
  Generation: 0
  For Sale: No
  Price: 0

Kitty #2:
  DNA: fedcba0987654321abcdef1234567890
  Gender: Male  
  Generation: 1
  For Sale: Yes
  Price: 150
```

**Option 3: View kitties for sale**
- Shows all kitties across the contract that are for sale
- Includes owner information
- Useful for finding kitties to buy

**Option 9: View kitty details**
- Get detailed information about any kitty by ID
- Shows complete kitty data structure

### Marketplace Operations

**Option 6: Set kitty price**
- Put your kitty up for sale
- Enter kitty ID and desired price
- Others can now make offers

```
Enter the kitty ID to set price for: 1
Enter the price: 100
Setting price for kitty 1 to 100...
✅ Price set successfully!
```

**Option 7: Create buy offer**
- Make an offer on any kitty for sale
- Enter kitty ID and your bid price
- Owner can accept or ignore your offer

```
Enter the kitty ID to make an offer on: 1
Enter your bid price: 120
Creating buy offer for kitty 1 with bid price 120...
✅ Buy offer created successfully!
```

**Option 12: Approve offer**
- Accept a purchase offer on your kitty
- Transfers ownership and completes sale
- Must specify buyer address

**Option 11: View all offers for a kitty**
- See all pending offers on a specific kitty
- Shows buyer addresses and offered prices

### Transfer Operations

**Option 4: Transfer a kitty**
- Transfer your kitty to another address
- Enter kitty ID and recipient address
- Resets sale status

**Option 5: Transfer a kitty from owner**
- Transfer kitty using NFT approval system
- Requires prior approval from owner
- Used for marketplace transfers

### Breeding System

**Option 8: Breed kitties**
- Create offspring from two parent kitties
- Both parents must exist
- Combines DNAs
- Offspring generation (max(parent generations) + 1)

```
Enter the first kitty ID for breeding: 1
Enter the second kitty ID for breeding: 2
Breeding kitties 1 and 2...
✅ Kitties bred successfully! New offspring created.
```

### NFT Standard Operations

**Option 13: NFT Operations**
Access standard ERC-721 operations:

```
NFT Operations:
  1. Check balance of address
  2. Get owner of token
  3. Approve address for token
  4. Get approved address for token
  5. Set approval for all tokens
  6. Check approval for all
  7. Back to main menu
```

These operations use the external NFT module functionality:
- **Balance**: Number of kitties owned by an address
- **Owner**: Current owner of a specific kitty
- **Approve**: Allow another address to transfer your kitty
- **Approval Status**: Check who's approved for transfers

### Contract Statistics

**Option 10: View contract stats**
- Total number of kitties created
- Contract address information
- Overall contract health

```
=== Contract Statistics ===
Contract Address: 0x1234...5678
Total Kitties: 42
```

## Address Format

Midnight wallet addresses use the bech32m format, with a network-specific prefix that identifies which network the address belongs to. A preprod unshielded address looks like this:

```
mn_addr_preprod1hdvtst70zfgd8wvh7l8ppp7mcrxnjn56wc5hlxpwflz3fxdykaesrw0ln4
```

When a kitty operation asks for a recipient address, paste the full bech32m address as shown by your wallet. The prefix must match the network the CLI is connected to: `mn_addr_preprod1...` on preprod and `mn_addr_preview1...` on preview.

Contract addresses are distinct from wallet addresses and are shown in hex. Use the value reported when a contract is deployed or when viewing contract statistics.

## Error Handling

The CLI provides descriptive error messages:

```
# Common errors and meanings:
"Kitty is not for sale" - Cannot make offer on unlisted kitty
"Bid price too low" - Offer below asking price
"You don't own this kitty" - Cannot modify kitty you don't own
"Kitty does not exist" - Invalid kitty ID
"Invalid address format" - Address not in correct hex format
```

## Tips & Best Practices

### Getting Started
1. **Deploy a test contract** first to experiment
2. **Create a few kitties** to practice with
3. **Try marketplace operations** with different prices
4. **Experiment with breeding** to see genetic inheritance

### Marketplace Strategy
- **Research prices** by viewing kitties for sale
- **Make competitive offers** slightly above asking price
- **Set reasonable prices** when selling your kitties
- **Check offers regularly** to see interest in your kitties

### Breeding Tips
- **Track generations** - higher generations may be rarer
- **Experiment with DNA combinations** to see inheritance patterns
- **Keep variety** - different DNA combinations create unique offspring

### Address Management
- **Save contract addresses** you want to reconnect to later
- **Keep track of wallet addresses** for transfers
- **Use the full bech32m address** for the connected network when transferring

## Configuration Files

The CLI uses Docker Compose files to run the local infrastructure it depends on. These define container images and ports only; network endpoints, proof server URLs, and wallet settings live in the API configuration (`packages/api/kitties/src/common/config.ts`).

- **`proof-server-testnet.yml`** - Standalone proof server for use against preprod or preview
- **`standalone.yml`** - Full local stack (proof server, indexer, and node) for undeployed development

Both files are located in `packages/cli/`.

## Development Usage

### Debugging
- Use verbose logging by setting environment variables
- Check `packages/cli/logs/` for detailed logs
- Monitor transaction hashes for blockchain confirmation

### Contract Development
- Deploy fresh contracts for testing changes
- Use CLI to verify contract behavior
- Test all operations before production deployment

### Multiple Contracts
- Connect to different contracts by using their addresses
- Manage multiple kitty collections
- Transfer kitties between different contract instances

### Integration Testing
- Use CLI to verify API functionality
- Test end-to-end workflows
- Validate contract behavior under various conditions
