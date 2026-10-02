"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const profiles = [
  { id: "aarav", name: "Aarav Mehta", role: "Finance operator", initials: "AM" },
  { id: "priya", name: "Priya Nair", role: "Finance controller", initials: "PN" },
];

export default function LoginPage() {
  const router = useRouter();
  const [profile, setProfile] = useState(profiles[0]);
  const [showProfiles, setShowProfiles] = useState(false);
  function enterWorkspace() {
    sessionStorage.setItem("payrecon-session", JSON.stringify(profile));
    router.push("/reconciliation");
  }
  return <main className="loginPage"><div className="loginBackdrop"/><Link className="loginBrand" href="/"><svg viewBox="0 0 40 40" aria-hidden="true"><rect x="1" y="1" width="38" height="38" rx="11" fill="#2b83ea"/><path d="M11 13h12a5 5 0 0 1 0 10H16v5h-5V13Zm5 5v1h7a.5.5 0 0 0 0-1h-7Z" fill="white"/><path d="M22 13h6v4h-6zM22 23h6v5h-6z" fill="#b8dcff"/></svg><span>PayRecon<small>PAYMENTS OPERATIONS</small></span></Link>
    <section className="loginCard"><div className="loginIntro"><span className="loginGlyph">↔</span><div className="heroEyebrow"><i/> LOCAL WORKSPACE</div><h1>Welcome back</h1><p>Choose a local team profile to open the reconciliation workspace.</p></div><label className="fieldLabel">WORKSPACE</label><div className="loginWorkspace"><span className="workspaceAvatar">M</span><span><b>Meadow &amp; Moss</b><small>Merchant finance · INR</small></span><span className="workspaceChevron">⌄</span></div><label className="fieldLabel profileField">TEAM PROFILE</label><div className="profileSelectWrap"><button className="profileSelect" onClick={() => setShowProfiles(value => !value)} aria-expanded={showProfiles}><span className="profileAvatar">{profile.initials}</span><span><b>{profile.name}</b><small>{profile.role}</small></span><span className="workspaceChevron">⌄</span></button>{showProfiles && <div className="profileOptions">{profiles.map(item => <button key={item.id} onClick={() => { setProfile(item); setShowProfiles(false); }}><span className="profileAvatar">{item.initials}</span><span><b>{item.name}</b><small>{item.role}</small></span>{item.id === profile.id && <strong>✓</strong>}</button>)}</div>}</div><button className="loginSubmit" onClick={enterWorkspace}>Continue to workspace <span>→</span></button><div className="loginInfo"><span>i</span><p>Local access profile for this working prototype. Uploaded files are processed by your local app.</p></div><Link className="backToSite" href="/">← Back to PayRecon</Link></section><footer className="loginFooter">Independent local reconciliation workspace · Synthetic sample data available after sign-in</footer></main>;
}
