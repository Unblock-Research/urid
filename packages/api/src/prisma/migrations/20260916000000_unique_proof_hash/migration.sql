-- Critical finding #2: proofHash must identify exactly one proof row.
--
-- proofHash was previously derived from public signals alone, which are identical
-- across repeated proofs of the same credential. Existing rows may therefore
-- collide, and the unique index below would fail against them.
--
-- De-duplicate first, keeping the newest row per hash (ties broken by id so the
-- statement is deterministic). Older colliding rows are exactly the ones that
-- could be resolved in place of a revoked twin, so dropping them is the intent.
DELETE FROM "ZkProof" a
USING "ZkProof" b
WHERE a."proofHash" = b."proofHash"
  AND (
    a."createdAt" < b."createdAt"
    OR (a."createdAt" = b."createdAt" AND a."id" < b."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "ZkProof_proofHash_key" ON "ZkProof"("proofHash");
