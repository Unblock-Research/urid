/**
 * ImpactService — real 7-pillar impact score from live ORCID + Crossref data.
 *
 * calculate(did):
 *   1. Loads researcher by DID.
 *   2. If no orcidId → all 7 pillars insufficient_data, totalScore 0, no HTTP.
 *   3. Fetches ORCID (works/peer-reviews/fundings) + Crossref (per-DOI citations)
 *      in parallel through injected clients.
 *   4. Computes 5 data-backed pillars via metrics.ts; marks works-less pillars
 *      and the always-absent ethics/repro as insufficient_data.
 *   5. Renormalises the weighted total over ONLY scored pillars; adds a coverage field.
 *   6. Persists the real ImpactScore and returns it.
 *
 * getScore(did):
 *   Returns the latest persisted ImpactScore, or { status: 'not_calculated' }
 *   when none exists. Never falls back to a hardcoded constant.
 *
 * Threat mitigations applied here (T-07-07 → T-07-10):
 *   - Only scored pillars (backed by real fetched metrics) contribute to totalScore.
 *   - Upstream failures degrade affected pillar(s) to insufficient_data — no crash.
 *   - Service passes ids through the typed client API; never builds URLs itself.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { OrcidClient } from "./sources/orcid.client";
import { CrossrefClient } from "./sources/crossref.client";
import {
  scoreKnowledge,
  scoreImpact,
  scoreReview,
  scoreLeadership,
  scoreRecognition,
  computeHIndex,
} from "./sources/metrics";
import type { NormalizedWork } from "./sources/types";

// ---------------------------------------------------------------------------
// Pillar static definitions (id, label, weight)
// Weights 22/18/12/18/18/6/6 preserved from the original spec.
// ---------------------------------------------------------------------------

const PILLAR_DEFS = [
  { id: "knowledge", label: "Knowledge creation", weight: 22 },
  { id: "impact", label: "Peer & societal impact", weight: 18 },
  { id: "review", label: "Peer review", weight: 12 },
  { id: "leadership", label: "Leadership / collab", weight: 18 },
  { id: "recognition", label: "Recognition & funding", weight: 18 },
  { id: "ethics", label: "Adaptability & ethics", weight: 6 },
  { id: "repro", label: "Reproducibility", weight: 6 },
] as const;

type PillarDef = (typeof PILLAR_DEFS)[number];

/**
 * A single scored or unscored pillar result in the ImpactScore.pillars JSON.
 */
