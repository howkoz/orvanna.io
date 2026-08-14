/* Orvanna Member Portal, demo mode.
   Plain JavaScript, no libraries, no build step.
   Data surface: seven read-only demo views on Supabase PostgREST.
   Every account, order, and payout is synthetic. */
"use strict";

/* ---------------- configuration ---------------- */

const API_BASE = "https://oiyibdczkokegaxkwulv.supabase.co/rest/v1";
const API_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9peWliZGN6a29rZWdheGt3dWx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MzM1MDEsImV4cCI6MjEwMjIwOTUwMX0.NfZPoc6ZCZb-VtYhMC_toLnX73s5BJ_esKA4na-Pgdw";

const DEFAULT_MEMBER = "GW-000002";
const DEFAULT_PERIOD = "2026-07-01";
const PAGE_SIZE = 1000; /* PostgREST caps one response at 1,000 rows; page past it */

const RANK_ORDER = { member: 1, builder: 2, leader: 3, director: 4, executive: 5 };
const RANK_LABEL = { member: "Member", builder: "Builder", leader: "Leader", director: "Director", executive: "Executive" };
const RANK_LADDER = ["member", "builder", "leader", "director", "executive"];
const PAID_DEPTH = { member: 1, builder: 2, leader: 3, director: 4, executive: 5 };
const QUAL_SV = 100; /* Sales Volume (SV) needed to be qualified, comp plan v1.3 */

/* Rank requirements, comp plan specification v1.3.
   Every rank above Member also requires qualification (SV >= 100). */
const RANK_REQS = {
  builder:   { tv: null,  activeLegs: 2, legsWith: null },
  leader:    { tv: 2500,  activeLegs: 3, legsWith: null },
  director:  { tv: 10000, activeLegs: null, legsWith: { rank: "builder", count: 2 } },
  executive: { tv: 40000, activeLegs: null, legsWith: { rank: "leader", count: 2 } }
};

/* ---------------- state and caches ---------------- */

const state = { member: DEFAULT_MEMBER, period: DEFAULT_PERIOD, tab: "team" };

const db = {
  members: [],                 /* v_demo_members rows */
  byCode: new Map(),           /* member_code -> member row */
  children: new Map(),         /* sponsor_code -> [child codes] */
  subtreeSize: new Map(),      /* member_code -> node count including self */
  company: [],                 /* v_demo_company rows, period ascending */
  companyByPeriod: new Map(),
  customersByMember: new Map(),/* member_code -> [customer rows] */
  periodMaps: new Map(),       /* period -> Map(member_code -> member_month row) */
  memberMonths: new Map(),     /* member_code -> [6 member_month rows] */
  customerVol: new Map(),      /* member_code -> [customer volume rows] */
  statements: new Map()        /* "code|period" -> [statement rows] */
};

/* ---------------- small utilities ---------------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function fmt2(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmt0(n) {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function pct(rate) {
  /* 0.1000 -> "10%" */
  return (Number(rate) * 100).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "%";
}
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function periodLong(p) {  /* "2026-07-01" -> "July 2026" */
  const y = p.slice(0, 4), m = parseInt(p.slice(5, 7), 10);
  return MONTHS_LONG[m - 1] + " " + y;
}
function periodShort(p) { /* "2026-07-01" -> "Jul 2026" */
  const y = p.slice(0, 4), m = parseInt(p.slice(5, 7), 10);
  return MONTHS_SHORT[m - 1] + " " + y;
}
function periodYm(p) { return p.slice(0, 7); } /* "2026-07" */

function rankBadge(rankCode, big) {
  const code = (rankCode || "member").toLowerCase();
  return '<span class="badge ' + (big ? "big " : "") + "rank-" + esc(code) + '">' +
    esc(RANK_LABEL[code] || rankCode) + "</span>";
}

/* ---------------- data layer ---------------- */

async function rest(pathQuery) {
  const res = await fetch(API_BASE + "/" + pathQuery, {
    headers: { apikey: API_KEY, Authorization: "Bearer " + API_KEY }
  });
  if (!res.ok) {
    throw new Error("The data service answered HTTP " + res.status + " for " + pathQuery.split("?")[0]);
  }
  return res.json();
}

