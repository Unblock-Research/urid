# External Integrations

**Analysis Date:** 2026-07-06

## APIs & External Services

**Blockchain/DID Registration:**
- Unblock Chain RPC - Local testnet at `http://localhost:9000`
  - SDK/Client: Native fetch API
  - Used for: DID registration, SBT (Soulbound Token) minting, on-chain transactions
  - Endpoint: `/rpc/send_transaction` (POST)
  - Transaction types: `register_did`, `mint_sbt` (implementations in `packages/api/src/modules/identity/identity.service.ts` and `packages/api/src/modules/credentials/credentials.service.ts`)

**Academic & Professional Accounts (Planned):**
- ORCID - Integration planned (UI shows "Connect ORCID" at signup step 5, `packages/web/src/app/signup/page.tsx`)
  - Status: UI placeholder, backend integration not yet implemented
- GitHub - Integration planned (UI shows "Connect GitHub")
  - Status: UI placeholder, backend integration not yet implemented
- arXiv - Integration planned (UI shows "arXiv")
  - Status: UI placeholder, backend integration not yet implemented
- Crossref - Integration planned (UI shows "Crossref" for reviewer records)
  - Status: UI placeholder, backend integration not yet implemented
- OpenAlex - Integration planned (UI shows "OpenAlex")
  - Status: UI placeholder, backend integration not yet implemented
- ResearchHub - Integration planned (UI shows "ResearchHub")
  - Status: UI placeholder, backend integration not yet implemented

**Web3 Wallets (Planned):**
- MetaMask - Integration planned (UI shows wallet connection, `packages/web/src/app/signup/page.tsx` step 6)
  - Status: UI placeholder, backend integration not yet implemented
- Trust Wallet - UI placeholder only
- Rainbow - UI placeholder only
- Coinbase Wallet - UI placeholder only
- Phantom - UI placeholder only
- WalletConnect - UI placeholder only

## Data Storage

**Databases:**
- PostgreSQL - Primary data store
  - Connection: `DATABASE_URL` environment variable in `packages/api/.env`
  - Client: `@prisma/client` 6.11
  - ORM: Prisma (`packages/api/src/prisma/schema.prisma`)
  - Managed by: `packages/api/src/prisma/prisma.service.ts`
  - Schema includes: Researcher, SoulboundToken, ImpactScore, ZkProof, Affiliation, ConnectedApp, WalletLink, RecoveryShard, AuditLog

**File Storage:**
- Not detected - Currently no file upload/storage integrations configured

**Caching:**
- None - Not currently implemented

## Authentication & Identity

**Auth Provider:**
- Custom DID (Decentralized Identifier) based
  - Implementation: `packages/api/src/modules/identity/identity.service.ts`
  - DID format: `did:ub:0x{HASH}` (generated from handle hash)
  - MVP status: Auth guard in `packages/api/src/guards/auth.guard.ts` currently allows all requests
  - Production: Guard will validate DID signature or JWT (not yet implemented)
  - Key management: Client-side key generation mentioned in UI (step 2, `packages/web/src/app/signup/page.tsx`)
    - Curve: Ed25519 / Curve25519
    - Storage: Device secure enclave
    - ZK circuits: Groth16 · 12 supported

## Monitoring & Observability

**Error Tracking:**
- Not detected

**Logs:**
- Console logging via NestJS Logger (`packages/api/src/modules/identity/identity.service.ts`, `packages/api/src/modules/credentials/credentials.service.ts`)
  - Format: Basic string messages
  - Examples: "Registered: @{handle} → {did}", "SBT minted: {credentialType}"

## CI/CD & Deployment

**Hosting:**
- Not detected - No deployment configuration files found (no GitHub Actions, GitLab CI, or similar)

**CI Pipeline:**
- Not detected

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection string

**Secrets location:**
- `.env` file in `packages/api/` (not committed to git)

## Webhooks & Callbacks

**Incoming:**
- Not detected

**Outgoing:**
- Not detected

## Data Models & Relationships

**Researcher (Core Identity):**
- Primary fields: handle (unique), did (unique), displayName, bio, orcidId
- Relationships: sbts, impactScores, zkProofs, affilRecords, connectedApps, walletLinks, recoveryShard, auditLogs
- Purpose: Central identity record for researchers

**SoulboundToken (Credentials):**
- Holds verifiable credentials (education, publication, review, award, certification)
- Fields: credentialType, title, issuer, onChainTxHash, issuedAt, expiresAt, revoked
- Purpose: Non-transferable blockchain credentials

**ImpactScore:**
- 7-pillar scoring system mentioned in README
- Fields: totalScore, pillars (JSON), bonuses, penalty
- Purpose: Researcher impact measurement

**ZkProof:**
- Zero-knowledge proof permissions
- Fields: appName, claims (JSON), proofHash, status, expiresAt
- Purpose: Selective disclosure per app

**WalletLink:**
- Blockchain wallet addresses linked to identity
- Fields: address, chain, isPrimary, label
- Purpose: Web3 account integration

**RecoveryShard:**
- Account recovery mechanism
- Fields: guardianName, guardianKind, status
- Purpose: 5-of-7 guardian recovery quorum (implemented in `packages/api/src/modules/identity/identity.service.ts`)

**Affiliation:**
- Institutional role assertions
- Fields: organizationName, role, department, status, issuedBy
- Purpose: Verify institutional affiliations

**ConnectedApp:**
- Third-party app permissions
- Fields: appName, scopes, status
- Purpose: Track which apps have access to user data

**AuditLog:**
- Activity tracking
- Fields: action, appName, claims, timestamp
- Purpose: Security audit trail

---

*Integration audit: 2026-07-06*
