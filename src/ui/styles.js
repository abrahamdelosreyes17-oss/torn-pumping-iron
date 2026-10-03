/*
 * The webpage's look: K's tokens and components (mockups/K-home.html and
 * mockups/pi.css, DESIGN.md §1), with the round 7 type pass
 * (mockups/round7/home.html): Source Serif 4 for titles and the one big
 * number, Inter for everything else, an 8 px grid. Inside the page's shadow
 * root, so Torn Eye and overlay styles on torn.com never mix with it.
 */

export const APP_CSS = `
:host {
  --page:#141618; --card:#1c1f22; --card2:#24282c; --line:#2c3136; --line2:#3a4046;
  --text:#e3e5e8; --muted:#939aa1; --dim:#6c737a; --white:#fff;
  --chalk:#efebe2; --on-chalk:#15171a;
  --str:#e5534b; --def:#4a8ff0; --spd:#f0c02f; --dex:#43b86c;
  --good:#9bdc8a; --warn:#e8a33d; --bad:#ff6b5e; --link:#8fb8e8;
  --b-stomp:#3fbf5a; --b-good:#a6e08a; --b-tough:#f0a040; --b-cant:#ff5a4e; --b-none:#6c737a;
  --serif: "Source Serif 4", Georgia, "Times New Roman", serif; --sans: Inter, "Segoe UI", system-ui, sans-serif; --display: var(--serif);
}
* { box-sizing: border-box; }
.pi-root { margin: 0; min-height: 100vh; background: var(--page); color: var(--text); font: 400 14px/1.5 var(--sans); -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
.num { font-variant-numeric: tabular-nums; }
.lab { font-size: 13px; font-weight: 500; color: var(--muted); white-space: nowrap; }
.grow { flex: 1; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
.muted { color: var(--muted); } .dim { color: var(--dim); } .white { color: var(--white); }
.s-str { color: var(--str); } .s-def { color: var(--def); } .s-spd { color: var(--spd); } .s-dex { color: var(--dex); }
.c-good { color: var(--good); } .c-warn { color: var(--warn); } .c-bad { color: var(--bad); }
.mark { width: 24px; height: 24px; border-radius: 50%; background: var(--chalk); display: grid; place-items: center; box-shadow: inset 0 0 0 4px var(--chalk), inset 0 0 0 6px #2a2d31; flex: none; }
.mark i { width: 6px; height: 6px; border-radius: 50%; background: var(--on-chalk); }
.mark.sm { width: 18px; height: 18px; box-shadow: inset 0 0 0 3px var(--chalk), inset 0 0 0 4px #2a2d31; }
.mark.sm i { width: 4px; height: 4px; }

/* density; --edge: the page's side margin, 32 px, wider past 1600 px so every bar and card lines up on one column */
.app { --row: 44px; --pad: 16px; --gap: 24px; --sec: 24px; --edge: max(32px, calc((100% - 1600px) / 2 + 32px)); min-width: 1180px; background: var(--page); }

/* top bar */
.top { height: 56px; display: flex; align-items: center; gap: 4px; padding: 0 var(--edge); border-bottom: 1px solid var(--line); }
.brand { font: 600 15px/1 var(--sans); letter-spacing: .08em; color: var(--white); text-transform: uppercase; margin: 0 20px 0 6px; white-space: nowrap; }
.tab { height: 56px; display: inline-flex; align-items: center; padding: 0 10px; color: var(--muted); font-weight: 500; border-bottom: 2px solid transparent; white-space: nowrap; }
.tab:hover { text-decoration: none; color: var(--text); }
.tab.on { color: var(--white); border-bottom-color: var(--chalk); }
.upd { color: var(--muted); font-size: 13px; display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.upd i { width: 7px; height: 7px; border-radius: 50%; background: var(--good); }
.seg { display: inline-flex; border: 1px solid var(--line2); border-radius: 999px; overflow: hidden; flex: none; }
.top .seg { margin-left: 12px; }
.seg button { height: 30px; padding: 0 14px; background: transparent; border: 0; color: var(--muted); font: 500 13px var(--sans); cursor: pointer; white-space: nowrap; }
.seg button[aria-pressed="true"] { background: var(--chalk); color: var(--on-chalk); }
.seg button:focus-visible { outline: 2px solid var(--chalk); outline-offset: -2px; }

/* status strip: the only uppercase labels on the page */
.strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 32px; padding: 20px var(--edge) 24px; border-bottom: 1px solid var(--line); background: #171a1c; }
.st { display: flex; flex-direction: column; gap: 0; min-width: 0; }
.st-h { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.st-h .lab { font-size: 12px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; }
.st-h b { font: 600 22px/1.2 var(--serif); color: var(--white); white-space: nowrap; }
.st-h b.warn { color: var(--warn); } .st-h b.good { color: var(--good); }
.bar { height: 4px; border-radius: 2px; background: var(--card2); overflow: hidden; }
.st .bar { margin: 10px 0 8px; }
.bar i { display: block; height: 100%; border-radius: 2px; }
.st small { color: var(--muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* body 70 / 30 */
.body { display: grid; grid-template-columns: minmax(0, 7fr) minmax(300px, 3fr); gap: 32px; padding: 32px var(--edge); }
.main, .pane { display: flex; flex-direction: column; gap: var(--sec); min-width: 0; }
.sh { display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.sh h2 { margin: 0; font: 600 19px/1.3 var(--serif); color: var(--white); }
.sh h3 { margin: 0; font: 600 19px/1.3 var(--serif); color: var(--white); }
.sh .meta { color: var(--muted); font-size: 13px; }
.sh .meta b { color: var(--good); font-weight: 500; }
.sh .right { margin-left: auto; }
.ct { font: 600 19px/1.3 var(--serif); color: var(--white); }

/* buttons */
.acts { display: flex; gap: 8px; }
.btn { height: 36px; padding: 0 16px; border-radius: 8px; border: 1px solid var(--line2); background: var(--card2); color: var(--text); font: 500 14px var(--sans); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; white-space: nowrap; }
.btn:hover { text-decoration: none; border-color: var(--muted); }
.btn.primary { background: var(--chalk); color: var(--on-chalk); border-color: var(--chalk); }
.btn.sm { height: 30px; padding: 0 12px; font-size: 13px; border-radius: 7px; }
.btn.ghost { background: transparent; }
.btn:focus-visible { outline: 2px solid var(--chalk); outline-offset: 2px; }

/* next band (Home primary) */
.next { display: grid; grid-template-columns: auto 1fr auto; gap: 24px; align-items: center; padding: 20px 24px; background: var(--card2); border-radius: 12px; }
.next .cd { font: 600 40px/1 var(--serif); color: var(--chalk); min-width: 96px; }
.next .what b { display: block; font-size: 17px; font-weight: 600; color: var(--white); }
.next .what span { color: var(--muted); font-size: 13px; }

/* tables (steps, sources, targets, war) */
.tbl { width: 100%; border-collapse: collapse; }
.tbl th { text-align: left; font-size: 13px; font-weight: 500; color: var(--muted); padding: 0 8px 8px; white-space: nowrap; vertical-align: bottom; }
.tbl td { height: var(--row); padding: 6px 8px; border-top: 1px solid var(--line); }
.tbl .r { text-align: right; }
.tbl .t { color: var(--muted); width: 64px; white-space: nowrap; }
.tbl tr.done td { color: var(--dim); }
.tbl tr.done .ok { color: var(--good); }
.tbl tr.now td { background: #202428; color: var(--white); }
.tbl tr.now .t { color: var(--chalk); }
.tbl tr.sel td { background: #202428; }
.tbl tr.sel td:first-child { box-shadow: inset 2px 0 0 var(--chalk); }
.tbl tr.pending td { background: #26221c; }
.tbl tr.pending td:first-child { box-shadow: inset 2px 0 0 var(--warn); }
.tbl tr.click { cursor: pointer; }
.tbl tr.click:hover td { background: #1f2326; }
.tbl .when, .tbl td.second { color: var(--muted); font-size: 13px; }
.tbl small { color: var(--muted); font-size: 13px; }
.tbl tfoot td { border-top: 1px solid var(--line2); color: var(--muted); font-size: 13px; }
.tbl tfoot b { color: var(--white); }
.tbl b, .tbl b.w { font-weight: 600; }
.tbl b.w { color: var(--white); }

/* stats vs build */
.sg { display: flex; flex-direction: column; }
.sgr { display: grid; grid-template-columns: 40px 108px minmax(0, 1fr) 120px 110px 84px; gap: 16px; align-items: center; height: var(--row); border-top: 1px solid var(--line); }
.sgr:first-of-type { border-top: 0; }
.sgr b.n { font: 600 13px var(--sans); letter-spacing: .04em; }
.sgr .v { text-align: right; font-weight: 600; color: var(--white); }
.share { position: relative; height: 6px; border-radius: 3px; background: var(--card2); }
.share i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; }
.share em { position: absolute; top: -4px; width: 2px; height: 14px; background: var(--chalk); }
.sgr .gap { text-align: right; font-size: 13px; color: var(--muted); }
.sgr .tod { text-align: right; font-size: 13px; }
.spark { width: 76px; height: 18px; }
.sgfoot { display: flex; flex-wrap: wrap; gap: 8px 24px; color: var(--muted); font-size: 13px; margin-top: 16px; }
.sgfoot b { color: var(--text); font-weight: 500; }

/* buy (pane) */
.buy { display: flex; flex-direction: column; }
.bi { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 4px 12px; align-items: center; padding: 12px 0; border-top: 1px solid var(--line); }
.bi:first-of-type { border-top: 0; }
.bi b { color: var(--white); font-weight: 500; }
.bi small { grid-column: 1 / 2; color: var(--muted); font-size: 13px; }
.bi .p { text-align: right; font-weight: 600; }
.buyfoot { display: flex; justify-content: space-between; align-items: baseline; border-top: 1px solid var(--line2); padding-top: 8px; color: var(--muted); font-size: 13px; }
.buyfoot b { color: var(--white); font: 600 18px var(--sans); }

/* heads-up list */
.heads { display: flex; flex-direction: column; gap: 0; margin: 0; padding: 0; list-style: none; }
.heads li { display: grid; grid-template-columns: 7px 1fr; gap: 12px; align-items: start; font-size: 14px; }
.heads li i { width: 7px; height: 7px; border-radius: 50%; background: var(--dim); margin-top: 8px; }
.heads li.w i { background: var(--warn); }
.heads li.g i { background: var(--good); }
.heads li span { color: var(--muted); }

/* small card (current plan, selected choice) */
.plan { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
.plan b { color: var(--white); font-weight: 600; }
.plan span { color: var(--muted); font-size: 13px; }

/* primary card (Plan's recommendation, Buy's total) */
.prime { padding: var(--pad) 16px; background: var(--card); border: 1px solid var(--chalk); border-radius: 14px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
.prime .k { font: 600 24px/1.2 var(--serif); color: var(--white); }
.prime .d { color: var(--muted); }
.prime .figs { display: flex; flex-wrap: wrap; gap: 16px 40px; }
.fig { display: flex; flex-direction: column; gap: 4px; }
.fig b { font: 600 20px/1.2 var(--sans); color: var(--white); white-space: nowrap; }
.fig b.good { color: var(--good); }
.prime .why { grid-column: 1 / -1; color: var(--muted); font-size: 13px; border-top: 1px solid var(--line); padding-top: 16px; display: flex; flex-direction: column; gap: 8px; }
.pill-tag { display: inline-flex; align-items: center; height: 22px; padding: 0 10px; border-radius: 11px; font-size: 12px; font-weight: 500; background: var(--card2); color: var(--muted); vertical-align: 3px; white-space: nowrap; }
.pill-tag.chalk { background: var(--chalk); color: var(--on-chalk); }

/* warning block */
.warnb { border-left: 3px solid var(--warn); background: #231d12; padding: 16px 20px; border-radius: 0 10px 10px 0; display: flex; flex-direction: column; gap: 8px; }
.warnb b { color: #ffd79a; font-size: 14px; font-weight: 600; }
.warnb p { margin: 0; color: var(--text); max-width: 90ch; }
.warnb .acts { margin-top: 0; }
.app > .warnb.paused { padding: 16px var(--edge); }

/* builds */
.builds { display: flex; flex-direction: column; }
.brow { display: grid; grid-template-columns: 150px 180px minmax(0, 1fr) auto; gap: 16px; align-items: center; height: var(--row); padding: 0 8px; border-top: 1px solid var(--line); cursor: pointer; }
.brow:first-child { border-top: 0; }
.brow.sel { background: var(--card); box-shadow: inset 0 0 0 1px var(--chalk); border-radius: 8px; border-top-color: transparent; }
.brow.sel + .brow { border-top-color: transparent; }
.brow b { color: var(--white); font-weight: 600; }
.brow span { color: var(--muted); font-size: 13px; }
.ratio { display: flex; height: 8px; border-radius: 4px; overflow: hidden; gap: 1px; }
.ratio i { display: block; height: 100%; }

/* inputs */
.field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.field .inp { width: 100%; }
.field .lab { white-space: normal; }
.inp { height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--line2); background: #111315; color: var(--text); font: 400 14px var(--sans); min-width: 0; }
.inp:focus { outline: 2px solid var(--chalk); outline-offset: -1px; }
.inp.masked { -webkit-text-security: disc; }
textarea.inp.ta { height: auto; padding: 8px 12px; line-height: 1.5; resize: vertical; }
.row { display: flex; gap: 8px; align-items: center; }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 13px; }
.kv dt { color: var(--muted); } .kv dd { margin: 0; text-align: right; }

/* settings sections */
.sec { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 32px; padding: 24px 0; border-top: 1px solid var(--line); }
.sec:first-child { border-top: 0; padding-top: 0; }
.sec h3 { margin: 0 0 8px; font: 600 19px/1.3 var(--serif); color: var(--white); }
.state { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }
.state i { width: 7px; height: 7px; border-radius: 50%; background: var(--dim); }
.state.ok { color: var(--good); } .state.ok i { background: var(--good); }
.state.off { color: var(--muted); }
.state.bad { color: var(--bad); } .state.bad i { background: var(--bad); }
.secbody { display: flex; flex-direction: column; gap: 16px; max-width: 760px; min-width: 0; }
.secbody p { margin: 0; color: var(--muted); }
ol.steps-list { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
/* A plan being worked out (the Plan card): the card's own day line, filling */
.planrun { margin-top: 16px; }
.planrun .dayline i { transition: none; opacity: .72; }
/* Re-plan running (the owner's pick, 2A in mockups/round7/animation-options.html): a light crosses the whole bar, so it
   shows even at 2%. Transform only. Still under the PC's "reduce motion" and with Settings › Animations off. */
.planrun .dayline::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(255,255,255,0) 38%, rgba(255,255,255,.7) 50%, rgba(255,255,255,0) 62%); transform: translateX(-100%); animation: pi-sweep 1.8s linear infinite; }
@keyframes pi-sweep { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .planrun .dayline::after { animation: none; opacity: 0; } }
.pi-root.still .planrun .dayline::after { animation: none; opacity: 0; }
/* Report a problem */
ul.incl { margin: 8px 0 0; padding-left: 20px; color: var(--muted); font-size: 13px; display: flex; flex-direction: column; gap: 4px; }
.shots { display: flex; flex-wrap: wrap; gap: 8px; }
.shot { position: relative; display: inline-block; }
.shot img { display: block; height: 72px; max-width: 160px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line2); }
.shot .x { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 50%; border: 0; background: #111315; color: var(--text); cursor: pointer; line-height: 1; }
pre.logbox { margin: 0; padding: 12px; max-height: 260px; overflow: auto; white-space: pre-wrap; font: 12px/1.5 Consolas, "Cascadia Mono", monospace; color: var(--muted); background: #111315; border: 1px solid var(--line); border-radius: 8px; }
details.dis > summary { cursor: pointer; color: var(--link); font-size: 13px; list-style: none; }
details.dis > summary::before { content: "▸ "; }
details.dis[open] > summary::before { content: "▾ "; }
.tos { border-collapse: collapse; margin-top: 8px; width: 100%; font-size: 13px; }
.tos th { text-align: left; color: var(--muted); font-weight: 500; padding: 8px 16px 8px 0; width: 170px; vertical-align: top; border-top: 1px solid var(--line); }
.tos td { padding: 8px 0; border-top: 1px solid var(--line); }
.check { display: inline-flex; align-items: center; gap: 8px; }
.check input { accent-color: var(--chalk); width: 15px; height: 15px; margin: 0; }

/* charts */
.chart { width: 100%; display: block; }
.chart text { font: 11px var(--sans); fill: var(--muted); }
.chart .ax { stroke: var(--line); }
.legend { display: flex; gap: 16px; font-size: 13px; color: var(--muted); }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }

/* Torn Eye chip */
.chip { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 12px 0 8px; border-radius: 15px; background: #1e2124; border: 1px solid var(--line2); font: 13px var(--sans); color: var(--text); white-space: nowrap; }
.chip .dot { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 3px currentColor; background: #111; flex: none; }
.chip b { font-weight: 600; }
.chip .src { color: var(--dim); font-size: 12px; }
.b-stomp { color: var(--b-stomp); } .b-good { color: var(--b-good); } .b-tough { color: var(--b-tough); } .b-cant { color: var(--b-cant); } .b-none { color: var(--b-none); }
.chip .figs { color: var(--text); }
.band { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; white-space: nowrap; }
.band .dot { width: 10px; height: 10px; border-radius: 50%; box-shadow: inset 0 0 0 3px currentColor; background: #111; }

/* hover card */
.hcard { width: 330px; background: var(--card); border: 1px solid var(--line2); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.45); }
.hcard .hh { display: flex; align-items: baseline; gap: 8px; }
.hcard .hh b { color: var(--white); font-size: 14px; font-weight: 600; }
.kept { display: grid; grid-template-columns: 80px minmax(0,1fr) 40px; gap: 8px; align-items: center; font-size: 13px; }
.kept .bar { height: 6px; }
.hcard .foot { font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 8px; }

/* overlay pill + card (on torn.com) */
.pi-pill { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px 0 6px; border-radius: 18px; background: #1b1e21; border: 1px solid var(--line2); box-shadow: 0 4px 14px rgba(0,0,0,.4); font: bold 13px Arial; color: var(--text); }
.pi-pill .cd { font: bold 16px "Arial Narrow", Arial, sans-serif; color: var(--chalk); }
.pi-card { width: 280px; background: #1b1e21; border: 1px solid var(--line2); border-radius: 10px; padding: 12px 14px; box-shadow: 0 8px 24px rgba(0,0,0,.5); display: flex; flex-direction: column; gap: 8px; }
.pi-card .cd { font: bold 34px/1 "Arial Narrow", Arial, sans-serif; color: var(--chalk); }
.pi-card .step { font-weight: bold; color: var(--white); }
.pi-card .mini { display: grid; grid-template-columns: 48px 1fr 60px; gap: 6px; align-items: center; font-size: 11px; color: var(--muted); }
.pi-card .later { font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 6px; display: flex; flex-direction: column; gap: 3px; }
/* app-only additions */
* { box-sizing: border-box; }
.pi-root button, .pi-root input, .pi-root select, .pi-root textarea { font-family: var(--sans); }
.pi-root b, .pi-root strong { font-weight: 600; }
.app { min-height: 100vh; }
.empty { padding: 48px var(--edge); display: flex; flex-direction: column; gap: 16px; align-items: flex-start; max-width: calc(640px + 64px); }
.empty h2 { margin: 0; font: 600 28px/1.2 var(--serif); color: var(--white); }
.empty p { margin: 0; color: var(--muted); }
.toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--card2); border: 1px solid var(--line2); color: var(--text); padding: 8px 16px; border-radius: 10px; font-size: 14px; z-index: 5; }
.msg { font-size: 13px; }
.msg.ok { color: var(--good); } .msg.bad { color: var(--bad); }
.tab { cursor: pointer; }
.btn:disabled { opacity: .45; cursor: default; }
.brow:focus-visible, .tbl tr.click:focus-visible { outline: 2px solid var(--chalk); outline-offset: -2px; }
.pane .chart { max-width: 100%; }
.big { font: 600 32px/1.2 var(--serif); color: var(--white); }
.pr { display: grid; grid-template-columns: 90px 76px 1fr; gap: 12px; align-items: center; height: var(--row); border-top: 1px solid var(--line); font-size: 13px; }
.pr:first-child { border-top: 0; }
.pr b { color: var(--white); font-size: 14px; }
.pr .r { text-align: right; }
.smc { display: flex; flex-direction: column; gap: 4px; }
.smc .h { display: flex; justify-content: space-between; align-items: baseline; }
.smc .h b { font: 600 13px var(--sans); letter-spacing: .04em; }
.smc .h span { font-weight: 600; color: var(--white); }
.smc small { color: var(--muted); font-size: 13px; }
.tl { display: flex; flex-direction: column; }
.tlr { display: grid; grid-template-columns: 18px 170px 90px minmax(0, 1fr) 110px; gap: 12px; align-items: center; height: var(--row); border-top: 1px solid var(--line); }
.tlr:first-child { border-top: 0; }
.tlr .dotc { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--dim); }
.tlr.now .dotc { background: var(--chalk); border-color: var(--chalk); }
.tlr.next .dotc { border-color: var(--chalk); }
.tlr b { color: var(--white); }
.tlr .r { text-align: right; }
.meter { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; align-items: baseline; padding: 12px 0; border-top: 1px solid var(--line); }
.meter:first-child { border-top: 0; }
.meter .bar { grid-column: 1 / -1; }
.meter b { color: var(--white); }
.keyrow { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; max-width: 560px; }
.data { display: flex; flex-direction: column; }
.dr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 12px; align-items: center; padding: 12px 0; border-top: 1px solid var(--line); }
.dr:first-child { border-top: 0; }
.dr b { color: var(--white); font-weight: 500; }
.dr small { color: var(--muted); font-size: 13px; }
.opts { display: flex; flex-wrap: wrap; gap: 8px 24px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding-bottom: 16px; }
.filters .inp { width: 64px; height: 30px; }
.slider { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
.slider input { accent-color: var(--chalk); width: 140px; }
.bands { display: flex; flex-direction: column; }
.bandr { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; align-items: center; min-height: var(--row); border-top: 1px solid var(--line); font-size: 13px; }
.bandr:first-child { border-top: 0; }
.bandr .inp { width: 56px; height: 30px; padding: 0 8px; text-align: right; }
.stok { color: var(--good); } .sthos { color: var(--bad); } .sttr { color: var(--link); }

/* ---- Round 3 (mockups/round3/r3.css): control bars, tick chips, cards with more room, charts, the Plan chooser. ---- */
.tab .n { margin-left: 6px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--card2); color: var(--text); font-size: 12px; font-weight: 500; line-height: 18px; text-align: center; }
.tab .dotw { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); margin-left: 6px; }
.topwarn { display: inline-flex; align-items: center; gap: 8px; height: 30px; margin-right: 16px; padding: 0 12px 0 8px; border: 1px solid var(--warn); border-radius: 15px; color: var(--warn); font-size: 13px; font-weight: 500; text-decoration: none; white-space: nowrap; }
.topwarn i { font-style: normal; width: 16px; height: 16px; border-radius: 50%; background: var(--warn); color: #15171a; display: inline-grid; place-items: center; font-size: 11px; font-weight: 600; }
.topwarn:hover, .topwarn:focus-visible { background: #231d12; outline: none; }
.strip.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.ctl { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 16px var(--edge); border-bottom: 1px solid var(--line); background: #171a1c; font-size: 14px; }
.ctl + .ctl { padding-top: 0; margin-top: -1px; border-top: 0; }
.ctl .lab { margin-right: -8px; }
.ctl .inp { height: 32px; width: auto; }
.ctl .sep { width: 1px; height: 24px; background: var(--line2); }
.ctl select, .ctl .sel { height: 32px; padding: 0 32px 0 12px; border-radius: 8px; border: 1px solid var(--line2); background: var(--card2) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23939aa1'/%3E%3C/svg%3E") no-repeat right 12px center; color: var(--text); font: 500 13px var(--sans); display: inline-flex; align-items: center; appearance: none; }
.info { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; border: 1px solid var(--line2); color: var(--muted); font: 600 11px var(--sans); cursor: help; }
.ticks { display: inline-flex; gap: 8px; flex-wrap: wrap; }
.tk { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 12px 0 10px; border-radius: 15px; border: 1px solid var(--line2); color: var(--muted); font: 500 13px var(--sans); cursor: pointer; user-select: none; background: transparent; white-space: nowrap; }
.tk i { width: 12px; height: 12px; border-radius: 3px; border: 1px solid var(--dim); display: grid; place-items: center; }
.tk[aria-pressed="true"] { color: var(--text); border-color: var(--muted); }
.tk[aria-pressed="true"] i { background: var(--chalk); border-color: var(--chalk); }
.tk[aria-pressed="true"] i::after { content: ""; width: 6px; height: 3px; border: solid var(--on-chalk); border-width: 0 0 2px 2px; transform: rotate(-45deg) translate(1px, -1px); }
.tk:focus-visible { outline: 2px solid var(--chalk); outline-offset: 2px; }
.why { color: var(--warn); font-size: 13px; }
.why.ok { color: var(--muted); }
.tbl tr.whatif td { color: var(--dim); }
.tbl tr.whatif b.w { color: var(--muted); }
.tag { white-space: nowrap; display: inline-block; height: 22px; line-height: 22px; padding: 0 9px; border-radius: 11px; font-size: 12px; font-weight: 500; background: var(--card2); color: var(--muted); vertical-align: 1px; }
.tag.chalk { background: var(--chalk); color: var(--on-chalk); }
.tag.warn { background: #3a2a10; color: var(--warn); }
.tag.good { background: #1f3320; color: var(--good); }
.bl { display: flex; flex-direction: column; }
.bl .r { display: grid; grid-template-columns: 78px 90px 1fr; gap: 12px; align-items: center; height: var(--row); padding: 0 12px; border-top: 1px solid var(--line); cursor: pointer; font-size: 13px; }
.bl .r:first-child { border-top: 0; }
.bl .r b { color: var(--white); font-size: 14px; }
.bl .r span { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bl .r.sel { border: 1px solid var(--chalk); border-radius: 8px; }
.bl .r:focus-visible { outline: 2px solid var(--chalk); outline-offset: -2px; }
.bl .ratio { height: 8px; }
.nowb { display: grid; grid-template-columns: auto 1fr auto; gap: 24px; align-items: center; padding: 20px 24px; border-radius: 12px; background: var(--card2); }
.nowb .k { font: 600 12px var(--sans); color: var(--on-chalk); background: var(--chalk); border-radius: 6px; padding: 4px 8px; }
.nowb .cd { font: 600 40px/1 var(--serif); color: var(--chalk); min-width: 88px; }
.nowb b { font-size: 17px; font-weight: 600; line-height: 1.35; color: var(--white); }
.nowb span.s { color: var(--muted); font-size: 13px; }
.nowb .acts { display: flex; gap: 8px; }
.tbl tr.ih td { height: var(--row); background: #191c1f; }
.tbl tr.ih b { font-size: 14px; color: var(--white); }
.tbl tr.sub td:first-child { padding-left: 24px; }
.verdict { font-size: 13px; }
svg.ch { width: 100%; display: block; overflow: visible; }
svg.ch text { font: 11px var(--sans); fill: var(--muted); }
svg.ch .ax { stroke: var(--line2); stroke-width: 1; }
svg.ch .grid { stroke: var(--line); stroke-width: 1; stroke-dasharray: 2 4; }
.legend2 { display: flex; gap: 16px; font-size: 13px; color: var(--muted); flex-wrap: wrap; }
.legend2 i { display: inline-block; width: 14px; height: 2px; vertical-align: 4px; margin-right: 6px; }
.legend2 i.dash { background: repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 7px); height: 2px; }
.mult { display: grid; grid-template-columns: 1fr 1fr; gap: 24px 32px; }
.mult .t { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; color: var(--muted); margin-bottom: 4px; gap: 12px; }
.mult .t b { font: 600 13px var(--sans); letter-spacing: .04em; }
.band2 { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
.band2 i { width: 9px; height: 9px; border-radius: 50%; }
.modes button { min-width: 72px; }
.hidden { display: none !important; }
.cdn { color: var(--warn); }
.facts { display: grid; grid-template-columns: auto 1fr; gap: 12px 16px; font-size: 14px; margin: 0; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; text-align: right; color: var(--text); }
.facts .mini { height: 4px; border-radius: 2px; background: var(--card2); overflow: hidden; margin-top: 8px; }
.facts .mini i { display: block; height: 100%; background: var(--good); }
.one { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.bliss { display: grid; grid-template-columns: auto 1fr; gap: 12px 16px; font-size: 14px; color: var(--muted); }
.bliss b { color: var(--text); }
.note2 { color: var(--muted); font-size: 13px; margin-top: 16px; }
/* Plan: your plan (round 6) */
.plancard .pc-top { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
.plancard .pc-what { flex: 1 1 360px; min-width: 0; }
.plancard .pc-title { font: 600 28px/1.2 var(--serif); color: var(--white); }
.plancard .pc-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
.plancard .acts { display: flex; gap: 8px; }
.dayline { height: 4px; background: var(--line); border-radius: 2px; margin-top: 16px; position: relative; overflow: hidden; }
.dayline i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--chalk); border-radius: 2px; }
.newrow { border-top: 1px solid var(--line); margin-top: 16px; padding-top: 16px; display: flex; gap: 8px 12px; align-items: center; flex-wrap: wrap; }
.newrow .confirm { display: inline-flex; gap: 8px; align-items: center; flex-wrap: wrap; border: 1px solid var(--warn); border-radius: 8px; padding: 8px 12px; }
.months { display: grid; gap: 8px; }
.months .mo { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px; font-size: 12px; color: var(--muted); min-width: 0; }
.months .mo b { display: block; color: var(--text); font-size: 14px; font-weight: 500; margin-top: 2px; }
.months .mo em { display: block; font-style: normal; color: var(--chalk); font-size: 12px; font-weight: 500; margin-top: 2px; }
.months .mo.past { opacity: .55; }
.months .mo.now { border-color: var(--chalk); }
/* Breathing room and cards (owner, round 3; round 7 type pass): one level of cards; the page's primary block has a soft chalk edge. */
.app { --row: 44px; --pad: 16px; --gap: 24px; --sec: 24px; }
.top { padding: 0 var(--edge); }
.strip { padding: 20px var(--edge) 24px; }
.body { padding: 32px var(--edge) 40px; gap: 32px; align-items: stretch; }
.main > div, .pane > div { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 24px; min-width: 0; }
.main > div.lead { border-color: rgba(239, 235, 226, .4); }
.main > .lead:first-child > .sh:first-child h2 { font-size: 28px; line-height: 1.2; }
.lead .prime { border: 0; padding: 0; background: none; }
.main > div:last-child, .pane > div:last-child { flex-grow: 1; }
.sh { margin-bottom: 16px; }
.tbl td { border-top-color: #262a2e; }
.tbl th { padding-bottom: 8px; }
.heads li { padding: 8px 0; }
/* The "Plan" chooser: the one control that says "this is where I plan it". */
.plansel { position: relative; }
.plansel > summary { list-style: none; display: inline-flex; align-items: center; gap: 12px; height: 36px; padding: 0 14px 0 16px; border: 1.5px solid var(--chalk); border-radius: 9px; background: #22252a; cursor: pointer; white-space: nowrap; }
.plansel > summary::-webkit-details-marker { display: none; }
.plansel > summary .lab { color: var(--chalk); }
.plansel > summary b { font-size: 14px; font-weight: 600; color: var(--white); }
.plansel > summary::after { content: ""; width: 0; height: 0; border: 5px solid transparent; border-top-color: var(--chalk); margin-top: 5px; }
.plansel .menu { position: absolute; z-index: 5; top: 44px; left: 0; width: 380px; background: var(--card); border: 1px solid var(--line2); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.5); padding: 8px; }
.plansel .opt { display: block; width: 100%; text-align: left; padding: 10px 12px; border-radius: 8px; cursor: pointer; background: transparent; border: 0; font: inherit; color: inherit; }
.plansel .opt:hover, .plansel .opt:focus-visible { background: var(--card2); outline: none; }
.plansel .opt b { display: block; color: var(--white); }
.plansel .opt span { color: var(--muted); font-size: 13px; }
.plansel .opt.on { outline: 1px solid var(--chalk); }
.main > .sec, .main > .sec:first-child { padding: 24px; }
.heads li.go { cursor: pointer; }
.heads li.go:hover div, .heads li.go:focus-visible div { color: var(--white); }
.heads li.go:focus-visible { outline: 2px solid var(--chalk); outline-offset: 2px; }
.tbl tr.click:focus-visible td { box-shadow: inset 0 0 0 2px var(--chalk); }
.pi-chip:focus-visible { outline: 2px solid var(--chalk); }
/* Narrow windows (a tablet): bars wrap, the pane goes under the page. */
@media (max-width: 1000px) {
  .app { min-width: 0; --edge: 16px; }
  .top { flex-wrap: wrap; height: auto; padding: 8px 16px; }
  .strip, .strip.four { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .body { grid-template-columns: minmax(0, 1fr); padding: 16px; }
  .mult { grid-template-columns: minmax(0, 1fr); }
  .tbl { display: block; overflow-x: auto; }
}
.warnb.paused { border-radius: 0; margin: 0; padding: 12px 24px; }
.dev-scatter { max-width: 520px; }
`;
