/* PoGo Price Guide — mockup front end (no prices yet).
 * Hash routes:
 *   #/                    home
 *   #/browse/:region      species list (region = all | kanto | johto | ...)
 *   #/p/:id               species page (ladder, variant explorer, combo builder)
 *   #/p/:id/:variantKey   variant page
 *   #/backgrounds         all backgrounds by family
 *   #/bg/:slug            one background
 *   #/traded              every variant, most traded first (loads more as you scroll)
 *   #/search/:q           search results
 *   #/about               data notes
 */
"use strict";

const IMG_ROOT = "https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Images/";
const monImg = (fn, shiny) => `${IMG_ROOT}Pokemon%20-%20256x256/Addressable%20Assets/${fn}${shiny ? ".s" : ""}.icon.png`;
const bgImg = (url) => url || null; // catalog stores full image URLs for backgrounds

let PRICES = { variants: {}, delivery_factors: {}, generated: null };
const money = (x) => (x == null ? "—" : "$" + (x >= 100 ? Math.round(x).toLocaleString() : x.toFixed(2)));
const recOf = (v) => PRICES.variants[`${v.sp.id}/${v.key}`] || null;
/* The headline price: the 30-day median of sales when there are sales, otherwise the lowest current asking price
 * (clearly labelled), otherwise nothing. Prices are on a standard-trade basis (see Data notes). */
function quote(v) {
  const r = v && recOf(v);
  if (r && r.price != null) return { text: money(r.price), sub: `${r.n} sale${r.n === 1 ? "" : "s"} · 30d`, cls: "price", value: r.price, r };
  if (r && r.ask != null) return { text: money(r.ask), sub: `lowest ask · ${r.listings} listing${r.listings === 1 ? "" : "s"}`, cls: "price ask", value: r.ask, r };
  return { text: "—", sub: "not listed", cls: "price none", value: null, r };
}
/* demand: recent sales first, then lifetime sold on current listings */
const demand = (v) => { const r = recOf(v); return r ? (r.n || 0) * 1000 + (r.lifetime || 0) : -1; };
function speciesFrom(s) {
  const vals = variantsOf(s).map((v) => quote(v).value).filter((x) => x != null);
  return vals.length ? Math.min(...vals) : null;
}

let CAT, SP = {}, BG = {}, BGSLUG = {};
const VCACHE = new Map();

/* ------------------------------------------------------------------ utils */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9♀♂ ]+/g, " ").replace(/\s+/g, " ").trim();
const dex3 = (n) => "#" + String(n).padStart(3, "0");
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Sprite filenames vary (pm646.fNORMAL vs pm25), so try a chain of fallbacks before hiding the image.
window.imgFail = (el) => {
  const rest = (el.dataset.fallback || "").split("|").filter(Boolean);
  if (rest.length) { el.dataset.fallback = rest.slice(1).join("|"); el.src = rest[0]; return; }
  el.style.visibility = "hidden";
};
function monTag(fn, shiny, dex, cls = "mon", alt = "") {
  const chain = [`pm${dex}.fNORMAL`, `pm${dex}`].filter((f) => f !== fn).map((f) => monImg(f, shiny));
  if (shiny) chain.push(monImg(fn, false));
  return `<img class="${cls}" loading="lazy" alt="${esc(alt)}" src="${monImg(fn, shiny)}" data-fallback="${chain.join("|")}" onerror="imgFail(this)">`;
}
const baseLook = (s) => s.looks.find((l) => l.kind === "base") || s.looks[0];
function composite(v, boxCls) {
  const bg = v.bg && bgImg(v.bg.img);
  const sprite = v.max === "gmax" && v.look.kind === "base"
    ? monTag(`pm${v.sp.dex}.fGIGANTAMAX`, v.shiny, v.sp.dex, "mon", v.label).replace('data-fallback="', `data-fallback="${monImg(v.look.img, v.shiny)}|`)
    : monTag(v.look.img, v.shiny, v.sp.dex, "mon", v.label);
  return `<div class="${boxCls}">${bg ? `<img class="bgimg" loading="lazy" alt="" src="${bg}" onerror="this.remove()">` : ""}${sprite}</div>`;
}

/* --------------------------------------------------------------- variants */
function yearOf(look) {
  // prefer the year in the form code (e.g. ANNIVERSARY_2026) over the shiny release date
  const m = (look.img || "").match(/(20\d\d)/) || (look.shinyDate || "").match(/^(\d{4})/);
  return m ? +m[1] : null;
}
const MAX_NAME = { dmax: "Dynamax", gmax: "Gigantamax" };
function makeVariant(sp, look, shiny, link, max) {
  const bg = link ? BG[link.bg] : null;
  const parts = [];
  if (look.key !== "base") parts.push(look.key);
  if (shiny) parts.push("shiny");
  if (bg) parts.push("bg-" + bg.slug);
  if (max) parts.push(max);
  const key = parts.join("+") || "base";
  const lookName = look.name || "";
  const short = [shiny ? "Shiny" : "", MAX_NAME[max] || "", lookName].filter(Boolean).join(" ") || "Standard";
  const shortFull = bg ? `${short === "Standard" ? "" : short + " + "}${bg.name}` : short;
  const label = [shiny ? "Shiny" : "", MAX_NAME[max] || "", sp.name].filter(Boolean).join(" ")
    + (lookName ? ` (${lookName})` : "") + (bg ? ` · ${bg.name} background` : "");
  return { sp, look, shiny, bg, link, max, key, short: shortFull, label };
}
/* Variants = looks × shiny, plus Dynamax/Gigantamax, plus every (background × look × max) link from the
 * background data. A background variant is shiny only when the source says a shiny can have it. */
function variantsOf(sp) {
  if (VCACHE.has(sp.id)) return VCACHE.get(sp.id);
  const out = [];
  const lookByKey = Object.fromEntries(sp.looks.map((l) => [l.key, l]));
  const base = baseLook(sp);
  for (const look of sp.looks) {
    for (const shiny of look.shiny ? [false, true] : [false]) out.push(makeVariant(sp, look, shiny, null, null));
  }
  if (sp.dmax) { out.push(makeVariant(sp, base, false, null, "dmax")); if (base.shiny) out.push(makeVariant(sp, base, true, null, "dmax")); }
  if (sp.gmax.exists) {
    out.push(makeVariant(sp, base, false, null, "gmax"));
    if (sp.gmax.shiny) out.push(makeVariant(sp, base, true, null, "gmax"));
  }
  for (const link of sp.bgs) {
    const look = lookByKey[link.look];
    if (!look || !BG[link.bg]) continue;
    out.push(makeVariant(sp, look, false, link, link.max));
    if (link.shiny) out.push(makeVariant(sp, look, true, link, link.max));
  }
  VCACHE.set(sp.id, out);
  return out;
}
const bgCount = (sp) => new Set(sp.bgs.map((l) => l.bg)).size;
function dimsOf(v) {
  const d = [];
  if (v.shiny) d.push("shiny");
  if (v.look.kind === "costume") d.push("costume");
  if (v.look.kind === "form") d.push("form");
  if (v.bg) d.push("bg");
  if (v.max) d.push("max");
  return d;
}
function tagsOf(v) {
  let h = "";
  if (v.shiny) h += `<span class="tag shiny">✦ Shiny</span>`;
  if (v.look.kind === "costume") h += `<span class="tag costume">Costume</span>`;
  if (v.look.kind === "form") h += `<span class="tag form">Form</span>`;
  if (v.bg) h += `<span class="tag bg">${v.bg.kind === "special" ? "Special BG" : "Location BG"}</span>`;
  if (v.max) h += `<span class="tag max">${MAX_NAME[v.max]}</span>`;
  if (v.link?.evolve) h += `<span class="tag inferred" title="This background can only be had by evolving a Pokémon that has it">via evolution</span>`;
  return h;
}
/* Ladder: the PSA 7/8/9/10 row equivalent: the most-traded variants for this species (recent sales, then lifetime
 * sold on current listings). Species with fewer than 6 variants on the market are filled in by rule. */
