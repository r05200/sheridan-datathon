import { useState, useEffect, useRef } from "react";

/* ---- Optional images: paste a path / URL / data URI. Empty = built-in icon ---- */
const LOGO_SRC = "";        // logo on inner pages
const START_LOGO_SRC = "";  // logo on the start screen (falls back to LOGO_SRC)
const START_DROP_SRC = "";  // image that drops onto the logo (falls back to a drawn tangerine)

/* ------------------------------ data ------------------------------ */
const TABS = [["customer", "Customer"], ["stress", "Stress Test"], ["plan", "Plan"]];
const USERS = [
  [94681, "healthy", 82, "120+", 19567, 740], [82210, "healthy", 76, "48", 14820, 510],
  [71554, "watch", 58, "7.2", 6940, -960], [63905, "watch", 61, "9.6", 8350, -870],
  [55128, "risk", 34, "2.1", 2310, -1100], [48377, "healthy", 88, "120+", 26400, 1220],
  [39942, "risk", 29, "1.4", 1150, -820], [30618, "watch", 52, "5.8", 4990, -860],
];
const LABEL = { healthy: "Healthy", watch: "Watch", risk: "At risk" };
const SORTS = ["Money health", "Account ID", "Runway"];
const RUNS = ["Any", "Under 6 mo", "6 to 24 mo", "24+ mo"];
const YOUT = [81.0,76.7,70.2,85.3,72.3,68.0,78.8,70.2,78.8,63.7,76.7,70.2,81.0,72.3,65.8,78.8,70.2,61.5,74.5,70.2,81.0,72.3,76.7,74.5];
const YIN = [76.7,72.3,81.0,61.5,65.8,55.0,68.0,63.7,57.2,65.8,59.3,50.7,70.2,63.7,55.0,59.3,70.2,52.8,63.7,57.2,68.0,55.0,61.5,60.4];
const YSAV = [41.0,39.9,40.2,38.4,37.6,36.1,36.9,35.8,34.2,33.9,32.8,33.1,32.4,31.2,30.9,29.8,29.0,28.6,27.5,26.8,26.0,25.6,25.1,24.6];
const pts = (a) => a.map((y, i) => `${i ? "L" : "M"}${(56 + (i * 804) / 23).toFixed(1)} ${y}`).join(" ");
const SL = [
  { l: "Income kept", min: 0, max: 100, st: 5, f: (v) => v + "%", sc: ["0%", "100%"] },
  { l: "EI duration", min: 1, max: 12, st: 1, f: (v) => v + (v > 1 ? " months" : " month"), sc: ["1 mo", "12 mo"] },
  { l: "Household bills increase", min: 0, max: 30, st: 1, f: (v) => v + "%", sc: ["0%", "30%"] },
  { l: "One-off cost", min: 0, max: 20000, st: 250, f: (v) => "$" + v.toLocaleString("en-US"), sc: ["$0", "$20,000"] },
];
const PRE = [["Job loss (EI)", [55, 6, 0, 0]], ["Surprise repair", [100, 6, 0, 8000]], ["Bills up", [100, 6, 20, 0]], ["Job loss + bills up", [55, 6, 15, 0]]];
const B = { inc: 11932, sp: 11193, fix: 5960, sav: 19567 };
const m = (n) => "$" + Math.round(Math.abs(n)).toLocaleString("en-US");
const sg = (n) => (n < 0 ? "\u2212" : "+") + m(n);

