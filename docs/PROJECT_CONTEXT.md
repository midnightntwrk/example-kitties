# Midnight Kitties - AI Project Context

> **Quick Reference Guide for AI Systems**  
> Last Updated: August 27, 2025  
> Repository: `riusricardo/midnight-kitties`  
> Branch: `main`

## 🎯 Project Summary

**Midnight Kitties** is a comprehensive CryptoKitties-inspired NFT dApp showcasing the **Midnight blockchain ecosystem** and **Compact programming language**. It serves as both a functional application and educational reference for Midnight development.

### Key Features
- 🐱 **NFT System**: Breeding, trading, ownership mechanics
- 🧬 **Genetic Breeding**: DNA inheritance with generation tracking
- 💰 **Marketplace**: Offer/approval system for trading
- 🌐 **Cross-Platform**: Browser + Node.js compatibility
- 🔧 **Development Tools**: CLI, testing, comprehensive docs

## 🏗️ Architecture Overview

```
┌─────────────────────┐    ┌─────────────────────┐
│    Web Frontend     │    │    CLI Interface    │
│   (React + MUI)     │    │  (Interactive TUI)  │
└─────────────────────┘    └─────────────────────┘
           │                          │
           └──────────────────────────┘
                        │
             ┌─────────────────────┐    ┌─────────────────────┐
             │   Universal API     │◄──►│   Smart Contract    │
             │ (Browser/Node.js)   │    │ (Compact Language)  │
             └─────────────────────┘    └─────────────────────┘
                       │                          │
                       ▼                          ▼
          ┌────────────────────────────────────────────────────┐
          │            Midnight Network                        │
          │  (Privacy-first blockchain with ZK proofs)        │
          └────────────────────────────────────────────────────┘
```

## 📁 Critical File Locations

### Smart Contract
- **Main Contract**: `packages/contracts/kitties/src/kitties.compact`
- **Generated Code**: `packages/contracts/kitties/src/managed/`
- **Tests**: `packages/contracts/kitties/src/test/`

### API Layer
- **Universal API**: `packages/api/kitties/src/`
- **Browser Entry**: `packages/api/kitties/src/browser-index.ts`
- **Node Entry**: `packages/api/kitties/src/index.ts`
- **Environment Abstraction**: `packages/api/kitties/src/env*.ts`

### Frontend
- **Web App**: `apps/web/src/`
- **UI Components**: `packages/ui/components/`
- **Main Entry**: `apps/web/src/main.tsx`

### CLI Tools
- **CLI Source**: `packages/cli/kitties/src/`
- **Entry Point**: `packages/cli/kitties/src/cli.ts`

### Configuration
- **Root Config**: `package.json`, `turbo.json`, `tsconfig.json`
- **Vite Config**: `apps/web/vite.config.ts`
- **CLI Configs**: `packages/cli/kitties/*.yml`

## 🔍 Key Technologies & Concepts

### Compact Language Features Used
```compact
// External module integration
import "midnight-contracts/contracts/tokens/nft/src/modules/Nft";

// Complex data structures
export struct Kitty {
  dna: Field,                // 32-byte genetic identifier
  gender: Gender,            // Male/Female enum
  owner: ZswapCoinPublicKey, // Owner's public key
  price: Uint<64>,           // Sale price
  forSale: Boolean,          // Sale status
  generation: Uint<32>       // Breeding generation
}

// Advanced state management
export ledger kitties: Map<Uint<64>, Kitty>;
export ledger buyOffers: Map<Uint<64>, Map<ZswapCoinPublicKey, Offer>>;
```

### Core Operations
1. **Kitty Management**: `createKitty()`, `transferKitty()`, `setPrice()`
2. **Marketplace**: `createBuyOffer()`, `approveOffer()`, `getOffer()`
3. **Breeding**: `breedKitty()` with DNA combination
4. **NFT Standard**: All ERC-721 operations via external module

### API Architecture Patterns
- **Environment Detection**: Runtime Node.js vs Browser detection
- **Path Resolution**: Multi-strategy approach for CJS/ESM compatibility
- **Cross-Platform Exports**: Separate browser/node entry points
- **Universal Interface**: Same API surface across environments

## ⚡ Quick Start Commands

```bash
# Install dependencies
yarn install

# Build everything
yarn build

# Start web app
yarn start

# Run CLI (testnet)
yarn kitties-cli-remote

# Test contract
yarn test-contract

# Test API
yarn test-api
```

## 🧪 Testing Strategy

### Contract Testing
- **Simulator**: `KittiesSimulator` class for isolated testing
- **Test File**: `packages/contracts/kitties/src/test/kitties.test.ts`
- **Coverage**: Basic ops, marketplace, breeding, NFT standard, edge cases

### API Testing
- **Cross-Platform**: Tests in both browser and Node.js environments
- **Integration**: Tests against live testnet
- **Environment**: Tests environment abstraction layer

## 🔧 Development Workflow

### Contract Development
1. Edit `kitties.compact`
2. Run `yarn compact` to compile
3. Run `yarn test-contract` to validate
4. Update API bindings if needed

### API Development
1. Modify files in `packages/api/kitties/src/`
2. Run `yarn build:api`
3. Test with `yarn test-api`
4. Validate browser compatibility

### Frontend Development
1. Edit files in `apps/web/src/` or `packages/ui/`
2. Run `yarn start` for development server
3. Test wallet integration and real-time updates