function ladderOf(sp) {
  const v = variantsOf(sp), picks = [];
  const add = (x) => { if (x && !picks.includes(x) && picks.length < 6) picks.push(x); };
  v.filter((x) => recOf(x)).sort((a, b) => demand(b) - demand(a)).forEach(add);
  const plain = (x) => !x.bg && !x.max;
  add(v.find((x) => x.look.kind === "base" && !x.shiny && plain(x)));
  add(v.find((x) => x.look.kind === "base" && x.shiny && plain(x)));
  v.filter((x) => x.bg && x.shiny).slice(0, 2).forEach(add);
  add(v.find((x) => x.max && x.shiny));
  add(v.find((x) => x.max && !x.shiny));
  v.filter((x) => x.look.kind === "costume" && x.shiny && plain(x))
    .sort((a, b) => (b.look.shinyDate || "").localeCompare(a.look.shinyDate || "")).forEach(add);
  v.filter((x) => x.look.kind === "form" && plain(x)).forEach(add);
  v.forEach(add);
  return picks;
}

/* ---------------------------------------------------------------- shared UI */
function typeTags(sp) {
  let h = sp.types.map((t) => `<span class="tag type">${esc(t)}</span>`).join("");
  if (sp.cls) h += `<span class="tag cls">${{ legendary: "Legendary", mythical: "Mythical", ultra_beast: "Ultra Beast" }[sp.cls]}</span>`;
  return h;
}
function chartFor(v, title) {
  const r = v && recOf(v);
  const hist = (r && r.history) || [];
  if (!hist.length) return chartPlaceholder(title, r && r.ask != null ? `No sales yet · lowest ask ${money(r.ask)}` : "No sales tracked yet");
  const w = 1000, h = 190, L = 56, R = 12, T = 12, B = 30;
  const day = (d) => new Date(d + "T00:00:00Z").getTime();
  const end = day((PRICES.generated || hist[hist.length - 1][0]).slice(0, 10));
  const start = Math.min(day(hist[0][0]), end - 30 * 864e5);
  const maxY = Math.max(...hist.map((x) => x[1])) * 1.25 || 1;
  const X = (d) => L + (day(d) - start) / Math.max(1, end - start) * (w - L - R);
  const Y = (p) => T + (1 - p / maxY) * (h - T - B);
  let g = "";
  for (let i = 0; i <= 3; i++) {
    const p = maxY * i / 3, y = Y(p);
    g += `<line class="grid-line" x1="${L}" x2="${w - R}" y1="${y}" y2="${y}"/><text class="axis-text" x="${L - 6}" y="${y + 4}" text-anchor="end">${money(p)}</text>`;
  }
  const fmtD = (t) => new Date(t).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
  g += `<text class="axis-text" x="${L}" y="${h - 8}">${fmtD(start)}</text><text class="axis-text" x="${w - R}" y="${h - 8}" text-anchor="end">${fmtD(end)}</text>`;
  const pts = hist.map((x) => `${X(x[0]).toFixed(1)},${Y(x[1]).toFixed(1)}`).join(" ");
  if (hist.length > 1) g += `<polyline class="price-line" points="${pts}"/>`;
  g += hist.map((x) => `<circle class="price-dot" cx="${X(x[0]).toFixed(1)}" cy="${Y(x[1]).toFixed(1)}" r="${3 + Math.min(5, Math.sqrt(x[2]))}"><title>${x[0]}: ${money(x[1])} (${x[2]} sale${x[2] === 1 ? "" : "s"})</title></circle>`).join("");
  return `<div class="chart"><div class="chart-head"><b>${esc(title)}</b><span class="small muted">daily median · dot size = sales</span></div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Price history chart">${g}</svg>
    <div class="small muted">Event markers (GO Fest, Tour, Community Day) will be drawn on this chart.</div></div>`;
}
function chartPlaceholder(title, message = "No sales tracked yet") {
  const w = 1000, h = 190, rows = 4;
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i -= 2) months.push(new Date(now.getFullYear(), now.getMonth() - i, 1).toLocaleString("en", { month: "short" }));
  let g = "";
  for (let i = 0; i <= rows; i++) { const y = 10 + i * (h - 40) / rows; g += `<line class="grid-line" x1="40" x2="${w - 10}" y1="${y}" y2="${y}"/>`; }
  months.forEach((m, i) => { g += `<text class="axis-text" x="${40 + i * (w - 60) / (months.length - 1)}" y="${h - 8}" text-anchor="middle">${m}</text>`; });
  return `<div class="chart"><div class="chart-head"><b>${esc(title)}</b>
    <div class="seg"><button class="on">1Y</button><button>6M</button><button>3M</button><button>All</button></div></div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Empty price history chart">${g}
    <text class="empty" x="${w / 2}" y="${h / 2}" text-anchor="middle">${esc(message)}</text></svg>
    <div class="small muted">Event markers (GO Fest, Tour, Community Day) will be drawn on this chart.</div></div>`;
}
/* Events a variant came from. A background variant uses the background's events for that exact Pokémon/look
 * (the same background can come from several events, e.g. Team Valor: Triumph Together and Ultra Unlock).
 * A plain costume uses the costume's events. */
function eventsOf(v) {
  if (v.link) return (v.link.events || []).map((e) => ({ title: e.title, when: fmtRange(e.start, e.end) }));
  if (v.look.kind === "costume" || v.look.kind === "form") {
    const evs = (v.look.events || []).filter((e) => !v.shiny || e.shiny || !(v.look.events || []).some((x) => x.shiny));
    if (evs.length) return evs.map((e) => ({ title: e.title, when: e.dates, shiny: e.shiny }));
    if (v.look.shinyDate) return [{ title: `Shiny released ${v.look.shinyDate.replaceAll("/", "-")}`, when: "", fallback: true }];
  }
  return [];
}
function fmtRange(a, b) {
  if (!a) return "";
  return b && b !== a ? `${a} → ${b}` : a;
}
function eventTags(v, max = 2) {
  const evs = eventsOf(v);
  if (!evs.length) return "";
  const shown = evs.slice(0, max).map((e) =>
    `<span class="tag event${e.fallback ? " fallback" : ""}" title="${esc(e.title + (e.when ? " · " + e.when : ""))}">📅 ${esc(e.title)}</span>`).join("");
  const more = evs.length > max ? `<span class="tag event more" title="${esc(evs.slice(max).map((e) => e.title).join(" · "))}">+${evs.length - max} more</span>` : "";
  return `<div class="evline">${shown}${more}</div>`;
}
function variantRow(v, showSpecies = false) {
  const href = `#/p/${v.sp.id}/${encodeURIComponent(v.key)}`;
  return `<tr>
    <td class="thumb">${composite(v, "thumb-box")}</td>
    <td><a class="vname" href="${href}">${esc(showSpecies ? v.label : v.short)}</a><div>${tagsOf(v)}</div>${eventTags(v)}</td>
    ${(() => { const q = quote(v), r = q.r;
      return `<td class="num"><span class="${q.cls}">${q.text}</span><div class="small muted">${esc(q.sub)}</div></td>
    <td class="num hide-sm ${r && r.n ? "" : "muted"}">${r ? r.n : 0}</td>
    <td class="num hide-sm">${r && r.last ? `${money(r.last[1])}<div class="small muted">${esc(r.last[0])}</div>` : '<span class="muted">—</span>'}</td>`; })()}
  </tr>`;
}
const variantHead = (first = "Variant") =>
  `<thead><tr><th></th><th>${first}</th><th class="num">Price</th><th class="num hide-sm">Sales (30d)</th><th class="num hide-sm">Last sale</th></tr></thead>`;