/* Fetch every row of a query, paging past the 1,000-row response cap. */
async function fetchAll(pathQuery) {
  const sep = pathQuery.indexOf("?") >= 0 ? "&" : "?";
  let out = [], offset = 0;
  for (;;) {
    const rows = await rest(pathQuery + sep + "limit=" + PAGE_SIZE + "&offset=" + offset);
    out = out.concat(rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out;
}

async function loadCore() {
  const [members, tree, company, customers] = await Promise.all([
    fetchAll("v_demo_members?select=member_code,display_name,enrolled_on,rank_name&order=member_code.asc"),
    fetchAll("v_demo_tree?select=member_code,sponsor_code"),
    fetchAll("v_demo_company?select=*&order=period.asc"),
    fetchAll("v_demo_customers?select=customer_code,display_name,referring_member_code,enrolled_on&order=customer_code.asc")
  ]);

  db.members = members;
  db.byCode = new Map(members.map(function (m) { return [m.member_code, m]; }));

  db.children = new Map();
  tree.forEach(function (e) {
    if (!e.sponsor_code) return;
    if (!db.children.has(e.sponsor_code)) db.children.set(e.sponsor_code, []);
    db.children.get(e.sponsor_code).push(e.member_code);
  });
  db.children.forEach(function (list) { list.sort(); });

  /* subtree sizes (self included), iterative so deep legs cannot overflow the stack */
  db.subtreeSize = new Map();
  members.forEach(function (m) {
    if (db.subtreeSize.has(m.member_code)) return;
    const stack = [[m.member_code, 0]];
    const order = [];
    while (stack.length) {
      const top = stack.pop();
      order.push(top[0]);
      (db.children.get(top[0]) || []).forEach(function (c) {
        if (!db.subtreeSize.has(c)) stack.push([c, 0]);
      });
    }
    for (let i = order.length - 1; i >= 0; i--) {
      const code = order[i];
      let n = 1;
      (db.children.get(code) || []).forEach(function (c) { n += db.subtreeSize.get(c) || 0; });
      db.subtreeSize.set(code, n);
    }
  });

  db.company = company;
  db.companyByPeriod = new Map(company.map(function (c) { return [c.period, c]; }));

  db.customersByMember = new Map();
  customers.forEach(function (c) {
    if (!db.customersByMember.has(c.referring_member_code)) db.customersByMember.set(c.referring_member_code, []);
    db.customersByMember.get(c.referring_member_code).push(c);
  });
}

async function getPeriodMap(period) {
  if (db.periodMaps.has(period)) return db.periodMaps.get(period);
  const rows = await fetchAll(
    "v_demo_member_months?select=member_code,sv,cv,tv,is_active,rank_earned&period=eq." + period);
  const map = new Map(rows.map(function (r) { return [r.member_code, r]; }));
  db.periodMaps.set(period, map);
  return map;
}

async function getMemberMonths(code) {
  if (db.memberMonths.has(code)) return db.memberMonths.get(code);
  const rows = await rest("v_demo_member_months?member_code=eq." + encodeURIComponent(code) + "&order=period.asc");
  db.memberMonths.set(code, rows);
  return rows;
}

async function getCustomerVol(code) {
  if (db.customerVol.has(code)) return db.customerVol.get(code);
  const rows = await rest("v_demo_customer_volume?member_code=eq." + encodeURIComponent(code) + "&order=volume_month.asc");
  db.customerVol.set(code, rows);
  return rows;
}

async function getStatement(code, period) {
  const key = code + "|" + period;
  if (db.statements.has(key)) return db.statements.get(key);
  const rows = await fetchAll(
    "v_demo_statements?earner_code=eq." + encodeURIComponent(code) +
    "&period=eq." + period + "&order=level.asc,source_code.asc");
  db.statements.set(key, rows);
  return rows;
}

/* ---------------- derived computations (client side, public data only) ---------------- */

function legStats(code, periodMap) {
  /* One entry per frontline (directly sponsored) member: is the leg active
     (frontline SV >= 100), and the highest rank earned anywhere in the leg. */
  const frontline = db.children.get(code) || [];
  return frontline.map(function (fc) {
    const row = periodMap.get(fc);
    const active = !!row && Number(row.sv) >= QUAL_SV;
    let maxRank = 1;
    const stack = [fc];
    while (stack.length) {
      const cur = stack.pop();
      const r = periodMap.get(cur);
      if (r) maxRank = Math.max(maxRank, RANK_ORDER[(r.rank_earned || "member").toLowerCase()] || 1);
      (db.children.get(cur) || []).forEach(function (c) { stack.push(c); });
    }
    return { code: fc, active: active, maxRank: maxRank, sv: row ? Number(row.sv) : 0 };
  });
}

/* ---------------- panel plumbing ---------------- */

function panelBody(tab) {
  return document.querySelector("#panel-" + tab + " .panel-body");
}
function setLoading(el, msg) {
  el.innerHTML = '<div class="state-box"><div class="spinner" role="status" aria-label="Loading"></div><div>' +
    esc(msg || "Loading live demo data") + "&hellip;</div></div>";
}
function setError(el, err, retryFn) {
  el.innerHTML = '<div class="state-box">' +
    '<div class="error-title">Could not load this section</div>' +
    "<div>" + esc(err && err.message ? err.message : String(err)) + "</div>" +
    '<button class="retry-btn" type="button">Retry</button></div>';
  el.querySelector(".retry-btn").addEventListener("click", retryFn);
}

/* ---------------- MY TEAM ---------------- */

function makeCustomerLeaf(cust) {
  const li = document.createElement("li");
  li.className = "tnode";
  li.innerHTML = '<span class="customer-row">' +
    '<span class="customer-tag">Customer</span>' +
    '<span class="node-code">' + esc(cust.customer_code) + "</span>" +
    '<span class="node-name">' + esc(cust.display_name) + "</span>" +
    "</span>";
  return li;
}

function makeNode(code, depth, periodMap) {
  const m = db.byCode.get(code);
  const row = periodMap.get(code);
  const kids = db.children.get(code) || [];
  const custs = db.customersByMember.get(code) || [];
  const downline = (db.subtreeSize.get(code) || 1) - 1;
  const rank = row ? row.rank_earned : "member";
  const sv = row ? Number(row.sv) : 0;
  const hasBranch = kids.length > 0 || custs.length > 0;

  const li = document.createElement("li");
  li.className = "tnode";
  li.dataset.code = code;

  let html = '<span class="node-row' + (depth === 0 ? " rootcard" : "") + '">';
  if (hasBranch) {
    html += '<button class="node-toggle" type="button" aria-label="Expand or collapse this leg">&#9654;</button>';
  }
  html += '<span class="node-code">' + esc(code) + "</span>" +
    '<span class="node-name">' + esc(m ? m.display_name : code) + "</span>" +
    rankBadge(rank) +
    '<span class="node-sv">SV ' + fmt2(sv) + "</span>";
  if (downline > 0) html += '<span class="node-count">' + fmt0(downline) + " downline</span>";
  if (custs.length > 0) {
    html += '<span class="node-count">' + fmt0(custs.length) +
      (custs.length === 1 ? " customer" : " customers") + "</span>";
  }
  html += "</span>";
  li.innerHTML = html;

  if (hasBranch) {
    const toggle = li.querySelector(".node-toggle");
    let built = false;
    let ul = null;
    const expand = function () {
      if (!built) {
        ul = document.createElement("ul");
        kids.forEach(function (c) { ul.appendChild(makeNode(c, depth + 1, periodMap)); });
        custs.forEach(function (c) { ul.appendChild(makeCustomerLeaf(c)); });
        li.appendChild(ul);
        built = true;
      }
      ul.style.display = "";
      toggle.classList.add("open");
    };
    const collapse = function () {
      if (ul) ul.style.display = "none";
      toggle.classList.remove("open");
    };
    toggle.addEventListener("click", function () {
      if (toggle.classList.contains("open")) collapse(); else expand();
    });
    /* Depth 0 opens by default so the frontline (depth 1) is visible;
       depth 2 and deeper stay collapsed until clicked. */
    if (depth === 0) expand();
  }
  return li;
}

async function renderTeam() {
  const el = panelBody("team");
  setLoading(el, "Loading the downline tree");
  try {
    const periodMap = await getPeriodMap(state.period);
    const m = db.byCode.get(state.member);
    const row = periodMap.get(state.member);
    const downline = (db.subtreeSize.get(state.member) || 1) - 1;
    const custs = db.customersByMember.get(state.member) || [];

    let html =
      '<h2 class="section-title">My Team</h2>' +
      '<p class="section-sub">Downline of the selected member for ' + esc(periodLong(state.period)) +
      ". Click the arrows to open deeper legs. Dashed leaves are retail customers who buy through a member.</p>" +
      '<div class="member-hero">' +
      '<div><div class="hero-name">' + esc(m ? m.display_name : state.member) + "</div>" +
      '<div class="hero-code">' + esc(state.member) + "</div></div>" +
      rankBadge(row ? row.rank_earned : "member", true) +
      '<div class="hero-meta">Sales Volume (SV) ' + fmt2(row ? row.sv : 0) +
      " &middot; Team Volume (TV) " + fmt2(row ? row.tv : 0) + "</div>" +
      '<div class="hero-spacer"></div>' +
      '<div class="hero-meta">' + fmt0(downline) +
      (downline === 1 ? " member" : " members") + " in downline &middot; " +
      fmt0(custs.length) + (custs.length === 1 ? " customer" : " customers") + "</div>" +
      "</div>";

    if (downline === 0 && custs.length === 0) {
      html += '<div class="note-chip">This member has no downline and no customers yet.</div>';
      el.innerHTML = html;
      return;
    }
    html += '<div class="tree-scroll"><ul class="tree" id="teamTree"></ul></div>';
    el.innerHTML = html;
    document.getElementById("teamTree").appendChild(makeNode(state.member, 0, periodMap));
  } catch (err) {
    setError(el, err, renderTeam);
  }
}

/* ---------------- MY VOLUME ---------------- */

function volumeChartSvg(months, custByMonth) {
  const W = 640, H = 260, padL = 16, padR = 16, padB = 34, padT = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxSv = Math.max(QUAL_SV, ...months.map(function (r) { return Number(r.sv); }));
  const n = months.length || 1;
  const slot = innerW / n;
  const barW = Math.min(64, slot * 0.55);
  const y0 = H - padB;
  const scale = function (v) { return v / maxSv * innerH; };

  let bars = "";
  months.forEach(function (r, i) {
    const sv = Number(r.sv);
    const cust = Math.min(sv, Number(custByMonth.get(r.period) || 0));
    const own = sv - cust;
    const x = padL + slot * i + (slot - barW) / 2;
    const hOwn = scale(own), hCust = scale(cust);
    const yCust = y0 - hCust, yOwn = yCust - hOwn;
    if (cust > 0) {
      bars += '<rect class="bar-seg" x="' + x + '" y="' + yCust + '" width="' + barW +
        '" height="' + hCust + '" rx="2" fill="#22D3EE"></rect>';
    }
    if (own > 0) {
      bars += '<rect class="bar-seg" x="' + x + '" y="' + yOwn + '" width="' + barW +
        '" height="' + hOwn + '" rx="2" fill="#818CF8"></rect>';
    }
    bars += '<text x="' + (x + barW / 2) + '" y="' + (Math.min(yOwn, y0) - 6) +
      '" text-anchor="middle" font-size="11" fill="currentColor">' + fmt2(sv) + "</text>";
    bars += '<text x="' + (x + barW / 2) + '" y="' + (y0 + 16) +
      '" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.7">' +
      esc(periodShort(r.period)) + "</text>";
    if (r.period === state.period) {
      bars += '<rect x="' + (x - 5) + '" y="' + padT + '" width="' + (barW + 10) +
        '" height="' + (innerH + 8) + '" rx="6" fill="none" stroke="#22D3EE" stroke-opacity="0.5" stroke-dasharray="4 3"></rect>';
    }
  });

  const qy = y0 - scale(QUAL_SV);
  const qline = '<line x1="' + padL + '" y1="' + qy + '" x2="' + (W - padR) + '" y2="' + qy +
    '" stroke="#94A3B8" stroke-dasharray="5 4" stroke-width="1"></line>' +
    '<text x="' + (W - padR) + '" y="' + (qy - 5) + '" text-anchor="end" font-size="10" fill="currentColor" opacity="0.7">qualification 100.00</text>';

  return '<svg class="chart-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Monthly Sales Volume bars">' +
    '<line x1="' + padL + '" y1="' + y0 + '" x2="' + (W - padR) + '" y2="' + y0 +
    '" stroke="currentColor" stroke-opacity="0.35"></line>' + qline + bars + "</svg>";
}

async function renderVolume() {
  const el = panelBody("volume");
  setLoading(el, "Loading volume history");
  try {
    const [months, custVol] = await Promise.all([
      getMemberMonths(state.member),
      getCustomerVol(state.member)
    ]);
    const custByMonth = new Map(custVol.map(function (r) { return [r.volume_month, Number(r.customer_sv)]; }));
    const cur = months.find(function (r) { return r.period === state.period; });
    const curCust = Number(custByMonth.get(state.period) || 0);
    const qualified = !!cur && Number(cur.sv) >= QUAL_SV;

    let html =
      '<h2 class="section-title">My Volume</h2>' +
      '<p class="section-sub">Six months of monthly Sales Volume (SV) for ' + esc(state.member) +
      ". The cyan slice is volume bought by this member&#39;s retail customers; it rolls up to the member&#39;s account at purchase time.</p>";

    html += '<div class="card-row">' +
      '<div class="stat-card"><div class="stat-label">Sales Volume (SV), ' + esc(periodShort(state.period)) + "</div>" +
      '<div class="stat-value">' + fmt2(cur ? cur.sv : 0) + "</div>" +
      '<div class="stat-note">of which customers: ' + fmt2(curCust) + "</div></div>" +
      '<div class="stat-card"><div class="stat-label">Commissionable Volume (CV)</div>' +
      '<div class="stat-value">' + fmt2(cur ? cur.cv : 0) + "</div>" +
      '<div class="stat-note">80% of SV, the base commissions apply to</div></div>' +
      '<div class="stat-card"><div class="stat-label">Team Volume (TV)</div>' +
      '<div class="stat-value">' + fmt2(cur ? cur.tv : 0) + "</div>" +
      '<div class="stat-note">whole downline, this member excluded</div></div>' +
      '<div class="stat-card"><div class="stat-label">Qualified this month</div>' +
      '<div class="stat-value"><span class="qual-pill ' + (qualified ? "qual-yes" : "qual-no") + '">' +
      (qualified ? "QUALIFIED" : "NOT QUALIFIED") + "</span></div>" +
      '<div class="stat-note">gate: SV of at least 100.00</div></div>' +
      "</div>";

    html += '<div class="chart-box"><div class="chart-title">Monthly Sales Volume (SV), member and customer slices</div>' +
      volumeChartSvg(months, custByMonth) +
      '<div class="legend">' +
      '<span><span class="legend-swatch" style="background:#818CF8"></span>Member volume</span>' +
      '<span><span class="legend-swatch" style="background:#22D3EE"></span>Customer volume</span>' +
      '<span>Dashed outline marks the selected period</span>' +
      "</div></div>";

    el.innerHTML = html;
  } catch (err) {
    setError(el, err, renderVolume);
  }
}

/* ---------------- MY RANK ---------------- */

function reqItem(met, label, valueText, ratio) {
  let html = '<li class="req-item ' + (met ? "req-met" : "req-unmet") + '">' +
    '<span class="req-icon">' + (met ? "&#10003;" : "&#10007;") + "</span>" +
    '<span class="req-label">' + label + "</span>" +
    '<span class="req-value">' + valueText + "</span>";
  if (ratio !== null && ratio !== undefined) {
    const w = Math.max(2, Math.min(100, ratio * 100));
    html += '<span class="req-bar"><span class="req-bar-fill" style="width:' + w.toFixed(1) + '%"></span></span>';
  }
  html += "</li>";
  return html;
}

function buildReqList(targetRank, row, legs) {
  const req = RANK_REQS[targetRank];
  const sv = Number(row ? row.sv : 0);
  const tv = Number(row ? row.tv : 0);
  const items = [];

  const qualMet = sv >= QUAL_SV;
  items.push(reqItem(qualMet,
    "Qualified: Sales Volume (SV) of at least " + fmt2(QUAL_SV),
    fmt2(sv) + " of " + fmt2(QUAL_SV), sv / QUAL_SV));

  if (req.tv !== null) {
    items.push(reqItem(tv >= req.tv,
      "Team Volume (TV) of at least " + fmt2(req.tv),
      fmt2(tv) + " of " + fmt2(req.tv), tv / req.tv));
  }
  if (req.activeLegs !== null) {
    const n = legs.filter(function (l) { return l.active; }).length;
    items.push(reqItem(n >= req.activeLegs,
      "At least " + fmt0(req.activeLegs) + " active legs (frontline member qualified with SV of 100.00 or more)",
      fmt0(n) + " of " + fmt0(req.activeLegs), n / req.activeLegs));
  }
  if (req.legsWith) {
    const need = RANK_ORDER[req.legsWith.rank];
    const n = legs.filter(function (l) { return l.maxRank >= need; }).length;
    items.push(reqItem(n >= req.legsWith.count,
      "At least " + fmt0(req.legsWith.count) + " legs each containing a " +
      RANK_LABEL[req.legsWith.rank] + " or higher",
      fmt0(n) + " of " + fmt0(req.legsWith.count), n / req.legsWith.count));
  }
  const allMet = /req-unmet/.test(items.join("")) === false;
  return { html: '<ul class="req-list">' + items.join("") + "</ul>", allMet: allMet };
}

async function renderRank() {
  const el = panelBody("rank");
  setLoading(el, "Checking rank requirements");
  try {
    const periodMap = await getPeriodMap(state.period);
    const row = periodMap.get(state.member);
    const current = ((row && row.rank_earned) || "member").toLowerCase();
    const legs = legStats(state.member, periodMap);
    const idx = RANK_LADDER.indexOf(current);
    const next = idx >= 0 && idx < RANK_LADDER.length - 1 ? RANK_LADDER[idx + 1] : null;

    let html =
      '<h2 class="section-title">My Rank</h2>' +
      '<p class="section-sub">Rank earned for ' + esc(periodLong(state.period)) +
      ". Ranks recompute from scratch every month; nothing carries over.</p>";

    html += '<div class="card-row">' +
      '<div class="stat-card"><div class="stat-label">Current rank</div>' +
      '<div class="stat-value">' + rankBadge(current, true) + "</div>" +
      '<div class="stat-note">paid depth: ' + fmt0(PAID_DEPTH[current]) + " level" +
      (PAID_DEPTH[current] > 1 ? "s" : "") + "</div></div>" +
      '<div class="stat-card"><div class="stat-label">Active legs</div>' +
      '<div class="stat-value">' + fmt0(legs.filter(function (l) { return l.active; }).length) +
      " of " + fmt0(legs.length) + "</div>" +
      '<div class="stat-note">frontline members qualified this month</div></div>' +
      '<div class="stat-card"><div class="stat-label">Team Volume (TV)</div>' +
      '<div class="stat-value">' + fmt2(row ? row.tv : 0) + "</div>" +
      '<div class="stat-note">' + esc(periodShort(state.period)) + "</div></div>" +
      "</div>";

    html += '<div class="note-chip">Computed from public data: active legs and per-leg ranks are derived in the browser from the public tree and monthly views, the same numbers the commission engine used.</div>';

    if (next) {
      const built = buildReqList(next, row, legs);
      html += '<h3 class="section-title" style="font-size:15px">Progress toward ' +
        esc(RANK_LABEL[next]) + "</h3>" + built.html;
    } else {
      const built = buildReqList("executive", row, legs);
      html += '<div class="note-chip">This member already holds the top rank. The checklist below shows the Executive requirements being maintained this month.</div>' + built.html;
    }
    el.innerHTML = html;
  } catch (err) {
    setError(el, err, renderRank);
  }
}

/* ---------------- MY STATEMENT ---------------- */

async function renderStatement() {
  const el = panelBody("statement");
  setLoading(el, "Loading the commission statement");
  try {
    const [lines, periodMap] = await Promise.all([
      getStatement(state.member, state.period),
      getPeriodMap(state.period)
    ]);
    const row = periodMap.get(state.member);
    const qualified = !!row && !!row.is_active;
    const rank = ((row && row.rank_earned) || "member").toLowerCase();
    const total = lines.reduce(function (s, l) { return s + Number(l.amount); }, 0);

    let html =
      '<h2 class="section-title">My Statement</h2>' +
      '<p class="section-sub">Commission lines for ' + esc(state.member) + " in " +
      esc(periodLong(state.period)) +
      ". Each line pays a percentage of one downline member&#39;s Commissionable Volume (CV), by level.</p>";

    html += '<div class="card-row">' +
      '<div class="stat-card"><div class="stat-label">Total earned</div>' +
      '<div class="stat-value">' + fmt2(total) + "</div>" +
      '<div class="stat-note">sum of ' + fmt0(lines.length) + " line" + (lines.length === 1 ? "" : "s") + "</div></div>" +
      '<div class="stat-card"><div class="stat-label">Rank and paid depth</div>' +
      '<div class="stat-value">' + rankBadge(rank, true) + "</div>" +
      '<div class="stat-note">paid on levels 1 through ' + fmt0(PAID_DEPTH[rank]) + "</div></div>" +
      '<div class="stat-card"><div class="stat-label">Qualified this month</div>' +
      '<div class="stat-value"><span class="qual-pill ' + (qualified ? "qual-yes" : "qual-no") + '">' +
      (qualified ? "QUALIFIED" : "NOT QUALIFIED") + "</span></div>" +
      '<div class="stat-note">gate: Sales Volume (SV) of at least 100.00</div></div>' +
      "</div>";

    if (!qualified) {
      html += '<div class="note-chip">Unpaid this month: this member was not qualified (Sales Volume (SV) under 100.00) in ' +
        esc(periodLong(state.period)) +
        ", so no commissions were paid. The volume in this member&#39;s downline still paid the qualified upline.</div>";
    }

    if (lines.length === 0) {
      html += qualified
        ? '<div class="note-chip">No commission lines this period: no Commissionable Volume (CV) inside paid depth.</div>'
        : "";
      el.innerHTML = html;
      return;
    }

    /* by-level summary chips */
    const byLevel = new Map();
    lines.forEach(function (l) {
      const cur = byLevel.get(l.level) || { n: 0, amt: 0 };
      cur.n += 1; cur.amt += Number(l.amount);
      byLevel.set(l.level, cur);
    });
    html += '<div class="level-chips">';
    Array.from(byLevel.keys()).sort(function (a, b) { return a - b; }).forEach(function (lv) {
      const c = byLevel.get(lv);
      html += '<span class="level-chip">Level ' + fmt0(lv) + ": <b>" + fmt2(c.amt) +
        "</b> from " + fmt0(c.n) + " line" + (c.n === 1 ? "" : "s") + "</span>";
    });
    html += "</div>";

    html += '<div class="table-scroll"><table class="stmt"><thead><tr>' +
      "<th>Level</th><th>Source member</th><th>Name</th>" +
      '<th class="num">Source CV</th><th class="num">Rate</th><th class="num">Amount</th>' +
      "</tr></thead><tbody>";
    lines.forEach(function (l) {
      const src = db.byCode.get(l.source_code);
      html += "<tr><td>" + fmt0(l.level) + "</td>" +
        '<td class="mono">' + esc(l.source_code) + "</td>" +
        "<td>" + esc(src ? src.display_name : "") + "</td>" +
        '<td class="num">' + fmt2(l.source_cv) + "</td>" +
        '<td class="num">' + pct(l.rate) + "</td>" +
        '<td class="num">' + fmt2(l.amount) + "</td></tr>";
    });
    html += '</tbody><tfoot><tr><th colspan="5" style="text-align:right">Total</th>' +
      '<th class="num" style="text-align:right">' + fmt2(total) + "</th></tr></tfoot></table></div>";

    el.innerHTML = html;
  } catch (err) {
    setError(el, err, renderStatement);
  }
}

/* ---------------- COMPANY ---------------- */

function trendChartSvg(rows) {
  const W = 640, H = 220, padL = 16, padR = 16, padB = 30, padT = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const vals = rows.map(function (r) { return Number(r.total_payout); });
  const maxV = Math.max(...vals) * 1.12 || 1;
  const n = rows.length;
  const x = function (i) { return n === 1 ? W / 2 : padL + innerW * i / (n - 1); };
  const y = function (v) { return padT + innerH - v / maxV * innerH; };

  let pts = "", dots = "", labels = "";
  rows.forEach(function (r, i) {
    const px = x(i), py = y(Number(r.total_payout));
    pts += (i ? " " : "") + px.toFixed(1) + "," + py.toFixed(1);
    const sel = r.period === state.period;
    dots += '<circle cx="' + px + '" cy="' + py + '" r="' + (sel ? 6 : 4) +
      '" fill="' + (sel ? "#22D3EE" : "#818CF8") + '"></circle>';
    labels += '<text x="' + px + '" y="' + (py - 10) + '" text-anchor="middle" font-size="11" fill="currentColor">' +
      fmt2(r.total_payout) + "</text>" +
      '<text x="' + px + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.7">' +
      esc(periodShort(r.period)) + "</text>";
  });

  return '<svg class="chart-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Payout trend across six months">' +
    '<polyline points="' + pts + '" fill="none" stroke="#4F46E5" stroke-width="2.5" stroke-linejoin="round"></polyline>' +
    dots + labels + "</svg>";
}

async function renderCompany() {
  const el = panelBody("company");
  setLoading(el, "Loading company totals");
  try {
    const c = db.companyByPeriod.get(state.period);
    if (!c) throw new Error("No finalized company run found for period " + state.period);

    const payoutPct = Number(c.total_cv) > 0 ? Number(c.total_payout) / Number(c.total_cv) * 100 : 0;

    let html =
      '<h2 class="section-title">Company</h2>' +
      '<p class="section-sub">Company-wide results of the finalized commission run for ' +
      esc(periodLong(state.period)) + " (run #" + fmt0(c.run_id) + ").</p>";

    html += '<div class="card-row">' +
      '<div class="stat-card"><div class="stat-label">Total Sales Volume (SV)</div>' +
      '<div class="stat-value">' + fmt2(c.total_sv) + "</div></div>" +
      '<div class="stat-card"><div class="stat-label">Total Commissionable Volume (CV)</div>' +
      '<div class="stat-value">' + fmt2(c.total_cv) + "</div></div>" +
      '<div class="stat-card"><div class="stat-label">Total payout</div>' +
      '<div class="stat-value">' + fmt2(c.total_payout) + "</div>" +
      '<div class="stat-note">' + payoutPct.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
      "% of CV</div></div>" +
      '<div class="stat-card"><div class="stat-label">Members paid</div>' +
      '<div class="stat-value">' + fmt0(c.members_paid) + "</div>" +
      '<div class="stat-note">of ' + fmt0(db.members.length) + " accounts</div></div>" +
      "</div>";

    /* rank distribution */
    const dist = [
      ["member", c.rank_member_count],
      ["builder", c.rank_builder_count],
      ["leader", c.rank_leader_count],
      ["director", c.rank_director_count],
      ["executive", c.rank_executive_count]
    ];
    const maxCount = Math.max(...dist.map(function (d) { return Number(d[1]); })) || 1;
    const colors = { member: "#64748B", builder: "#818CF8", leader: "#22D3EE", director: "#FBBF24", executive: "#C084FC" };
    html += '<div class="chart-box"><div class="chart-title">Rank distribution, ' + esc(periodShort(state.period)) + "</div>";
    dist.forEach(function (d) {
      const w = Math.max(0.8, Number(d[1]) / maxCount * 100);
      html += '<div class="dist-row"><span class="dist-name">' + esc(RANK_LABEL[d[0]]) + "</span>" +
        '<span class="dist-track"><span class="dist-fill" style="width:' + w.toFixed(1) +
        "%;background:" + colors[d[0]] + '"></span></span>' +
        '<span class="dist-count">' + fmt0(d[1]) + "</span></div>";
    });
    html += "</div>";

    html += '<div class="chart-box"><div class="chart-title">Total payout by month</div>' +
      trendChartSvg(db.company) + "</div>";

    el.innerHTML = html;
  } catch (err) {
    setError(el, err, renderCompany);
  }
}

/* ---------------- footer ---------------- */

function renderFooter() {
  const c = db.companyByPeriod.get(state.period);
  const f = document.getElementById("footer");
  if (c) {
    f.textContent = "Synthetic demo data · " + fmt0(db.members.length) +
      " accounts · period " + periodYm(state.period) + " · run #" + c.run_id +
      " · no real earnings";
  } else {
    f.textContent = "Synthetic demo data · no real earnings";
  }
}

/* ---------------- header controls ---------------- */

function setPickerDisplay() {
  const input = document.getElementById("memberSearch");
  const m = db.byCode.get(state.member);
  input.value = state.member + (m ? " · " + m.display_name : "");
}

function initMemberPicker() {
  const input = document.getElementById("memberSearch");
  const list = document.getElementById("memberList");

  function close() { list.hidden = true; }
  function open() { list.hidden = false; }

  function renderList(query) {
    const q = query.trim().toLowerCase();
    let matches = db.members;
    if (q) {
      matches = db.members.filter(function (m) {
        return m.member_code.toLowerCase().indexOf(q) >= 0 ||
          m.display_name.toLowerCase().indexOf(q) >= 0;
      });
    }
    const shown = matches.slice(0, 50);
    if (shown.length === 0) {
      list.innerHTML = '<div class="picker-empty">No member matches that search.</div>';
      return;
    }
    list.innerHTML = shown.map(function (m) {
      return '<div class="picker-item" data-code="' + esc(m.member_code) + '">' +
        '<span><span class="p-code">' + esc(m.member_code) + "</span> " + esc(m.display_name) + "</span>" +
        '<span class="p-rank">' + esc(m.rank_name) + "</span></div>";
    }).join("") +
    (matches.length > 50
      ? '<div class="picker-empty">' + fmt0(matches.length - 50) + " more, keep typing to narrow.</div>"
      : "");
  }

  input.addEventListener("focus", function () {
    input.select();
    renderList("");
    open();
  });
  input.addEventListener("input", function () {
    renderList(input.value);
    open();
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { close(); input.blur(); setPickerDisplay(); }
    if (e.key === "Enter") {
      const first = list.querySelector(".picker-item");
      if (first) selectMember(first.dataset.code);
    }
  });
  list.addEventListener("mousedown", function (e) {
    const item = e.target.closest(".picker-item");
    if (item) { e.preventDefault(); selectMember(item.dataset.code); }
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".picker-wrap")) { close(); }
  });

  function selectMember(code) {
    state.member = code;
    close();
    input.blur();
    setPickerDisplay();
    renderActive();
  }
  setPickerDisplay();
}

