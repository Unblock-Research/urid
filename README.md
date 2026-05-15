# URID — Universal Researcher Identity

Decentralized identity, reputation, and credential system for researchers.

## Architecture

```
packages/
├── web/       — Next.js web app (dashboard, signup, ZK permissions)
├── api/       — NestJS API (identity, credentials, ZK proofs, impact scoring)
├── mobile/    — React Native app (iOS + Android)
└── shared/    — Shared types, utils, constants
```

## Features

- 9-step onboarding (handle, DID, key generation, recovery shards, SBT import)
- True Impact Score (7-pillar scoring system)
- Soulbound Token credentials (PhD, publications, reviews, awards)
- Zero-knowledge proof permissions (selective disclosure per app)
- Affiliation management (institutional role assertions)
- Wallet integration (UBR native + external wallets)
- AI Twin agent authorization
- iOS + Android native apps

## Quick Start

```bash
pnpm install
pnpm dev:api    # API on port 3001
pnpm dev:web    # Web on port 3000
```