/* Every priced variant, most traded first (recent sales, then lifetime sold on current listings). */
let HOT = null;
function hotVariants() {
  if (HOT) return HOT;
  const score = (r) => (r.n || 0) * 1000 + (r.lifetime || 0);
  HOT = Object.entries(PRICES.variants).filter(([, r]) => score(r) > 0).sort((a, b) => score(b[1]) - score(a[1]))
    .map(([k]) => { const [sid, ...rest] = k.split("/"); const sp2 = SP[sid]; return sp2 && variantsOf(sp2).find((x) => x.key === rest.join("/")); })
    .filter(Boolean);
  return HOT;
}

/* ------------------------------------------------------------------- pages */
function pageHome() {
  const sp = CAT.species;
  const nVariants = sp.reduce((a, s) => a + variantsOf(s).length, 0);
  const featuredIds = ["pikachu", "zacian", "charizard", "kyurem", "mewtwo", "eevee", "unown", "vivillon", "dialga", "lugia", "gengar", "dragonite"];
  const featured = featuredIds.map((id) => SP[id]).filter(Boolean);
  const newest = sp.flatMap((s) => s.looks.filter((l) => l.kind === "costume" && l.shinyDate).map((l) => ({ s, l })))
    .sort((a, b) => b.l.shinyDate.localeCompare(a.l.shinyDate)).slice(0, 12);
  const most = [...sp].sort((a, b) => variantsOf(b).length - variantsOf(a).length).slice(0, 10);
  return `
    <h1>Pokémon GO trade price guide</h1>
    <p class="muted">Prices for Pokémon sold as in-game trades. Each variant (shiny, costume, background, Gigantamax) is tracked as its own product,
      like graded copies of a card. Tradable Pokémon only: mythicals and fused or Crowned forms can't be traded.</p>
    <div class="stats">
      <div class="stat"><b>${sp.length.toLocaleString()}</b><span class="muted small">tradable species</span></div>
      <div class="stat"><b>${nVariants.toLocaleString()}</b><span class="muted small">trackable variants</span></div>
      <div class="stat"><b>${sp.reduce((a, s) => a + s.looks.filter((l) => l.kind === "costume").length, 0)}</b><span class="muted small">costumes</span></div>
      <div class="stat"><b>${CAT.backgrounds.length}</b><span class="muted small">backgrounds</span></div>
      <div class="stat"><b>${Object.values(PRICES.variants).reduce((a, r) => a + (r.n || 0), 0).toLocaleString()}</b><span class="muted small">sales in the last 30 days</span></div>
      <div class="stat"><b>${Object.keys(PRICES.variants).length.toLocaleString()}</b><span class="muted small">variants listed on eBay now</span></div>
    </div>
    ${(() => {
      const all = hotVariants(), hot = all.slice(0, 15);
      return hot.length ? `<div class="h2-row"><h2>Most traded right now</h2>
          ${all.length > hot.length ? `<a class="btn btn-sm" href="#/traded">See all ${all.length.toLocaleString()} →</a>` : ""}</div>
        <p class="small muted">Ranked by recent sales, then lifetime sold on current eBay listings.</p>
        <div class="table-scroll"><table class="t">${variantHead("Variant")}<tbody>${hot.map((x) => variantRow(x, true)).join("")}</tbody></table></div>` : "";
    })()}
    <h2>Featured</h2>
    <div class="grid cards">${featured.map(cardFor).join("")}</div>
    <h2>Newest shiny costumes</h2>
    <div class="table-scroll"><table class="t">${variantHead("Variant")}<tbody>${newest.map(({ s, l }) =>
      variantRow(makeVariant(s, l, true, null, null), true)).join("")}</tbody></table></div>
    <h2>Most variants</h2>
    <div class="table-scroll"><table class="t"><thead><tr><th></th><th>Pokémon</th><th class="num">Variants</th><th class="num hide-sm">Costumes</th><th class="num hide-sm">Backgrounds</th></tr></thead><tbody>
      ${most.map((s) => `<tr><td class="thumb"><div class="thumb-box">${monTag(baseLook(s).img, false, s.dex)}</div></td>
        <td><a class="vname" href="#/p/${s.id}">${esc(s.name)}</a> <span class="muted small">${dex3(s.dex)}</span></td>
        <td class="num">${variantsOf(s).length}</td><td class="num hide-sm">${s.looks.filter((l) => l.kind === "costume").length}</td>
        <td class="num hide-sm">${bgCount(s)}</td></tr>`).join("")}
    </tbody></table></div>`;
}
function pageTraded() {
  const all = hotVariants(), STEP = 50;
  return {
    html: `<p class="small"><a href="#/">Home</a> › Most traded</p>
      <h1>Most traded right now</h1>
      <p class="muted">All ${all.length.toLocaleString()} variants with sales, ranked by recent sales, then lifetime sold on current eBay listings.</p>
      <div class="table-scroll"><table class="t">${variantHead("Variant")}<tbody id="traded-rows"></tbody></table></div>
      <p class="see-all"><button class="btn" id="traded-more" type="button">Load more</button></p>
      <p class="small muted" id="traded-count"></p>`,
    after() {
      const body = $("#traded-rows"), more = $("#traded-more"), count = $("#traded-count");
      let shown = 0;
      const load = () => {
        body.insertAdjacentHTML("beforeend", all.slice(shown, shown + STEP).map((x, i) =>
          variantRow(x, true).replace("<tr>", `<tr data-rank="${shown + i + 1}">`)).join(""));
        shown = Math.min(all.length, shown + STEP);
        count.textContent = `Showing ${shown.toLocaleString()} of ${all.length.toLocaleString()}`;
        if (shown >= all.length) { more.remove(); io && io.disconnect(); }
        else if (io) { io.unobserve(more); io.observe(more); }   // still on screen after a batch: check again
      };
      // keep loading as the button scrolls into view; the button also works on its own
      const io = "IntersectionObserver" in window
        ? new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && document.body.contains(more)) load(); }, { rootMargin: "600px" })
        : null;
      more.addEventListener("click", load);
      load();
      if (io && document.body.contains(more)) io.observe(more);
    },
  };
}
function cardFor(s) {
  return `<a class="card" href="#/p/${s.id}">${monTag(baseLook(s).img, baseLook(s).shiny, s.dex, "", s.name)}
    <div class="nm">${esc(s.name)}</div><div class="small muted">${variantsOf(s).length} variants</div>
    <div class="price" style="color:var(--price);font-weight:700">${speciesFrom(s) != null ? "from " + money(speciesFrom(s)) : "—"}</div></a>`;
}

