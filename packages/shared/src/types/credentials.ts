export interface SoulboundToken { id: string; researcherId: string; credentialType: string; title: string; issuer: string; tone: string; issuedAt: string; revoked: boolean; onChainTxHash?: string; }
export type CredentialType = "EDUCATION" | "PUBLICATION" | "REVIEW" | "AWARD" | "CERTIFICATION" | "ORCID" | "AFFILIATION";