/* ------------------------------ icons ------------------------------ */
const Ic = ({ sm, style, children }) => (
  <svg className={"icon" + (sm ? " sm" : "")} viewBox="0 0 24 24" style={style}>{children}</svg>
);
const IC = {
  check: <path d="M5 12l4 4 10-10" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><circle cx="12" cy="16.5" r=".6" fill="currentColor" /></>,
  warn: <><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5" /><circle cx="12" cy="17.5" r=".6" fill="currentColor" /></>,
  chev: <path d="M9 5l7 7-7 7" />, back: <path d="M15 5l-7 7 7 7" />, down: <path d="M6 9l6 6 6-6" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  trend: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />,
  arrow: <path d="M3 12h14M12 6l6 6-6 6" />,
  list: <path d="M4 6h16M4 12h16M4 18h10" />,
  up: <><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></>,
  pie: <><path d="M21 12a9 9 0 11-9-9" /><path d="M12 3a9 9 0 019 9h-9V3z" /></>,
};
const Sparkle = ({ size = 24, id = "spk", fill }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {!fill && <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFA43A" /><stop offset=".55" stopColor="#FF8F2E" /><stop offset="1" stopColor="#E8501F" /></linearGradient></defs>}
    <path d="M12 2c.6 5.4 4.6 9.4 10 10-5.4.6-9.4 4.6-10 10-.6-5.4-4.6-9.4-10-10 5.4-.6 9.4-4.6 10-10z" fill={fill || `url(#${id})`} />
  </svg>
);
const Pillow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 15c0-3 2-5 5-5h6c3 0 5 2 5 5" /><path d="M3 19h18" /><path d="M12 10V5" />
  </svg>
);
const LogoMark = ({ start, children }) => {
  const src = start ? START_LOGO_SRC || LOGO_SRC : LOGO_SRC;
  return (
    <div className="logo-mark" style={src ? { background: "none", boxShadow: "none" } : undefined}>
      {src ? <img src={src} alt="Cushion logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <Pillow />}
      {children}
    </div>
  );
};
const Leaf = () => (
  <svg className="leaf" viewBox="0 0 150 96" fill="none" aria-hidden="true">
    <path d="M72 96C72 82 74 72 80 62" stroke="rgba(255,255,255,0.30)" strokeWidth="5" strokeLinecap="round" />
    <path d="M80 64C86 30 118 12 146 18C144 48 118 72 80 64Z" fill="rgba(255,255,255,0.26)" />
    <path d="M84 60C100 46 118 34 136 26" stroke="rgba(245,130,32,0.35)" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const Tangerine = () =>
  START_DROP_SRC ? <img className="drop" src={START_DROP_SRC} alt="" /> : (
    <svg className="drop" viewBox="0 0 100 100" aria-hidden="true">
      <ellipse cx="50" cy="58" rx="38" ry="35" fill="#FF8A00" /><ellipse cx="38" cy="46" rx="14" ry="10" fill="#FFB347" opacity=".7" />
      <path d="M50 24c-2-8 2-13 8-15" stroke="#6B8E23" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M52 24c8-10 22-8 26-4-4 8-16 12-26 4z" fill="#4CAF50" />
    </svg>
  );

/* ------------------------------ shell ------------------------------ */
function Shell({ page, acct, go, title, sub, wrap, children }) {
  return (
    <div className="page">
      <div className="glow" />
      <header className="topbar">
        <div className="logo" onClick={() => go("start")}><LogoMark /><span className="logo-word">Cushion</span></div>
        <button className="user-chip" title="Back to user selection" onClick={() => go("users")}><Ic sm>{IC.user}</Ic><span>User {acct}</span></button>
      </header>
      <section className="tabbar">
        <button className="back-arrow" aria-label="Back to user selection" title="Back to user selection" onClick={() => go("users")}><Ic>{IC.back}</Ic></button>
        <nav className="tabs">
          {TABS.map(([k, l]) => <button key={k} className={"tab" + (page === k ? " active" : "")} onClick={() => go(k)}>{l}</button>)}
        </nav>
      </section>
      <section className="page-header">
        {wrap ? <div><h1 className="page-title">{title}</h1><p className="page-sub">{sub}</p></div> : <><h1 className="page-title">{title}</h1><p className="page-sub">{sub}</p></>}
      </section>
      {children}
    </div>
  );
}
const Head = ({ icon, title, sub, meta }) => (
  <div className="card-head">
    <div className="icon-tile"><Ic>{icon}</Ic></div>
    <div><div className="card-title">{title}</div><div className="card-sub">{sub}</div></div>
    {meta && <div className="meta">{meta}</div>}
  </div>
);

/* ------------------------------ start ------------------------------ */
function Start({ go }) {
  const [drop, setDrop] = useState(false);
  const run = () => {
    if (drop) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return go("users");
    setDrop(true);
    setTimeout(() => go("users"), 1750);
  };
  return (
    <main className="start-screen">
      <div className="orb one"><Leaf /></div><div className="orb two"><Leaf /></div><div className="orb three" />
      <section className="start-center">
        <LogoMark start>{drop && <Tangerine />}</LogoMark>
        <h1 className="brand-name">Cushion</h1>
        <p className="brand-caption">A little clarity. More peace of mind.</p>
        <button className="search-user-btn" onClick={run}><Ic>{IC.search}</Ic>Search user database</button>
      </section>
    </main>
  );
}

/* ------------------------------ users ------------------------------ */
function Users({ go }) {
  const [q, setQ] = useState(""), [hf, setHf] = useState("all"), [sortI, setSortI] = useState(0), [runI, setRunI] = useState(0), [sel, setSel] = useState(null);
  const key = [(u) => u[2], (u) => u[0], (u) => parseFloat(u[3])][sortI];
  const inRun = (u) => { const r = parseFloat(u[3]); return [true, r < 6, r >= 6 && r < 24, r >= 24][runI]; };
  const rows = USERS.filter((u) => (hf === "all" || u[1] === hf) && String(u[0]).includes(q.trim()) && inRun(u)).sort((a, b) => key(b) - key(a));
  const pills = [["all", "All", 24], ["healthy", "Healthy", 11], ["watch", "Watch", 8], ["risk", "At risk", 5]];
  const clear = () => { setQ(""); setHf("all"); setSortI(0); setRunI(0); };
  return (
    <div className="users">
      <header className="topbar" style={{ padding: "0 40px", height: 72 }}>
        <div className="logo" onClick={() => go("start")}><LogoMark /><span className="logo-word">Cushion</span></div>
      </header>
      <section className="banner">
        <h1>User database</h1><p>Find a customer and open their money snapshot.</p>
        <div className="banner-stat">
          <div className="stat-chip"><small>Total users</small><div className="stat-big">24</div></div>
          <div className="stat-chip"><small>Need attention</small><div className="stat-big">13</div></div>
        </div>
      </section>
      <main className="content">
        <section className="card filters">
          <div className="filter-top">
            <label className="search-field">
              <Ic style={{ color: "var(--orange)" }}>{IC.search}</Ic>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by account ID" aria-label="Search users" />
              <span className="kbd">e.g. 94681</span>
            </label>
            <button className="select" onClick={() => setSortI((sortI + 1) % 3)}><span>Sort by</span>{SORTS[sortI]}<Ic sm>{IC.down}</Ic></button>
            <button className="select" onClick={() => setRunI((runI + 1) % 4)}><span>Runway</span>{RUNS[runI]}<Ic sm>{IC.down}</Ic></button>
          </div>
          <div className="filter-bottom">
            <span className="filter-label">Money health</span>
            {pills.map(([k, l, c]) => (
              <button key={k} className={"pill" + (hf === k ? " selected" : "")} onClick={() => setHf(k)}>
                {k !== "all" && <i className={"dot " + k} />}{l}<span className="ct">{c}</span>
              </button>
            ))}
            <button className="clear" onClick={clear}><Ic sm>{IC.x}</Ic>Clear filters</button>
          </div>
        </section>
        <section className="card list-card">
          <div className="list-head">
            <div>
              <h2>All users</h2>
              <div className="sub">{rows.length} of {USERS.length} shown · sorted by {["money health", "account ID", "runway"][sortI]}, high to low</div>
            </div>
            <div className="mix">
              <div className="mix-bar">
                <i className="h" data-tip={"Healthy\n11 of 24 users · 46%"} /><i className="w" data-tip={"Watch\n8 of 24 users · 33%"} /><i className="r" data-tip={"At risk\n5 of 24 users · 21%"} />
              </div>
              <div className="mix-legend">
                <span><i className="dot healthy" />Healthy 46%</span><span><i className="dot watch" />Watch 33%</span><span><i className="dot risk" />At risk 21%</span>
              </div>
            </div>
          </div>
          <div className="cols"><div>User</div><div>Money health</div><div>Runway</div><div>Savings buffer</div><div>Monthly gap</div><div /></div>
          {rows.map(([id, st, score, run, buf, gap]) => (
            <button key={id} className={"user-row" + (sel === id ? " selected" : "")} onClick={() => { setSel(id); setTimeout(() => go("customer", String(id)), 180); }}>
              <div className="uid">Account {id}</div>
              <div className="health-cell">
                <span className={"badge sm " + st}><Ic sm>{IC[st === "healthy" ? "check" : st === "watch" ? "info" : "warn"]}</Ic>{LABEL[st]}</span>
                <div className="score">
                  <div className="score-bar" data-tip={`Money health score\n${score} out of 100 · ${LABEL[st]}`}><i className={st} style={{ width: score + "%" }} /></div><b>{score}</b>
                </div>
              </div>
              <div className="num">{run}<small> months</small></div>
              <div className="num">{m(buf)}</div>
              <div className={"num gap " + (gap > 0 ? "pos" : "neg")}>{sg(gap)}<small>/mo</small></div>
              <div className="chev"><Ic>{IC.chev}</Ic></div>
            </button>
          ))}
          {!rows.length && <div className="empty">No users match. Try clearing the filters.</div>}
          <div className="list-foot">
            <span>Showing 1–8 of 24 users</span>
            <div className="pager"><div className="pg"><Ic sm>{IC.back}</Ic></div><div className="pg active">1</div><div className="pg">2</div><div className="pg">3</div><div className="pg"><Ic sm>{IC.chev}</Ic></div></div>
          </div>
        </section>
      </main>
    </div>
  );
}

/* ----------------------------- customer ----------------------------- */
function Customer({ acct, ...p }) {
  const metrics = [
    ["Money in", "$11,932", "/mo", "Monthly income", IC.up],
    ["Spending", "$11,193", "/mo", "Monthly money out", <><path d="M12 5v14" /><path d="M19 12l-7 7-7-7" /></>],
    ["Fixed costs", "$5,960", "/mo", "The essentials", <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>],
    ["Savings buffer", "$19,567", "", "3.3 months of fixed costs", IC.shield],
    ["Runway", "120+", "months", "No shortfall", IC.clock],
  ];
  return (
    <Shell {...p} acct={acct} title="A little clarity. More peace of mind." sub="Your everyday finances, with the bigger picture in view.">
      <main className="content">
        <section className="card p account-overview">
          <div className="account-head">
            <div><h2 className="account-title">Account {acct}</h2><div className="card-sub">Your baseline, before any surprises</div></div>
            <span className="badge green"><Ic sm><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></Ic>Healthy right now</span>
          </div>
          <div className="metrics">
            {metrics.map(([l, v, u, n, ic], i) => (
              <div key={l} className={"metric" + (i === 4 ? " runway" : "")}>
                <div className="metric-top"><div className="mini-tile"><Ic sm>{ic}</Ic></div><div className="metric-label">{l}</div></div>
                <div className="metric-value">{v}{u && <small>{u}</small>}</div><div className="metric-note">{n}</div>
              </div>
            ))}
          </div>
          <div className="insight"><div className="insight-inner"><Sparkle id="spk1" />
            <span>You bring in about <b>$740 more</b> than you spend each month, and your savings cover about <b>3.3 months</b> of fixed costs.</span></div></div>
        </section>

        <div className="visuals">
          <section className="card p vis-card">
            <div className="vis-title">Health check</div>
            <div className="vis-body">
              <div className="gauge" data-tip={"Money health\n82 out of 100 · Healthy"}>
                <svg viewBox="0 0 240 132">
                  <defs><linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#FFA43A" /><stop offset=".6" stopColor="#FF8F2E" /><stop offset="1" stopColor="#E8501F" /></linearGradient></defs>
                  <path d="M20 120 A100 100 0 0 1 220 120" fill="none" stroke="#FFEAD6" strokeWidth="22" strokeLinecap="round" />
                  <path d="M20 120 A100 100 0 0 1 220 120" fill="none" stroke="url(#gaugeGrad)" strokeWidth="22" strokeLinecap="round" strokeDasharray="257 314" />
                </svg>
                <div className="gauge-center"><b>82</b><span>Healthy</span></div>
              </div>
              <div className="gauge-ends"><span>0</span><span>100</span></div>
            </div>
          </section>
          <section className="card p vis-card">
            <div className="vis-title">Money in vs out</div>
            <div className="vis-body">
              <div className="pair">
                <div className="pair-row"><div className="pair-label"><span>In</span><b>$11,932</b></div><div className="pair-bar" data-tip={"Money in\n$11,932 per month"}><i className="in" /></div></div>
                <div className="pair-row"><div className="pair-label"><span>Out</span><b>$11,193</b></div><div className="pair-bar" data-tip={"Money out\n$11,193 per month\n$739 less than comes in"}><i className="out" /></div></div>
              </div>
              <div className="chip-green"><Ic sm>{IC.check}</Ic>About $740 left each month</div>
            </div>
          </section>
          <section className="card p vis-card">
            <div className="vis-title">Savings buffer</div>
            <div className="vis-body">
              <div className="blocks">
                {[1, 1, 1, 0.3, 0, 0].map((f, i) => (
                  <div key={i} className="block" data-tip={(i < 3 ? `Month ${i + 1} · $5,960 covered` : i === 3 ? "Month 4 · $1,687 of $5,960 covered (28%)" : `Month ${i + 1} · not covered yet`) + "\nTotal buffer $19,567"}>
                    {f > 0 && <i style={{ width: f * 100 + "%", borderRadius: f === 1 ? 10 : "10px 0 0 10px" }} />}
                  </div>
                ))}
              </div>
              <div className="blocks-scale"><span>Mo 1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span></div>
              <div className="blocks-big">3.3<small>months of fixed costs</small></div>
            </div>
          </section>
          <section className="card p card-spending">
            <Head icon={IC.pie} title="Where the money goes" sub="A typical month · $11,193 total" />
            <div className="donut-wrap"><div className="donut">
              <svg viewBox="0 0 208 208">
                <circle cx="104" cy="104" r="80" fill="none" stroke="#FFC48A" strokeWidth="28" data-tip={"Household bills\n$5,960 per month · 53%"} />
                <circle cx="104" cy="104" r="80" fill="none" stroke="#F58220" strokeWidth="28" strokeDasharray="236.3 502.65" data-tip={"Cash withdrawals\n$5,233 per month · 47%"} />
              </svg>
              <div className="donut-center"><b>$11,193</b><span>per month</span></div>
            </div></div>
            <div className="legend">
              <div className="legend-row"><i className="dot a" />Cash withdrawals<span className="pct">47%</span></div>
              <div className="legend-row"><i className="dot b" />Household bills<span className="pct">53%</span></div>
            </div>
            <div className="fixed">
              <div className="fixed-row"><span>Fixed costs</span><b>$5,960/mo</b></div>
              <div className="progress" data-tip={"Fixed costs\n$5,960 per month · 53% of spending"}><div className="bar" /></div>
              <div className="fixed-note">About 53% of typical spending</div>
            </div>
          </section>
        </div>

        <section className="card p card-history">
          <Head icon={IC.trend} title="Your money over time" sub="Sample history · illustrative, not verified account history" meta="Last 24 months" />
          <div className="chart-legend"><span><i className="sw in" />Money in</span><span><i className="sw out" />Money out</span></div>
          <div className="chart-label c1"><span>Monthly flows · $/month</span></div>
          <svg className="chart-svg c1" viewBox="0 0 880 160" fontFamily="'Nunito Sans', sans-serif">
            <g stroke="#F3E9DC"><line x1="56" y1="16" x2="860" y2="16" /><line x1="56" y1="81" x2="860" y2="81" /><line x1="56" y1="146" x2="860" y2="146" /></g>
            <g fontSize="14" fill="#8F867D" textAnchor="end"><text x="46" y="20">$14k</text><text x="46" y="85">$11k</text><text x="46" y="150">$8k</text></g>
            <path d={pts(YOUT)} fill="none" stroke="#2B2623" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
            <path d={pts(YIN)} fill="none" stroke="#F58220" strokeWidth="2.75" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <div className="chart-label c2"><span>Savings buffer · $ balance</span><span>Separate scale</span></div>
          <svg className="chart-svg c2" viewBox="0 0 880 130" fontFamily="'Nunito Sans', sans-serif">
            <defs>
              <linearGradient id="savFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FF8F2E" stopOpacity=".26" /><stop offset="1" stopColor="#FF8F2E" stopOpacity=".02" /></linearGradient>
              <linearGradient id="savLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#FFA43A" /><stop offset="1" stopColor="#FF8F2E" /></linearGradient>
            </defs>
            <g stroke="#F3E9DC"><line x1="56" y1="8" x2="860" y2="8" /><line x1="56" y1="98" x2="860" y2="98" /></g>
            <g fontSize="14" fill="#8F867D" textAnchor="end"><text x="46" y="12">$24k</text><text x="46" y="102">$0</text></g>
            <path d={pts(YSAV) + " L860.0 98 L56.0 98 Z"} fill="url(#savFill)" />
            <path d={pts(YSAV)} fill="none" stroke="url(#savLine)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx="860" cy="24.6" r="5" fill="#fff" stroke="#FF8F2E" strokeWidth="3" />
            <g fontSize="14" fill="#8F867D" textAnchor="middle">
              <text x="56" y="120" textAnchor="start">Nov '24</text><text x="230.8" y="120">Apr '25</text><text x="440.6" y="120">Oct '25</text><text x="650.4" y="120">Apr '26</text><text x="860" y="120" textAnchor="end">Oct '26</text>
            </g>
          </svg>
        </section>
      </main>
    </Shell>
  );
}

/* ------------------------------ stress ------------------------------ */
function Slider({ cfg, v, set }) {
  const ref = useRef(), [drag, setDrag] = useState(false);
  const p = ((v - cfg.min) / (cfg.max - cfg.min)) * 100;
  const at = (e) => {
    const b = ref.current.getBoundingClientRect(), k = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width));
    set(Math.round((cfg.min + k * (cfg.max - cfg.min)) / cfg.st) * cfg.st);
  };
  const key = (e) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (d) { e.preventDefault(); set(Math.min(cfg.max, Math.max(cfg.min, v + d * cfg.st))); }
  };
  return (
    <div className="slider-row">
      <div className="slider-label"><span>{cfg.l}</span><span className="val">{cfg.f(v)}</span></div>
      <div ref={ref} className={"track" + (drag ? " dragging" : "")} role="slider" tabIndex={0} aria-label={cfg.l} aria-valuenow={v} aria-valuemin={cfg.min} aria-valuemax={cfg.max}
        onKeyDown={key} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(true); at(e); }}
        onPointerMove={(e) => drag && at(e)} onPointerUp={() => setDrag(false)}>
        <div className="fill" style={{ width: p + "%" }} /><div className="thumb" style={{ left: p + "%" }} />
      </div>
      <div className="track-scale"><span>{cfg.sc[0]}</span><span>{cfg.sc[1]}</span></div>
    </div>
  );
}