function pageBrowse(region) {
  const regions = [...new Set(CAT.species.map((s) => s.region))];
  const r = regions.find((x) => x.toLowerCase() === region) || null;
  const list = CAT.species.filter((s) => !r || s.region === r);
  const html = `
    <div class="crumbs"><a href="#/">Home</a> › ${r ? esc(r) : "All Pokémon"}</div>
    <h1>${r ? esc(r) + " Pokémon" : "All tradable Pokémon"}</h1>
    <p class="muted">${list.length} species.</p>
    <div class="filters" id="bf">
      <button class="chip on" data-f="all">All</button>
      <button class="chip" data-f="legendary">Legendary</button>
      <button class="chip" data-f="ultra_beast">Ultra Beast</button>
      <button class="chip" data-f="mythical">Mythical (tradable)</button>
      <button class="chip" data-f="costume">Has costumes</button>
      <button class="chip" data-f="bg">Has backgrounds</button>
      <button class="chip" data-f="dmax">Dynamax</button>
      <button class="chip" data-f="gmax">Gigantamax</button>
      <input id="bq" placeholder="Filter by name or type…">
    </div>
    <div class="table-scroll"><table class="t"><thead><tr><th></th><th>Pokémon</th><th class="hide-sm">Type</th>
      <th class="num">Variants</th><th class="num hide-sm">BGs</th><th class="num">Standard</th><th class="num">Shiny</th><th class="num hide-sm">Top variant</th></tr></thead>
      <tbody id="brows"></tbody></table></div>`;
  return { html, after: () => {
    let f = "all";
    const draw = () => {
      const q = norm($("#bq").value);
      const rows = list.filter((s) => {
        if (f === "costume" && !s.looks.some((l) => l.kind === "costume")) return false;
        if (f === "bg" && !s.bgs.length) return false;
        if (f === "dmax" && !s.dmax) return false;
        if (f === "gmax" && !s.gmax.exists) return false;
        if (["legendary", "ultra_beast", "mythical"].includes(f) && s.cls !== f) return false;
        return !q || norm(s.name + " " + s.types.join(" ") + " " + s.dex).includes(q);
      });
      $("#brows").innerHTML = rows.map((s) => {
        const hasShiny = s.looks.some((l) => l.kind === "base" && l.shiny);
        return `<tr><td class="thumb"><div class="thumb-box">${monTag(baseLook(s).img, false, s.dex)}</div></td>
          <td><a class="vname" href="#/p/${s.id}">${esc(s.name)}</a> <span class="muted small">${dex3(s.dex)}</span>
            <div>${s.cls ? typeTags({ types: [], cls: s.cls }) : ""}</div></td>
          <td class="hide-sm">${s.types.map((t) => `<span class="tag type">${t}</span>`).join("")}</td>
          <td class="num">${variantsOf(s).length}</td>
          <td class="num hide-sm muted">${bgCount(s) || ""}</td>
          ${(() => {
            const vs2 = variantsOf(s);
            const std = quote(vs2.find((x) => x.key === "base"));
            const shy = quote(vs2.find((x) => x.key === "shiny"));
            const top = vs2.filter((x) => recOf(x)).sort((a, b) => demand(b) - demand(a))[0];
            const tq = top && quote(top);
            return `<td class="num"><span class="${std.cls}">${std.text}</span></td>
          <td class="num">${hasShiny ? `<span class="${shy.cls}">${shy.text}</span>` : '<span class="muted">n/a</span>'}</td>
          <td class="num hide-sm">${top ? `<a href="#/p/${s.id}/${encodeURIComponent(top.key)}">${esc(top.short)}</a> <span class="${tq.cls}">${tq.text}</span>` : '<span class="muted">—</span>'}</td>`;
          })()}</tr>`;
      }).join("") || `<tr><td colspan="7" class="muted">No matches.</td></tr>`;
    };
    $$("#bf .chip").forEach((c) => c.addEventListener("click", () => {
      $$("#bf .chip").forEach((x) => x.classList.toggle("on", x === c)); f = c.dataset.f; draw();
    }));
    $("#bq").addEventListener("input", draw);
    draw();
  } };
}

