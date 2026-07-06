# Technology Stack

**Analysis Date:** 2026-07-06

## Languages

**Primary:**
- TypeScript 5.8 - All packages (API, web, mobile, shared)

## Runtime

**Environment:**
- Node.js - API backend
- Expo (52.0.46) - Mobile runtime for iOS/Android
- Browser - Next.js web app

**Package Manager:**
- pnpm - Monorepo workspace (configured in `pnpm-workspace.yaml`)
- Lockfile: `pnpm-lock.yaml` present

## Frameworks

**Core:**
- NestJS 11.0 - Backend API framework at `packages/api/`
- Next.js 15.0 - Frontend web framework at `packages/web/`
- React Native 0.77.5 - Cross-platform mobile framework at `packages/mobile/`
- React 19.0 - UI library across web and mobile

**Mobile-specific:**
- Expo Router 4.0 - Navigation for mobile apps
- Expo 52.0.46 - Development platform for iOS/Android
- Expo Status Bar, Linking, Constants - System integrations
- React Native Screens, Safe Area Context, Gesture Handler, Reanimated - Native modules

**Backend utilities:**
- Express 5.0 - HTTP server (used by NestJS)
- Prisma 6.11 - ORM for database operations
- Reflect Metadata 0.1.13 - Decorator support for NestJS
- RxJS 7.8 - Reactive programming library

**Frontend utilities:**
- Tailwind CSS 4.0 - Utility CSS framework
- PostCSS 8.0 - CSS transformation

## Key Dependencies

**Critical:**
- `@nestjs/core`, `@nestjs/common` 11.0 - Core NestJS framework
- `@nestjs/platform-express` 11.0 - Express integration for NestJS
- `@nestjs/config` 4.0 - Configuration management
- `@nestjs/swagger` 11.0 - API documentation (OpenAPI/Swagger)
- `@prisma/client` 6.11 - Database client
- `prisma` 6.11 - Schema management and migrations

**Validation & types:**
- `zod` 3.25 - Schema validation library
- `axios` 1.6 - HTTP client (dependency but not actively used in current code)

**Mobile-specific:**
- `@expo/vector-icons` 14.0 - Icon library
- `expo-clipboard` 7.0 - Clipboard access
- `react-native-safe-area-context` 5.4 - Safe area handling for notched devices

## Configuration

**Environment:**
- `.env` file present in `packages/api/` (contains DATABASE_URL and other secrets)
- Configuration is loaded at runtime by Prisma and NestJS config module

**Build:**
- TypeScript config: `packages/api/tsconfig.json` - CommonJS output, ES2020 target
- TypeScript config: `packages/web/tsconfig.json` - ESNext output, bundler module resolution
- TypeScript config: `packages/mobile/tsconfig.json` - TypeScript support
- NestJS app setup: `packages/api/src/main.ts` - Port 3001, CORS enabled
- Next.js config: `packages/web/next.config.ts` - Minimal config
- Expo app config: `packages/mobile/app.json` - Expo router plugin, iOS/Android identifiers

**API Documentation:**
- Swagger docs served at `http://localhost:3001/api/docs` via NestJS Swagger module

## Platform Requirements

**Development:**
- Node.js runtime (version not explicitly pinned)
- pnpm package manager
- TypeScript compiler
- For mobile: Expo CLI, iOS Simulator/Android Emulator

**Production:**
- Backend: Docker container running NestJS on Node.js
- Database: PostgreSQL server (remote or local)
- Frontend: Static hosting for Next.js build output
- Mobile: App Store (iOS) and Google Play (Android) deployments
- Blockchain: Local RPC node at `http://localhost:9000` (Unblock Chain)

---

*Stack analysis: 2026-07-06*
