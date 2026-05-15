export interface ImpactScore { totalScore: number; delta30d: number; pillars: ImpactPillar[]; }
export interface ImpactPillar { id: string; label: string; score: number; weight: number; sub: string; }