function pageSpecies(sp) {
  const vs = variantsOf(sp);
  const ladder = ladderOf(sp);
  const base = sp.looks.find((l) => l.kind === "base") || sp.looks[0];
  const counts = { shiny: 0, costume: 0, form: 0, bg: 0, max: 0 };
  vs.forEach((v) => dimsOf(v).forEach((d) => counts[d]++));

  const html = `
    <div class="crumbs"><a href="#/">Home</a> › <a href="#/browse/${sp.region.toLowerCase()}">${esc(sp.region)}</a> › ${esc(sp.name)}</div>
    <div class="product">
      <div>
        <div class="hero-img" id="hero">${monTag(base.img, false, sp.dex, "mon", sp.name)}</div>
        <div class="small muted hero-cap" id="hero-cap"></div>
      </div>
      <div>
        <h1>${esc(sp.name)}${base.name ? ` <span class="muted">(${esc(base.name)})</span>` : ""}</h1>
        <div class="meta-line">${dex3(sp.dex)} · ${esc(sp.region)} · ${typeTags(sp)}</div>
        <div class="ladder">${ladder.map((v) => `
          <a class="rung" href="#/p/${sp.id}/${encodeURIComponent(v.key)}">
            <div class="lbl">${esc(v.short)}</div>
            ${(() => { const q = quote(v); return `<div class="${q.cls}">${q.text}</div><div class="n">${esc(q.sub)}</div>`; })()}
            ${monTag(v.look.img, v.shiny, sp.dex, "", "")}
          </a>`).join("")}</div>
        <div class="ladder-note">This row works like PSA grades on a card: the most-traded ${esc(sp.name)} variants.
          Prices are 30-day sale medians; a grey price is the lowest current asking price where there are no sales yet.
          ${vs.length > ladder.length ? `<a href="#explorer">All ${vs.length} variants ↓</a>` : ""}</div>
        <div class="panel builder" id="builder"></div>
        <div id="chart"></div>
      </div>
    </div>

    <div id="explorer">
      <div class="explorer-head"><h2>All variants <span class="muted small">(${vs.length})</span></h2></div>
      <div class="filters sticky-filters" id="vf">
          <div class="seg" id="shinyseg"><button class="on" data-v="any">Any</button><button data-v="1">✦ Shiny</button><button data-v="0">Non-shiny</button></div>
          ${["costume", "form", "bg", "max"].filter((d) => counts[d]).map((d) =>
            `<button class="chip" data-dim="${d}">${{ costume: "Costume", form: "Form", bg: "Background", max: "Dynamax / Gigantamax" }[d]}<span class="c">${counts[d]}</span></button>`).join("")}
          <input id="vq" placeholder="Filter variants or events…">
      </div>
      <div id="groups"></div>
    </div>`;

  return { html, after: () => {
    const f = { shiny: "any", dims: new Set(), q: "" };
    $$("#shinyseg button").forEach((b) => b.addEventListener("click", () => {
      $$("#shinyseg button").forEach((x) => x.classList.toggle("on", x === b)); f.shiny = b.dataset.v; drawGroups();
    }));
    $$("#vf .chip").forEach((c) => c.addEventListener("click", () => {
      c.classList.toggle("on"); f.dims.has(c.dataset.dim) ? f.dims.delete(c.dataset.dim) : f.dims.add(c.dataset.dim); drawGroups();
    }));
    $("#vq").addEventListener("input", (e) => { f.q = norm(e.target.value); drawGroups(); });

    function drawGroups() {
      const shown = vs.filter((v) => {
        if (f.shiny !== "any" && v.shiny !== (f.shiny === "1")) return false;
        if (f.dims.size && !dimsOf(v).some((d) => f.dims.has(d))) return false;
        return !f.q || norm(v.label + " " + eventsOf(v).map((e) => e.title).join(" ")).includes(f.q);
      });
      // group: Standard / Forms / Costumes by year / Backgrounds by family / Gigantamax
      const groups = new Map();
      const put = (k, title, v, order) => { if (!groups.has(k)) groups.set(k, { title, rows: [], order }); groups.get(k).rows.push(v); };
      for (const v of shown) {
        if (v.max && !v.bg) put("max", "Dynamax & Gigantamax", v, 90);
        else if (v.bg) { const fam = CAT.families[v.bg.family]; put("bg-" + v.bg.family, `Backgrounds · ${fam ? fam.name : v.bg.family}`, v, 20); }
        else if (v.look.kind === "base") put("std", "Standard", v, 0);
        else if (v.look.kind === "form") put("form", "Forms", v, 10);
        else { const y = yearOf(v.look); put("c" + (y || 0), `Costumes · ${y || "Year unknown"}`, v, 100 - (y ? y - 2000 : 0) + 30); }
      }
      const list = [...groups.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
      const LIMIT = 8;
      $("#groups").innerHTML = list.map((g, i) => {
        const open = list.length <= 4 || i < 3 || f.q || f.dims.size;
        const more = g.rows.length > LIMIT;
        return `<details class="group" ${open ? "open" : ""}><summary><span class="grow">${esc(g.title)}</span><span class="muted small">${g.rows.length} variant${g.rows.length === 1 ? "" : "s"}</span></summary>
          <table class="t">${variantHead()}<tbody>${g.rows.map((v, j) => variantRow(v).replace("<tr>", `<tr ${j >= LIMIT ? 'class="extra" hidden' : ""}>`)).join("")}</tbody></table>
          ${more ? `<button class="show-more">Show all ${g.rows.length}</button>` : ""}</details>`;
      }).join("") || `<p class="muted">No variants match these filters.</p>`;
      $$("#groups .show-more").forEach((b) => b.addEventListener("click", () => {
        $$("tr.extra", b.parentElement).forEach((tr) => (tr.hidden = false)); b.remove();
      }));
    }
    drawGroups();
    drawBuilder(sp);
  } };
}

function drawBuilder(sp) {
  const vs = variantsOf(sp);
  const looks = sp.looks;
  const el = $("#builder");
  // open on the regular Pokémon (standard look, not shiny, no background); the builder drives the big image,
  // so the species page shows the plain Pokémon until someone picks a combo
  const sel = { look: (looks.find((l) => l.kind === "base") || looks[0]).key, shiny: false, bg: "", max: "" };
  const opts = (arr) => arr.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
  const lookName = (l) => (l.kind === "base" ? `Standard${l.name ? " (" + l.name + ")" : ""}` : `${l.name}${l.kind === "costume" ? " · costume" : ""}`);
  function current() {
    return vs.find((v) => v.look.key === sel.look && v.shiny === sel.shiny && (v.bg ? v.bg.id : "") === sel.bg && (v.max || "") === sel.max);
  }
  function render() {
    const look = looks.find((l) => l.key === sel.look);
    const maxOpts = [["", "None"]];
    if (look.kind === "base" && sp.dmax || sp.bgs.some((l) => l.look === look.key && l.max === "dmax")) maxOpts.push(["dmax", "Dynamax"]);
    if (look.kind === "base" && sp.gmax.exists || sp.bgs.some((l) => l.look === look.key && l.max === "gmax")) maxOpts.push(["gmax", "Gigantamax"]);
    if (!maxOpts.some(([k]) => k === sel.max)) sel.max = "";
    const bgOpts = sp.bgs.filter((l) => l.look === look.key && (l.max || "") === sel.max);
    if (!bgOpts.some((b) => b.bg === sel.bg)) sel.bg = "";
    let v = current();
    if (!v && sel.shiny) { sel.shiny = false; v = current(); }
    const shinyOk = !!vs.find((x) => x.look.key === sel.look && x.shiny && (x.bg ? x.bg.id : "") === sel.bg && (x.max || "") === sel.max);
    // The builder lives in the product header: the big image on the left is its live preview,
    // and the chart title follows the selected combo.
    el.innerHTML = `<div class="builder-head"><b>Price any combo</b>
        <span class="small muted">Combos with too few sales will get a model-estimated price.</span></div>
      <div class="builder-grid">
        <label class="f-look">Look<select id="b-look">${opts(looks.map((l) => [l.key, lookName(l)]))}</select></label>
        <label class="f-shiny switch"><input type="checkbox" id="b-shiny" ${sel.shiny ? "checked" : ""} ${shinyOk ? "" : "disabled"}> ✦ Shiny</label>
        ${maxOpts.length > 1 ? `<label class="f-max">Max<select id="b-max">${opts(maxOpts)}</select></label>` : ""}
        <label class="f-bg">Background <span class="small">(${bgOpts.length})</span><select id="b-bg" ${bgOpts.length ? "" : "disabled"}>${opts([["", bgOpts.length ? "None" : "None for this look"], ...bgOpts.map((b) => { const y = ((b.events || [])[0] || {}).start?.slice(0, 4) || BG[b.bg].year; return [b.bg, BG[b.bg].name + (y ? ` (${y})` : "") + (b.evolve ? " · via evolution" : "")]; })])}</select></label>
      </div>
      <div class="builder-result">
        <div class="br-main">
          <b>${esc(v ? v.label : "Not a valid combination")}</b>
          <div>${v ? tagsOf(v) : ""}</div>
          ${v ? eventTags(v, 3) : ""}
        </div>
        ${(() => { const q = quote(v); return `<div class="br-price"><span class="${q.cls}">${q.text}</span><span class="small muted">${esc(q.sub)}</span></div>`; })()}
        ${v ? `<a class="btn" href="#/p/${sp.id}/${encodeURIComponent(v.key)}">Open variant page →</a>` : ""}
      </div>`;
    if (v) {
      $("#hero").outerHTML = composite(v, "hero-img").replace('class="hero-img"', 'class="hero-img" id="hero"');
      $("#hero-cap").textContent = v.short === "Standard" ? "" : v.short;
    }
    $("#chart").innerHTML = chartFor(v, `${v ? v.short : "Standard"} · price history`);
    $("#b-look").value = sel.look; $("#b-bg").value = sel.bg; if ($("#b-max")) $("#b-max").value = sel.max;
    $("#b-look").onchange = (e) => { sel.look = e.target.value; render(); };
    $("#b-shiny").onchange = (e) => { sel.shiny = e.target.checked; render(); };
    $("#b-bg").onchange = (e) => { sel.bg = e.target.value; render(); };
    if ($("#b-max")) $("#b-max").onchange = (e) => { sel.max = e.target.value; render(); };
  }
  render();
}

function pageVariant(sp, key) {
  const vs = variantsOf(sp);
  const v = vs.find((x) => x.key === key);
  if (!v) return `<p>Unknown variant. <a href="#/p/${sp.id}">Back to ${esc(sp.name)}</a></p>`;
  const siblings = ladderOf(sp).filter((x) => x !== v).slice(0, 5);
  const html = `
    <div class="crumbs"><a href="#/">Home</a> › <a href="#/browse/${sp.region.toLowerCase()}">${esc(sp.region)}</a> ›
      <a href="#/p/${sp.id}">${esc(sp.name)}</a> › ${esc(v.short)}</div>
    <div class="product">
      <div>${composite(v, "hero-img")}</div>
      <div>
        <h1>${esc(v.label)}</h1>
        <div class="meta-line">${dex3(sp.dex)} · ${typeTags(sp)} ${tagsOf(v)}</div>
        ${(() => { const r = recOf(v) || {}; return `<div class="ladder" style="margin-top:8px">
          <div class="rung"><div class="lbl">Market price (30-day median)</div><div class="price">${money(r.price)}</div><div class="n">${r.n || 0} sale${r.n === 1 ? "" : "s"}</div></div>
          <div class="rung"><div class="lbl">Low / High (30d)</div><div class="price">${r.price != null ? `${money(r.low)} / ${money(r.high)}` : "— / —"}</div><div class="n">10th–90th percentile</div></div>
          <div class="rung"><div class="lbl">Last sale</div><div class="price">${r.last ? money(r.last[1]) : "—"}</div><div class="n">${r.last ? esc(r.last[0]) : "—"}</div></div>
          <div class="rung"><div class="lbl">Lowest ask now</div><div class="price ask">${money(r.ask)}</div><div class="n">${r.listings || 0} listing${r.listings === 1 ? "" : "s"} · ${(r.lifetime || 0).toLocaleString()} sold lifetime</div></div>
        </div>`; })()}
        ${chartFor(v, `${v.short} · price history`)}
      </div>
    </div>
    <h2>What's guaranteed in this trade</h2>
    <div class="panel small">
      <b>Fixed by the seller:</b> species${v.look.kind !== "base" || v.look.name ? `, ${v.look.kind === "base" ? "form" : v.look.kind} (${esc(v.look.name)})` : ""}${v.shiny ? ", shiny" : ""}${v.bg ? `, background (${esc(v.bg.name)})` : ""}${v.max ? `, ${MAX_NAME[v.max]}` : ""}.<br>
      <b>Random, never guaranteed:</b> IVs, CP and HP (rerolled on trade), moves, size, Poké Ball and lucky.
      ${v.bg ? `<br><b>Background:</b> ${esc(CAT.families[v.bg.family]?.desc || "")} <a href="#/bg/${v.bg.slug}">About this background →</a>` : ""}
      ${v.shiny && v.look.shinyDate ? `<br><b>Shiny released:</b> ${esc(v.look.shinyDate)}` : ""}
    </div>
    ${eventsOf(v).length ? `<h2>${v.bg ? "Events this background came from" : "Events this costume came from"}</h2>
    <table class="t"><thead><tr><th>Event</th><th>Dates</th>${v.bg ? "" : "<th class=\"num\">Shiny</th>"}</tr></thead><tbody>
      ${eventsOf(v).map((e) => `<tr><td>${esc(e.title)}</td><td class="muted">${esc(e.when || "")}</td>${v.bg ? "" : `<td class="num">${e.shiny ? "✦" : ""}</td>`}</tr>`).join("")}
    </tbody></table>
    ${v.bg && v.look.kind === "costume" && (v.look.events || []).length ? `<p class="small muted">The ${esc(v.look.name)} costume has appeared in: ${v.look.events.map((e) => esc(e.title) + (e.dates ? ` (${esc(e.dates)})` : "")).join(" · ")}.</p>` : ""}` : ""}
    <h2>Recent sales</h2>
    <table class="t"><thead><tr><th>Date</th><th>Listing</th><th class="hide-sm">Delivery</th><th class="num">Qty</th><th class="num">Price</th></tr></thead>
      <tbody>${((recOf(v) || {}).sales || []).map((x) => `<tr><td class="muted">${esc(x[0])}</td>
        <td>${x[5] ? `<a href="${esc(x[5])}" target="_blank" rel="noopener nofollow">${esc(x[4])} ↗</a>` : esc(x[4])}<div class="small muted">${x[7] ? esc(x[7]) : ""}${x[8] === "sold_page" ? `${x[7] ? " · " : ""}from eBay sold listings (latest sale of that listing)` : ""}</div></td>
        <td class="hide-sm muted">${esc(x[3] || "—")}</td><td class="num">${x[2]}</td>
        <td class="num"><span class="price">${money(x[1])}</span>${x[6] != null && Math.abs(x[6] - x[1]) > 0.005 ? `<div class="small muted">listed ${money(x[6])}</div>` : ""}</td></tr>`).join("")
        || `<tr><td colspan="5" class="muted">No sales recorded yet. Sales show up when a listing's sold count goes up between daily snapshots.</td></tr>`}</tbody></table>
    <h2>Listed now on eBay</h2>
    <table class="t"><thead><tr><th>Listing</th><th class="hide-sm">Seller</th><th class="hide-sm">Delivery</th><th class="num hide-sm">Sold (lifetime)</th><th class="num">Price</th></tr></thead>
      <tbody>${((recOf(v) || {}).listed || []).map((x) => `<tr>
        <td><a href="${esc(x[3])}" target="_blank" rel="noopener nofollow">${esc(x[4])} ↗</a>${x[5] ? `<div class="small muted">Option: ${esc(x[5])}</div>` : ""}</td>
        <td class="hide-sm">${esc(x[6] || "")}${x[7] != null ? `<div class="small muted">${Number(x[7]).toLocaleString()} feedback</div>` : ""}</td>
        <td class="hide-sm muted">${esc(x[2] || "—")}</td><td class="num hide-sm">${x[8] == null ? '<span class="muted" title="Sold count not fetched yet">—</span>' : Number(x[8]).toLocaleString()}</td>
        <td class="num"><span class="price ask">${money(x[1])}</span>${Math.abs(x[1] - x[0]) > 0.005 ? `<div class="small muted">≈ ${money(x[0])} as a trade</div>` : ""}</td></tr>`).join("")
        || `<tr><td colspan="5" class="muted">Nobody is selling this variant on eBay right now (in the listings we track).</td></tr>`}</tbody></table>
    <p class="small muted">Prices are on a standard-trade basis: PTC and 1M-Stardust sales are adjusted (see Data notes).</p>
    <h2>Other ${esc(sp.name)} variants</h2>
    <div class="ladder">${siblings.map((x) => `<a class="rung" href="#/p/${sp.id}/${encodeURIComponent(x.key)}">
      <div class="lbl">${esc(x.short)}</div>${(() => { const q = quote(x); return `<div class="${q.cls}">${q.text}</div><div class="n">${esc(q.sub)}</div>`; })()}${monTag(x.look.img, x.shiny, sp.dex, "", "")}</a>`).join("")}</div>
    <p><a href="#/p/${sp.id}#explorer">See all ${vs.length} variants →</a></p>`;
  return html;
}

const BGSP = new Map(); // background id -> species that can have it (filled at boot)
function linkedSpecies(bgId) { return BGSP.get(bgId) || []; }
function pageBackgrounds() {
  const byFam = new Map();
  for (const b of CAT.backgrounds) { if (!byFam.has(b.family)) byFam.set(b.family, []); byFam.get(b.family).push(b); }
  const famOrder = Object.keys(CAT.families);
  return `
    <div class="crumbs"><a href="#/">Home</a> › Backgrounds</div>
    <h1>Backgrounds</h1>
    <p class="muted">All ${CAT.backgrounds.length} backgrounds, grouped by family. Backgrounds in the same family should sell for similar prices,
      so a family will also get its own price. That helps backgrounds with only a few sales.</p>
    <div class="notice">Which Pokémon can have each background comes from <b>Dittobase</b> (primary) and is cross-checked against <b>Bulbapedia</b>.
      Pokémon that only Bulbapedia lists are added too. ${CAT.backgrounds.filter((b) => linkedSpecies(b.id).length).length} of ${CAT.backgrounds.length}
      backgrounds have at least one tradable Pokémon. The rest are mythical-only, fusion-only, or have no published list yet.</div>
    ${famOrder.filter((f) => byFam.has(f)).map((f) => `
      <details class="group" ${["gofest_city", "gofest_global", "tour_global", "tour_city"].includes(f) ? "open" : ""}>
        <summary><span class="grow">${esc(CAT.families[f].name)}</span><span class="muted small">${byFam.get(f).length} backgrounds</span></summary>
        <div class="panel"><p class="small muted" style="margin-top:0">${esc(CAT.families[f].desc)}</p>
        <div class="grid bgs">${byFam.get(f).map(bgCard).join("")}</div></div>
      </details>`).join("")}`;
}
const bgYears = (b) => [...new Set((b.events || []).map((e) => (e.start || "").slice(0, 4)).filter(Boolean))].sort().join(", ") || (b.year || "");
function bgCard(b) {
  const n = linkedSpecies(b.id).length;
  return `<a class="bg-card" href="#/bg/${b.slug}"><div class="img">${b.img ? `<img loading="lazy" alt="" src="${bgImg(b.img)}" onerror="this.remove()">` : `<span class="muted small">no image</span>`}</div>
    <div class="body"><b>${esc(b.name)}</b><div class="small muted">${b.kind === "special" ? "Special" : "Location"}${bgYears(b) ? " · " + bgYears(b) : ""} · ${n ? `${n} Pokémon` : "no tradable Pokémon"}</div></div></a>`;
}
function pageBackground(b) {
  const sps = linkedSpecies(b.id);
  const vs = sps.flatMap((s) => variantsOf(s).filter((v) => v.bg && v.bg.id === b.id));
  return `
    <div class="crumbs"><a href="#/">Home</a> › <a href="#/backgrounds">Backgrounds</a> › ${esc(b.name)}</div>
    <div class="product">
      <div class="hero-img">${b.img ? `<img class="bgimg" alt="" src="${bgImg(b.img)}">` : ""}</div>
      <div>
        <h1>${esc(b.name)}</h1>
        <div class="meta-line"><span class="tag bg">${b.kind === "special" ? "Special background" : "Location background"}</span>
          ${esc(CAT.families[b.family]?.name || b.family)}${bgYears(b) ? " · " + bgYears(b) : ""}</div>
        <div class="small" style="margin:6px 0 10px">${(b.events || []).filter((e) => e.title).map((e) =>
          `<div>📅 ${esc(e.title)}${e.start ? ` <span class="muted">· ${esc(e.start)}${e.end && e.end !== e.start ? " → " + esc(e.end) : ""}</span>` : ""}</div>`).join("")}
          <div class="muted">Sources: ${(b.sources || []).map(esc).join(", ")}</div></div>
        ${(() => {
          const med = (xs) => { xs = xs.filter((x) => x != null).sort((a, b) => a - b); return xs.length ? xs[Math.floor((xs.length - 1) / 2)] : null; };
          const famVs = CAT.backgrounds.filter((x) => x.family === b.family)
            .flatMap((x) => linkedSpecies(x.id).flatMap((s2) => variantsOf(s2).filter((v2) => v2.bg && v2.bg.id === x.id)));
          const mine = vs.map((v2) => quote(v2).value), fam = famVs.map((v2) => quote(v2).value);
          return `<div class="ladder" style="max-width:420px"><div class="rung"><div class="lbl">Family price index (median)</div><div class="price">${money(med(fam))}</div><div class="n">${fam.filter((x) => x != null).length} priced variants</div></div>
          <div class="rung"><div class="lbl">This background (median)</div><div class="price">${money(med(mine))}</div><div class="n">${mine.filter((x) => x != null).length} priced variants</div></div></div>`;
        })()}
      </div>
    </div>
    <h2>Pokémon with this background <span class="muted small">(${sps.length} species · ${vs.length} variants)</span></h2>
    ${vs.length ? `<div class="table-scroll"><table class="t">${variantHead("Variant")}<tbody>${vs.map((v) => variantRow(v, true)).join("")}</tbody></table></div>`
      : `<p class="muted">No tradable Pokémon. The sources list only mythical or fused Pokémon for this background, or no Pokémon at all.</p>`}`;
}

function searchVariants(q, limit = 200) {
  const toks = norm(q).split(" ").filter(Boolean);
  if (!toks.length) return [];
  const out = [];
  for (const s of CAT.species) {
    const spHay = norm(`${s.name} ${s.types.join(" ")} ${s.dex}`);
    if (!toks.some((t) => spHay.includes(t)) && !s.looks.some((l) => toks.some((t) => norm(l.name).includes(t))) && !s.bgs.length) continue;
    for (const v of variantsOf(s)) {
      const hay = norm(`${v.label} ${v.look.kind} ${v.bg ? "background bg " + v.bg.name : ""} ${v.max || ""} ${eventsOf(v).map((e) => e.title).join(" ")}`) + " " + spHay;
      if (toks.every((t) => hay.includes(t))) out.push(v);
    }
  }
  const qn = norm(q);
  out.sort((a, b) => (norm(b.sp.name).startsWith(qn) - norm(a.sp.name).startsWith(qn)) || a.sp.dex - b.sp.dex);
  return out.slice(0, limit);
}
function pageSearch(q) {
  const qn = norm(q);
  const sps = CAT.species.filter((s) => norm(s.name).includes(qn)).slice(0, 24);
  const vs = searchVariants(q);
  const bgs = CAT.backgrounds.filter((b) => norm(b.name).includes(qn)).slice(0, 12);
  return `
    <div class="crumbs"><a href="#/">Home</a> › Search</div>
    <h1>Results for “${esc(q)}”</h1>
    ${sps.length ? `<h2>Pokémon</h2><div class="grid cards">${sps.map(cardFor).join("")}</div>` : ""}
    ${vs.length ? `<h2>Variants <span class="muted small">(${vs.length}${vs.length === 200 ? "+" : ""})</span></h2>
      <div class="table-scroll"><table class="t">${variantHead()}<tbody>${vs.map((v) => variantRow(v, true)).join("")}</tbody></table></div>` : ""}
    ${bgs.length ? `<h2>Backgrounds</h2><div class="grid bgs">${bgs.map(bgCard).join("")}</div>` : ""}
    ${!sps.length && !vs.length && !bgs.length ? `<p class="muted">Nothing found.</p>` : ""}`;
}

function pageAbout() {
  return `
    <div class="crumbs"><a href="#/">Home</a> › Data notes</div>
    <h1>Data notes</h1>
    <div class="panel">
      <p><b>Catalog built:</b> ${esc(CAT.generated)}</p>
      <ul>
        <li><b>Species, forms, costumes, tradability:</b> ${esc(CAT.sources.game_master)}. The game data has an <code>isTradable</code> flag for each form.</li>
        <li><b>Which Pokémon can have which background:</b> ${esc(CAT.sources.backgrounds)}.
          ${CAT.bg_report.linked_dittobase} links from Dittobase, ${CAT.bg_report.links_added_from_bulbapedia} more from Bulbapedia,
          ${CAT.bg_report.backgrounds_only_on_bulbapedia} backgrounds that only Bulbapedia lists.</li>
        <li><b>Shiny availability and costume names:</b> ${esc(CAT.sources.shiny)}</li>
        <li><b>Events:</b> background events come from Dittobase's per-event Pokémon lists. Costume events come from Bulbapedia's
          "Event Pokémon (GO)" page. A costume with no listed event shows its shiny release date instead.</li>
        <li><b>Released species:</b> ${esc(CAT.sources.released)}</li>
        <li><b>Images:</b> ${esc(CAT.sources.images)}</li>
      </ul>
      <h3>How prices work</h3>
      <p class="small">Every day the collector snapshots Pokémon GO trade listings on eBay. When a listing's sold count goes up between
        snapshots, that's a sale at the listing's price. Each listing is matched to a variant from its title and chosen option.
        The price shown is the <b>median of the last 30 days of sales</b>. Sales from low-confidence matches, accounts, bundles and
        services are left out, and so are sales with extras that change the product (Level 50, powered-up CP, extra moves, Lucky, Crowned form).
        Where a variant has no sales yet, the <b>lowest current asking price</b> is shown in grey instead.</p>
      <p class="small"><b>Coverage:</b> every day the collector searches eBay for every Pokémon (about a third of species per day) plus broad
        searches. Single-item listings get an asking price straight from the search result. Sold counts, and the options inside
        multi-option listings, need a detail call, and eBay allows 5,000 a day, so listings that sell are refreshed first.</p>
      <p class="small"><b>Older history</b> comes from eBay "Sold items" search pages saved by hand. On those pages a listing that sold many times
        shows up once, at its most recent sale, so imported history is reliable for prices but undercounts how many sold.
        For listings we already track, only sales from before we started tracking are imported, so nothing is counted twice.</p>
      <p class="small">Prices are on a <b>standard trade</b> basis. Sellers charge differently for delivery options, so other options are adjusted
        by the price gap sellers themselves use when they list several options for the same Pokémon:
        ${Object.entries(PRICES.delivery_factors || {}).map(([d, f]) => `${esc(d)} × ${f.factor} (from ${f.pairs} listings)`).join(", ") || "not measured yet"}.
        ${PRICES.generated ? `Last snapshot: ${esc(PRICES.generated)}.` : ""}</p>
      <h3>How variants are counted</h3>
      <p class="small">A variant is a <i>look</i> (standard, alternate form or costume) × shiny × Dynamax/Gigantamax × background.
        Background combos come straight from the background lists: each one names the exact look (e.g. a costume) and whether a shiny exists.
        Pokémon that can only get a background by evolving are tagged “via evolution”. Shadow versions are left out because they can't be traded.</p>
      <h3>Known gaps</h3>
      <ul class="small">
        <li>Background lists are community-maintained (Dittobase, Bulbapedia). A background released after the last data fetch won't appear until the fetch runs again.</li>
        <li>Dynamax is only known where a background list mentions it, so plain Dynamax variants are missing for species that never got a Dynamax background.</li>
        <li>Older costumes that never got a shiny may be missing, because the old costume system isn't listed in the game data.</li>
        <li>Release status for non-shiny alternate forms isn't verified, so a few unreleased forms may appear.</li>
        <li>Gender differences aren't treated as separate variants.</li>
        <li>Bulbapedia sometimes groups related costumes in one row (e.g. Pikachu's balloon costumes), so those costumes share one event list.</li>
      </ul>
    </div>
    <h2>Not tradable (excluded)</h2>
    <table class="t"><thead><tr><th>#</th><th>Pokémon / form</th><th>Reason</th></tr></thead><tbody>
      ${CAT.excluded.map((e) => `<tr><td class="muted">${dex3(e.dex)}</td><td>${esc(e.name)}</td><td class="muted">${esc(e.reason)}</td></tr>`).join("")}
    </tbody></table>`;
}

/* ------------------------------------------------------------------ router */
function setNav(active) {
  const regions = [...new Set(CAT.species.map((s) => s.region))];
  const items = [["all", "All Pokémon"], ...regions.map((r) => [r.toLowerCase(), r])];
  $("#region-nav").innerHTML = items.map(([k, t]) => `<a href="#/browse/${k}" class="${active === k ? "on" : ""}">${esc(t)}</a>`).join("")
    + `<a href="#/backgrounds" class="${active === "backgrounds" ? "on" : ""}">Backgrounds</a>`
    + `<a href="#/about" class="${active === "about" ? "on" : ""}">Data notes</a>`;
}
function route() {
  const hash = location.hash.replace(/^#/, "");
  const [path, anchor] = hash.split("#");
  const parts = (path || "/").split("/").filter(Boolean).map(decodeURIComponent);
  let out, active = "";
  if (!parts.length) out = pageHome();
  else if (parts[0] === "browse") { active = parts[1] || "all"; out = pageBrowse(parts[1] || "all"); }
  else if (parts[0] === "p" && SP[parts[1]]) {
    const sp = SP[parts[1]]; active = sp.region.toLowerCase();
    out = parts[2] ? pageVariant(sp, parts[2]) : pageSpecies(sp);
  } else if (parts[0] === "backgrounds") { active = "backgrounds"; out = pageBackgrounds(); }
  else if (parts[0] === "bg" && BGSLUG[parts[1]]) { active = "backgrounds"; out = pageBackground(BGSLUG[parts[1]]); }
  else if (parts[0] === "search") out = pageSearch(parts.slice(1).join("/"));
  else if (parts[0] === "traded") out = pageTraded();
  else if (parts[0] === "about") { active = "about"; out = pageAbout(); }
  else out = `<p>Page not found. <a href="#/">Home</a></p>`;
  setNav(active);
  syncHeaderHeight(); // nav content can change the header's height
  const app = $("#app");
  if (typeof out === "string") app.innerHTML = out;
  else { app.innerHTML = out.html; out.after(); }
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
  else window.scrollTo(0, 0);
  const h1 = $("h1", app);
  document.title = (h1 ? h1.textContent.trim() + " · " : "") + "PoGo Price Guide";
}

/* ------------------------------------------------------------------ search */
function setupSearch() {
  const input = $("#search"), box = $("#suggest");
  let items = [], idx = -1;
  const close = () => { box.hidden = true; idx = -1; };
  input.addEventListener("input", () => {
    const q = norm(input.value);
    if (q.length < 2) return close();
    const sps = CAT.species.filter((s) => norm(s.name).includes(q))
      .sort((a, b) => norm(b.name).startsWith(q) - norm(a.name).startsWith(q) || a.dex - b.dex).slice(0, 6)
      .map((s) => ({ href: `#/p/${s.id}`, img: monImg(baseLook(s).img, false), t: s.name, sub: `${dex3(s.dex)} · ${variantsOf(s).length} variants` }));
    const vs = q.includes(" ") || sps.length < 3 ? searchVariants(input.value, 6).map((v) => ({
      href: `#/p/${v.sp.id}/${encodeURIComponent(v.key)}`, img: monImg(v.look.img, v.shiny), t: v.label, sub: "variant" })) : [];
    items = [...sps, ...vs];
    if (!items.length) return close();
    box.innerHTML = items.map((it, i) => `<a href="${it.href}" data-i="${i}"><img src="${it.img}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(it.t)}<br><span class="small muted">${esc(it.sub)}</span></span></a>`).join("");
    box.hidden = false; idx = -1;
  });
  input.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); idx = (idx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      $$("a", box).forEach((a, i) => a.classList.toggle("active", i === idx));
    } else if (e.key === "Escape") close();
  });
  $("#search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (idx >= 0 && items[idx]) location.hash = items[idx].href;
    else if (input.value.trim()) location.hash = "#/search/" + encodeURIComponent(input.value.trim());
    close(); input.blur();
  });
  box.addEventListener("click", close);
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) close(); });
}

