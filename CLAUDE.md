# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This is a monorepo with two independent packages:

- **`sdk/`** — The `spark-mppx` npm package: a Lightning Network payment method for the [MPP protocol](https://mpp.dev), built on [Spark](https://spark.money) wallets.
- **`demo/`** — A demo application with an Express server (`demo/server/`) and a React+Vite SPA (`demo/app/`).

Each package has its own `node_modules` and must be installed separately.

## Commands

### SDK (`sdk/`)
```bash
npm install
npx tsc --noEmit          # typecheck
npm run example:server    # run example server (regtest)
npm run example:client    # run example client (regtest)
```

### Demo server (`demo/server/`)
```bash
npm install --legacy-peer-deps
npx tsc --noEmit          # typecheck
npx tsx index.ts          # run server (port 3000)
```

### Demo app (`demo/app/`)
```bash
npm install --legacy-peer-deps
npm run dev               # Vite dev server
npm run build             # tsc + vite build → dist/
npx tsc --noEmit          # typecheck only
```

## How the 402 payment flow works

1. Client sends a normal HTTP request.
2. Server calls `mppx.charge({ amount, currency })(request)`. If no valid credential is present, it returns a `402` with a `WWW-Authenticate` header containing a BOLT11 Lightning invoice.
3. Client pays the invoice via Spark and retries with an `Authorization` header containing the preimage.
4. Server verifies `sha256(preimage) == paymentHash` locally — no external call needed. Returns the response with a `Payment-Receipt` header.

## SDK architecture

**`sdk/src/Methods.ts`** — Defines the shared `charge` method schema using `mppx`'s `Method.from()`. Specifies what fields are in the challenge request (amount, currency, invoice, paymentHash) and credential payload (preimage).

**`sdk/src/server/Charge.ts`** — Server-side `spark.charge()`. Creates a `SparkWallet`, lazily initialized on first request. Implements `request()` (generates a fresh BOLT11 invoice) and `verify()` (checks preimage against paymentHash).

**`sdk/src/client/Charge.ts`** — Client-side `spark.charge()`. Intercepts 402s, calls `wallet.payLightningInvoice()`, polls for the preimage (Spark sometimes returns it async), and returns it as the credential. Exposes a `cleanup()` method to close WebSocket connections.

Both sides are wired to the `mppx` library via `Method.toServer()` / `Method.toClient()`.

## Demo server architecture

**`demo/server/index.ts`** — Express app entry point. Defines `AppContext` (serverMnemonic, secretKey), registers modules, serves the built SPA as a fallback.

**`demo/server/sdk.ts`** — Re-exports `Mppx` and `spark` from `spark-mppx/server` with `@ts-nocheck` to avoid tsconfig boundary issues when the SDK is a local file: dependency.

**`demo/server/utils.ts`** — `toWebRequest()` converts an Express `Request` to a Web `Request`, required because the SDK uses the Web standard Request/Response API.

Each module (`stocks.ts`, `lottery.ts`, `faucet.ts`) exports a `register(app, ctx)` function. Server modules create their own `Mppx` instance with a unique `realm` (used in HMAC scoping).

## Demo app architecture

**`demo/app/src/wallet.ts`** — BIP39+localStorage wallet management. `generateWallet()` / `importWallet()` / `loadMnemonic()` / `clearWallet()` manage the stored mnemonic. `getWallet()` lazily initializes a `SparkWallet` singleton. `payAndFetch()` is an async generator that drives the full 402 flow step-by-step, yielding typed `PayStep` values for the UI to display.

**`demo/app/src/App.tsx`** — Single-file React app (no router). Top-level `App` checks for a stored mnemonic; if absent, renders `WalletSetup`; otherwise renders `MainApp`. `MainApp` contains the terminal-style API explorer with sidebar, controls, terminal log pane, and code snippet pane. Mobile (<640px) uses a top tab bar (api / terminal / code).

## Dependencies and peer deps

The demo packages have peer dependency conflicts with `@buildonspark/spark-sdk`; always use `--legacy-peer-deps` when installing in `demo/server/` and `demo/app/`.

The SDK uses `"."`, `"./server"`, and `"./client"` exports pointing directly at TypeScript source files (no build step for the SDK itself).

## CI

Three jobs in `.github/workflows/ci.yml`: `typecheck-sdk`, `typecheck-demo-server`, `build-demo-app`. All run on Node 22. The repo enforces squash merges.