function Stress({ acct, ...p }) {
  const [vals, setVals] = useState([55, 6, 15, 0]), [preset, setPreset] = useState(0);
  const [kept, dur, bills, one] = vals;
  const bal = Math.max(0, B.sav - one), inc = (B.inc * kept) / 100, sp = B.sp + (B.fix * bills) / 100, gap = inc - sp;
  const run = gap >= 0 ? (bal > 0 ? 120 : 0) : bal / -gap, ok = run >= dur, over = run >= 120;
  const X = (n) => 56 + n * 68.57, Y = (b) => 240 - Math.min(b, 20000) * 0.01;
  const x1 = run > 7 ? 536 : X(Math.min(run, 7)), y1 = run > 7 ? Y(bal + gap * 7) : 240, xi = X(Math.min(dur, 7));
  const ln = gap >= 0 ? `M56 ${Y(bal)} L536 ${Y(bal + gap * 7)}` : `M56 ${Y(bal)} L${x1} ${y1}`;
  const setVal = (i, v) => { setVals(vals.map((x, j) => (j === i ? v : x))); setPreset(null); };
  const rows = [["Income", m(B.inc), m(inc)], ["Spending", m(B.sp), m(sp)], ["Monthly gap", "+$739", sg(gap)], ["Runway", "120+ mo", over ? "120+ mo" : run.toFixed(1) + " mo"]];
  return (
    <Shell {...p} acct={acct} wrap title="What if life changes?" sub="Pick a shock and see how long your cushion lasts.">
      <main className="stress-test">
        <section className="card p card-shock">
          <Head icon={IC.bolt} title="Choose a shock" sub="Pick a scenario, then adjust the details." />
          <div className="presets">
            {PRE.map(([l, v], i) => (
              <button key={l} className={"pill" + (preset === i ? " selected" : "")} onClick={() => { setVals(v); setPreset(i); }}>
                {preset === i && <Ic sm>{IC.check}</Ic>}{l}
              </button>
            ))}
          </div>
          <div className="sliders">{SL.map((c, i) => <Slider key={c.l} cfg={c} v={vals[i]} set={(v) => setVal(i, v)} />)}</div>
        </section>
        <div className="right-col">
          <section className="hero-runway">
            <div>
              <div className="hero-label"><Ic sm>{IC.clock}</Ic>Your runway after this shock</div>
              <div className="hero-number">{over ? "120+" : run.toFixed(1)}<small>months</small></div>
            </div>
            <div className="hero-chip"><Ic sm>{IC.arrow}</Ic>Before shock: <b>120+ months</b></div>
          </section>
          <section className={"verdict" + (ok ? " good" : "")}>
            <div className="verdict-icon"><Ic>{ok ? IC.check : IC.warn}</Ic></div>
            <div className="verdict-text">
              {ok
                ? <><b>Makes it.</b> {gap >= 0 ? "Your income still covers spending, so the cushion holds." : `Your savings last through EI with about ${m(bal + gap * dur)} to spare.`}</>
                : <><b>Does not make it.</b> Runs out about {(dur - run).toFixed(1)} months before EI ends, short by about {m(-gap * dur - bal)}.</>}
            </div>
            <span className={"badge " + (ok ? "green" : "red")}>{ok ? "Covered" : "Not covered"}</span>
          </section>
          <div className="chart-compare">
            <section className="card p card-chart">
              <Head icon={IC.trend} title="Balance month by month" sub="Savings buffer under this shock" />
              <div className="chart-legend"><span><i className="swatch" />Balance</span><span><i className="swatch dash" />$0 line</span></div>
              <svg className="chart-svg" viewBox="0 0 560 300" fontFamily="'Nunito Sans', sans-serif">
                <defs>
                  <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FF8F2E" stopOpacity=".28" /><stop offset="1" stopColor="#FF8F2E" stopOpacity=".02" /></linearGradient>
                  <linearGradient id="lineStroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#FFA43A" /><stop offset=".5" stopColor="#FF8F2E" /><stop offset="1" stopColor="#F58220" /></linearGradient>
                </defs>
                <g stroke="#F3E9DC">{[40, 90, 140, 190].map((y) => <line key={y} x1="56" y1={y} x2="536" y2={y} />)}</g>
                <g fontSize="11" fill="#8F867D" textAnchor="end">
                  {["$20k", "$15k", "$10k", "$5k"].map((t, i) => <text key={t} x="46" y={44 + i * 50}>{t}</text>)}
                  <text x="46" y="244" fill="#C8344B" fontWeight="600">$0</text>
                </g>
                <g fontSize="11" fill="#8F867D" textAnchor="middle">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <text key={n} x={X(n)} y="264">{n}</text>)}
                  <text x="296" y="286">Months</text>
                </g>
                <path d={`${ln} L${gap >= 0 ? 536 : x1} 240 L56 240 Z`} fill="url(#areaFill)" />
                <path d={ln} stroke="url(#lineStroke)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
                <line x1="56" y1="240" x2="536" y2="240" stroke="#C8344B" strokeWidth="1.75" strokeDasharray="6 5" />
                <circle cx="56" cy={Y(bal)} r="6" fill="#fff" stroke="#F58220" strokeWidth="3" />
                {bal >= 1 && <><rect x="68" y={Y(bal) - 22} width="76" height="24" rx="12" fill="#FFEAD6" /><text x="106" y={Y(bal) - 6} fontSize="12" fontWeight="600" fill="#B8500A" textAnchor="middle">{m(bal)}</text></>}
                {run <= 7 && gap < 0 && <>
                  <circle cx={x1} cy="240" r="6" fill="#fff" stroke="#C8344B" strokeWidth="3" />
                  <rect x={x1 - 64} y="196" width="128" height="26" rx="13" fill="#FDECEF" stroke="#F6C3CC" />
                  <text x={x1} y="213" fontSize="12" fontWeight="600" fill="#C8344B" textAnchor="middle">Runs out, month {run.toFixed(1)}</text>
                </>}
                <line x1={xi} y1="40" x2={xi} y2="240" stroke="#F58220" strokeWidth="1.5" strokeDasharray="3 4" />
                <rect x={xi - 36} y="12" width="73" height="24" rx="12" fill="#F58220" />
                <text x={xi} y="28" fontSize="12" fontWeight="600" fill="#fff" textAnchor="middle">EI ends</text>
              </svg>
            </section>
            <section className="card p">
              <Head icon={IC.list} title="Before vs after" sub="Per month" />
              <table className="compare">
                <thead><tr><th /><th>Before</th><th>After</th></tr></thead>
                <tbody>
                  {rows.map(([l, b, a], i) => (
                    <tr key={l} className={i === 3 ? "runway" : ""}>
                      <td>{l}</td><td>{b}</td>
                      <td className="after" style={i === 2 ? { color: gap < 0 ? "" : "var(--green)" } : i === 3 && ok ? { color: "var(--green)" } : undefined}>{a}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="table-note">Income is {kept}% of usual. Household bills are up {bills}%.{one ? ` One-off cost: ${m(one)}.` : ""}</div>
            </section>
          </div>
        </div>
      </main>
    </Shell>
  );
}

/* ------------------------------- plan ------------------------------- */
function Plan({ acct, ...p }) {
  const [done, setDone] = useState([true, false, false]), [busy, setBusy] = useState(false), [goal, setGoal] = useState("Build a safety cushion I can rely on");
  const n = done.filter(Boolean).length;
  const steps = [["Set up a savings transfer", "$740 on payday", "+$740/mo"], ["Trim cash withdrawals 20%", "Your biggest spending slice", "+$1,050/mo"], ["Review household bills", "53% of your spending", "Free up more"]];
  const send = () => { setBusy(true); setTimeout(() => setBusy(false), 600); };
  const rank = [["Cut cash withdrawals 20% \u2192 5.5 months", false], ["Cut cash withdrawals 30% \u2192 6.4 months", true], ["Pause optional spending \u2192 4.8 months", false]];
  return (
    <Shell {...p} acct={acct} title="Small steps. A stronger cushion." sub="Tell us what you're working toward, and we'll map out how to get there.">
      <section className="plan-builder">
        <div className="prompt-box"><div className="prompt-inner">
          <Sparkle id="spk2" />
          <input className="prompt-text" value={goal} aria-label="Your goal" onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
          <button className={"send-btn" + (busy ? " busy" : "")} aria-label="Build plan" onClick={send}><Ic>{IC.up}</Ic></button>
        </div></div>
      </section>
      <main className="content plan-grid">
        <section className="goal-hero">
          <div className="hero-spark"><Sparkle size={48} fill="#fff" /></div>
          <div className="lbl"><Ic sm><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /></Ic>Your goal</div>
          <div className="big">$27,800<small>safety cushion</small></div>
          <div className="hero-bar" data-tip={"$19,600 saved of $27,800\n70% there · $8,200 to go"}><i /></div>
          <div className="hero-meta"><span>$19,600 saved · 70%</span>
            <span className="hero-chip"><Ic sm><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></Ic>About 11 months to go</span></div>
        </section>
        <section className="card p card-roadmap">
          <Head icon={IC.trend} title="Your road to $27,800" sub="Savings balance, month by month" />
          <div className="chart-legend"><span><i className="sw" style={{ background: "#F58220" }} />Save $740 a month</span><span><i className="sw" style={{ background: "#2B2623" }} />Also cut cash withdrawals 20%</span></div>
          <svg className="chart-svg" viewBox="0 0 600 210" fontFamily="'Nunito Sans', sans-serif">
            <g stroke="#F3E9DC">{[16, 69.3, 122.7, 176].map((y) => <line key={y} x1="56" y1={y} x2="580" y2={y} />)}</g>
            <g fontSize="11" fill="#8F867D" textAnchor="end">{["$30k", "$25k", "$20k", "$15k"].map((t, i) => <text key={t} x="46" y={[20, 73, 127, 180][i]}>{t}</text>)}</g>
            <g fontSize="11" fill="#8F867D" textAnchor="middle">{["Now", "3 mo", "6 mo", "9 mo", "12 mo"].map((t, i) => <text key={t} x={56 + i * 131} y="196">{t}</text>)}</g>
            <line x1="56" y1="39.5" x2="580" y2="39.5" stroke="#F58220" strokeWidth="1.5" strokeDasharray="6 5" opacity=".55" />
            <rect x="480" y="18" width="98" height="20" rx="10" fill="#FFEAD6" /><text x="529" y="32" fontSize="11" fontWeight="600" fill="#B8500A" textAnchor="middle">Goal $27,800</text>
            <path d="M56 126.9 L536.3 39.5" stroke="#F58220" strokeWidth="3.5" strokeLinecap="round" fill="none" />
            <path d="M56 126.9 L274.3 39.5" stroke="#2B2623" strokeWidth="3.5" strokeLinecap="round" fill="none" />
            <circle cx="56" cy="126.9" r="6" fill="#fff" stroke="#F58220" strokeWidth="3" />
            <circle cx="274.3" cy="39.5" r="6" fill="#fff" stroke="#2B2623" strokeWidth="3" />
            <circle cx="536.3" cy="39.5" r="6" fill="#fff" stroke="#F58220" strokeWidth="3" />
            <text x="274.3" y="64" fontSize="12" fontWeight="600" fill="#2B2623" textAnchor="middle">Month 5</text>
            <text x="536.3" y="64" fontSize="12" fontWeight="600" fill="#B8500A" textAnchor="middle">Month 11</text>
          </svg>
        </section>
        <section className="card p card-steps">
          <Head icon={<><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h9" /></>} title="Do this month" sub="Three small moves" />
          <div className="steps">
            {steps.map(([t, s, tag], i) => (
              <button key={t} className="step" onClick={() => setDone(done.map((d, j) => (j === i ? !d : d)))}>
                <div className={"check" + (done[i] ? " done pop" : "")}>{done[i] && <Ic sm style={{ strokeWidth: 2.5 }}>{IC.check}</Ic>}</div>
                <div className="step-body"><b>{t}</b><span>{s}</span></div><span className="tag">{tag}</span>
              </button>
            ))}
          </div>
          <div className="step-note"><Ic style={{ color: "#F58220" }}>{IC.info}</Ic>{n === 3 ? "All done! Your plan is on track." : `${n} of 3 done. Each step you finish brings the goal closer.`}</div>
        </section>
        <section className="card p card-faster">
          <Head icon={IC.bolt} title="Get there faster" sub="Months to reach $27,800" />
          <div className="race">
            {[["Save $740 a month", "11 months", "a"], ["Plus cut cash withdrawals 20%", "5 months", "b"], ["Plus cut cash withdrawals 30%", "4 months", "c"]].map(([l, v, c]) => (
              <div key={c} className="race-row"><div className="race-label"><span>{l}</span><b>{v}</b></div>
                <div className="race-bar" data-tip={`${l}\n${v} to reach $27,800`}><i className={c} /></div></div>
            ))}
          </div>
        </section>
        <section className="card p card-backup">
          <Head icon={IC.shield} title="Backup plan if the shock hits" sub="Your runway under a job loss" />
          <div className="backup-list">
            {rank.map(([t, best], i) => (
              <div key={t} className={"backup-row" + (best ? " best" : "")}><div className="rank">{i + 1}</div><div className="backup-text">{t}</div>
                <span className={"badge sm " + (best ? "green" : "amber")}><Ic sm>{best ? IC.check : IC.info}</Ic>{best ? "You make it" : "Falls short"}</span></div>
            ))}
          </div>
        </section>
      </main>
    </Shell>
  );
}

/* ------------------------------- app ------------------------------- */
export default function App() {
  const read = () => { const h = location.hash.slice(1); return ["start", "users", "customer", "stress", "plan"].includes(h) ? h : "start"; };
  const [page, setPage] = useState(read), [acct, setAcct] = useState("94681"), [tip, setTip] = useState(null);
  useEffect(() => { const f = () => { setPage(read()); scrollTo(0, 0); }; addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  const go = (to, a) => { if (a) setAcct(a); if (location.hash === "#" + to) setPage(to); else location.hash = to; };
  const onMove = (e) => { const t = e.target.closest && e.target.closest("[data-tip]"); setTip(t ? { x: e.clientX, y: e.clientY, s: t.getAttribute("data-tip") } : null); };
  const p = { go, acct, page };
  return (
    <div className={"cs " + page} onMouseMove={onMove} onMouseLeave={() => setTip(null)}>
      <style>{CSS}</style>
      {page === "start" && <Start go={go} />}
      {page === "users" && <Users go={go} />}
      {page === "customer" && <Customer {...p} />}
      {page === "stress" && <Stress {...p} />}
      {page === "plan" && <Plan {...p} />}
      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 16, innerWidth - 220), top: Math.max(8, tip.y - 14 - 18 * tip.s.split("\n").length) }}>
          {tip.s.split("\n").map((l, i) => <div key={i} style={i ? { fontWeight: 700 } : { opacity: 0.75 }}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ styles ------------------------------ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700&family=Poppins:wght@500;600;700&display=swap');
.cs{--orange:#F58220;--o-text:#B8500A;--o100:#FFEAD6;--o50:#FFF6EC;--o300:#FFC48A;--ink:#2B2623;--soft:#6A625B;--faint:#8F867D;--line:#F3E4D3;--green:#166B45;--gbg:#DFF5E9;--gbar:#2E9B68;--amber:#9A5B00;--abg:#FFF3D9;--abar:#E59A0C;--red:#C8344B;--rbg:#FDECEF;--rline:#F6C3CC;--rbar:#D9485B;--sm:0 2px 8px rgba(200,100,10,.08);--md:0 8px 24px rgba(200,100,10,.1),0 2px 6px rgba(200,100,10,.06);--sun:linear-gradient(110deg,#FFA43A,#F58220 52%,#E8501F);--gx:max(40px,calc((100vw - 1360px)/2));
font-family:'Nunito Sans',sans-serif;color:var(--ink);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased;background:#FFFCF8;min-height:100vh;position:relative;overflow-x:hidden;padding-bottom:32px}
.cs.start{background:#E4620A;padding:0}
:where(.cs) *{box-sizing:border-box;margin:0;padding:0}
:where(.cs) button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;text-align:inherit}
:where(.cs) :is(h1,h2,.pf,.logo-word,.tab,.pill,.badge,.card-title,.metric-value,.big,.stat-big,.num,.uid,.pg,.hero-number,.account-title,.vis-title,.gauge-center b,.blocks-big,.donut-center b){font-family:Poppins,sans-serif}
.cs :is(button,input,[role=slider]):focus-visible{outline:3px solid rgba(245,130,31,.55);outline-offset:2px}
.icon{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}.icon.sm{width:16px;height:16px}
.glow{position:absolute;inset:0 0 auto 0;height:520px;pointer-events:none;background:radial-gradient(520px 260px at 18% 12%,rgba(255,164,58,.16),transparent 70%),radial-gradient(560px 280px at 62% 4%,rgba(245,130,31,.16),transparent 70%),radial-gradient(420px 240px at 95% 20%,rgba(232,80,31,.12),transparent 70%)}
.page{position:relative}.page>*:not(.glow){position:relative;z-index:1}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:var(--md)}.card.p{padding:16px 20px}
.card-head{display:flex;align-items:center;gap:12px;margin-bottom:10px}.card-head .meta{margin-left:auto;font-size:13px;color:var(--soft);font-weight:500}
.card-title{font-size:16px;font-weight:600;letter-spacing:-.01em}.card-sub{font-size:13px;color:var(--soft)}
.icon-tile{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#FFA04A,#F58220);color:#fff;box-shadow:0 4px 12px rgba(245,130,31,.3);display:flex;align-items:center;justify-content:center}
.badge{display:inline-flex;align-items:center;gap:8px;padding:5px 14px;border-radius:999px;font-size:13px;font-weight:600;white-space:nowrap}
.badge.sm{gap:4px;padding:4px 12px;font-size:12px}
.badge.green,.badge.healthy{background:var(--gbg);color:var(--green)}.badge.amber,.badge.watch{background:var(--abg);color:var(--amber)}
.badge.red,.badge.risk{background:var(--rbg);color:var(--red);border:1px solid var(--rline)}.badge.red{background:#fff}
.chart-legend{display:flex;gap:16px;font-size:12px;color:var(--soft);font-weight:500;margin-bottom:6px}.chart-legend span{display:inline-flex;align-items:center;gap:8px}
.chart-svg{display:block;width:100%;height:auto}
.sw{width:20px;height:4px;border-radius:2px}.sw.in{background:var(--orange)}.sw.out{background:var(--ink)}
.progress{height:10px;border-radius:999px;background:var(--o100);overflow:hidden}.progress .bar{width:53%;height:100%;border-radius:999px;background:linear-gradient(90deg,#FFA43A,#FF8F2E)}
.tip{position:fixed;z-index:9999;pointer-events:none;background:#2B2623;color:#fff;border-radius:12px;padding:8px 12px;font:600 12.5px/1.45 'Nunito Sans',sans-serif;box-shadow:0 10px 28px rgba(43,38,35,.3);white-space:nowrap}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%}.dot.healthy{background:var(--gbar)}.dot.watch{background:var(--abar)}.dot.risk{background:var(--rbar)}

/* top bar / tabs / header */
.topbar{height:64px;padding:0 var(--gx);display:flex;align-items:center;gap:24px;background:rgba(255,255,255,.8);border-bottom:1px solid var(--line)}
.logo{display:flex;align-items:center;gap:8px;cursor:pointer}
.logo-mark{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#FFA04A,#F58220);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(245,130,31,.35);position:relative}
.logo-mark svg:not(.drop){width:18px;height:18px;color:#fff}
.logo-word{font-size:20px;font-weight:700;letter-spacing:-.03em;color:var(--orange)}
.user-chip{margin-left:auto;display:inline-flex;align-items:center;gap:8px;height:42px;padding:0 18px 0 14px;border-radius:999px;background:#fff;border:1px solid var(--line);box-shadow:var(--sm);font:600 14px Poppins,sans-serif;white-space:nowrap}
.user-chip svg{color:var(--orange)}.user-chip:hover,.back-arrow:hover{border-color:var(--orange)}
.tabbar{position:relative;display:flex;justify-content:center;padding:14px var(--gx) 0}
.back-arrow{position:absolute;left:var(--gx);bottom:3px;width:40px;height:40px;border-radius:50%;background:#fff;border:1px solid var(--line);box-shadow:var(--sm);color:var(--orange);display:flex;align-items:center;justify-content:center}
.back-arrow svg{stroke-width:2.2}
.tabs{display:flex;gap:8px;padding:4px;background:var(--o50);border-radius:999px;border:1px solid var(--line)}
.tab{padding:6px 18px;border-radius:999px;font-size:14px;font-weight:500;color:var(--soft)}
.tab.active{background:var(--orange);color:#fff;font-weight:600;box-shadow:0 4px 12px rgba(245,130,31,.32)}
.page-header{position:relative;overflow:hidden;margin:14px 0 18px;padding:16px var(--gx);display:flex;align-items:center;justify-content:space-between;gap:24px;background:linear-gradient(120deg,#FF9A3D,#F58220 45%,#E4620A);color:#fff}
.page-header::after{content:"";position:absolute;right:-90px;top:-140px;width:440px;height:440px;border-radius:50%;background:rgba(255,255,255,.13)}
.page-header>*{position:relative;z-index:1}
.page-title{font-size:28px;line-height:1.15;font-weight:700;letter-spacing:-.035em}.page-sub{font-size:15px;font-weight:600;color:rgba(255,255,255,.95)}
.content{padding:0 var(--gx);display:flex;flex-direction:column;gap:16px}

/* start */
.start-screen{position:relative;overflow:hidden;width:100%;height:100vh;display:flex;align-items:center;justify-content:center;color:#fff;background:radial-gradient(700px 420px at 85% 12%,rgba(255,210,150,.55),transparent 70%),linear-gradient(135deg,#FFA04A,#F58220 45%,#E4620A)}
.orb{position:absolute;border-radius:50%;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.16),rgba(255,255,255,.09) 70%);will-change:transform}
.orb.one{width:520px;height:520px;right:-70px;top:120px;animation:floatA 16s ease-in-out infinite}
.orb.two{width:420px;height:420px;left:-110px;bottom:-150px;animation:floatB 19s ease-in-out infinite}
.orb.three{width:220px;height:220px;left:240px;top:80px;background:rgba(255,255,255,.08)}
.orb .leaf{position:absolute;left:50%;overflow:visible}.orb.one .leaf{top:-66px;width:150px;height:96px;transform:translateX(-46%)}
.orb.two .leaf{top:-58px;width:124px;height:80px;transform:translateX(-30%) scaleX(-1) rotate(-8deg)}
@keyframes floatA{0%,100%{transform:translate(0,0) rotate(-6deg)}33%{transform:translate(-16px,14px) rotate(5deg)}66%{transform:translate(10px,26px) rotate(10deg)}}
@keyframes floatB{0%,100%{transform:translate(0,0) rotate(5deg)}33%{transform:translate(18px,-16px) rotate(-7deg)}66%{transform:translate(-8px,-26px) rotate(-12deg)}}
.start-center{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;text-align:center}
.start-center .logo-mark{width:128px;height:128px;border-radius:40px;background:#fff;color:var(--orange);box-shadow:0 28px 56px rgba(150,60,0,.38),0 8px 16px rgba(150,60,0,.18)}
.start-center .logo-mark svg:not(.drop){width:72px;height:72px;color:var(--orange)}
.drop{position:absolute;left:50%;top:50%;width:125px;height:125px;margin:-62px 0 0 -62px;object-fit:contain;z-index:5;pointer-events:none;animation:drop 1.15s forwards}
.start-center .logo-mark:has(.drop){animation:squish .32s ease-out .7s}
@keyframes drop{0%{transform:translateY(-110vh) rotate(-25deg);animation-timing-function:cubic-bezier(.55,0,.9,.5)}60%{transform:translateY(0) rotate(8deg);animation-timing-function:ease-out}78%{transform:translateY(-26px) rotate(2deg);animation-timing-function:ease-in}100%{transform:translateY(0) rotate(8deg)}}
@keyframes squish{50%{transform:scale(1.06,.9)}}
.brand-name{margin-top:32px;font-size:80px;font-weight:700;letter-spacing:-.045em;line-height:1}
.brand-caption{margin-top:16px;font-size:22px;font-weight:600;color:rgba(255,255,255,.96)}
.search-user-btn{margin-top:56px;height:72px;padding:0 48px 0 40px;border-radius:999px;background:#fff;color:var(--o-text);display:flex;align-items:center;gap:16px;font:600 20px Poppins,sans-serif;letter-spacing:-.01em;box-shadow:0 0 0 8px rgba(255,255,255,.28),0 24px 48px rgba(150,60,0,.34),0 6px 14px rgba(150,60,0,.18);transition:transform .2s}
.search-user-btn:hover{transform:translateY(-3px) scale(1.03)}.search-user-btn svg{width:28px;height:28px;stroke-width:2;color:var(--orange)}

/* users */
.users{max-width:1440px;margin:0 auto}
.banner{position:relative;overflow:hidden;padding:48px 40px 120px;color:#fff;background:linear-gradient(120deg,#FF9A3D,#F58220 45%,#E4620A)}
.banner::after{content:"";position:absolute;right:-90px;top:-150px;width:480px;height:480px;border-radius:50%;background:rgba(255,255,255,.13)}
.banner::before{content:"";position:absolute;left:520px;bottom:-160px;width:280px;height:280px;border-radius:50%;background:rgba(255,255,255,.09)}
.banner h1{font-size:48px;font-weight:700;letter-spacing:-.035em;line-height:1.1;position:relative;z-index:1}.banner p{margin-top:8px;font-size:18px;font-weight:600;position:relative;z-index:1}
.banner-stat{position:absolute;right:40px;top:48px;display:flex;gap:16px;z-index:1}
.stat-chip{padding:12px 20px;border-radius:16px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35)}.stat-chip small{display:block;font-size:12px;font-weight:600}.stat-big{font-size:28px;font-weight:700;letter-spacing:-.03em;line-height:1.2}
.users .content{padding:0 40px;margin-top:-72px;position:relative;z-index:2;gap:24px}.users .card{border-radius:20px}
.filters{padding:24px;display:flex;flex-direction:column;gap:20px;box-shadow:0 20px 48px rgba(160,70,0,.22),0 6px 14px rgba(160,70,0,.1)}
.filter-top{display:flex;gap:16px;align-items:center}
.search-field{flex:1;height:56px;border-radius:999px;border:1.5px solid var(--orange);background:#fff;display:flex;align-items:center;gap:12px;padding:0 8px 0 20px;box-shadow:0 6px 16px rgba(245,130,31,.14)}
.search-field input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:var(--ink)}
.kbd{padding:4px 12px;border-radius:999px;background:var(--o50);color:var(--o-text);font-size:12px;font-weight:700}
.select{height:56px;padding:0 20px;border-radius:999px;border:1px solid var(--line);background:#fff;display:flex;align-items:center;gap:12px;font-weight:600;box-shadow:var(--sm);white-space:nowrap}.select span,.select svg{color:var(--faint)}
.filter-bottom{display:flex;align-items:center;gap:12px}.filter-label{font-weight:700;color:var(--soft);margin-right:4px}
.pill{padding:10px 20px;border-radius:999px;font-size:14px;font-weight:500;background:#fff;border:1px solid var(--line);color:var(--soft);display:inline-flex;align-items:center;gap:8px;box-shadow:var(--sm)}
.pill .ct{padding:0 8px;border-radius:999px;background:var(--o50);font-size:12px;font-weight:600}
.pill.selected{background:var(--o100);border:1.5px solid var(--orange);color:var(--o-text);font-weight:600;box-shadow:0 6px 16px rgba(245,130,31,.2)}.pill.selected .ct{background:#fff}
.clear{margin-left:auto;color:var(--o-text);font-weight:700;display:inline-flex;align-items:center;gap:8px}
.list-card{overflow:hidden}.list-head{padding:24px 24px 20px;display:flex;align-items:center;gap:32px}
.list-head h2{font-size:20px;font-weight:600;letter-spacing:-.02em;white-space:nowrap}.list-head .sub{font-size:13px;color:var(--soft)}.mix{flex:1}
.mix-bar{display:flex;height:14px;border-radius:999px;overflow:hidden;gap:3px}.mix-bar i{display:block;height:100%}
.mix-bar .h{width:45.8%;background:var(--gbar)}.mix-bar .w{width:33.3%;background:var(--abar)}.mix-bar .r{width:20.9%;background:var(--rbar)}
.mix-legend{display:flex;gap:24px;margin-top:8px;font-size:12px;font-weight:600;color:var(--soft)}.mix-legend span{display:inline-flex;align-items:center;gap:8px}
.cols,.user-row{display:grid;grid-template-columns:1.1fr 1.7fr 1fr 1fr 1fr 40px;gap:48px;align-items:center;padding:0 24px;width:100%}
.cols{height:44px;background:var(--o50);border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:12px;font-weight:700;color:var(--soft)}
.user-row{height:88px;border-bottom:1px solid var(--line);background:#fff;transition:background .2s,transform .2s}
.user-row:hover,.user-row.selected{background:linear-gradient(90deg,#FFF3E6,#fff 80%)}.user-row:hover{transform:translateX(4px)}.user-row.selected{box-shadow:inset 4px 0 0 var(--orange)}
.uid{font-size:17px;font-weight:600;letter-spacing:-.01em}.num{font-size:18px;font-weight:600;letter-spacing:-.02em}
.num small{font-size:12px;font-weight:600;color:var(--faint);letter-spacing:0;font-family:'Nunito Sans',sans-serif}
.gap.pos{color:var(--green)}.gap.neg{color:var(--red)}
.health-cell{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding-right:16px}
.score{display:flex;align-items:center;gap:12px;width:100%;max-width:260px}
.score-bar{flex:1;height:8px;border-radius:999px;background:var(--o100);overflow:hidden}.score-bar i{display:block;height:100%;border-radius:999px}
.score-bar .healthy{background:var(--gbar)}.score-bar .watch{background:var(--abar)}.score-bar .risk{background:var(--rbar)}
.score b{font:600 13px Poppins,sans-serif;width:24px;text-align:right}
.chev{width:40px;height:40px;border-radius:50%;border:1px solid var(--line);color:var(--orange);display:flex;align-items:center;justify-content:center;background:#fff;box-shadow:var(--sm);transition:transform .2s}
.user-row:hover .chev,.user-row.selected .chev{background:var(--sun);border-color:transparent;color:#fff;box-shadow:0 6px 14px rgba(245,130,31,.4)}.user-row:hover .chev{transform:translateX(4px)}
.empty{padding:48px;text-align:center;color:var(--faint)}
.list-foot{height:72px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;font-weight:600;color:var(--soft)}
.pager{display:flex;gap:8px}.pg{min-width:40px;height:40px;padding:0 12px;border-radius:999px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-weight:600;background:#fff;color:var(--soft)}
.pg.active{background:var(--orange);border-color:var(--orange);color:#fff;box-shadow:0 6px 14px rgba(245,130,31,.35)}

/* customer */
.account-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.account-head>div{display:flex;align-items:baseline;gap:12px}.account-title{font-size:20px;font-weight:600;letter-spacing:-.02em}
.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}
.metric{padding:14px 18px;border-radius:16px;background:var(--o50);border:1px solid var(--line);box-shadow:var(--sm);transition:transform .2s,box-shadow .2s}.metric:hover{transform:translateY(-3px);box-shadow:0 12px 28px rgba(200,100,10,.16)}
.metric.runway{background:linear-gradient(160deg,#FFEBD6,#FFF3E6);border-color:#FFD5AE}.metric.runway .metric-value{color:var(--o-text)}
.metric-top{display:flex;align-items:center;gap:10px}.metric-label{font-size:13px;color:var(--soft);font-weight:500}
.mini-tile{width:28px;height:28px;border-radius:9px;background:var(--orange);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(245,130,31,.3)}
.metric-value{font-size:32px;font-weight:700;letter-spacing:-.03em;margin:8px 0 4px;line-height:1.1}.metric-value small{font-size:14px;font-weight:500;color:var(--soft);letter-spacing:0;margin-left:2px}
.metric-note{font-size:12.5px;color:var(--faint)}
.insight{margin-top:14px;border-radius:14px;padding:2px;background:var(--sun);box-shadow:0 8px 24px rgba(245,130,31,.14)}
.insight-inner{background:#fff;border-radius:12px;padding:9px 18px;display:flex;align-items:center;gap:12px;font-size:14px;font-weight:500}.insight-inner b{font-weight:700;color:var(--o-text)}
.visuals{display:grid;grid-template-columns:250px 1fr 1fr 1.5fr;gap:16px}
.vis-card{display:flex;flex-direction:column}.vis-title{font-size:14px;font-weight:600;margin-bottom:2px}.vis-body{flex:1;display:flex;flex-direction:column;justify-content:center}
.gauge{position:relative;width:190px;height:104px;margin:0 auto}.gauge svg{width:190px;height:104px}
.gauge-center{position:absolute;left:0;right:0;bottom:0;text-align:center}.gauge-center b{display:block;font-size:30px;font-weight:700;letter-spacing:-.03em;line-height:1}.gauge-center span{font-size:13px;color:var(--soft)}
.gauge-ends{display:flex;justify-content:space-between;width:190px;margin:4px auto 0;font-size:11px;color:var(--faint)}
.pair{display:flex;flex-direction:column;gap:10px}.pair-label{display:flex;justify-content:space-between;font-size:13px;font-weight:500;color:var(--soft);margin-bottom:4px}.pair-label b{color:var(--ink);font-size:15px;font-weight:700}
.pair-bar{height:20px;border-radius:8px;background:var(--o50);overflow:hidden}.pair-bar i{display:block;height:100%;border-radius:8px}
.pair-bar .in{width:100%;background:linear-gradient(90deg,#FF8F2E,#F58220)}.pair-bar .out{width:93.8%;background:linear-gradient(90deg,#FFC48A,#FFB067)}
.chip-green{align-self:flex-start;margin-top:12px;display:inline-flex;align-items:center;gap:8px;padding:5px 14px;border-radius:999px;background:var(--gbg);color:var(--green);font-weight:600;font-size:13px}
.blocks,.blocks-scale{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}.block{height:40px;border-radius:10px;background:var(--o100);position:relative;overflow:hidden}
.block i{position:absolute;inset:0 auto 0 0;background:linear-gradient(160deg,#FF8F2E,#F58220)}
.blocks-scale{margin-top:4px;font-size:11px;color:var(--faint);text-align:center}.blocks-big{margin-top:10px;font-size:26px;font-weight:700;letter-spacing:-.03em}.blocks-big small{font-size:14px;font-weight:500;color:var(--soft);letter-spacing:0;margin-left:8px}
.card-spending{display:grid;grid-template-columns:132px 1fr;column-gap:18px;align-content:center}.card-spending .card-head{grid-column:1/-1;margin-bottom:8px}
.donut-wrap{grid-column:1;grid-row:2/4;align-self:center}.donut{position:relative;width:120px;height:120px}.donut svg{width:120px;height:120px;transform:rotate(-90deg)}
.donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}.donut-center b{font-size:17px;font-weight:700;letter-spacing:-.03em}.donut-center span{font-size:11px;color:var(--soft)}
.legend{grid-column:2;grid-row:2;display:flex;flex-direction:column;gap:6px;align-self:end}.legend-row{display:flex;align-items:center;gap:12px;font-size:14px;font-weight:500}.legend-row .dot{width:12px;height:12px}.dot.a{background:var(--orange)}.dot.b{background:var(--o300)}.pct{margin-left:auto;font-weight:700}
.fixed{grid-column:2;grid-row:3;margin-top:8px;padding-top:8px;border-top:1px solid var(--line);align-self:start}.fixed-row{display:flex;justify-content:space-between;font-weight:500;margin-bottom:6px}.fixed-note{margin-top:4px;font-size:12px;color:var(--faint)}
.card-history{position:relative;display:grid;grid-template-columns:1fr 1fr;column-gap:24px;align-items:start}.card-history .card-head{grid-column:1/-1}
.card-history .chart-legend{position:absolute;right:150px;top:24px;margin:0}
.chart-label{display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin:0 0 2px;grid-row:2}.chart-label span:last-child:not(:first-child){font-weight:500;color:var(--faint);font-size:12px}
.c1{grid-column:1}.c2{grid-column:2}.chart-svg.c1,.chart-svg.c2{grid-row:3}

/* stress */
.stress-test{padding:0 var(--gx);display:grid;grid-template-columns:400px 1fr;gap:16px;align-items:stretch}
.right-col{display:flex;flex-direction:column;gap:16px}.card-shock{display:flex;flex-direction:column;gap:16px}.card-shock .card-head{margin:0}
.presets{display:grid;grid-template-columns:1fr 1fr;gap:8px}.presets .pill{padding:9px 14px;justify-content:center;text-align:center}
.sliders{flex:1;display:flex;flex-direction:column;justify-content:space-evenly;gap:12px}
.slider-label{display:flex;justify-content:space-between;font-size:14px;font-weight:500;margin-bottom:8px}.val{color:var(--o-text);font-weight:600}
.track{position:relative;height:8px;border-radius:999px;background:var(--o100);cursor:pointer;touch-action:none}.track::after{content:"";position:absolute;inset:-14px 0}
.fill{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:linear-gradient(90deg,#FF8F2E,#F58220)}
.thumb{position:absolute;top:50%;width:22px;height:22px;border-radius:50%;background:#fff;border:3px solid var(--orange);transform:translate(-50%,-50%);box-shadow:0 4px 10px rgba(245,130,31,.35);transition:transform .15s}.dragging .thumb{transform:translate(-50%,-50%) scale(1.2)}
.track-scale{display:flex;justify-content:space-between;font-size:11px;color:var(--faint);margin-top:6px}
.hero-runway{border-radius:16px;padding:18px 28px;display:flex;justify-content:space-between;align-items:center;color:#fff;position:relative;overflow:hidden;box-shadow:0 16px 40px rgba(200,100,10,.16);background:radial-gradient(420px 220px at 100% 0%,rgba(255,164,58,.45),transparent 70%),radial-gradient(360px 200px at 85% 110%,rgba(232,80,31,.35),transparent 70%),linear-gradient(135deg,#FFA04A,#F58220 50%,#E4620A)}
.hero-label{font-size:16px;font-weight:500;opacity:.88;display:flex;align-items:center;gap:8px}.hero-number{font-size:56px;font-weight:700;letter-spacing:-.04em;line-height:1.05;margin-top:2px}.hero-number small{font-size:24px;font-weight:500;margin-left:8px;opacity:.9}
.hero-chip{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);font-size:14px;font-weight:500}.hero-chip b{font-weight:700}
.verdict{display:flex;align-items:center;gap:16px;padding:10px 20px;background:var(--rbg);border:1px solid var(--rline);border-radius:16px;box-shadow:var(--sm)}
.verdict.good{background:#DFF5E9;border-color:#A8E0C3}.verdict.good .verdict-text{color:#0D4A30}.verdict.good .verdict-icon{color:var(--green)}
.verdict-icon{width:40px;height:40px;border-radius:12px;background:#fff;color:var(--red);display:flex;align-items:center;justify-content:center}.verdict-text{flex:1;color:#7A1626;font-size:15px;font-weight:500}.verdict-text b{font-weight:700}
.chart-compare{display:grid;grid-template-columns:1fr 290px;gap:16px;flex:1}.card-chart{display:flex;flex-direction:column}.card-chart .chart-svg{flex:1;min-height:0}
.swatch{width:16px;height:3px;border-radius:2px;background:var(--orange)}.swatch.dash{background:repeating-linear-gradient(90deg,var(--red) 0 4px,transparent 4px 7px)}
table.compare{width:100%;border-collapse:collapse;font-size:14px}.compare th{text-align:right;font-size:12px;font-weight:600;color:var(--faint);padding:0 0 8px}.compare th:first-child,.compare td:first-child{text-align:left}
.compare td{padding:9px 0;border-top:1px solid var(--line);text-align:right;font-weight:600;font-variant-numeric:tabular-nums}.compare td:first-child{font-weight:500;color:var(--soft)}.compare td.after{color:var(--red)}.compare tr.runway td{font-size:15px}
.table-note{margin-top:10px;padding:12px;border-radius:12px;background:var(--o50);font-size:12px;color:var(--soft)}

/* plan */
.plan-builder{margin:0 var(--gx) 16px}.prompt-box{border-radius:999px;padding:2px;background:var(--sun);box-shadow:0 10px 28px rgba(245,130,31,.2)}
.prompt-inner{background:#fff;border-radius:999px;padding:6px 6px 6px 20px;display:flex;align-items:center;gap:16px;height:52px}
.prompt-text{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:15px}
.send-btn{width:40px;height:40px;border-radius:50%;background:var(--sun);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(245,130,31,.4)}.send-btn.busy svg{animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.plan-grid{display:grid;grid-template-columns:380px 1fr 400px;gap:16px;align-items:stretch}
.goal-hero{grid-column:1;grid-row:1;padding:22px 26px;border-radius:16px;display:flex;flex-direction:column;justify-content:center;color:#fff;position:relative;overflow:hidden;box-shadow:0 16px 40px rgba(200,100,10,.16);background:radial-gradient(420px 220px at 100% 0%,rgba(255,164,58,.45),transparent 70%),radial-gradient(360px 200px at 85% 110%,rgba(232,80,31,.35),transparent 70%),linear-gradient(135deg,#FFA04A,#F58220 50%,#E4620A)}
.goal-hero .lbl{font-size:16px;font-weight:500;opacity:.9;display:flex;align-items:center;gap:8px}.goal-hero .big{font-size:48px;font-weight:700;letter-spacing:-.04em;line-height:1.1;margin:4px 0 16px}.goal-hero .big small{font-size:16px;font-weight:500;letter-spacing:0;margin-left:8px;opacity:.85}
.hero-bar{height:14px;border-radius:999px;background:rgba(255,255,255,.22);overflow:hidden}.hero-bar i{display:block;width:70%;height:100%;border-radius:999px;background:#fff}
.hero-meta{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-top:12px;font-weight:500}.hero-meta .hero-chip{padding:6px 12px;font-size:13px;font-weight:600}
.hero-spark{position:absolute;right:32px;top:28px;opacity:.5}
.card-roadmap{grid-column:2;grid-row:1}.card-steps{grid-column:3;grid-row:1/3;display:flex;flex-direction:column}.card-faster{grid-column:1;grid-row:2}.card-backup{grid-column:2;grid-row:2}
.steps{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}
.step{display:flex;align-items:center;gap:16px;padding:12px 14px;border:1px solid var(--line);border-radius:16px;background:#fff;box-shadow:var(--sm);transition:transform .2s}.step:hover{transform:translateX(4px)}
.check{width:28px;height:28px;border-radius:50%;border:2px solid var(--o300);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;transition:background .2s,border-color .2s}.check.done{background:var(--orange);border-color:var(--orange)}.check.pop{animation:pop .35s}
@keyframes pop{0%{transform:scale(.6)}60%{transform:scale(1.15)}100%{transform:scale(1)}}
.step-body{flex:1}.step-body b{display:block;font-weight:600;font-size:15px}.step-body span{font-size:13px;color:var(--soft)}
.tag{padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;background:var(--gbg);color:var(--green);white-space:nowrap}
.step-note{margin-top:auto;padding:16px;border-radius:14px;background:var(--o50);display:flex;align-items:center;gap:12px;font-weight:500;font-size:13px}
.race{display:flex;flex-direction:column;gap:14px}.race-label{display:flex;justify-content:space-between;font-weight:500;margin-bottom:6px}.race-label b{font:700 16px Poppins,sans-serif}
.race-bar{height:20px;border-radius:8px;background:var(--o50);overflow:hidden}.race-bar i{display:block;height:100%;border-radius:8px}
.race-bar .a{width:100%;background:linear-gradient(90deg,#FFC48A,#FFB067)}.race-bar .b{width:45%;background:linear-gradient(90deg,#FF8F2E,#F58220)}.race-bar .c{width:36%;background:linear-gradient(90deg,#FFA43A,#F58220)}
.backup-list{display:flex;flex-direction:column;gap:8px}
.backup-row{display:flex;align-items:center;gap:16px;padding:9px 14px;border:1px solid var(--line);border-radius:14px;background:#fff;box-shadow:var(--sm);transition:transform .2s,box-shadow .2s}.backup-row:hover{transform:translateY(-3px);box-shadow:0 12px 28px rgba(200,100,10,.16)}
.backup-row.best{border-color:#A8E0C3;background:#F7FDFA}
.rank{width:28px;height:28px;border-radius:50%;background:var(--o100);color:var(--o-text);font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0}.backup-text{flex:1;font-weight:500}

@media (prefers-reduced-motion:reduce){.cs *{animation:none!important;transition:none!important}}
`;