function initPeriodPicker() {
  const sel = document.getElementById("periodSelect");
  sel.innerHTML = db.company.map(function (c) {
    return '<option value="' + esc(c.period) + '"' +
      (c.period === state.period ? " selected" : "") + ">" + esc(periodLong(c.period)) + "</option>";
  }).join("");
  sel.addEventListener("change", function () {
    state.period = sel.value;
    renderFooter();
    renderActive();
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const logo = document.getElementById("logoImg");
  logo.src = theme === "dark" ? "assets/logo-header-dark.svg" : "assets/logo-final-primary.svg";
  document.getElementById("themeIcon").innerHTML = theme === "dark" ? "&#9788;" : "&#9789;";
  try { localStorage.setItem("orvanna-demo-theme", theme); } catch (e) { /* file:// may block storage */ }
}

function initTheme() {
  let theme = "dark";
  try {
    const saved = localStorage.getItem("orvanna-demo-theme");
    if (saved === "light" || saved === "dark") theme = saved;
  } catch (e) { /* default stands */ }
  applyTheme(theme);
  document.getElementById("themeBtn").addEventListener("click", function () {
    const cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
  });
}

function initTabs() {
  document.querySelectorAll(".tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.tab = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach(function (b) { b.classList.toggle("active", b === btn); });
      document.querySelectorAll(".panel").forEach(function (p) {
        p.classList.toggle("active", p.id === "panel-" + state.tab);
      });
      renderActive();
    });
  });
}

/* ---------------- orchestration ---------------- */

function renderActive() {
  renderFooter();
  switch (state.tab) {
    case "team": renderTeam(); break;
    case "volume": renderVolume(); break;
    case "rank": renderRank(); break;
    case "statement": renderStatement(); break;
    case "company": renderCompany(); break;
  }
}

async function boot() {
  initTheme();
  initTabs();
  const teamEl = panelBody("team");
  setLoading(teamEl, "Connecting to the live demo database");
  try {
    await loadCore();
  } catch (err) {
    setError(teamEl, err, boot);
    return;
  }
  if (db.company.length > 0 && !db.companyByPeriod.has(state.period)) {
    state.period = db.company[db.company.length - 1].period;
  }
  if (!db.byCode.has(state.member) && db.members.length > 0) {
    state.member = db.members[0].member_code;
  }
  initMemberPicker();
  initPeriodPicker();
  renderActive();
}

boot();
