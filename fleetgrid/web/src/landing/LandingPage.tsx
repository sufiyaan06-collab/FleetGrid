import { useState } from "react";
import { useFleet } from "../store/FleetContext";
import { Logo } from "./components/ui";

const links = [
  { label: "Platform", href: "#platform" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Who it's for", href: "#network" },
];

function Arrow() {
  return <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4"><path d="M4 10h11m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Check() {
  return <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">✓</span>;
}

export default function LandingPage() {
  const { setMode } = useFleet();
  const [menuOpen, setMenuOpen] = useState(false);
  const go = (mode: 'LOGIN' | 'REGISTER', portal?: 'BUSINESS' | 'DRIVER' | 'CONTROL_TOWER') => {
    setMenuOpen(false);
    if (mode === 'LOGIN' && portal) window.history.replaceState({}, document.title, '/?portal=' + portal);
    else window.history.replaceState({}, document.title, window.location.pathname);
    void setMode(mode);
  };

  return (
    <div className="fg-landing min-h-screen overflow-hidden bg-[#080f1d] text-slate-100">
      <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#080f1d]/90 backdrop-blur-xl">
        <nav className="mx-auto flex h-[76px] max-w-[1240px] items-center justify-between px-5 sm:px-8" aria-label="Main navigation">
          <Logo className="text-white" />
          <div className="hidden items-center gap-9 md:flex">
            {links.map((link) => <a key={link.href} href={link.href} className="text-[13px] font-medium text-slate-400 transition hover:text-white">{link.label}</a>)}
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <button onClick={() => go('LOGIN', 'BUSINESS')} className="rounded-lg px-4 py-2.5 text-[13px] font-semibold text-slate-300 transition hover:text-white">Shipper sign in</button>
            <button onClick={() => go('LOGIN', 'DRIVER')} className="rounded-lg border border-white/15 px-4 py-2.5 text-[13px] font-semibold text-emerald-200 transition hover:border-emerald-300/40 hover:bg-emerald-300/[0.06]" >Driver sign in</button>
            <button onClick={() => go('LOGIN', 'CONTROL_TOWER')} className="rounded-lg border border-emerald-300/25 px-4 py-2.5 text-[13px] font-semibold text-emerald-200 transition hover:border-emerald-300/45 hover:bg-emerald-300/[0.06]">Administrator sign in</button>
            <button onClick={() => go('REGISTER')} className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-400 px-4 text-[13px] font-bold text-[#062018] shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-300">Get started <Arrow /></button>
          </div>
          <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-slate-200 md:hidden">
            {menuOpen ? "✕" : "☰"}
          </button>
        </nav>
        {menuOpen && <div className="border-t border-white/[0.08] bg-[#0b1525] px-5 py-5 md:hidden">
          <div className="flex flex-col gap-4">{links.map((link) => <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="text-sm text-slate-300">{link.label}</a>)}</div>
          <div className="mt-5 flex gap-3">
            <button onClick={() => go('LOGIN', 'BUSINESS')} className="h-11 flex-1 rounded-lg border border-white/15 text-sm font-semibold">Shipper sign in</button>
            <button onClick={() => go('LOGIN', 'DRIVER')} className="h-11 flex-1 rounded-lg border border-emerald-300/30 text-sm font-semibold text-emerald-200">Driver sign in</button>
            <button onClick={() => go('LOGIN', 'CONTROL_TOWER')} className="h-11 flex-[1.4] rounded-lg bg-emerald-400 text-sm font-bold text-[#062018]">Admin sign in</button>
          </div>
        </div>}
      </header>

      <main>
        <section className="relative isolate">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{background:"radial-gradient(ellipse 55% 55% at 78% 28%, rgba(16,185,129,.13), transparent 70%), radial-gradient(ellipse 40% 50% at 8% 8%, rgba(59,130,246,.10), transparent 75%)"}} />
          <div className="mx-auto grid max-w-[1240px] items-center gap-14 px-5 pb-20 pt-20 sm:px-8 sm:pb-28 sm:pt-28 lg:grid-cols-[1.03fr_.97fr] lg:gap-12 lg:pt-32">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.16em] text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Freight operations, connected
              </div>
              <h1 className="mt-7 max-w-[720px] text-[clamp(3rem,6.2vw,5.6rem)] font-semibold leading-[.99] tracking-[-.065em] text-white">
                Move freight.<br /><span className="text-emerald-300">Without the chaos.</span>
              </h1>
              <p className="mt-7 max-w-[560px] text-[16px] leading-8 text-slate-400 sm:text-[17px]">
                FleetGrid brings shippers, fleet operators and drivers into one workspace to find capacity, coordinate deliveries and keep every shipment in view.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <button onClick={() => go('REGISTER')} className="inline-flex h-12 items-center gap-2 rounded-lg bg-emerald-400 px-5 text-[13px] font-bold text-[#062018] shadow-xl shadow-emerald-950/30 transition hover:-translate-y-0.5 hover:bg-emerald-300">Create your account <Arrow /></button>
                <button onClick={() => go('LOGIN', 'BUSINESS')} className="inline-flex h-12 items-center rounded-lg border border-white/15 px-5 text-[13px] font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/[0.04]" >Shipper sign in</button>
                <button onClick={() => go('LOGIN', 'DRIVER')} className="inline-flex h-12 items-center rounded-lg border border-emerald-300/25 px-5 text-[13px] font-semibold text-emerald-200 transition hover:border-emerald-300/45 hover:bg-emerald-300/[0.05]" >Driver sign in</button>
              </div>
              <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-[12px] text-slate-500">
                <span className="flex items-center gap-2"><Check /> One connected workspace</span>
                <span className="flex items-center gap-2"><Check /> Role-based access</span>
                <span className="flex items-center gap-2"><Check /> Shipment visibility</span>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-[590px]">
              <div aria-hidden className="absolute -inset-5 rounded-[30px] bg-emerald-400/[0.08] blur-3xl" />
              <div className="relative overflow-hidden rounded-2xl border border-slate-700/80 bg-[#0d192b] shadow-[0_35px_100px_-35px_rgba(0,0,0,.9)]">
                <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
                  <div className="flex items-center gap-3"><div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300">⌘</div><div><div className="text-[12px] font-bold tracking-wide text-white">FLEETGRID WORKSPACE</div><div className="mt-0.5 text-[10px] text-slate-500">Illustrative product preview</div></div></div>
                  <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.08] px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-emerald-300">Overview</span>
                </div>
                <div className="grid grid-cols-3 gap-2.5 p-4 sm:p-5">
                  {[["SHIPMENTS","Track each load"],["CAPACITY","Find available trucks"],["OPERATIONS","Coordinate the network"]].map(([label,desc],i)=><div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><div className="text-[9px] font-bold tracking-[.14em] text-slate-500">{label}</div><div className="mt-2 text-[11px] font-semibold leading-snug text-slate-200">{desc}</div><div className="mt-3 h-1 w-8 rounded-full" style={{background:i===1?"#34d399":i===2?"#60a5fa":"#a78bfa"}} /></div>)}
                </div>
                <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                  <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#091321]">
                    <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3"><span className="text-[11px] font-semibold text-slate-200">Shipment activity</span><span className="text-[9px] uppercase tracking-wider text-slate-500">Sample view</span></div>
                    <div className="space-y-0 px-4">
                      {[["SH-1048","Bengaluru → Chennai","In transit","text-emerald-300"],["SH-1047","Mysuru → Bengaluru","Capacity reserved","text-sky-300"],["SH-1046","Chennai → Hosur","Delivered","text-slate-400"]].map(([id,route,status,tone])=><div key={id} className="flex items-center justify-between gap-3 border-b border-white/[0.06] py-3 last:border-0"><div className="min-w-0"><div className="font-mono text-[10px] text-slate-300">{id}</div><div className="mt-1 truncate text-[11px] text-slate-500">{route}</div></div><span className={`shrink-0 text-[9px] font-semibold ${tone}`}>{status}</span></div>)}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-300/15 bg-emerald-300/[0.05] px-4 py-3"><div><div className="text-[10px] font-semibold text-emerald-200">One network. Clear handoffs.</div><div className="mt-1 text-[10px] text-slate-500">Shippers · Fleets · Drivers · Operations</div></div><div className="flex -space-x-2"><span className="grid h-7 w-7 place-items-center rounded-full border-2 border-[#0d192b] bg-violet-400/20 text-[9px] text-violet-200">S</span><span className="grid h-7 w-7 place-items-center rounded-full border-2 border-[#0d192b] bg-sky-400/20 text-[9px] text-sky-200">F</span><span className="grid h-7 w-7 place-items-center rounded-full border-2 border-[#0d192b] bg-emerald-400/20 text-[9px] text-emerald-200">D</span></div></div>
                </div>
              </div>
              <div className="absolute -bottom-5 -left-4 hidden rounded-xl border border-slate-700 bg-[#101f32] px-4 py-3 shadow-xl sm:block"><div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Designed around</div><div className="mt-1 text-[12px] font-semibold text-white">Real freight workflows</div></div>
            </div>
          </div>
        </section>

        <section id="platform" className="border-y border-white/[0.07] bg-[#0b1525] py-20 sm:py-24">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="max-w-[650px]"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-emerald-300">The platform</p><h2 className="mt-4 text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">Everything needed to keep freight moving.</h2><p className="mt-4 text-[15px] leading-7 text-slate-400">Replace disconnected updates and manual coordination with a shared operational picture.</p></div>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {[
                {n:"01",title:"Capacity discovery",desc:"Find suitable truck space for a shipment and reserve capacity along supported routes.",icon:"↗"},
                {n:"02",title:"Shipment visibility",desc:"Follow shipment progress, route details and status updates from one place.",icon:"◎"},
                {n:"03",title:"Coordinated operations",desc:"Give the right people the information and actions relevant to their role.",icon:"⌘"},
              ].map((item)=><article key={item.n} className="rounded-2xl border border-white/[0.08] bg-[#0e1a2c] p-6 transition hover:-translate-y-1 hover:border-emerald-300/25"><div className="flex items-center justify-between"><span className="text-[10px] font-bold tracking-[.16em] text-slate-600">{item.n}</span><span className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-300/20 bg-emerald-300/[0.07] text-xl text-emerald-300">{item.icon}</span></div><h3 className="mt-8 text-lg font-semibold text-white">{item.title}</h3><p className="mt-3 text-[13px] leading-6 text-slate-400">{item.desc}</p></article>)}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="py-20 sm:py-24">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:items-end"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-emerald-300">How it works</p><h2 className="mt-4 text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">A simpler way to coordinate every load.</h2></div><p className="max-w-xl text-[15px] leading-7 text-slate-400">Each participant works from the same shipment journey, with clear responsibilities at every stage.</p></div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {[["01","Post or find capacity","Fleet operators make available truck capacity discoverable. Shippers search for a suitable route and load size."],["02","Reserve and coordinate","A shipper creates a shipment request and the relevant fleet or driver can respond to the assignment."],["03","Track through delivery","Follow shipment status and keep the shipper, fleet and driver aligned through completion."]].map(([n,title,desc],i)=><div key={n} className="relative border-t border-slate-700 pt-6"><div className="flex items-center gap-3"><span className="font-mono text-xs text-emerald-300">{n}</span>{i<2&&<span className="h-px flex-1 bg-slate-800 md:hidden" />}</div><h3 className="mt-5 text-lg font-semibold text-white">{title}</h3><p className="mt-3 text-[13px] leading-6 text-slate-400">{desc}</p></div>)}
            </div>
          </div>
        </section>

        <section id="network" className="border-y border-white/[0.07] bg-[#0b1525] py-20 sm:py-24">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="max-w-[650px]"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-emerald-300">One connected network</p><h2 className="mt-4 text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">A focused workspace for every role.</h2><p className="mt-4 text-[15px] leading-7 text-slate-400">People see the tools and information relevant to the work they are responsible for.</p></div>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {[["Shippers","Find transport capacity, create shipments, follow delivery progress and manage payments."],["Fleet operators","Manage fleet availability, coordinate drivers and make spare capacity visible to shippers."],["Drivers","See assigned work, respond to shipment tasks and keep delivery status up to date."]].map(([title,desc],i)=><article key={title} className="rounded-2xl border border-white/[0.08] bg-[#0e1a2c] p-6"><div className="grid h-11 w-11 place-items-center rounded-xl bg-white/[0.05] text-lg text-emerald-300">{["▤","▰","➜"][i]}</div><h3 className="mt-6 text-lg font-semibold text-white">{title}</h3><p className="mt-3 text-[13px] leading-6 text-slate-400">{desc}</p></article>)}
            </div>
          </div>
        </section>

        <section className="px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-[1050px] rounded-3xl border border-emerald-300/20 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,.15),transparent_55%),#0d1a2b] px-6 py-14 text-center sm:px-12 sm:py-16">
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-emerald-300">Get started with FleetGrid</p>
            <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-semibold tracking-[-.045em] text-white sm:text-5xl">Bring your freight operations into focus.</h2>
            <p className="mx-auto mt-5 max-w-xl text-[14px] leading-7 text-slate-400">Create an account to access the workspace built for your role in the freight network.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3"><button onClick={() => go('REGISTER')} className="inline-flex h-12 items-center gap-2 rounded-lg bg-emerald-400 px-5 text-[13px] font-bold text-[#062018] transition hover:bg-emerald-300">Create your account <Arrow /></button><button onClick={() => go('LOGIN')} className="h-12 rounded-lg border border-white/15 px-5 text-[13px] font-semibold text-slate-200 transition hover:bg-white/[0.05]">Sign in</button></div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.08] bg-[#070d18]">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-8 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div><Logo className="text-white" /><p className="mt-3 max-w-sm text-[12px] leading-5 text-slate-500">A connected workspace for shippers, fleet operators and drivers.</p></div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-[12px] text-slate-400"><a href="#platform" className="hover:text-white">Platform</a><a href="#how-it-works" className="hover:text-white">How it works</a><a href="#network" className="hover:text-white">Network</a><button onClick={() => go('LOGIN')} className="hover:text-white">Sign in</button><button onClick={() => go('REGISTER')} className="hover:text-white">Create account</button></div>
          <span className="text-[11px] text-slate-600">© 2026 FleetGrid</span>
        </div>
      </footer>
    </div>
  );
}
