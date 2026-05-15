"use client";
import { useState } from "react";

const mono9 = { fontFamily: "var(--font-mono)", fontSize: "9px" as const, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--urid-ink4)" };

const claims = [
  { id: "age", label: "Age ≥ 18", proven: true },
  { id: "human", label: "Human", proven: true },
  { id: "affil-ucsf", label: "UCSF", proven: true },
  { id: "affil-hhmi", label: "HHMI", proven: true },
  { id: "tis-80", label: "TIS ≥ 80", proven: true },
  { id: "tis-50", label: "TIS ≥ 50", proven: true },
  { id: "sbt-rev", label: "Reviewer", proven: true },
  { id: "sbt-phd", label: "PhD", proven: true },
  { id: "cite-100", label: "Cites ≥ 100", proven: true },
  { id: "no-misc", label: "No misconduct", proven: true },
];

const apps = [
  { name: "Open Labbook", status: "ACTIVE", consents: { "affil-ucsf": "30d", "sbt-rev": "forever", "human": "forever", "no-misc": "forever" } },
  { name: "URPublisher", status: "ACTIVE", consents: { "sbt-rev": "forever", "tis-50": "forever", "human": "forever", "no-misc": "forever" } },
  { name: "Token Swap", status: "ACTIVE", consents: { "human": "forever", "age": "forever" } },
  { name: "VitaDAO", status: "ACTIVE", consents: { "sbt-rev": "30d", "tis-80": "30d", "human": "forever" } },
  { name: "ORCID", status: "ACTIVE", consents: { "sbt-phd": "forever" } },
  { name: "arXiv", status: "ACTIVE", consents: { "human": "forever" } },
  { name: "Cell Reports", status: "ACTIVE", consents: { "sbt-rev": "forever", "affil-ucsf": "30d", "no-misc": "forever" } },
  { name: "Anthropic Research", status: "PENDING", consents: {} },
];

const pendingRequest = {
  app: "Anthropic Research",
  message: "Wants to verify: TIS ≥ 80, human, no misconduct record",
  claims: ["tis-80", "human", "no-misc"],
  expiresIn: "5m 12s",
};

const auditLog = [
  { time: "08:42:18", app: "Cell Reports", claims: "affil-ucsf, sbt-rev", action: "reveal · prove", color: "var(--urid-ok)" },
  { time: "08:41:02", app: "VitaDAO", claims: "tis-80", action: "auto · cached", color: "var(--urid-ink4)" },
  { time: "08:38:14", app: "Anthropic", claims: "tis-80, human, no-misc", action: "pending", color: "var(--urid-warn)" },
  { time: "08:22:41", app: "Open Labbook", claims: "human, no-misc", action: "auto · cached", color: "var(--urid-ink4)" },
  { time: "07:58:33", app: "arXiv", claims: "human", action: "reveal · 1h", color: "var(--urid-ok)" },
  { time: "07:14:09", app: "URPublisher", claims: "sbt-rev, tis-50", action: "reveal · prove", color: "var(--urid-ok)" },
];

