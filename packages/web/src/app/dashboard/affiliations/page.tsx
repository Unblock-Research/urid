"use client";
export default function Page() {
  return (
    <div className="min-h-screen p-6" style={{ background: "var(--urid-paper)" }}>
      <div className="max-w-4xl mx-auto">
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--urid-ink4)" }}>URID / affiliations</p>
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "24px", marginTop: 4, color: "var(--urid-ink)" }}>affiliations</h1>
        <p className="text-[13px] mt-1" style={{ color: "var(--urid-ink3)" }}>View and manage your affiliations.</p>
        <div className="mt-6 border p-8 text-center" style={{ borderColor: "var(--urid-rule)" }}>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--urid-ink4)" }}>Full affiliations page coming soon</p>
        </div>
      </div>
    </div>
  );
}
