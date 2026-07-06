-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Researcher" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "orcidId" TEXT,
    "linkedinUrl" TEXT,
    "avatarUrl" TEXT,
    "affiliations" TEXT[],
    "researchInterests" TEXT[],
    "careerStage" TEXT NOT NULL DEFAULT 'EARLY_CAREER',
    "fieldOfStudy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Researcher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoulboundToken" (
    "id" TEXT NOT NULL,
    "researcherId" TEXT NOT NULL,
    "credentialType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "issuerDid" TEXT,
    "metadataUri" TEXT,
    "fieldOfStudy" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'default',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "onChainTxHash" TEXT,

    CONSTRAINT "SoulboundToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactScore" (
    "id" TEXT NOT NULL,
    "researcherId" TEXT NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "pillars" JSONB NOT NULL,
    "bonuses" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "penalty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpactScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZkProof" (
    "id" TEXT NOT NULL,
    "researcherId" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "claims" JSONB NOT NULL,
    "consentWindow" TEXT NOT NULL,
    "proofHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ZkProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Affiliation" (
    "id" TEXT NOT NULL,
    "researcherId" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "department" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "issuedBy" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "sbtId" TEXT,

    CONSTRAINT "Affiliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectedApp" (
    "id" TEXT NOT NULL,
    "researcherId" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'connected',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectedApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletLink" (
    "id" TEXT NOT NULL,
    "researcherId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryShard" (
    "id" TEXT NOT NULL,
    "researcherId" TEXT NOT NULL,
    "guardianName" TEXT NOT NULL,
    "guardianKind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "RecoveryShard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "researcherId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "appName" TEXT,
    "claims" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Researcher_handle_key" ON "Researcher"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "Researcher_did_key" ON "Researcher"("did");

-- CreateIndex
CREATE UNIQUE INDEX "Researcher_orcidId_key" ON "Researcher"("orcidId");

-- CreateIndex
CREATE INDEX "SoulboundToken_researcherId_idx" ON "SoulboundToken"("researcherId");

-- CreateIndex
CREATE INDEX "ImpactScore_researcherId_idx" ON "ImpactScore"("researcherId");

-- CreateIndex
CREATE INDEX "ZkProof_researcherId_status_idx" ON "ZkProof"("researcherId", "status");

-- CreateIndex
CREATE INDEX "Affiliation_researcherId_idx" ON "Affiliation"("researcherId");

-- CreateIndex
CREATE INDEX "ConnectedApp_researcherId_idx" ON "ConnectedApp"("researcherId");

-- CreateIndex
CREATE INDEX "WalletLink_researcherId_idx" ON "WalletLink"("researcherId");

-- CreateIndex
CREATE INDEX "RecoveryShard_researcherId_idx" ON "RecoveryShard"("researcherId");

-- CreateIndex
CREATE INDEX "AuditLog_researcherId_idx" ON "AuditLog"("researcherId");

-- AddForeignKey
ALTER TABLE "SoulboundToken" ADD CONSTRAINT "SoulboundToken_researcherId_fkey" FOREIGN KEY ("researcherId") REFERENCES "Researcher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactScore" ADD CONSTRAINT "ImpactScore_researcherId_fkey" FOREIGN KEY ("researcherId") REFERENCES "Researcher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZkProof" ADD CONSTRAINT "ZkProof_researcherId_fkey" FOREIGN KEY ("researcherId") REFERENCES "Researcher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Affiliation" ADD CONSTRAINT "Affiliation_researcherId_fkey" FOREIGN KEY ("researcherId") REFERENCES "Researcher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectedApp" ADD CONSTRAINT "ConnectedApp_researcherId_fkey" FOREIGN KEY ("researcherId") REFERENCES "Researcher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLink" ADD CONSTRAINT "WalletLink_researcherId_fkey" FOREIGN KEY ("researcherId") REFERENCES "Researcher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryShard" ADD CONSTRAINT "RecoveryShard_researcherId_fkey" FOREIGN KEY ("researcherId") REFERENCES "Researcher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_researcherId_fkey" FOREIGN KEY ("researcherId") REFERENCES "Researcher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