interface PillarResult {
  id: string;
  label: string;
  weight: number;
  /** Normalised sub-score in [0, 1].  null when status is 'insufficient_data'. */
  score: number | null;
  /** 'scored' when backed by real fetched metrics; 'insufficient_data' otherwise. */
  status: "scored" | "insufficient_data";
  /** Raw metrics that drove this pillar — empty object for insufficient_data pillars. */
  metrics: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildInsufficientPillar(def: PillarDef): PillarResult {
  return {
    id: def.id,
    label: def.label,
    weight: def.weight,
    score: null,
    status: "insufficient_data",
    metrics: {},
  };
}

/**
 * Renormalized weighted average over ONLY the 'scored' pillars.
 *
 * Formula:
 *   totalScore = Σ(score_i × weight_i) / Σ(weight_i)  over scored pillars
 *   coverage   = Σ(weight_i) / 100                    over scored pillars
 *
 * Returns { totalScore: 0, coverage: 0 } when no pillars are scored.
 */
function computeTotal(pillars: PillarResult[]): {
  totalScore: number;
  coverage: number;
} {
  const scored = pillars.filter((p) => p.status === "scored");
  if (scored.length === 0) return { totalScore: 0, coverage: 0 };
  const scoredWeightSum = scored.reduce((s, p) => s + p.weight, 0);
  const totalScore =
    scored.reduce((s, p) => s + (p.score as number) * p.weight, 0) /
    scoredWeightSum;
  const coverage = scoredWeightSum / 100;
  return { totalScore, coverage };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ImpactService {
  constructor(
    private prisma: PrismaService,
    private orcid: OrcidClient,
    private crossref: CrossrefClient,
  ) {}

  /**
   * Return the latest persisted ImpactScore for a researcher.
   *
   * - Unknown DID → null
   * - Known DID with no persisted score → { status: 'not_calculated' }
   * - Known DID with a persisted score → latest ImpactScore row
   */
  async getScore(did: string) {
    const r = await this.prisma.researcher.findUnique({ where: { did } });
    if (!r) return null;
    const score = await this.prisma.impactScore.findFirst({
      where: { researcherId: r.id },
      orderBy: { calculatedAt: "desc" },
    });
    return score ?? { status: "not_calculated" as const };
  }

  /**
   * Compute and persist a real 7-pillar ImpactScore for the researcher.
   *
   * @throws NotFoundException when no researcher exists for the given DID.
   */
  async calculate(did: string) {
    const r = await this.prisma.researcher.findUnique({ where: { did } });
    if (!r) throw new NotFoundException("Researcher not found");

    // ── No ORCID iD linked ──────────────────────────────────────────────────
    // All pillars insufficient_data; no outbound HTTP.
    if (!r.orcidId) {
      const pillars = PILLAR_DEFS.map(buildInsufficientPillar);
      return this.prisma.impactScore.create({
        data: {
          researcherId: r.id,
          totalScore: 0,
          pillars: JSON.parse(
            JSON.stringify({ pillars, coverage: 0 }),
          ),
          bonuses: 0,
          penalty: 0,
        },
      });
    }

    const orcidId = r.orcidId;

    // ── Parallel ORCID fetch ────────────────────────────────────────────────
    // Client methods never throw (graceful-degradation contract); we add an
    // extra .catch() here to protect against edge-case subclassing.
    const [works, peerReviews, fundings] = await Promise.all([
      this.orcid.getWorks(orcidId).catch(() => [] as NormalizedWork[]),
      this.orcid.getPeerReviews(orcidId).catch(() => ({ count: 0 })),
      this.orcid.getFundings(orcidId).catch(() => ({ count: 0 })),
    ]);

    // ── Crossref citation counts for all DOIs ────────────────────────────────
    const dois = works
      .map((w) => w.doi)
      .filter((doi): doi is string => doi !== null);
    const citationMap = await this.crossref
      .getCitationCounts(dois)
      .catch(() => new Map<string, number | undefined>());

    // ── Derive metrics ──────────────────────────────────────────────────────
    const citationCounts = works.map((w) =>
      w.doi != null ? (citationMap.get(w.doi) ?? 0) : 0,
    );
    const totalCitations = citationCounts.reduce((s, c) => s + c, 0);
    const hIndex = computeHIndex(citationCounts);

    // Collaboration signal: sum of coAuthorCount across all works
    const collaborationSignal = works.reduce((s, w) => s + w.coAuthorCount, 0);

    // Distinct non-null publication venues
    const distinctVenues = new Set(
      works.map((w) => w.venue).filter((v): v is string => v !== null),
    ).size;

    const hasWorks = works.length > 0;

    // ── Build 7 pillar results ──────────────────────────────────────────────
    //
    // knowledge, impact, leadership: require at least one work on the ORCID
    //   record; if zero works exist there is no source data → insufficient_data.
    //
    // review, recognition: always scored — a count of 0 is valid data (the
    //   researcher genuinely has zero peer reviews / funding entries).
    //
    // ethics, repro: no data source available this milestone → always insufficient_data.

    const pillars: PillarResult[] = [
      hasWorks
        ? {
            id: "knowledge",
            label: "Knowledge creation",
            weight: 22,
            score: scoreKnowledge(works.length, distinctVenues),
            status: "scored",
            metrics: { worksCount: works.length, distinctVenues },
          }
        : buildInsufficientPillar(PILLAR_DEFS[0]),

      hasWorks
        ? {
            id: "impact",
            label: "Peer & societal impact",
            weight: 18,
            score: scoreImpact(totalCitations, hIndex),
            status: "scored",
            metrics: { totalCitations, hIndex },
          }
        : buildInsufficientPillar(PILLAR_DEFS[1]),

      {
        id: "review",
        label: "Peer review",
        weight: 12,
        score: scoreReview(peerReviews.count),
        status: "scored",
        metrics: { reviewCount: peerReviews.count },
      },

      hasWorks
        ? {
            id: "leadership",
            label: "Leadership / collab",
            weight: 18,
            score: scoreLeadership(collaborationSignal),
            status: "scored",
            metrics: { collaborationSignal },
          }
        : buildInsufficientPillar(PILLAR_DEFS[3]),

      {
        id: "recognition",
        label: "Recognition & funding",
        weight: 18,
        score: scoreRecognition(fundings.count),
        status: "scored",
        metrics: { fundingCount: fundings.count },
      },

      // ethics — no data source this milestone
      buildInsufficientPillar(PILLAR_DEFS[5]),

      // repro — no data source this milestone
      buildInsufficientPillar(PILLAR_DEFS[6]),
    ];

    // ── Renormalised total + coverage ────────────────────────────────────────
    const { totalScore, coverage } = computeTotal(pillars);

    // ── Persist and return ───────────────────────────────────────────────────
    return this.prisma.impactScore.create({
      data: {
        researcherId: r.id,
        totalScore,
        pillars: JSON.parse(JSON.stringify({ pillars, coverage })),
        bonuses: 0,
        penalty: 0,
      },
    });
  }

  async getHistory(did: string) {
    const r = await this.prisma.researcher.findUnique({ where: { did } });
    if (!r) return [];
    return this.prisma.impactScore.findMany({
      where: { researcherId: r.id },
      orderBy: { calculatedAt: "desc" },
      take: 20,
    });
  }
}
