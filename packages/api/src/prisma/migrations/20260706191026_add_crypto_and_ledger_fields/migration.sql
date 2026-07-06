-- AlterTable
ALTER TABLE "RecoveryShard" ADD COLUMN     "encryptedShard" TEXT,
ADD COLUMN     "shardIndex" INTEGER,
ADD COLUMN     "threshold" INTEGER;

-- AlterTable
ALTER TABLE "Researcher" ADD COLUMN     "encryptedPrivateKey" TEXT,
ADD COLUMN     "keyType" TEXT NOT NULL DEFAULT 'Ed25519',
ADD COLUMN     "publicKey" TEXT;

-- AlterTable
ALTER TABLE "SoulboundToken" ADD COLUMN     "claims" JSONB,
ADD COLUMN     "issuerPublicKey" TEXT,
ADD COLUMN     "issuerSignature" TEXT,
ADD COLUMN     "merkleRoot" TEXT;

-- AlterTable
ALTER TABLE "ZkProof" ADD COLUMN     "circuitId" TEXT,
ADD COLUMN     "disclosedClaims" JSONB,
ADD COLUMN     "proof" JSONB,
ADD COLUMN     "publicSignals" JSONB,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "txHash" TEXT NOT NULL,
    "prevHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_txHash_key" ON "LedgerTransaction"("txHash");

-- CreateIndex
CREATE INDEX "LedgerTransaction_index_idx" ON "LedgerTransaction"("index");
