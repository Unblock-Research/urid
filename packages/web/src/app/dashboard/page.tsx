"use client";
import { useState } from "react";
import Link from "next/link";

const mono9 = { fontFamily: "var(--font-mono)", fontSize: "9px" as const, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--urid-ink4)" };
const serif = (s: number) => ({ fontFamily: "var(--font-serif)", fontSize: `${s}px`, lineHeight: "0.95", letterSpacing: "-0.02em", color: "var(--urid-ink)" });

const TABS = ["Identity", "Impact", "Credentials", "Connected Apps", "ZK Permissions", "Wallet", "Network"] as const;

const pillars = [
  { id: "knowledge", label: "Knowledge creation", score: 0.83, weight: 22, sub: "34 papers · 2.8K cites", delta: "+0.02" },
  { id: "impact", label: "Peer & societal impact", score: 0.72, weight: 18, sub: "Media coverage · policy", delta: "+0.05" },
  { id: "review", label: "Peer review", score: 0.78, weight: 12, sub: "142 reviews · Cell, Nature", delta: "+0.04" },
  { id: "leadership", label: "Leadership / collab", score: 0.69, weight: 18, sub: "4 mentees · 3 labs", delta: "-0.01" },
  { id: "recognition", label: "Recognition & funding", score: 0.81, weight: 18, sub: "Sloan · $1.2M grants", delta: "+0.03" },
  { id: "ethics", label: "Adaptability & ethics", score: 0.74, weight: 6, sub: "0 misconduct · 3 fields", delta: "0.00" },
  { id: "repro", label: "Reproducibility", score: 0.82, weight: 6, sub: "18 replicated · 0 refuted", delta: "+0.06" },
];

const events = [
  { kind: "sbt", actor: "Sloan Foundation", desc: "2026 Fellow badge issued", time: "12m", accent: true },
  { kind: "review", actor: "Cell Reports", desc: "Review accepted — revision recommended", time: "2h" },
  { kind: "cite", actor: "K. Yamada et al.", desc: "Cited your GABA-T paper", time: "6h" },
  { kind: "repro", actor: "RIKEN · T. Suzuki", desc: "Replicated tonic GABA result ✓", time: "1d", accent: true },
  { kind: "pay", actor: "NIH R01", desc: "Milestone 3 payout — 4,200 UBR", time: "2d" },
  { kind: "sbt", actor: "arXiv", desc: "Preprint indexed — 35th paper", time: "3d" },
];

const badges = [
  { tone: "default", code: "EDU", title: "Ph.D. Neuroscience", sub: "UCSF · 2019", issuer: "ORCID" },
  { tone: "info", code: "PUB", title: "34 Publications", sub: "2.8K citations", issuer: "arXiv" },
  { tone: "accent", code: "REV", title: "Reviewer of Record", sub: "Cell · Nature Neuro", issuer: "Crossref" },
  { tone: "ok", code: "AWARD", title: "Sloan Fellow 2022", sub: "Sloan Foundation", issuer: "Verified" },
  { tone: "default", code: "OSS", title: "openbrain Maintainer", sub: "1.2K stars", issuer: "GitHub" },
  { tone: "info", code: "AFFIL", title: "UCSF Asst. Prof", sub: "Neurology Dept", issuer: "UCSF" },
  { tone: "warn", code: "GRANT", title: "NIH R01 PI", sub: "$420K active", issuer: "NIH" },
  { tone: "default", code: "REPRO", title: "18 Replications", sub: "0 refuted", issuer: "UB-Chain" },
];

