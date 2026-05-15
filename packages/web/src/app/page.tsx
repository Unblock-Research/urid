"use client";
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--urid-paper)" }}>
      <div className="max-w-4xl w-full px-8 grid grid-cols-2 gap-16 items-center">
        {/* Left — copy */}
        <div>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--urid-ink4)", marginBottom: 16 }}>
            UNIVERSAL RESEARCHER IDENTITY
          </p>
          <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "42px", lineHeight: 1.05, letterSpacing: "-0.02em", color: "var(--urid-ink)", marginBottom: 16 }}>
            Identity, reputation, and wallet — finally one thing.
          </h1>
          <p style={{ fontSize: "15px", lineHeight: 1.6, color: "var(--urid-ink3)", marginBottom: 32 }}>
            Own your research identity with a decentralized identifier, soulbound credentials,
            zero-knowledge proofs, and a true multi-dimensional impact score — all in one place.
          </p>
          <div className="flex gap-3 mb-8">
            <Link href="/signup"
              className="px-6 py-3 text-[13px] font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--urid-ink)", color: "var(--urid-paper)" }}>
              Claim your URID
            </Link>
            <Link href="/dashboard"
              className="px-6 py-3 text-[13px] font-medium border transition-colors hover:bg-[rgba(14,14,16,0.04)]"
              style={{ borderColor: "var(--urid-rule)", color: "var(--urid-ink3)" }}>
              I already have one
            </Link>
          </div>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "9px", letterSpacing: "0.1em", color: "var(--urid-ink4)" }}>
            ~4 MINUTES · NO PASSWORD · NO EMAIL REQUIRED · DID + SBT + ZK
          </p>
          <div className="flex gap-4 mt-6">
            {["ORCID", "arXiv", "GitHub", "OpenAIRE", "Crossref"].map(s => (
              <span key={s} style={{ fontFamily: "var(--font-mono)", fontSize: "9px", letterSpacing: "0.06em", color: "var(--urid-ink4)" }}>{s}</span>
            ))}
          </div>
        </div>

        {/* Right — URID Glyph */}
        <div className="flex items-center justify-center">
          <div className="relative" style={{ width: 320, height: 320 }}>
            {/* Corner brackets */}
            {[{ t: 0, l: 0 }, { t: 0, r: 0 }, { b: 0, l: 0 }, { b: 0, r: 0 }].map((pos, i) => (
              <div key={i} className="absolute w-8 h-8" style={{ ...pos as any, borderColor: "var(--urid-accent)", borderWidth: 2, borderStyle: "solid",
                borderTop: pos.t !== undefined ? "2px solid var(--urid-accent)" : "none",
                borderBottom: pos.b !== undefined ? "2px solid var(--urid-accent)" : "none",
                borderLeft: pos.l !== undefined ? "2px solid var(--urid-accent)" : "none",
                borderRight: pos.r !== undefined ? "2px solid var(--urid-accent)" : "none",
              }} />
            ))}
            {/* Mandala glyph */}
            <svg viewBox="0 0 200 200" className="w-full h-full p-12">
              <circle cx="100" cy="100" r="60" fill="none" stroke="var(--urid-ink)" strokeWidth="1" opacity="0.3" />
              <circle cx="100" cy="100" r="40" fill="none" stroke="var(--urid-ink)" strokeWidth="1" opacity="0.2" />
              <circle cx="100" cy="100" r="20" fill="none" stroke="var(--urid-ink)" strokeWidth="1.5" opacity="0.4" />
              <circle cx="100" cy="100" r="4" fill="var(--urid-ink)" />
              {Array.from({ length: 16 }, (_, i) => {
                const angle = (i / 16) * Math.PI * 2;
                const x1 = 100 + Math.cos(angle) * 25;
                const y1 = 100 + Math.sin(angle) * 25;
                const x2 = 100 + Math.cos(angle) * 55;
                const y2 = 100 + Math.sin(angle) * 55;
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--urid-ink)" strokeWidth="0.8" opacity={0.15 + (i % 3) * 0.1} />;
              })}
            </svg>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 flex items-center gap-2" style={{ background: "rgba(14,14,16,0.04)", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--urid-ink3)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--urid-accent)" }} />
              did:ub:0x4A92F2C3·B8F2A3FC2
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