## 🎨 UI Components Architecture

### Key Components
- **`App.tsx`**: Main application wrapper with theme and providers
- **`KittiesReader.tsx`**: Core application logic and state management
- **`MyKittiesGallery.tsx`**: User's kitty collection display
- **`KittyCard.tsx`**: Individual kitty display with actions
- **`MidnightWallet.tsx`**: Wallet connection and management
- **`WalletWidget.tsx`**: Connection status and controls

### State Management
- **React Context**: `LocalStateProviderContext.tsx`
- **RxJS Observables**: Real-time contract state updates
- **Runtime Configuration**: Environment-specific settings

## 🚨 Common Development Issues & Solutions

### Contract Compilation
- **Issue**: Compact compilation fails
- **Solution**: Check `COMPACT_PATH` environment variable points to `midnight-contracts`

### Browser Build Errors
- **Issue**: Node.js modules in browser
- **Solution**: Check Vite aliases in `apps/web/vite.config.ts`

### Path Resolution
- **Issue**: Module not found in different environments
- **Solution**: Use universal path resolver in `packages/api/kitties/src/path-resolver.ts`

### CLI Connection Issues
- **Issue**: Cannot connect to testnet
- **Solution**: Verify network configuration in `packages/cli/kitties/*.yml`

## 📚 External Dependencies

### Core Midnight Dependencies
- `@midnight-ntwrk/compact-runtime`: Compact language runtime
- `@midnight-ntwrk/midnight-js-*`: Midnight JavaScript SDK components
- `@midnight-ntwrk/wallet*`: Wallet integration libraries

### External Contract Modules
- `midnight-contracts`: External NFT module source (GitHub: `riusricardo/midnight-contracts`)

### Development Tools
- `turbo`: Monorepo build system
- `vitest`: Testing framework
- `vite`: Frontend build tool
- `typescript`: Type system

## 🎓 Educational Aspects

### For Compact Learning
- **Real-world patterns**: Data structures, state management, module integration
- **Best practices**: Error handling, access control, state transitions
- **Advanced features**: Nested maps, breeding algorithms, marketplace logic

### For Midnight Ecosystem
- **Module integration**: How to use external contract modules
- **Cross-platform development**: Universal API design patterns
- **Full-stack architecture**: Complete dApp development approach

## 🔮 Extension Points

### Easy Additions
- New kitty attributes (add fields to `Kitty` struct)
- Additional marketplace features (auctions, batch operations)
- Enhanced breeding (more complex genetics)

### Architecture Extensions
- Multiple contract support (contract factory pattern)
- Advanced state management (more complex ledger structures)
- Enhanced privacy features (selective disclosure patterns)

## 🏷️ Project Metadata

- **License**: GPL-3.0
- **Author**: Ricardo Rius
- **Package Manager**: Yarn v1.22.22
- **Node.js**: v18+
- **TypeScript**: v5.8.3
- **Turbo Version**: v2.5.4

## 📋 Quick Debugging Checklist

When issues arise, check:
1. ✅ Dependencies installed (`yarn install`)
2. ✅ Contracts compiled (`yarn compact`)
3. ✅ Environment variables set (`COMPACT_PATH`)
4. ✅ Network connectivity (for CLI/testnet operations)
5. ✅ Wallet connected (for frontend)
6. ✅ Build artifacts present in `dist/` folders

---

## � New Developer Onboarding

### First Steps for New Developers

1. **Environment Setup**
   ```bash
   # Prerequisites: Node.js v18+, Yarn
   git clone https://github.com/riusricardo/midnight-kitties.git
   cd midnight-kitties
   yarn install
   
   # Set environment variable for Compact compiler
   export COMPACT_PATH=/path/to/midnight-contracts
   ```

2. **Build and Test**
   ```bash
   # Compile contracts and build everything
   yarn build
   
   # Run tests to verify setup
   yarn test-contract
   yarn test-api
   ```

3. **Try the Applications**
   ```bash
   # Start web application
   yarn start  # Visit http://127.0.0.1:8080/
   
   # Try CLI interface
   yarn kitties-cli-remote
   ```

### Learning Path for New Developers

1. **Start with the Contract** (`packages/contracts/kitties/src/kitties.compact`)
   - Understand the Compact language syntax
   - Study the data structures (Kitty, Offer)
   - Explore the breeding and marketplace logic

2. **Explore the API** (`packages/api/kitties/`)
   - See how the universal API works across environments
   - Study the environment abstraction patterns
   - Understand the testing simulator

3. **Frontend Components** (`packages/ui/components/`)
   - React components for the web interface
   - State management with contexts and observables
   - Wallet integration patterns

4. **CLI Tools** (`packages/cli/kitties/`)
   - Interactive command-line interface
   - Contract deployment and interaction examples
   - Testing against live networks

### Key Concepts to Understand

- **Compact Language**: Midnight's smart contract language
- **External Modules**: Integration with `midnight-contracts` NFT modules
- **Cross-Platform API**: Same API works in browser and Node.js
- **Turborepo**: Monorepo build system with caching
- **ZK Proofs**: Privacy-first blockchain architecture

---

**📝 Note for AI Systems**: This document provides the essential context needed to understand and work with the Midnight Kitties project. For detailed implementation specifics, refer to the comprehensive documentation in each package's README file and the source code comments.