const TONE_COLORS: Record<string, string> = {
  default: "var(--urid-ink)", accent: "var(--urid-accent)", ok: "var(--urid-ok)", info: "var(--urid-info)", warn: "var(--urid-warn)",
};

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="min-h-screen" style={{ background: "var(--urid-paper)" }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 h-10 border-b" style={{ borderColor: "var(--urid-rule)", fontFamily: "var(--font-mono)", fontSize: "10px" }}>
        <div className="flex items-center gap-4">
          <span style={{ fontWeight: 600, color: "var(--urid-ink)", letterSpacing: "0.1em" }}>URID</span>
          <span style={{ color: "var(--urid-ink4)" }}>BLOCK 8,419,206 · ● ONLINE</span>
        </div>
        <div className="flex items-center gap-4" style={{ color: "var(--urid-ink4)" }}>
          <span>@malcolm.harriot</span>
          <span>8,420.18 UBR</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 px-6 border-b" style={{ borderColor: "var(--urid-rule)" }}>
        {TABS.map((t, i) => (
          <Link key={t} href={i === 4 ? "/dashboard/zk" : i === 5 ? "/dashboard/wallet" : i === 6 ? "/dashboard/network" : i === 2 ? "/dashboard/credentials" : i === 3 ? "#" : "#"}
            className="px-4 py-2.5 text-[12px] font-medium transition-colors"
            style={{ color: activeTab === i ? "var(--urid-ink)" : "var(--urid-ink4)", borderBottom: activeTab === i ? "2px solid var(--urid-accent)" : "2px solid transparent" }}
            onClick={() => setActiveTab(i)}>
            {t}
          </Link>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid gap-5 p-6" style={{ gridTemplateColumns: "380px 1fr 360px" }}>
        {/* LEFT — Identity */}
        <div className="space-y-4">
          <div className="p-5 border" style={{ borderColor: "var(--urid-rule)" }}>
            <div className="flex items-center gap-4 mb-4">
              <svg viewBox="0 0 80 80" width="72" height="72">
                <circle cx="40" cy="40" r="28" fill="none" stroke="var(--urid-ink)" strokeWidth="1" opacity="0.3" />
                <circle cx="40" cy="40" r="16" fill="none" stroke="var(--urid-ink)" strokeWidth="1" opacity="0.2" />
                <circle cx="40" cy="40" r="3" fill="var(--urid-ink)" />
                {Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return <line key={i} x1={40 + Math.cos(a) * 10} y1={40 + Math.sin(a) * 10} x2={40 + Math.cos(a) * 25} y2={40 + Math.sin(a) * 25} stroke="var(--urid-ink)" strokeWidth="0.6" opacity={0.15} />; })}
              </svg>
              <div>
                <p className="text-[16px] font-semibold" style={{ color: "var(--urid-ink)" }}>Dr. Malcolm A. Harriot</p>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--urid-ink3)" }}>@malcolm.harriot</p>
                <p className="mt-1 text-[11px]" style={{ color: "var(--urid-ink4)" }}>Asst. Prof · UCSF Weill Inst.</p>
              </div>
            </div>
            <div className="px-3 py-1.5 flex items-center gap-2 mb-4" style={{ background: "rgba(14,14,16,0.04)", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--urid-ink3)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--urid-accent)" }} />
              did:ub:0x4A92F2C3·B8F2A3FC2
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[["CITATIONS", "2,841"], ["REVIEWS", "142"], ["REPROS", "18"]].map(([l, v]) => (
                <div key={l}>
                  <p style={mono9}>{l}</p>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "16px", color: "var(--urid-ink)", marginTop: 2 }}>{v}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="p-4 border" style={{ borderColor: "var(--urid-rule)" }}>
            <div className="flex items-center justify-between">
              <p style={mono9}>WALLET</p>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--urid-ok)" }}>+412.40 · 7d</span>
            </div>
            <p style={serif(28)} className="mt-2">8,420.18 <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--urid-ink3)" }}>UBR</span></p>
          </div>
          <div className="p-3 text-[11px]" style={{ background: "rgba(14,14,16,0.04)", color: "var(--urid-ink3)" }}>
            <span style={mono9}>RECOVERY</span><br />5 of 7 guardians healthy
          </div>
        </div>

        {/* CENTER — Impact + Badges */}
        <div className="space-y-4">
          <div className="p-5 border" style={{ borderColor: "var(--urid-rule)" }}>
            <div className="flex items-center justify-between mb-4">
              <p style={mono9}>TRUE IMPACT SCORE · V3</p>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--urid-accent)" }}>+2.1 · 30d</span>
            </div>
            <div className="flex items-end gap-6 mb-6">
              <span style={serif(64)}>84.2</span>
              <div className="pb-2">
                <svg width="180" height="48" viewBox="0 0 180 48">
                  <polyline fill="none" stroke="var(--urid-ink)" strokeWidth="1.5"
                    points={[72,74,73,76,78,80,79,82,84,85,84.2].map((v, i) => `${i * 18},${48 - ((v - 70) / 16) * 44}`).join(" ")} />
                </svg>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--urid-ink4)", letterSpacing: "0.1em", marginTop: 2 }}>11-MONTH TREND</p>
              </div>
            </div>
            <p style={mono9} className="mb-1">RANK #241 / 18,402 RESEARCHERS</p>
            <div className="space-y-2 mt-4">
              {pillars.map(p => (
                <div key={p.id} className="grid items-center gap-3" style={{ gridTemplateColumns: "160px 1fr 40px 40px" }}>
                  <div>
                    <span className="text-[11px]" style={{ color: "var(--urid-ink3)" }}>{p.label}</span>
                  </div>
                  <div style={{ height: 4, background: "rgba(14,14,16,0.06)" }}>
                    <div style={{ width: `${p.score * 100}%`, height: "100%", background: "var(--urid-ink)" }} />
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--urid-ink)", textAlign: "right" }}>{(p.score * 100).toFixed(0)}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: p.delta.startsWith("+") ? "var(--urid-ok)" : "var(--urid-ink4)", textAlign: "right" }}>{p.delta}</span>
                </div>
              ))}
            </div>
          </div>
          {/* SBT Badges */}
          <div className="p-4 border" style={{ borderColor: "var(--urid-rule)" }}>
            <div className="flex items-center justify-between mb-3">
              <p style={mono9}>SOULBOUND CREDENTIALS</p>
              <Link href="/dashboard/credentials" style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--urid-accent)" }}>VIEW ALL 24 →</Link>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {badges.map((b, i) => (
                <div key={i} className="border p-2.5" style={{ borderColor: "var(--urid-rule)", borderTop: `3px solid ${TONE_COLORS[b.tone]}` }}>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "8px", color: TONE_COLORS[b.tone], letterSpacing: "0.06em" }}>{b.code}</p>
                  <p className="text-[11px] font-medium mt-1" style={{ color: "var(--urid-ink)" }}>{b.title}</p>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--urid-ink4)", marginTop: 2 }}>{b.sub}</p>
                  <p className="mt-2 flex items-center gap-1" style={{ fontFamily: "var(--font-mono)", fontSize: "8px", color: "var(--urid-ink4)" }}>
                    <span className="w-1 h-1 rounded-full" style={{ background: "var(--urid-ok)" }} /> {b.issuer}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — Events + Apps */}
        <div className="space-y-4">
          <div className="border p-4" style={{ borderColor: "var(--urid-rule)" }}>
            <p style={mono9} className="mb-3">LAST 7 DAYS</p>
            {events.map((e, i) => (
              <div key={i} className="flex items-start gap-2.5 py-2 border-b border-[rgba(14,14,16,0.06)] last:border-0">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5" style={{ background: e.accent ? "var(--urid-accent)" : "var(--urid-rule)" }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px]"><span className="font-medium" style={{ color: "var(--urid-ink)" }}>{e.actor}</span> <span style={{ color: "var(--urid-ink3)" }}>{e.desc}</span></p>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--urid-ink4)" }}>{e.time}</span>
              </div>
            ))}
          </div>
          <div className="border p-4" style={{ borderColor: "var(--urid-rule)" }}>
            <p style={mono9} className="mb-3">CONNECTED APPS</p>
            {["Open Labbook", "URPublisher", "Token Swap", "VitaDAO", "ORCID", "arXiv", "GitHub", "Anthropic"].map((app, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-[rgba(14,14,16,0.06)] last:border-0">
                <span className="text-[11px]" style={{ color: "var(--urid-ink2)" }}>{app}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: i < 7 ? "var(--urid-ok)" : "var(--urid-warn)" }}>
                  {i < 7 ? "ON" : "PENDING"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
