-- CreateTable
CREATE TABLE "AuthNonce" (
    "id" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The UNIQUE constraint IS the replay check: claiming a nonce is an INSERT, and
-- a duplicate raises P2002. A check-then-insert would race.
CREATE UNIQUE INDEX "AuthNonce_did_nonce_key" ON "AuthNonce"("did", "nonce");

-- CreateIndex
CREATE INDEX "AuthNonce_expiresAt_idx" ON "AuthNonce"("expiresAt");
