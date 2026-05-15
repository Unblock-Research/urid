export interface ZkProof { id: string; appName: string; claims: ZkClaim[]; consentWindow: string; proofHash: string; status: string; }
export interface ZkClaim { id: string; label: string; proven: boolean; scope: "reveal" | "hide"; }
