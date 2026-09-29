/*
 * The webpage's look: K's tokens and components (mockups/K-home.html and
 * mockups/pi.css, DESIGN.md §1). Inside the page's shadow root, so Torn Eye
 * and overlay styles on torn.com never mix with it.
 */

export const APP_CSS = `
:host {
  --page:#141618; --card:#1c1f22; --card2:#24282c; --line:#2c3136; --line2:#3a4046;
  --text:#e3e5e8; --muted:#939aa1; --dim:#6c737a; --white:#fff;
  --chalk:#efebe2; --on-chalk:#15171a;
  --str:#e5534b; --def:#4a8ff0; --spd:#f0c02f; --dex:#43b86c;
  --good:#9bdc8a; --warn:#e8a33d; --bad:#ff6b5e; --link:#8fb8e8;
  --b-stomp:#3fbf5a; --b-good:#a6e08a; --b-tough:#f0a040; --b-cant:#ff5a4e; --b-none:#6c737a;
  --display: "Barlow Condensed", "Arial Narrow", Arial, sans-serif;
}
* { box-sizing: border-box; }
.pi-root { margin: 0; min-height: 100vh; background: var(--page); color: var(--text); font: 13px/1.4 Arial, Helvetica, sans-serif; }
.num { font-variant-numeric: tabular-nums; }
.lab { font-size: 11px; font-weight: bold; letter-spacing: .5px; text-transform: uppercase; color: var(--muted); }
.grow { flex: 1; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
.muted { color: var(--muted); } .dim { color: var(--dim); } .white { color: var(--white); }
.s-str { color: var(--str); } .s-def { color: var(--def); } .s-spd { color: var(--spd); } .s-dex { color: var(--dex); }
.c-good { color: var(--good); } .c-warn { color: var(--warn); } .c-bad { color: var(--bad); }
.mark { width: 26px; height: 26px; border-radius: 50%; background: var(--chalk); display: grid; place-items: center; box-shadow: inset 0 0 0 4px var(--chalk), inset 0 0 0 6px #2a2d31; flex: none; }
.mark i { width: 6px; height: 6px; border-radius: 50%; background: var(--on-chalk); }
.mark.sm { width: 18px; height: 18px; box-shadow: inset 0 0 0 3px var(--chalk), inset 0 0 0 4px #2a2d31; }
.mark.sm i { width: 4px; height: 4px; }

/* density */
.app { --row: 34px; --pad: 12px; --gap: 20px; --sec: 24px; min-width: 1180px; background: var(--page); }

/* top bar */
.top { height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 20px; border-bottom: 1px solid var(--line); }
.brand { font: 700 17px/1 var(--display); letter-spacing: .6px; color: var(--white); text-transform: uppercase; margin-right: 16px; }
.tab { height: 48px; display: inline-flex; align-items: center; padding: 0 10px; color: var(--muted); font-weight: bold; border-bottom: 2px solid transparent; }
.tab:hover { text-decoration: none; color: var(--text); }
.tab.on { color: var(--white); border-bottom-color: var(--chalk); }
.upd { color: var(--muted); font-size: 12px; display: inline-flex; align-items: center; gap: 6px; }
.upd i { width: 7px; height: 7px; border-radius: 50%; background: var(--good); }
.seg { display: inline-flex; border: 1px solid var(--line2); border-radius: 14px; overflow: hidden; }
.top .seg { margin-left: 12px; }
.seg button { height: 26px; padding: 0 10px; background: transparent; border: 0; color: var(--muted); font: bold 11px Arial; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--chalk); color: var(--on-chalk); }
.seg button:focus-visible { outline: 2px solid var(--chalk); outline-offset: -2px; }

/* status strip */
.strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 24px; padding: var(--pad) 20px; border-bottom: 1px solid var(--line); background: #171a1c; }
.st { display: flex; flex-direction: column; gap: 5px; }
.st-h { display: flex; justify-content: space-between; align-items: baseline; }
.st-h b { font: 600 18px/1 var(--display); color: var(--white); }
.st-h b.warn { color: var(--warn); } .st-h b.good { color: var(--good); }
.bar { height: 5px; border-radius: 3px; background: var(--card2); overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 3px; }
.st small { color: var(--muted); font-size: 11px; }

/* body 70 / 30 */
.body { display: grid; grid-template-columns: minmax(0, 7fr) minmax(300px, 3fr); gap: var(--sec); padding: var(--sec) 20px; }
.main, .pane { display: flex; flex-direction: column; gap: var(--sec); min-width: 0; }
.sh { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.sh h2 { margin: 0; font: 700 22px/1 var(--display); color: var(--white); }
.sh h3 { margin: 0; font: 700 18px/1 var(--display); color: var(--white); }
.sh .meta { color: var(--muted); font-size: 12px; }
.sh .meta b { color: var(--good); font-weight: bold; }
.sh .right { margin-left: auto; }

/* buttons */
.acts { display: flex; gap: 8px; }
.btn { height: 30px; padding: 0 14px; border-radius: 5px; border: 1px solid var(--line2); background: var(--card2); color: var(--text); font: bold 12px Arial; display: inline-flex; align-items: center; cursor: pointer; white-space: nowrap; }
.btn:hover { text-decoration: none; border-color: var(--muted); }
.btn.primary { background: var(--chalk); color: var(--on-chalk); border-color: var(--chalk); }
.btn.sm { height: 26px; padding: 0 10px; font-size: 11px; }
.btn.ghost { background: transparent; }
.btn:focus-visible { outline: 2px solid var(--chalk); outline-offset: 2px; }

/* next band (Home primary) */
.next { display: grid; grid-template-columns: auto 1fr auto; gap: 20px; align-items: center; padding: var(--pad) 16px; background: var(--card); border: 1px solid var(--chalk); border-radius: 10px; }
.next .cd { font: 600 44px/0.9 var(--display); color: var(--chalk); min-width: 96px; }
.next .what b { display: block; font-size: 17px; color: var(--white); }
.next .what span { color: var(--muted); font-size: 13px; }

/* tables (steps, sources, targets, war) */
.tbl { width: 100%; border-collapse: collapse; }
.tbl th { text-align: left; font-size: 11px; font-weight: bold; letter-spacing: .5px; text-transform: uppercase; color: var(--muted); padding: 0 8px 6px; white-space: nowrap; }
.tbl td { height: var(--row); padding: 0 8px; border-top: 1px solid var(--line); }
.tbl .r { text-align: right; }
.tbl .t { font: 600 15px var(--display); color: var(--muted); width: 56px; }
.tbl tr.done td { color: var(--dim); }
.tbl tr.done .ok { color: var(--good); }
.tbl tr.now td { background: #202428; color: var(--white); }
.tbl tr.now .t { color: var(--chalk); }
.tbl tr.sel td { background: #202428; }
.tbl tr.sel td:first-child { box-shadow: inset 2px 0 0 var(--chalk); }
.tbl tr.click { cursor: pointer; }
.tbl tr.click:hover td { background: #1f2326; }
.tbl .when { color: var(--muted); font-size: 12px; }
.tbl small { color: var(--muted); font-size: 12px; }
.tbl tfoot td { border-top: 1px solid var(--line2); color: var(--muted); font-size: 12px; }
.tbl tfoot b { color: var(--white); }
.tbl b.w { color: var(--white); }

/* stats vs build */
.sg { display: flex; flex-direction: column; }
.sgr { display: grid; grid-template-columns: 40px 108px minmax(0, 1fr) 110px 110px 84px; gap: 12px; align-items: center; height: var(--row); border-top: 1px solid var(--line); }
.sgr:first-of-type { border-top: 0; }
.sgr b.n { font: 700 14px var(--display); letter-spacing: .5px; }
.sgr .v { text-align: right; font-weight: bold; color: var(--white); }
.share { position: relative; height: 6px; border-radius: 3px; background: var(--card2); }
.share i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; }
.share em { position: absolute; top: -4px; width: 2px; height: 14px; background: var(--chalk); }
.sgr .gap { text-align: right; font-size: 12px; color: var(--muted); }
.sgr .tod { text-align: right; font-size: 12px; }
.spark { width: 76px; height: 18px; }
.sgfoot { display: flex; gap: 20px; color: var(--muted); font-size: 12px; margin-top: 8px; }
.sgfoot b { color: var(--text); }

/* buy (pane) */
.buy { display: flex; flex-direction: column; }
.bi { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 4px 10px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
.bi:first-of-type { border-top: 0; }
.bi b { color: var(--white); }
.bi small { grid-column: 1 / 2; color: var(--muted); font-size: 12px; }
.bi .p { text-align: right; font-weight: bold; }
.buyfoot { display: flex; justify-content: space-between; align-items: baseline; border-top: 1px solid var(--line2); padding-top: 8px; color: var(--muted); font-size: 12px; }
.buyfoot b { color: var(--white); font: 600 20px var(--display); }

/* heads-up list */
.heads { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.heads li { display: grid; grid-template-columns: 8px 1fr; gap: 10px; align-items: baseline; font-size: 13px; }
.heads li i { width: 8px; height: 8px; border-radius: 50%; background: var(--dim); transform: translateY(1px); }
.heads li.w i { background: var(--warn); }
.heads li.g i { background: var(--good); }
.heads li span { color: var(--muted); }

/* small card (current plan, selected choice) */
.plan { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
.plan b { color: var(--white); }
.plan span { color: var(--muted); font-size: 12px; }

/* primary card (Plan's recommendation, Buy's total) */
.prime { padding: var(--pad) 16px; background: var(--card); border: 1px solid var(--chalk); border-radius: 10px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 24px; align-items: center; }
.prime .k { font: 700 26px/1 var(--display); color: var(--white); }
.prime .d { color: var(--muted); }
.prime .figs { display: flex; gap: 28px; }
.fig { display: flex; flex-direction: column; gap: 2px; }
.fig b { font: 600 24px/1 var(--display); color: var(--white); }
.fig b.good { color: var(--good); }
.prime .why { grid-column: 1 / -1; color: var(--muted); font-size: 12px; border-top: 1px solid var(--line); padding-top: 8px; }
.pill-tag { display: inline-block; height: 20px; line-height: 20px; padding: 0 8px; border-radius: 10px; font-size: 11px; font-weight: bold; letter-spacing: .4px; text-transform: uppercase; background: var(--card2); color: var(--muted); }
.pill-tag.chalk { background: var(--chalk); color: var(--on-chalk); }

/* warning block */
.warnb { border-left: 3px solid var(--warn); background: #231d12; padding: 10px 14px; border-radius: 0 8px 8px 0; display: flex; flex-direction: column; gap: 6px; }
.warnb b { color: #ffd79a; font-size: 14px; }
.warnb p { margin: 0; color: var(--text); max-width: 90ch; }
.warnb .acts { margin-top: 4px; }

/* builds */
.builds { display: flex; flex-direction: column; }
.brow { display: grid; grid-template-columns: 150px 180px minmax(0, 1fr) auto; gap: 14px; align-items: center; height: var(--row); padding: 0 8px; border-top: 1px solid var(--line); cursor: pointer; }
.brow:first-child { border-top: 0; }
.brow.sel { background: var(--card); box-shadow: inset 0 0 0 1px var(--chalk); border-radius: 6px; border-top-color: transparent; }
.brow.sel + .brow { border-top-color: transparent; }
.brow b { color: var(--white); }
.brow span { color: var(--muted); font-size: 12px; }
.ratio { display: flex; height: 8px; border-radius: 4px; overflow: hidden; gap: 1px; }
.ratio i { display: block; height: 100%; }

/* inputs */
.field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.field .inp { width: 100%; }
.inp { height: 30px; padding: 0 10px; border-radius: 5px; border: 1px solid var(--line2); background: #111315; color: var(--text); font: 13px Arial; min-width: 0; }
.inp:focus { outline: 2px solid var(--chalk); outline-offset: -1px; }
.inp.masked { -webkit-text-security: disc; }
.row { display: flex; gap: 8px; align-items: center; }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; font-size: 12px; }
.kv dt { color: var(--muted); } .kv dd { margin: 0; text-align: right; }

/* settings sections */
.sec { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 24px; padding: 18px 0; border-top: 1px solid var(--line); }
.sec:first-child { border-top: 0; padding-top: 0; }
.sec h3 { margin: 0 0 4px; font: 700 18px/1.1 var(--display); color: var(--white); }
.state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: bold; }
.state i { width: 8px; height: 8px; border-radius: 50%; background: var(--dim); }
.state.ok { color: var(--good); } .state.ok i { background: var(--good); }
.state.off { color: var(--muted); }
.state.bad { color: var(--bad); } .state.bad i { background: var(--bad); }
.secbody { display: flex; flex-direction: column; gap: 10px; max-width: 760px; }
.secbody p { margin: 0; color: var(--muted); }
ol.steps-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
details.dis > summary { cursor: pointer; color: var(--link); font-size: 12px; list-style: none; }
details.dis > summary::before { content: "▸ "; }
details.dis[open] > summary::before { content: "▾ "; }
.tos { border-collapse: collapse; margin-top: 8px; width: 100%; font-size: 12px; }
.tos th { text-align: left; color: var(--muted); font-weight: bold; padding: 5px 10px 5px 0; width: 170px; vertical-align: top; border-top: 1px solid var(--line); }
.tos td { padding: 5px 0; border-top: 1px solid var(--line); }
.check { display: inline-flex; align-items: center; gap: 8px; }
.check input { accent-color: var(--chalk); width: 14px; height: 14px; }

/* charts */
.chart { width: 100%; display: block; }
.chart text { font: 11px Arial; fill: var(--muted); }
.chart .ax { stroke: var(--line); }
.legend { display: flex; gap: 14px; font-size: 12px; color: var(--muted); }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }

/* Torn Eye chip */
.chip { display: inline-flex; align-items: center; gap: 8px; height: 28px; padding: 0 10px 0 8px; border-radius: 14px; background: #1e2124; border: 1px solid var(--line2); font: 12px Arial; color: var(--text); white-space: nowrap; }
.chip .dot { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 3px currentColor; background: #111; flex: none; }
.chip b { font-weight: bold; }
.chip .src { color: var(--dim); font-size: 11px; }
.b-stomp { color: var(--b-stomp); } .b-good { color: var(--b-good); } .b-tough { color: var(--b-tough); } .b-cant { color: var(--b-cant); } .b-none { color: var(--b-none); }
.chip .figs { color: var(--text); }
.band { display: inline-flex; align-items: center; gap: 6px; font-weight: bold; white-space: nowrap; }
.band .dot { width: 10px; height: 10px; border-radius: 50%; box-shadow: inset 0 0 0 3px currentColor; background: #111; }

/* hover card */
.hcard { width: 330px; background: var(--card); border: 1px solid var(--line2); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.45); }
.hcard .hh { display: flex; align-items: baseline; gap: 8px; }
.hcard .hh b { color: var(--white); font-size: 14px; }
.kept { display: grid; grid-template-columns: 80px minmax(0,1fr) 40px; gap: 8px; align-items: center; font-size: 12px; }
.kept .bar { height: 6px; }
.hcard .foot { font-size: 11px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 8px; }

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
.pi-root button { font-family: Arial, Helvetica, sans-serif; }
.app { min-height: 100vh; }
.empty { padding: 48px 20px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; max-width: 640px; }
.empty h2 { margin: 0; font: 700 26px/1 var(--display); color: var(--white); }
.empty p { margin: 0; color: var(--muted); }
.toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--card2); border: 1px solid var(--line2); color: var(--text); padding: 8px 14px; border-radius: 8px; font-size: 13px; z-index: 5; }
.msg { font-size: 12px; }
.msg.ok { color: var(--good); } .msg.bad { color: var(--bad); }
.tab { cursor: pointer; }
.btn:disabled { opacity: .45; cursor: default; }
.brow:focus-visible, .tbl tr.click:focus-visible { outline: 2px solid var(--chalk); outline-offset: -2px; }
.pane .chart { max-width: 100%; }
.big { font: 700 34px/1 var(--display); color: var(--white); }
.pr { display: grid; grid-template-columns: 90px 76px 1fr; gap: 10px; align-items: center; height: var(--row); border-top: 1px solid var(--line); font-size: 12px; }
.pr:first-child { border-top: 0; }
.pr b { color: var(--white); font-size: 13px; }
.pr .r { text-align: right; }
.smc { display: flex; flex-direction: column; gap: 4px; }
.smc .h { display: flex; justify-content: space-between; align-items: baseline; }
.smc .h b { font: 700 14px var(--display); letter-spacing: .5px; }
.smc .h span { font-weight: bold; color: var(--white); }
.smc small { color: var(--muted); font-size: 12px; }
.tl { display: flex; flex-direction: column; }
.tlr { display: grid; grid-template-columns: 18px 170px 90px minmax(0, 1fr) 110px; gap: 12px; align-items: center; height: var(--row); border-top: 1px solid var(--line); }
.tlr:first-child { border-top: 0; }
.tlr .dotc { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--dim); }
.tlr.now .dotc { background: var(--chalk); border-color: var(--chalk); }
.tlr.next .dotc { border-color: var(--chalk); }
.tlr b { color: var(--white); }
.tlr .r { text-align: right; }
.meter { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; align-items: baseline; padding: 8px 0; border-top: 1px solid var(--line); }
.meter:first-child { border-top: 0; }
.meter .bar { grid-column: 1 / -1; }
.meter b { color: var(--white); }
.keyrow { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; max-width: 560px; }
.data { display: flex; flex-direction: column; }
.dr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
.dr:first-child { border-top: 0; }
.dr b { color: var(--white); }
.dr small { color: var(--muted); font-size: 12px; }
.opts { display: flex; flex-wrap: wrap; gap: 8px 20px; }
.filters { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; padding-bottom: 10px; }
.filters .inp { width: 64px; height: 26px; }
.slider { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
.slider input { accent-color: var(--chalk); width: 140px; }
.bands { display: flex; flex-direction: column; }
.bandr { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 10px; align-items: center; min-height: var(--row); border-top: 1px solid var(--line); font-size: 12px; }
.bandr:first-child { border-top: 0; }
.bandr .inp { width: 52px; height: 26px; padding: 0 6px; text-align: right; }
.stok { color: var(--good); } .sthos { color: var(--bad); } .sttr { color: var(--link); }

/* ---- Round 3 (mockups/round3/r3.css): control bars, tick chips, cards with more room, charts, the Plan chooser. ---- */
.tab .n { margin-left: 5px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--card2); color: var(--text); font-size: 11px; line-height: 16px; text-align: center; }
.tab .dotw { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); margin-left: 5px; }
.topwarn { display: inline-flex; align-items: center; gap: 7px; margin-right: 14px; padding: 3px 10px; border: 1px solid var(--warn); border-radius: 12px; color: var(--warn); font-size: 12px; font-weight: bold; text-decoration: none; white-space: nowrap; }
.topwarn i { font-style: normal; width: 15px; height: 15px; border-radius: 50%; background: var(--warn); color: #15171a; display: inline-grid; place-items: center; font-size: 11px; }
.topwarn:hover, .topwarn:focus-visible { background: #231d12; outline: none; }
.strip.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.ctl { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 12px 24px; border-bottom: 1px solid var(--line); background: #171a1c; font-size: 13px; }
.ctl + .ctl { padding-top: 4px; }
.ctl .lab { margin-right: -6px; }
.ctl .inp { height: 28px; width: auto; }
.ctl .sep { width: 1px; height: 20px; background: var(--line2); }
.ctl select, .ctl .sel { height: 28px; padding: 0 28px 0 10px; border-radius: 5px; border: 1px solid var(--line2); background: var(--card2) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23939aa1'/%3E%3C/svg%3E") no-repeat right 10px center; color: var(--text); font: bold 12px Arial; display: inline-flex; align-items: center; appearance: none; }
.info { display: inline-grid; place-items: center; width: 15px; height: 15px; border-radius: 50%; border: 1px solid var(--line2); color: var(--muted); font: bold 11px Arial; cursor: help; }
.ticks { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.tk { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px 0 7px; border-radius: 13px; border: 1px solid var(--line2); color: var(--muted); font: bold 12px Arial; cursor: pointer; user-select: none; background: transparent; }
.tk i { width: 12px; height: 12px; border-radius: 3px; border: 1px solid var(--dim); display: grid; place-items: center; }
.tk[aria-pressed="true"] { color: var(--text); border-color: var(--muted); }
.tk[aria-pressed="true"] i { background: var(--chalk); border-color: var(--chalk); }
.tk[aria-pressed="true"] i::after { content: ""; width: 6px; height: 3px; border: solid var(--on-chalk); border-width: 0 0 2px 2px; transform: rotate(-45deg) translate(1px, -1px); }
.tk:focus-visible { outline: 2px solid var(--chalk); outline-offset: 2px; }
.why { color: var(--warn); font-size: 12px; }
.why.ok { color: var(--muted); }
.tbl tr.whatif td { color: var(--dim); }
.tbl tr.whatif b.w { color: var(--muted); }
.tag { white-space: nowrap; display: inline-block; height: 18px; line-height: 18px; padding: 0 7px; border-radius: 9px; font-size: 11px; font-weight: bold; letter-spacing: .4px; text-transform: uppercase; background: var(--card2); color: var(--muted); vertical-align: 1px; }
.tag.chalk { background: var(--chalk); color: var(--on-chalk); }
.tag.warn { background: #3a2a10; color: var(--warn); }
.tag.good { background: #1f3320; color: var(--good); }
.bl { display: flex; flex-direction: column; }
.bl .r { display: grid; grid-template-columns: 78px 90px 1fr; gap: 10px; align-items: center; height: 36px; padding: 0 8px; border-top: 1px solid var(--line); cursor: pointer; font-size: 12px; }
.bl .r:first-child { border-top: 0; }
.bl .r b { color: var(--white); font-size: 13px; }
.bl .r span { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bl .r.sel { border: 1px solid var(--chalk); border-radius: 6px; }
.bl .r:focus-visible { outline: 2px solid var(--chalk); outline-offset: -2px; }
.bl .ratio { height: 8px; }
.nowb { display: grid; grid-template-columns: auto 1fr auto; gap: 18px; align-items: center; padding: 16px 20px; border-radius: 10px; background: var(--card2); }
.nowb .k { font: 700 13px var(--display); letter-spacing: .6px; color: var(--on-chalk); background: var(--chalk); border-radius: 4px; padding: 3px 8px; }
.nowb .cd { font: 600 30px/0.9 var(--display); color: var(--chalk); min-width: 64px; }
.nowb b { font-size: 17px; color: var(--white); }
.nowb span.s { color: var(--muted); }
.nowb .acts { display: flex; gap: 8px; }
.tbl tr.ih td { height: 38px; background: #191c1f; }
.tbl tr.ih b { font-size: 14px; color: var(--white); }
.tbl tr.sub td:first-child { padding-left: 22px; }
.verdict { font-size: 12px; }
svg.ch { width: 100%; display: block; overflow: visible; }
svg.ch text { font: 11px Arial; fill: var(--muted); }
svg.ch .ax { stroke: var(--line2); stroke-width: 1; }
svg.ch .grid { stroke: var(--line); stroke-width: 1; stroke-dasharray: 2 4; }
.legend2 { display: flex; gap: 14px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
.legend2 i { display: inline-block; width: 14px; height: 2px; vertical-align: 3px; margin-right: 5px; }
.legend2 i.dash { background: repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 7px); height: 2px; }
.mult { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 28px; }
.mult .t { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: var(--muted); margin-bottom: 2px; gap: 10px; }
.mult .t b { font: 600 15px var(--display); }
.band2 { display: inline-flex; align-items: center; gap: 6px; font-weight: bold; }
.band2 i { width: 9px; height: 9px; border-radius: 50%; }
.modes button { min-width: 72px; }
.hidden { display: none !important; }
.cdn { color: var(--warn); }
.facts { display: grid; grid-template-columns: auto 1fr; gap: 9px 14px; font-size: 13px; margin: 0; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; text-align: right; color: var(--text); }
.facts .mini { height: 6px; border-radius: 3px; background: var(--card2); overflow: hidden; margin-top: 3px; }
.facts .mini i { display: block; height: 100%; background: var(--good); }
.one { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.bliss { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 13px; color: var(--muted); }
.bliss b { color: var(--text); }
.note2 { color: var(--muted); font-size: 12px; margin-top: 8px; }
/* Breathing room and cards (owner, round 3): one level of cards; the page's primary block has a chalk edge. */
.app { --row: 40px; --pad: 14px; --gap: 22px; --sec: 18px; }
.top { padding: 0 24px; }
.strip { padding: 14px 24px; }
.body { padding: 22px 24px 28px; gap: 22px; align-items: stretch; }
.main > div, .pane > div { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; min-width: 0; }
.main > div.lead { border-color: var(--chalk); }
.lead .prime { border: 0; padding: 0; background: none; }
.main > div:last-child, .pane > div:last-child { flex-grow: 1; }
.sh { margin-bottom: 12px; }
.tbl td { border-top-color: #262a2e; }
.tbl th { padding-bottom: 8px; }
.heads li { padding: 4px 0; }
/* The "Plan" chooser: the one control that says "this is where I plan it". */
.plansel { position: relative; }
.plansel > summary { list-style: none; display: inline-flex; align-items: center; gap: 10px; height: 34px; padding: 0 12px 0 14px; border: 1.5px solid var(--chalk); border-radius: 8px; background: #22252a; cursor: pointer; }
.plansel > summary::-webkit-details-marker { display: none; }
.plansel > summary .lab { color: var(--chalk); }
.plansel > summary b { font-size: 14px; color: var(--white); }
.plansel > summary::after { content: ""; width: 0; height: 0; border: 5px solid transparent; border-top-color: var(--chalk); margin-top: 5px; }
.plansel .menu { position: absolute; z-index: 5; top: 40px; left: 0; width: 360px; background: var(--card); border: 1px solid var(--line2); border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.5); padding: 6px; }
.plansel .opt { display: block; width: 100%; text-align: left; padding: 9px 10px; border-radius: 6px; cursor: pointer; background: transparent; border: 0; font: inherit; color: inherit; }
.plansel .opt:hover, .plansel .opt:focus-visible { background: var(--card2); outline: none; }
.plansel .opt b { display: block; color: var(--white); }
.plansel .opt span { color: var(--muted); font-size: 12px; }
.plansel .opt.on { outline: 1px solid var(--chalk); }
.main > .sec, .main > .sec:first-child { padding: 18px 20px; }
.heads li.go { cursor: pointer; }
.heads li.go:hover div, .heads li.go:focus-visible div { color: var(--white); }
.heads li.go:focus-visible { outline: 2px solid var(--chalk); outline-offset: 2px; }
.tbl tr.click:focus-visible td { box-shadow: inset 0 0 0 2px var(--chalk); }
.pi-chip:focus-visible { outline: 2px solid var(--chalk); }
/* Narrow windows (a tablet): bars wrap, the pane goes under the page. */
@media (max-width: 1000px) {
  .app { min-width: 0; }
  .top { flex-wrap: wrap; height: auto; padding: 6px 16px; }
  .strip, .strip.four { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .body { grid-template-columns: minmax(0, 1fr); padding: 16px; }
  .mult { grid-template-columns: minmax(0, 1fr); }
  .tbl { display: block; overflow-x: auto; }
}
.warnb.paused { border-radius: 0; margin: 0; padding: 12px 24px; }
.dev-scatter { max-width: 520px; }
`;