export default function ZkPermissionsPage() {
  const [consentWindow, setConsentWindow] = useState("24h");

  return (
    <div className="min-h-screen p-6" style={{ background: "var(--urid-paper)" }}>
      <div className="max-w-6xl mx-auto space-y-5">
        <div>
          <p style={mono9}>URID / ZK PERMISSIONS</p>
          <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "24px", marginTop: 4, color: "var(--urid-ink)" }}>Zero-Knowledge Permissions</h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--urid-ink3)" }}>Control which apps can verify your claims — without revealing your identity.</p>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 340px" }}>
          {/* Matrix */}
          <div className="border overflow-x-auto" style={{ borderColor: "var(--urid-rule)" }}>
            <table className="w-full text-[10px]" style={{ fontFamily: "var(--font-mono)" }}>
              <thead>
                <tr style={{ background: "rgba(14,14,16,0.03)" }}>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--urid-ink3)", width: 140, letterSpacing: "0.06em" }}>APP</th>
                  {claims.map(c => (
                    <th key={c.id} className="px-1.5 py-2 font-medium text-center" style={{ color: "var(--urid-ink4)", fontSize: "8px", letterSpacing: "0.04em", width: 60 }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apps.map(app => (
                  <tr key={app.name} className="border-t" style={{ borderColor: "rgba(14,14,16,0.06)" }}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px]" style={{ color: "var(--urid-ink)" }}>{app.name}</span>
                        <span className="px-1 py-0.5 text-[7px]" style={{
                          background: app.status === "ACTIVE" ? "oklch(0.72 0.13 155 / 0.1)" : "oklch(0.78 0.16 70 / 0.1)",
                          color: app.status === "ACTIVE" ? "var(--urid-ok)" : "var(--urid-warn)",
                        }}>{app.status}</span>
                      </div>
                    </td>
                    {claims.map(c => {
                      const consent = app.consents[c.id as keyof typeof app.consents];
                      return (
                        <td key={c.id} className="px-1 py-2 text-center">
                          {consent ? (
                            <span className="px-1.5 py-0.5 text-[8px]" style={{
                              background: consent === "forever" ? "oklch(0.72 0.13 155 / 0.08)" : "oklch(0.86 0.19 118 / 0.1)",
                              color: consent === "forever" ? "var(--urid-ok)" : "var(--urid-accent)",
                            }}>{consent}</span>
                          ) : app.status === "PENDING" && pendingRequest.claims.includes(c.id) ? (
                            <span className="px-1 py-0.5 text-[8px]" style={{ background: "oklch(0.78 0.16 70 / 0.1)", color: "var(--urid-warn)" }}>req</span>
                          ) : (
                            <span style={{ color: "rgba(14,14,16,0.1)" }}>·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Right — Pending + Health */}
          <div className="space-y-4">
            <div className="border p-4" style={{ borderColor: "var(--urid-warn)", background: "oklch(0.78 0.16 70 / 0.04)" }}>
              <div className="flex items-center justify-between mb-2">
                <p style={mono9}>● PENDING REQUEST</p>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--urid-warn)" }}>{pendingRequest.expiresIn}</span>
              </div>
              <p className="text-[13px] font-medium mb-1" style={{ color: "var(--urid-ink)" }}>{pendingRequest.app}</p>
              <p className="text-[11px] mb-3" style={{ color: "var(--urid-ink3)" }}>{pendingRequest.message}</p>
              <div className="space-y-1.5 mb-4">
                {pendingRequest.claims.map(c => {
                  const claim = claims.find(cl => cl.id === c);
                  return (
                    <div key={c} className="flex items-center justify-between px-2 py-1.5" style={{ background: "rgba(14,14,16,0.04)" }}>
                      <span className="text-[10px]" style={{ color: "var(--urid-ink2)" }}>{claim?.label}</span>
                      <span className="text-[9px]" style={{ fontFamily: "var(--font-mono)", color: "var(--urid-accent)" }}>PROVE</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-1.5 mb-3">
                {["1h", "24h", "30d", "Forever"].map(w => (
                  <button key={w} onClick={() => setConsentWindow(w.toLowerCase())}
                    className="flex-1 py-1.5 text-[9px] font-medium border cursor-pointer transition-colors"
                    style={{
                      fontFamily: "var(--font-mono)",
                      borderColor: consentWindow === w.toLowerCase() ? "var(--urid-ink)" : "var(--urid-rule)",
                      background: consentWindow === w.toLowerCase() ? "var(--urid-ink)" : "transparent",
                      color: consentWindow === w.toLowerCase() ? "var(--urid-paper)" : "var(--urid-ink3)",
                    }}>{w}</button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => alert("Rejected. Anthropic will be notified.")} className="flex-1 py-2 text-[11px] font-medium border cursor-pointer" style={{ borderColor: "var(--urid-rule)", color: "var(--urid-ink3)" }}>Reject</button>
                <button onClick={() => alert(`Proof signed and shared for ${consentWindow}.\nClaims: TIS≥80, human, no misconduct\nRecorded on UB-Chain.`)}
                  className="flex-1 py-2 text-[11px] font-medium cursor-pointer" style={{ background: "var(--urid-ink)", color: "var(--urid-paper)" }}>Sign & share for {consentWindow}</button>
              </div>
            </div>

            <div className="border p-4" style={{ borderColor: "var(--urid-rule)" }}>
              <p style={mono9} className="mb-2">PROOF HEALTH</p>
              <div className="grid grid-cols-2 gap-3">
                {[["GENERATED", "142"], ["APPS USING", "9"], ["FAILURES", "0"], ["EXPIRED (24h)", "3"]].map(([l, v]) => (
                  <div key={l}>
                    <p style={{ ...mono9, fontSize: "8px" }}>{l}</p>
                    <p style={{ fontFamily: "var(--font-mono)", fontSize: "14px", color: "var(--urid-ink)", marginTop: 2 }}>{v}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Audit log */}
        <div className="border p-4" style={{ borderColor: "var(--urid-rule)", background: "var(--urid-ink)", color: "var(--urid-paper)" }}>
          <p style={{ ...mono9, color: "rgba(255,255,255,0.4)" }} className="mb-2">AUDIT LOG · LIVE</p>
          {auditLog.map((e, i) => (
            <div key={i} className="grid items-center py-1.5 border-b" style={{ gridTemplateColumns: "70px 120px 1fr 100px", borderColor: "rgba(255,255,255,0.06)", fontFamily: "var(--font-mono)", fontSize: "10px" }}>
              <span style={{ color: "rgba(255,255,255,0.3)" }}>{e.time}</span>
              <span style={{ color: "rgba(255,255,255,0.7)" }}>{e.app}</span>
              <span style={{ color: "rgba(255,255,255,0.4)" }}>{e.claims}</span>
              <span style={{ color: e.color, textAlign: "right" }}>{e.action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
