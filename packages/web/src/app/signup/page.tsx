"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const mono9 = { fontFamily: "var(--font-mono)", fontSize: "9px" as const, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--urid-ink4)" };
const API = "http://localhost:3001";
const CHAIN = "http://localhost:9000";

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

const STEPS = ["Handle & DID", "Key Generation", "Recovery Shards", "SBT Import", "Connect Accounts", "Web3 Wallets", "Affiliations", "AI Twin", "Complete"];

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [handle, setHandle] = useState("malcolm.harriot");
  const [handleAvailable, setHandleAvailable] = useState(true);
  const [did, setDid] = useState("");
  const [selectedCreds, setSelectedCreds] = useState<Set<number>>(new Set([0, 1, 2, 3]));
  const [connectedAccounts, setConnectedAccounts] = useState<Set<string>>(new Set(["orcid", "github", "arxiv", "email"]));
  const [connectedWallets, setConnectedWallets] = useState<Set<string>>(new Set(["metamask"]));
  const [twinScopes, setTwinScopes] = useState<Record<string, boolean>>({ papers: true, reviews: true, citations: true, repos: false, spend: false });

  const guardians = [
    { name: "Aria M. (sister)", kind: "Personal", status: "SENT" },
    { name: "UCSF Weill IT", kind: "Institutional", status: "SENT" },
    { name: "iPhone 15 Pro", kind: "Device", status: "SEALED" },
    { name: "Ledger Nano X", kind: "Device", status: "SEALED" },
    { name: "unblock.foundation", kind: "Federated", status: "PENDING" },
    { name: "r.tanaka.eth", kind: "Peer", status: "PENDING" },
    { name: "orcid.org/0000-…", kind: "External", status: "PENDING" },
  ];

  const credentials = [
    { type: "EDUCATION", source: "ORCID", title: "Ph.D. Neuroscience · UCSF · 2019", verified: true },
    { type: "PUBLICATION", source: "arXiv", title: "34 papers, 2,841 citations", verified: true },
    { type: "OPEN-SOURCE", source: "GitHub", title: "Maintainer · openbrain · 1.2k★", verified: true },
    { type: "REVIEW", source: "Crossref", title: "Reviewer-of-record · Cell, Nature Neuro", verified: true },
    { type: "AWARD", source: "Sloan Found.", title: "2022 Sloan Research Fellow", verified: false },
  ];

  const accounts = [
    { id: "orcid", name: "ORCID", detail: "0000-0002-1825-0097" },
    { id: "github", name: "GitHub", detail: "@malcolm-h" },
    { id: "arxiv", name: "arXiv", detail: "arxiv.harriot.m" },
    { id: "email", name: "Email", detail: "malcolm@ucsf.edu" },
    { id: "researchhub", name: "ResearchHub", detail: null },
    { id: "crossref", name: "Crossref", detail: null },
    { id: "openalex", name: "OpenAlex", detail: null },
    { id: "ledger", name: "Ledger", detail: null },
  ];

  const wallets = [
    { id: "metamask", name: "MetaMask", chain: "Ethereum", address: "0x4f9a·c12b…2173", primary: true },
    { id: "trust", name: "Trust Wallet", chain: "ETH · BNB", address: "0x8d21·a04e…f8ec", primary: false },
    { id: "rainbow", name: "Rainbow", chain: null, address: null },
    { id: "coinbase", name: "Coinbase Wallet", chain: null, address: null },
    { id: "phantom", name: "Phantom", chain: null, address: null },
    { id: "walletconnect", name: "WalletConnect", chain: null, address: null },
  ];

  async function checkHandle(h: string) {
    setHandle(h);
    setHandleAvailable(h.length >= 3 && !h.includes(" "));
    if (h.length >= 3) {
      const hash = Array.from(h).reduce((a, c) => a + c.charCodeAt(0), 0).toString(16);
      setDid("did:ub:0x" + hash.padStart(8, "0").toUpperCase() + "·" + hash.slice(0, 8).toUpperCase());
    }
  }

  function next() { if (step < 9) setStep((step + 1) as Step); }
  function back() { if (step > 1) setStep((step - 1) as Step); }

  const inputCls = "w-full px-4 py-3 text-[14px] border outline-none transition-colors focus:border-[var(--urid-ink3)]";
  const inputStyle = { borderColor: "var(--urid-rule)", background: "var(--urid-paper)", color: "var(--urid-ink)", fontFamily: "var(--font-sans)" };

  return (
    <div className="min-h-screen flex" style={{ background: "var(--urid-paper)" }}>
      {/* Left — step info */}
      <div className="w-[420px] shrink-0 p-10 flex flex-col justify-between border-r" style={{ borderColor: "var(--urid-rule)" }}>
        <div>
          <p style={mono9}>STEP {String(step).padStart(2, "0")} OF 09</p>
          <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "32px", lineHeight: 1.1, letterSpacing: "-0.02em", color: "var(--urid-ink)", marginTop: 12 }}>
            {STEPS[step - 1]}
          </h2>
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: "var(--urid-ink3)" }}>
            {step === 1 && "Pick a handle. Own the address it resolves to. Your handle is your public name on the Unblock Research network."}
            {step === 2 && "Your keys are generated locally and never leave your device. The public key becomes your DID."}
            {step === 3 && "Split your recovery key across 7 trusted guardians. Any 5 can restore your identity."}
            {step === 4 && "We found credentials from your connected accounts. Select which to mint as Soulbound Tokens."}
            {step === 5 && "Link your academic and professional accounts for verified attestations."}
            {step === 6 && "Connect your Web3 wallets for UBR token management and on-chain operations."}
            {step === 7 && "Request verification of your institutional affiliations and roles."}
            {step === 8 && "Authorize an AI Twin to assist with research tasks within defined scopes."}
            {step === 9 && "Your URID is minted. Welcome to the Unblock Research network."}
          </p>
        </div>
        {/* Step dots */}
        <div className="flex gap-1.5">
          {STEPS.map((_, i) => (
            <div key={i} className="h-1.5 rounded-full transition-all" style={{
              width: i + 1 === step ? 22 : 6,
              background: i + 1 < step ? "var(--urid-ink)" : i + 1 === step ? "var(--urid-accent)" : "var(--urid-rule)",
            }} />
          ))}
        </div>
      </div>

      {/* Right — step content */}
      <div className="flex-1 p-10 overflow-y-auto">
        <div className="max-w-xl">

          {/* STEP 1: Handle */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label style={mono9} className="block mb-2">YOUR HANDLE</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[14px]" style={{ color: "var(--urid-ink4)" }}>@</span>
                  <input value={handle} onChange={e => checkHandle(e.target.value)} className={inputCls} style={{ ...inputStyle, paddingLeft: 32 }} />
                </div>
                {handleAvailable && handle.length >= 3 && (
                  <p className="mt-2 flex items-center gap-1.5" style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--urid-ok)" }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--urid-ok)" }} /> AVAILABLE
                  </p>
                )}
              </div>
              {did && (
                <div>
                  <label style={mono9} className="block mb-2">YOUR DID (DECENTRALIZED IDENTIFIER)</label>
                  <div className="px-4 py-3 flex items-center gap-2" style={{ background: "rgba(14,14,16,0.04)", fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--urid-ink3)" }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: "var(--urid-accent)" }} />
                    {did}
                  </div>
                </div>
              )}
              <div>
                <label style={mono9} className="block mb-2">SUGGESTIONS</label>
                <div className="grid grid-cols-2 gap-2">
                  {["malcolm.harriot", "m.harriot.eth", "harriot.lab", "malcolm.h.ucsf"].map(s => (
                    <button key={s} onClick={() => checkHandle(s)}
                      className="px-3 py-2 text-[12px] text-left border cursor-pointer transition-colors hover:bg-[rgba(14,14,16,0.03)]"
                      style={{ borderColor: handle === s ? "var(--urid-ink)" : "var(--urid-rule)", color: "var(--urid-ink3)", fontFamily: "var(--font-mono)" }}>
                      @{s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Key Generation */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="flex justify-center py-8">
                <svg viewBox="0 0 200 200" width="180" height="180">
                  <circle cx="100" cy="100" r="60" fill="none" stroke="var(--urid-accent)" strokeWidth="1.5" opacity="0.4" />
                  <circle cx="100" cy="100" r="40" fill="none" stroke="var(--urid-ink)" strokeWidth="1" opacity="0.3" />
                  <circle cx="100" cy="100" r="20" fill="none" stroke="var(--urid-ink)" strokeWidth="1.5" opacity="0.5" />
                  <circle cx="100" cy="100" r="5" fill="var(--urid-ink)" />
                  {Array.from({ length: 16 }, (_, i) => {
                    const a = (i / 16) * Math.PI * 2;
                    return <line key={i} x1={100 + Math.cos(a) * 25} y1={100 + Math.sin(a) * 25} x2={100 + Math.cos(a) * 55} y2={100 + Math.sin(a) * 55} stroke="var(--urid-ink)" strokeWidth="0.8" opacity={0.2} />;
                  })}
                </svg>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[["CURVE", "Ed25519 / Curve25519"], ["STORAGE", "Device secure enclave"], ["ZK CIRCUITS", "Groth16 · 12 supported"], ["STATUS", "● GENERATED · LOCAL"]].map(([l, v]) => (
                  <div key={l} className="p-3 border" style={{ borderColor: "var(--urid-rule)" }}>
                    <p style={mono9}>{l}</p>
                    <p className="mt-1 text-[12px]" style={{ color: "var(--urid-ink2)", fontFamily: "var(--font-mono)" }}>{v}</p>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 flex items-center gap-2" style={{ background: "rgba(14,14,16,0.04)", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--urid-ink3)" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: "var(--urid-accent)" }} /> {did || "did:ub:0x4A92F2C3·B8F2A3FC2"}
              </div>
            </div>
          )}

          {/* STEP 3: Recovery Shards */}
          {step === 3 && (
            <div className="space-y-4">
              {guardians.map((g, i) => (
                <div key={i} className="flex items-center justify-between p-3 border" style={{ borderColor: "var(--urid-rule)" }}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold" style={{ background: "var(--urid-ink)", color: "var(--urid-paper)", fontFamily: "var(--font-mono)" }}>{i + 1}</div>
                    <div>
                      <p className="text-[12px] font-medium" style={{ color: "var(--urid-ink)" }}>{g.name}</p>
                      <p style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--urid-ink4)" }}>{g.kind}</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 text-[9px] font-medium" style={{
                    fontFamily: "var(--font-mono)",
                    background: g.status === "SEALED" ? "oklch(0.72 0.13 155 / 0.1)" : g.status === "SENT" ? "oklch(0.66 0.13 240 / 0.1)" : "rgba(14,14,16,0.05)",
                    color: g.status === "SEALED" ? "var(--urid-ok)" : g.status === "SENT" ? "var(--urid-info)" : "var(--urid-ink4)",
                  }}>{g.status}</span>
                </div>
              ))}
              <div className="p-3 text-[11px] leading-relaxed" style={{ background: "rgba(14,14,16,0.04)", color: "var(--urid-ink3)" }}>
                <strong>Recovery quorum:</strong> any 5 of 7 guardians signing the same recovery challenge reissues your URID. Adding more guardians is recommended.
              </div>
            </div>
          )}

          {/* STEP 4: SBT Import */}
          {step === 4 && (
            <div className="space-y-3">
              <p style={mono9}>FOUND · {credentials.length} CREDENTIALS · {selectedCreds.size} SELECTED</p>
              {credentials.map((c, i) => (
                <label key={i} className="flex items-center gap-3 p-3 border cursor-pointer transition-colors hover:bg-[rgba(14,14,16,0.02)]" style={{ borderColor: selectedCreds.has(i) ? "var(--urid-ink)" : "var(--urid-rule)" }}>
                  <input type="checkbox" checked={selectedCreds.has(i)} onChange={() => {
                    const next = new Set(selectedCreds);
                    next.has(i) ? next.delete(i) : next.add(i);
                    setSelectedCreds(next);
                  }} className="accent-[var(--urid-ink)]" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 text-[8px] font-semibold" style={{ fontFamily: "var(--font-mono)", background: "rgba(14,14,16,0.06)", color: "var(--urid-ink3)" }}>{c.type}</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--urid-ink4)" }}>FROM {c.source}</span>
                    </div>
                    <p className="mt-1 text-[12px]" style={{ color: "var(--urid-ink)" }}>{c.title}</p>
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: c.verified ? "var(--urid-ok)" : "var(--urid-ink4)" }}>
                    {c.verified ? "● VERIFIED" : "○ NEEDS PROOF"}
                  </span>
                </label>
              ))}
            </div>
          )}

          {/* STEP 5: Connect Accounts */}
          {step === 5 && (
            <div className="grid grid-cols-2 gap-3">
              {accounts.map(a => (
                <div key={a.id} className="p-3 border flex items-center justify-between" style={{ borderColor: connectedAccounts.has(a.id) ? "var(--urid-ink)" : "var(--urid-rule)" }}>
                  <div>
                    <p className="text-[12px] font-medium" style={{ color: "var(--urid-ink)" }}>{a.name}</p>
                    {a.detail && <p style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--urid-ink4)" }}>{a.detail}</p>}
                  </div>
                  {connectedAccounts.has(a.id) ? (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--urid-ok)" }}>● LINKED</span>
                  ) : (
                    <button onClick={() => setConnectedAccounts(new Set([...connectedAccounts, a.id]))}
                      className="px-2 py-1 text-[9px] font-medium cursor-pointer" style={{ fontFamily: "var(--font-mono)", color: "var(--urid-accent)" }}>+ LINK</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* STEP 6: Web3 Wallets */}
          {step === 6 && (
            <div className="space-y-4">
              <div className="p-4 border" style={{ background: "var(--urid-ink)", color: "var(--urid-paper)", borderColor: "var(--urid-ink)" }}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "9px", letterSpacing: "0.12em", opacity: 0.5 }}>NATIVE · UB-CHAIN WALLET</p>
                <p style={{ fontFamily: "var(--font-serif)", fontSize: "28px", marginTop: 8 }}>0.00 <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", opacity: 0.5 }}>UBR</span></p>
                <p className="mt-2 text-[11px]" style={{ opacity: 0.5 }}>Spawned by your DID · co-signed with hardware on critical actions</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {wallets.map(w => (
                  <div key={w.id} className="p-3 border" style={{ borderColor: connectedWallets.has(w.id) ? "var(--urid-ink)" : "var(--urid-rule)" }}>
                    <p className="text-[12px] font-medium" style={{ color: "var(--urid-ink)" }}>{w.name}</p>
                    {w.address ? (
                      <p style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--urid-ink4)" }}>{w.address} · {w.chain}</p>
                    ) : (
                      <button onClick={() => setConnectedWallets(new Set([...connectedWallets, w.id]))}
                        className="mt-1 text-[9px] font-medium cursor-pointer" style={{ fontFamily: "var(--font-mono)", color: "var(--urid-accent)" }}>+ CONNECT</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 7: Affiliations */}
          {step === 7 && (
            <div className="space-y-3">
              {[
                { org: "UCSF Weill Institute", role: "Asst. Prof · Neurology", via: "email · ucsf.edu", status: "AUTO-VERIFIED", tone: "ok" },
                { org: "Howard Hughes Medical Inst.", role: "Investigator (2024–)", via: "email", status: "AWAITING", tone: "warn" },
                { org: "Anthropic", role: "Visiting Researcher", via: "invitation", status: "AWAITING", tone: "warn" },
              ].map((a, i) => (
                <div key={i} className="p-3 border flex items-center justify-between" style={{ borderColor: "var(--urid-rule)" }}>
                  <div>
                    <p className="text-[12px] font-medium" style={{ color: "var(--urid-ink)" }}>{a.org}</p>
                    <p style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--urid-ink3)" }}>{a.role}</p>
                  </div>
                  <span className="px-2 py-0.5 text-[9px] font-medium" style={{
                    fontFamily: "var(--font-mono)",
                    color: a.tone === "ok" ? "var(--urid-ok)" : "var(--urid-warn)",
                    background: a.tone === "ok" ? "oklch(0.72 0.13 155 / 0.1)" : "oklch(0.78 0.16 70 / 0.1)",
                  }}>{a.status}</span>
                </div>
              ))}
              <button className="w-full p-3 border-2 border-dashed text-[11px] font-medium cursor-pointer hover:bg-[rgba(14,14,16,0.02)]"
                style={{ borderColor: "var(--urid-rule)", color: "var(--urid-ink3)" }}
                onClick={() => alert("Request form: enter organization domain, select role, send signed claim")}>
                + Request another role
              </button>
            </div>
          )}

          {/* STEP 8: AI Twin */}
          {step === 8 && (
            <div className="space-y-4">
              <div className="p-4 border" style={{ background: "var(--urid-ink)", color: "var(--urid-paper)", borderColor: "var(--urid-ink)" }}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.1em", opacity: 0.5 }}>twin:malcolm.harriot</p>
                <p style={{ fontFamily: "var(--font-serif)", fontSize: "20px", marginTop: 6 }}>m.harriot.twin</p>
                <p className="mt-2 text-[10px]" style={{ fontFamily: "var(--font-mono)", opacity: 0.4 }}>BONDED · 50 UBR · SLASHABLE</p>
              </div>
              {[
                { key: "papers", label: "Read my papers + reviews", desc: "Twin can access your publication history and review records" },
                { key: "reviews", label: "Draft review responses", desc: "Twin can prepare review drafts for your approval" },
                { key: "citations", label: "Auto-suggest citations", desc: "Twin monitors new papers and suggests relevant citations" },
                { key: "repos", label: "Search private repositories", desc: "Twin can search your private labbook data" },
                { key: "spend", label: "Spend up to 50 UBR/week autonomously", desc: "Twin can initiate small transactions without approval" },
              ].map(s => (
                <div key={s.key} className="flex items-center justify-between p-3 border" style={{ borderColor: "var(--urid-rule)" }}>
                  <div className="flex-1 mr-4">
                    <p className="text-[12px] font-medium" style={{ color: "var(--urid-ink)" }}>{s.label}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--urid-ink4)" }}>{s.desc}</p>
                  </div>
                  <button onClick={() => setTwinScopes({ ...twinScopes, [s.key]: !twinScopes[s.key] })}
                    className="w-10 h-5 rounded-full relative cursor-pointer transition-colors"
                    style={{ background: twinScopes[s.key] ? "var(--urid-ink)" : "var(--urid-rule)" }}>
                    <div className="w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-transform"
                      style={{ left: twinScopes[s.key] ? "calc(100% - 17px)" : "3px" }} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* STEP 9: Complete */}
          {step === 9 && (
            <div className="space-y-6">
              <div className="p-6 text-center" style={{ background: "var(--urid-ink)", color: "var(--urid-paper)" }}>
                <p style={{ fontFamily: "var(--font-serif)", fontSize: "28px" }}>Welcome, Malcolm.</p>
                <p className="mt-2 text-[12px]" style={{ opacity: 0.6 }}>Your URID has been minted on UB-Chain.</p>
                <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5" style={{ background: "rgba(255,255,255,0.08)", fontFamily: "var(--font-mono)", fontSize: "10px" }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: "var(--urid-accent)" }} />
                  {did || "did:ub:0x4A92F2C3·B8F2A3FC2"}
                </div>
              </div>
              <div className="space-y-2">
                {[
                  "Review your soulbound badges",
                  "Open a research notebook on URLabbook",
                  "Set ZK permissions for your identity",
                  "Explore the researcher network",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 border cursor-pointer hover:bg-[rgba(14,14,16,0.02)]" style={{ borderColor: "var(--urid-rule)" }}
                    onClick={() => router.push("/dashboard")}>
                    <span className="w-5 h-5 flex items-center justify-center text-[10px]" style={{ fontFamily: "var(--font-mono)", color: "var(--urid-ink4)" }}>{i + 1}</span>
                    <span className="text-[12px]" style={{ color: "var(--urid-ink)" }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex justify-between mt-8 pt-6 border-t" style={{ borderColor: "var(--urid-rule)" }}>
            {step > 1 ? (
              <button onClick={back} className="px-4 py-2 text-[12px] font-medium cursor-pointer" style={{ color: "var(--urid-ink3)" }}>← Back</button>
            ) : <div />}
            {step < 9 ? (
              <button onClick={next} className="px-6 py-2.5 text-[12px] font-semibold cursor-pointer" style={{ background: "var(--urid-ink)", color: "var(--urid-paper)" }}>
                {step === 4 ? `Mint ${selectedCreds.size} selected →` : step === 8 ? "Authorise Twin →" : "Continue →"}
              </button>
            ) : (
              <button onClick={() => router.push("/dashboard")} className="px-6 py-2.5 text-[12px] font-semibold cursor-pointer" style={{ background: "var(--urid-accent)", color: "var(--urid-ink)" }}>
                Enter Dashboard →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