/* The variant list and combo builder are window-height panes that scroll on their own; they size
 * themselves from the sticky header's real height. */
function syncHeaderHeight() {
  const h = $(".site-header").getBoundingClientRect().height;
  document.documentElement.style.setProperty("--header-h", `${Math.round(h)}px`);
}
window.addEventListener("resize", syncHeaderHeight);

/* -------------------------------------------------------------------- boot */
Promise.all([
  fetch("data/catalog.json").then((r) => r.json()),
  fetch("data/prices.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
]).then(([cat, prices]) => {
  CAT = cat;
  if (prices) PRICES = prices;
  CAT.species.forEach((s) => (SP[s.id] = s));
  CAT.backgrounds.forEach((b) => { BG[b.id] = b; BGSLUG[b.slug] = b; });
  CAT.species.forEach((s) => new Set(s.bgs.map((l) => l.bg)).forEach((id) => {
    if (!BGSP.has(id)) BGSP.set(id, []);
    BGSP.get(id).push(s);
  }));
  setupSearch();
  window.addEventListener("hashchange", route);
  route();
}).catch((err) => {
  $("#app").innerHTML = `<p>Couldn't load data/catalog.json (${esc(err.message)}). Serve the <code>site/</code> folder over HTTP, e.g. <code>python3 -m http.server -d site 8000</code>.</p>`;
});
