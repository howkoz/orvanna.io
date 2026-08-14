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
  statements: new Map(),       /* "code|period" -> [statement rows] */
  earnedByMonth: new Map()     /* member_code -> Map(period -> commission total) */
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

/* Commission earned per month, all six finalized periods at once.
   The commission views carry no aggregate endpoint (PostgREST answers
   "Use of aggregate functions is not allowed"), so the lines come back
   raw and are totalled here. Only two columns are requested, which keeps
   the biggest earner in this data set (3,423 lines) to four pages. */
async function getEarnedByMonth(code) {
  if (db.earnedByMonth.has(code)) return db.earnedByMonth.get(code);
  const rows = await fetchAll(
    "v_demo_statements?select=period,amount&earner_code=eq." + encodeURIComponent(code));
  const map = new Map();
  rows.forEach(function (r) {
    map.set(r.period, (map.get(r.period) || 0) + Number(r.amount));
  });
  db.earnedByMonth.set(code, map);
  return map;
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

/* Month end as an ISO date, so an enrollment date can be compared to it.
   "2026-02-01" -> "2026-02-28". Needed because v_demo_member_months carries a
   zero-filled row for every member in every period, including months before
   that member existed; drawing those as a zero would be a false statement. */
function periodEndDate(p) {
  const y = parseInt(p.slice(0, 4), 10), m = parseInt(p.slice(5, 7), 10);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function notYetEnrolled(code, period) {
  const m = db.byCode.get(code);
  return !!(m && m.enrolled_on && m.enrolled_on > periodEndDate(period));
}

/* Every member from level 1 down to maxDepth, mapped to its level. */
function levelsWithin(code, maxDepth) {
  const out = new Map();
  let frontier = (db.children.get(code) || []).slice();
  for (let lvl = 1; lvl <= maxDepth && frontier.length; lvl++) {
    const next = [];
    frontier.forEach(function (c) {
      out.set(c, lvl);
      (db.children.get(c) || []).forEach(function (k) { next.push(k); });
    });
    frontier = next;
  }
  return out;
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

/* ================================================================
   THE OFFICE: the landing view.
   Four boards, in reading order: who in the paid depth finished the
   month under the qualification line (Gate Board), six months of
   evidence (Momentum Board), where the rank stands and where the
   commission came from (Runway and Earnings Mix), then the full tree
   behind one control. Company announcements sit in their own record
   (The Wire) and never interleave with anything about a person.
   ================================================================ */

/* ---- marks: one hexagon family, three fill states ---- */
const HEX_PTS = "12,2 21,7 21,17 12,22 3,17 3,7";
function hexMark(fill, cls) {
  let inner;
  if (fill === "full") {
    inner = '<polygon points="' + HEX_PTS + '" class="mk-fill"></polygon>';
  } else if (fill === "half") {
    inner = '<path d="M12 2 L3 7 L3 17 L12 22 Z" class="mk-fill"></path>' +
      '<polygon points="' + HEX_PTS + '" class="mk-line"></polygon>';
  } else {
    inner = '<polygon points="' + HEX_PTS + '" class="mk-line"></polygon>';
  }
  return '<svg class="mk ' + (cls || "") + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    inner + "</svg>";
}
function dateline(text) {
  return '<p class="dateline">' + esc(text) + "</p>";
}
/* A table is not clipped by overflow the way a block is, so the hidden
   copy lives inside a hidden div; otherwise it stretches the page and
   invents a horizontal scrollbar on a phone. */
function srTable(caption, headers, rows) {
  return '<div class="sr-only"><table><caption>' + esc(caption) + "</caption><thead><tr>" +
    headers.map(function (h) { return '<th scope="col">' + esc(h) + "</th>"; }).join("") +
    "</tr></thead><tbody>" +
    rows.map(function (r) {
      return "<tr>" + r.map(function (c, i) {
        return i === 0 ? '<th scope="row">' + esc(c) + "</th>" : "<td>" + esc(c) + "</td>";
      }).join("") + "</tr>";
    }).join("") + "</tbody></table></div>";
}

/* ---------------- board 1: the Gate Board ---------------- */

/* Who inside the reader's paid depth finished the month under the
   100.00 Sales Volume (SV) line, ranked by what the comp plan says it
   touches. Observations only: no suggested action, no contact control,
   and no claim that anyone cost the reader money. That last one is also
   a fact question, and the plan answers it: "The SOURCE member's own
   qualification does NOT matter: all CV pays upline" (comp plan v1.3,
   section 5), so a person under the line took nothing off this
   statement. The only true consequence is the active-leg rule. */
/* The three severity words, in one place so they can be restated without
   touching the ranking logic. They name a rule of the plan, never a
   verdict about the person: "Blocks your rank" beside somebody's name is
   the strongest possible instruction to lean on that person, which is the
   pattern Howard ruled out. Severity still reads through rank order, the
   length of the open gap, and the shape of the mark. */
const TIER_WORD = { 1: "Rank rule unmet", 2: "Leg not counted", 3: "Inside paid depth" };

function gateRows(periodMap) {
  const myRow = periodMap.get(state.member);
  const myRank = ((myRow && myRow.rank_earned) || "member").toLowerCase();
  const depth = PAID_DEPTH[myRank] || 1;
  const scope = levelsWithin(state.member, depth);
  const legs = legStats(state.member, periodMap);
  const activeLegs = legs.filter(function (l) { return l.active; }).length;

  const idx = RANK_LADDER.indexOf(myRank);
  const nextRank = idx >= 0 && idx < RANK_LADDER.length - 1 ? RANK_LADDER[idx + 1] : null;
  const needLegs = nextRank && RANK_REQS[nextRank] ? RANK_REQS[nextRank].activeLegs : null;
  const legsShort = !!needLegs && activeLegs < needLegs;

  const rows = [];
  let inScope = 0;
  scope.forEach(function (lvl, code) {
    if (notYetEnrolled(code, state.period)) return;   /* not a member that month */
    inScope += 1;
    const r = periodMap.get(code);
    const sv = r ? Number(r.sv) : 0;
    if (sv >= QUAL_SV) return;
    const m = db.byCode.get(code);
    let tier, word, why;
    if (lvl === 1 && legsShort) {
      tier = 1;
      word = TIER_WORD[1];
      why = RANK_LABEL[nextRank] + " needs " + fmt0(needLegs) + " active legs; " +
        fmt0(activeLegs) + " counted.";
    } else if (lvl === 1) {
      tier = 2;
      word = TIER_WORD[2];
      why = "Frontline leg, not active this month.";
    } else {
      tier = 3;
      word = TIER_WORD[3];
      why = "Level " + fmt0(lvl) + " of your paid depth.";
    }
    rows.push({
      code: code, name: m ? m.display_name : code, level: lvl,
      sv: sv, gap: QUAL_SV - sv, tier: tier, word: word, why: why
    });
  });

  rows.sort(function (a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (b.gap !== a.gap) return b.gap - a.gap;
    return a.code < b.code ? -1 : 1;
  });
  return { rows: rows, inScope: inScope, depth: depth, rank: myRank };
}

function gateRowHtml(r, top) {
  const fill = r.tier === 1 ? "full" : (r.tier === 2 ? "half" : "hollow");
  const pctFill = Math.max(0, Math.min(100, (r.sv / QUAL_SV) * 100));
  return '<li class="gate-row' + (top ? " gate-top" : "") + '">' +
    '<span class="gate-mark">' + hexMark(fill) + "</span>" +
    '<span class="gate-body">' +
      '<span class="gate-who"><span class="gate-name">' + esc(r.name) + "</span>" +
      '<span class="gate-code">' + esc(r.code) + "</span></span>" +
      '<span class="gate-meter">' +
        '<span class="gate-attained">' + fmt2(r.sv) + " SV</span>" +
        '<span class="gate-track"><span class="gate-fill" style="width:' + pctFill.toFixed(1) + '%"></span></span>' +
        '<span class="gate-gap">' + fmt2(r.gap) + " under</span>" +
      "</span>" +
    "</span>" +
    '<span class="gate-cons"><span class="gate-tier">' + esc(r.word) + "</span>" +
    '<span class="gate-why">' + esc(r.why) + "</span></span>" +
    "</li>";
}

/* The healthy state is drawn, not blank: a ring of members with every
   node filled. The same ring with hollow nodes says "nobody here yet". */
function gateRingSvg(count, filled) {
  const n = Math.max(3, Math.min(12, count || 7));
  let nodes = "";
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    const x = 60 + Math.cos(a) * 38, y = 60 + Math.sin(a) * 38;
    nodes += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="7" class="' +
      (filled ? "ring-node-on" : "ring-node-off") + '"></circle>';
  }
  return '<svg class="gate-ring" viewBox="0 0 120 120" aria-hidden="true" focusable="false">' +
    '<circle cx="60" cy="60" r="38" class="ring-path"></circle>' + nodes +
    '<polygon points="' + HEX_PTS.split(" ").map(function (p) {
      const xy = p.split(",");
      return (60 + (parseFloat(xy[0]) - 12) * 1.15).toFixed(1) + "," + (60 + (parseFloat(xy[1]) - 12) * 1.15).toFixed(1);
    }).join(" ") + '" class="ring-core"></polygon></svg>';
}

function gateBoardHtml(periodMap) {
  const g = gateRows(periodMap);
  const shown = g.rows.slice(0, 5);
  const capped = Math.min(g.rows.length, 50);
  const monthName = periodLong(state.period);

  let body;
  if (g.inScope === 0) {
    body = '<div class="gate-empty">' + gateRingSvg(6, false) +
      '<p class="gate-empty-line">No one sits inside your paid depth yet.</p>' +
      '<p class="gate-empty-note">Paid depth for the ' + esc(RANK_LABEL[g.rank]) +
      " rank is " + fmt0(g.depth) + " level" + (g.depth === 1 ? "" : "s") + ".</p></div>";
  } else if (g.rows.length === 0) {
    body = '<div class="gate-empty">' + gateRingSvg(g.inScope, true) +
      '<p class="gate-empty-line">' +
      (g.inScope === 1 ? "The one person in your paid depth reached the line in "
                       : "All " + fmt0(g.inScope) + " people in your paid depth reached the line in ") +
      esc(monthName) + ".</p>" +
      '<p class="gate-empty-note">Paid depth for the ' + esc(RANK_LABEL[g.rank]) +
      " rank is " + fmt0(g.depth) + " level" + (g.depth === 1 ? "" : "s") + ".</p></div>";
  } else {
    body = '<ol class="gate-list" id="gateList">' +
      shown.map(function (r, i) { return gateRowHtml(r, i === 0); }).join("") + "</ol>";
    if (g.rows.length > shown.length) {
      body += '<button class="gate-more" type="button" id="gateMore">Show all ' +
        fmt0(g.rows.length) + "</button>";
    }
    body += srTable(
      "People inside the paid depth under the 100.00 Sales Volume line in " + monthName,
      ["Member", "Level", "Sales Volume", "Under the line", "Tier", "Note"],
      g.rows.slice(0, capped).map(function (r) {
        return [r.name + " " + r.code, String(r.level), fmt2(r.sv), fmt2(r.gap), r.word, r.why];
      }));
  }

  return '<section class="board board-gate" aria-labelledby="gateTitle">' +
    '<header class="board-head"><h3 class="board-title" id="gateTitle">Under the line, your paid depth</h3>' +
    dateline(monthName.toUpperCase() + " · CLOSED AND FINAL · " +
      fmt0(g.inScope) + " IN PAID DEPTH") + "</header>" +
    '<p class="board-def">Sales Volume (SV) is the volume one member records in a month, including the orders their retail customers place, and the qualification line is 100.00 SV. Products carry Personal Volume (PV): a domain agent is 100 PV, a support agent 50 PV.</p>' +
    body +
    (g.rows.length > 50 ? '<p class="board-foot">' + fmt0(g.rows.length) +
      " people finished under the line; the first 50 in this order are listed.</p>" : "") +
    "</section>";
}

function wireGateBoard(periodMap) {
  const btn = document.getElementById("gateMore");
  if (!btn) return;
  btn.addEventListener("click", function () {
    const g = gateRows(periodMap);
    const list = document.getElementById("gateList");
    list.innerHTML = g.rows.slice(0, 50).map(function (r, i) {
      return gateRowHtml(r, i === 0);
    }).join("");
    btn.remove();
  });
}

/* ---------------- board 2: the Momentum Board ---------------- */

/* Two panels, one shared month axis, no dual axis anywhere. Every number
   lives in HTML underneath at a real 12 pixels rather than inside a scaled
   viewBox, which is why the drawing itself carries almost no type. */
function momentumHtml(months, custByMonth, earned) {
  const CW = 600, TOP_H = 150, BOT_H = 84, slot = CW / months.length;
  const svVals = months.map(function (r) { return Number(r.sv); });
  const svTop = Math.max(QUAL_SV, Math.max.apply(null, svVals)) * 1.18;
  const earnVals = months.map(function (r) { return Number(earned.get(r.period) || 0); });
  const earnMax = Math.max.apply(null, earnVals);
  const earnTop = earnMax > 0 ? earnMax * 1.18 : 1;
  const pre = months.map(function (r) { return notYetEnrolled(state.member, r.period); });

  /* top panel: sales volume, member and customer slices, one straight line at 100.00 */
  const barW = Math.min(52, slot * 0.5);
  let bars = "";
  months.forEach(function (r, i) {
    if (pre[i]) return;
    const sv = Number(r.sv);
    const cust = Math.min(sv, Number(custByMonth.get(r.period) || 0));
    const own = sv - cust;
    const x = slot * i + (slot - barW) / 2;
    const h = function (v) { return (v / svTop) * (TOP_H - 10); };
    const yCust = TOP_H - h(cust), yOwn = yCust - h(own);
    if (cust > 0) {
      bars += '<rect class="mom-cust" x="' + x.toFixed(1) + '" y="' + yCust.toFixed(1) +
        '" width="' + barW.toFixed(1) + '" height="' + h(cust).toFixed(1) + '" rx="2"></rect>';
    }
    if (own > 0) {
      bars += '<rect class="mom-own" x="' + x.toFixed(1) + '" y="' + yOwn.toFixed(1) +
        '" width="' + barW.toFixed(1) + '" height="' + h(own).toFixed(1) + '" rx="2"></rect>';
    }
    if (r.period === state.period) {
      bars += '<rect class="mom-sel" x="' + (x - 6).toFixed(1) + '" y="4" width="' +
        (barW + 12).toFixed(1) + '" height="' + (TOP_H - 4) + '" rx="7"></rect>';
    }
  });
  const qy = TOP_H - (QUAL_SV / svTop) * (TOP_H - 10);
  const qline = '<line class="mom-line" x1="0" y1="' + qy.toFixed(1) + '" x2="' + CW + '" y2="' + qy.toFixed(1) + '"></line>' +
    '<text class="mom-annot" x="6" y="' + (qy - 7).toFixed(1) + '">100.00 SV qualification line</text>';

  /* bottom panel: commission earned, filled area on the same month axis */
  let poly = "", dots = "";
  months.forEach(function (r, i) {
    const x = slot * (i + 0.5);
    const y = BOT_H - (earnVals[i] / earnTop) * (BOT_H - 12);
    poly += (i ? " " : "") + x.toFixed(1) + "," + y.toFixed(1);
    dots += '<circle class="' + (r.period === state.period ? "mom-dot-sel" : "mom-dot") +
      '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (r.period === state.period ? 5 : 3.5) + '"></circle>';
  });
  const areaPts = (slot * 0.5).toFixed(1) + "," + BOT_H + " " + poly + " " +
    (slot * (months.length - 0.5)).toFixed(1) + "," + BOT_H;

  const chart =
    '<div class="mom-chart">' +
      '<div class="mom-panel-label">Sales Volume (SV) by month</div>' +
      '<svg class="mom-svg" viewBox="0 0 ' + CW + " " + TOP_H + '" aria-hidden="true" focusable="false">' +
      '<defs><pattern id="momHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect width="7" height="7" class="hatch-bg"></rect><line x1="0" y1="0" x2="0" y2="7" class="hatch-line"></line>' +
      "</pattern></defs>" + qline + bars +
      '<line class="mom-base" x1="0" y1="' + TOP_H + '" x2="' + CW + '" y2="' + TOP_H + '"></line></svg>' +
      '<div class="mom-values" style="grid-template-columns:repeat(' + months.length + ',1fr)">' + months.map(function (r, i) {
        return '<span class="mom-val">' + (pre[i] ? '<span class="mom-na">not enrolled</span>' : fmt2(r.sv)) + "</span>";
      }).join("") + "</div>" +
      '<div class="mom-panel-label">Commission earned by month, United States dollars</div>' +
      '<svg class="mom-svg mom-svg-bot" viewBox="0 0 ' + CW + " " + BOT_H + '" aria-hidden="true" focusable="false">' +
      '<polygon class="mom-area" points="' + areaPts + '"></polygon>' +
      '<polyline class="mom-stroke" points="' + poly + '"></polyline>' + dots +
      '<line class="mom-base" x1="0" y1="' + BOT_H + '" x2="' + CW + '" y2="' + BOT_H + '"></line></svg>' +
      '<div class="mom-values" style="grid-template-columns:repeat(' + months.length + ',1fr)">' + earnVals.map(function (v) {
        return '<span class="mom-val">' + fmt2(v) + "</span>";
      }).join("") + "</div>" +
      '<div class="mom-months" style="grid-template-columns:repeat(' + months.length + ',1fr)">' + months.map(function (r) {
        return '<span class="mom-month' + (r.period === state.period ? " mom-month-sel" : "") + '">' +
          esc(periodShort(r.period)) + "</span>";
      }).join("") + "</div>" +
    "</div>";

  /* under about 560 pixels the same six months become six rows: reflow, never scroll */
  const rows = '<div class="mom-rows-wrap"><p class="mom-rows-head">' +
    '<span>Month</span><span>Against the 100.00 line</span><span>SV / earned</span></p>' +
    '<ol class="mom-rows">' + months.map(function (r, i) {
    const sv = Number(r.sv);
    const cust = Math.min(sv, Number(custByMonth.get(r.period) || 0));
    const w = function (v) { return Math.min(100, (v / (svTop || 1)) * 100); };
    return '<li class="mom-row' + (r.period === state.period ? " mom-row-sel" : "") + '">' +
      '<span class="mom-row-month">' + esc(periodShort(r.period)) + "</span>" +
      '<span class="mom-row-track">' +
        (pre[i] ? "" :
          '<span class="mom-row-own" style="width:' + w(sv - cust).toFixed(1) + '%"></span>' +
          '<span class="mom-row-cust" style="width:' + w(cust).toFixed(1) + '%"></span>') +
        '<span class="mom-row-line" style="left:' + w(QUAL_SV).toFixed(1) + '%"></span>' +
      "</span>" +
      '<span class="mom-row-num">' + (pre[i] ? '<span class="mom-na">not enrolled</span>' : fmt2(sv) + " SV") + "</span>" +
      '<span class="mom-row-earn">' + fmt2(earnVals[i]) + "</span>" +
      "</li>";
  }).join("") + "</ol></div>";

  const qualCount = months.filter(function (r, i) { return !pre[i] && Number(r.sv) >= QUAL_SV; }).length;
  const monthCount = months.filter(function (r, i) { return !pre[i]; }).length;
  const earnTotal = earnVals.reduce(function (a, b) { return a + b; }, 0);
  const summary = monthCount === 0
    ? "This member was not enrolled in any of these six months."
    : "Met the 100.00 Sales Volume (SV) line in " + fmt0(qualCount) + " of the last " +
      fmt0(monthCount) + " closed month" + (monthCount === 1 ? "" : "s") + ", and earned " +
      fmt2(earnTotal) + (monthCount === 1 ? " in it." : " across them.");

  return '<section class="board board-mom" aria-labelledby="momTitle">' +
    '<header class="board-head"><h3 class="board-title" id="momTitle">Six closed months</h3>' +
    dateline("FEBRUARY TO JULY 2026 · SIX FINALIZED RUNS · NO OPEN MONTH") + "</header>" +
    '<p class="board-summary">' + esc(summary) + "</p>" +
    chart + rows +
    '<p class="board-foot">Indigo is volume this member bought; hatched cyan is volume their retail customers bought, which counts toward the same Sales Volume (SV) total.</p>' +
    srTable("Sales Volume and commission earned by month",
      ["Month", "Sales Volume", "Of which customers", "Commission earned"],
      months.map(function (r, i) {
        return [periodLong(r.period),
          pre[i] ? "not enrolled" : fmt2(r.sv),
          pre[i] ? "not enrolled" : fmt2(Math.min(Number(r.sv), Number(custByMonth.get(r.period) || 0))),
          fmt2(earnVals[i])];
      })) +
    "</section>";
}

/* ---------------- board 3: Rank Runway and Earnings Mix ---------------- */

function runwayHtml(periodMap, row) {
  const current = ((row && row.rank_earned) || "member").toLowerCase();
  const curIdx = RANK_LADDER.indexOf(current);
  const legs = legStats(state.member, periodMap);
  const activeLegs = legs.filter(function (l) { return l.active; }).length;
  const nextRank = curIdx < RANK_LADDER.length - 1 ? RANK_LADDER[curIdx + 1] : null;

  const stops = RANK_LADDER.map(function (r, i) {
    const state_ = i < curIdx ? "done" : (i === curIdx ? "current" : "todo");
    return '<li class="stop stop-' + state_ + '">' +
      hexMark(i <= curIdx ? "full" : "hollow", i === curIdx ? "lit" : "") +
      '<span class="stop-label">' + esc(RANK_LABEL[r]) + "</span></li>";
  }).join("");

  /* micro bars for the NEXT rank's unmet requirements only, and only for
     aggregate rules: volume totals and leg counts, never a named person */
  let bars = "";
  if (nextRank) {
    const req = RANK_REQS[nextRank];
    const sv = Number(row ? row.sv : 0), tv = Number(row ? row.tv : 0);
    const items = [];
    if (sv < QUAL_SV) items.push(["Sales Volume (SV) of 100.00", sv / QUAL_SV, fmt2(sv) + " of " + fmt2(QUAL_SV)]);
    if (req.tv !== null && tv < req.tv) items.push(["Team Volume (TV)", tv / req.tv, fmt2(tv) + " of " + fmt2(req.tv)]);
    if (req.activeLegs !== null && activeLegs < req.activeLegs) {
      items.push(["Active legs", activeLegs / req.activeLegs, fmt0(activeLegs) + " of " + fmt0(req.activeLegs)]);
    }
    if (req.legsWith) {
      const need = RANK_ORDER[req.legsWith.rank];
      const n = legs.filter(function (l) { return l.maxRank >= need; }).length;
      if (n < req.legsWith.count) {
        items.push(["Legs holding a " + RANK_LABEL[req.legsWith.rank] + " or higher",
          n / req.legsWith.count, fmt0(n) + " of " + fmt0(req.legsWith.count)]);
      }
    }
    bars = items.length
      ? '<p class="runway-next">Unmet for ' + esc(RANK_LABEL[nextRank]) + "</p>" +
        items.map(function (it) {
          return '<div class="micro"><span class="micro-label">' + esc(it[0]) + "</span>" +
            '<span class="micro-track"><span class="micro-fill" style="width:' +
            Math.max(2, Math.min(100, it[1] * 100)).toFixed(1) + '%"></span></span>' +
            '<span class="micro-val">' + esc(it[2]) + "</span></div>";
        }).join("")
      : '<p class="runway-next">Every ' + esc(RANK_LABEL[nextRank]) + " rule was met in " +
        esc(periodLong(state.period)) + ".</p>";
  } else {
    bars = '<p class="runway-next">Top rank of the plan.</p>';
  }

  /* the leg counter: one disc per leg while the discs still mean something */
  let discs = "";
  if (legs.length > 0 && legs.length <= 8) {
    discs = '<span class="discs">' + legs.map(function (l) {
      return '<span class="disc ' + (l.active ? "disc-on" : "disc-off") + '"></span>';
    }).join("") + "</span>";
  }
  const legLine = legs.length === 0
    ? "No frontline legs yet."
    : fmt0(activeLegs) + " of " + fmt0(legs.length) + " leg" + (legs.length === 1 ? "" : "s") +
      " active. A leg is active when the frontline member reached 100.00 SV.";

  return '<section class="board board-runway" aria-labelledby="runTitle">' +
    '<header class="board-head"><h3 class="board-title" id="runTitle">Rank runway</h3>' +
    dateline(periodLong(state.period).toUpperCase() + " · CLOSED AND FINAL") + "</header>" +
    '<ol class="runway">' + stops + "</ol>" + bars +
    '<p class="leg-line">' + discs + "<span>" + esc(legLine) + "</span></p>" +
    "</section>";
}

const LEVEL_LABEL = { 1: "Level 1", 2: "Level 2", 3: "Level 3", 4: "Level 4", 5: "Level 5" };

function mixHtml(lines, row) {
  const total = lines.reduce(function (s, l) { return s + Number(l.amount); }, 0);
  const byLevel = new Map();
  lines.forEach(function (l) {
    byLevel.set(Number(l.level), (byLevel.get(Number(l.level)) || 0) + Number(l.amount));
  });
  const levels = Array.from(byLevel.keys()).sort(function (a, b) { return a - b; });

  let body;
  if (total <= 0) {
    const qualified = !!row && Number(row.sv) >= QUAL_SV;
    body = '<p class="mix-empty">No commission lines in ' + esc(periodLong(state.period)) + ". " +
      (qualified
        ? "This member was at or above the line, and no Commissionable Volume (CV) fell inside the paid depth that month."
        : "The 100.00 Sales Volume (SV) line was not met that month, and the plan pays a member only in a month they meet it.") +
      "</p>";
  } else {
    const cols = levels.map(function (lv) { return (byLevel.get(lv) / total * 100); });
    body =
      '<div class="mix-bar">' + levels.map(function (lv, i) {
        return '<span class="mix-seg mix-l' + lv + '" style="width:' + cols[i].toFixed(2) + '%">' +
          (cols[i] >= 5 ? '<span class="mix-seg-label">L' + fmt0(lv) + "</span>" : "") + "</span>";
      }).join("") + "</div>" +
      /* the label row is the same set of fractions, so each number sits under
         its own segment; a segment too narrow to hold a number honestly keeps
         only the amount, and the narrowest keep it in the hidden table */
      '<div class="mix-labels" style="grid-template-columns:' +
        cols.map(function (c) { return c.toFixed(2) + "fr"; }).join(" ") + '">' +
        levels.map(function (lv, i) {
          if (cols[i] >= 9) return '<span class="mix-lab">' + esc(LEVEL_LABEL[lv]) +
            "<b>" + fmt2(byLevel.get(lv)) + "</b></span>";
          if (cols[i] >= 4) return '<span class="mix-lab"><b>' + fmt2(byLevel.get(lv)) + "</b></span>";
          return '<span class="mix-lab"></span>';
        }).join("") + "</div>" +
      srTable("Commission earned by level in " + periodLong(state.period),
        ["Level", "Amount, United States dollars", "Share of the month"],
        levels.map(function (lv, i) {
          return [LEVEL_LABEL[lv], fmt2(byLevel.get(lv)), cols[i].toFixed(1) + "%"];
        }));
  }

  return '<section class="board board-mix" aria-labelledby="mixTitle">' +
    '<header class="board-head"><h3 class="board-title" id="mixTitle">Earnings mix</h3>' +
    dateline(periodLong(state.period).toUpperCase() + " · CLOSED AND FINAL · " +
      fmt2(total) + " TOTAL") + "</header>" + body + "</section>";
}

/* ================= THE WIRE (company announcements) =================
   Self-contained. To remove it: delete this block, the one call to
   wireHtml() inside renderTeam, and the ".wire" rules in portal.css.
   Nothing here reads the database and nothing here is about a person.
   Copy is icon-led: the mark carries the category, so no headline or face
   line names it. Headline 2 to 4 words naming the subject; face 5 to 10
   words carrying a number. The list renders newest first, and the newest
   item takes the lit mark, so the dates are an editorial choice.
   ==================================================================== */
const WIRE_GLYPHS = {
  agent:   '<circle cx="12" cy="8.5" r="1.9"></circle><circle cx="8" cy="15" r="1.9"></circle>' +
           '<circle cx="16" cy="15" r="1.9"></circle><path d="M12 8.5 L8 15 M12 8.5 L16 15 M8 15 L16 15"></path>',
  note:    '<path d="M7.5 9.5 H16.5 M7.5 12.5 H16.5 M7.5 15.5 H13"></path>',
  plan:    '<path d="M7.5 16 V13 M12 16 V10.5 M16.5 16 V8"></path>',
  run:     '<path d="M7.5 12.3 L10.6 15.4 L16.5 9"></path>',
  product: '<path d="M12 7 L16.5 9.6 L16.5 14.4 L12 17 L7.5 14.4 L7.5 9.6 Z"></path>'
};
const WIRE_ITEMS = [
  { date: "2026-07-28", glyph: "agent",
    headline: "More domain agents",
    face: "In build, 100 Personal Volume (PV) each month." },
  { date: "2026-07-21", glyph: "product",
    headline: "Constellation Pack",
    face: "Every domain agent plus the Manager, 800 PV monthly." },
  { date: "2026-08-03", glyph: "run",
    headline: "July 2026",
    face: "Six months, every line itemized to the cent." },
  { date: "2026-07-14", glyph: "plan",
    headline: "Version 1.3",
    face: "Ranks above Member need 100.00 Sales Volume (SV)." },
  { date: "2026-07-07", glyph: "note",
    headline: "Support answers here",
    face: "One chat window, in the navigation bar." },
  { date: "2026-06-30", glyph: "agent",
    headline: "Buy once instead",
    face: "Ten times the price, ten times the PV." }
];
function wireDate(iso) {
  const y = iso.slice(0, 4), m = parseInt(iso.slice(5, 7), 10), d = parseInt(iso.slice(8, 10), 10);
  return (MONTHS_SHORT[m - 1] + " " + d + ", " + y).toUpperCase();
}
function wireHtml() {
  const items = WIRE_ITEMS.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  return '<section class="board wire" aria-labelledby="wireTitle">' +
    '<header class="board-head"><h3 class="board-title" id="wireTitle">The wire</h3>' +
    dateline("COMPANY ANNOUNCEMENTS · DEMONSTRATION COPY") + "</header>" +
    '<ol class="wire-list">' + items.map(function (it, i) {
      return '<li class="wire-item">' +
        '<span class="wire-mark' + (i === 0 ? " wire-lit" : "") + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<polygon points="' + HEX_PTS + '" class="wire-hex"></polygon>' +
          '<g class="wire-glyph">' + WIRE_GLYPHS[it.glyph] + "</g></svg></span>" +
        '<span class="wire-body"><span class="wire-date">' + esc(wireDate(it.date)) + "</span>" +
        '<span class="wire-head">' + esc(it.headline) + "</span>" +
        '<span class="wire-face">' + esc(it.face) + "</span></span></li>";
    }).join("") + "</ol>" +
    '<p class="board-foot">Orvanna is a demonstration company; every announcement here is sample copy.</p>' +
    "</section>";
}
/* ================= end of The Wire ================= */

async function renderTeam() {
  const el = panelBody("team");
  setLoading(el, "Loading your office");
  try {
    const [periodMap, months, custVol, earned, lines] = await Promise.all([
      getPeriodMap(state.period),
      getMemberMonths(state.member),
      getCustomerVol(state.member),
      getEarnedByMonth(state.member),
      getStatement(state.member, state.period)
    ]);
    const custByMonth = new Map(custVol.map(function (r) { return [r.volume_month, Number(r.customer_sv)]; }));
    const m = db.byCode.get(state.member);
    const row = periodMap.get(state.member);
    const rank = ((row && row.rank_earned) || "member").toLowerCase();
    const downline = (db.subtreeSize.get(state.member) || 1) - 1;
    const custs = db.customersByMember.get(state.member) || [];
    const earnedNow = Number(earned.get(state.period) || 0);

    /* identity rail: two headline figures, nothing more */
    let html =
      '<section class="ident">' +
        '<span class="ident-mark">' + hexMark("full", "lit") + "</span>" +
        '<span class="ident-who"><span class="ident-name">' + esc(m ? m.display_name : state.member) + "</span>" +
        '<span class="ident-sub"><span class="ident-code">' + esc(state.member) + "</span>" +
        rankBadge(rank) + "</span></span>" +
        '<span class="ident-figs">' +
          '<span class="fig"><span class="fig-lab">Sales Volume (SV)</span>' +
          '<span class="fig-val">' + fmt2(row ? row.sv : 0) + "</span></span>" +
          '<span class="fig"><span class="fig-lab">Earned, dollars</span>' +
          '<span class="fig-val">' + fmt2(earnedNow) + "</span></span>" +
        "</span>" +
      "</section>";

    html += gateBoardHtml(periodMap);
    html += '<div class="office-grid">' +
      '<div class="office-main">' + momentumHtml(months, custByMonth, earned) + "</div>" +
      '<div class="office-rail">' + wireHtml() + "</div>" +
      "</div>";
    html += '<div class="office-pair">' + runwayHtml(periodMap, row) + mixHtml(lines, row) + "</div>";

    html += '<details class="tree-drop" id="treeDrop"><summary class="tree-summary">' +
      "Open the full team tree" +
      '<span class="tree-summary-note">' + fmt0(downline) + (downline === 1 ? " member" : " members") +
      " and " + fmt0(custs.length) + (custs.length === 1 ? " customer" : " customers") + "</span>" +
      "</summary>" +
      (downline === 0 && custs.length === 0
        ? '<p class="board-foot">This member has no downline and no customers yet.</p>'
        : '<div class="tree-scroll"><ul class="tree" id="teamTree"></ul></div>') +
      "</details>";

    el.innerHTML = html;
    wireGateBoard(periodMap);

    /* the tree is built on first open, so the landing never pays for it */
    const drop = document.getElementById("treeDrop");
    const host = document.getElementById("teamTree");
    if (drop && host) {
      drop.addEventListener("toggle", function () {
        if (drop.open && !host.childElementCount) {
          host.appendChild(makeNode(state.member, 0, periodMap));
        }
      });
    }
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
      bars += '<rect class="bar-seg seg-cust" x="' + x + '" y="' + yCust + '" width="' + barW +
        '" height="' + hCust + '" rx="2"></rect>';
    }
    if (own > 0) {
      bars += '<rect class="bar-seg seg-own" x="' + x + '" y="' + yOwn + '" width="' + barW +
        '" height="' + hOwn + '" rx="2"></rect>';
    }
    bars += '<text class="chart-value" x="' + (x + barW / 2) + '" y="' + (Math.min(yOwn, y0) - 6) +
      '" text-anchor="middle" font-size="13">' + fmt2(sv) + "</text>";
    bars += '<text class="chart-tick" x="' + (x + barW / 2) + '" y="' + (y0 + 18) +
      '" text-anchor="middle" font-size="13">' + esc(periodShort(r.period)) + "</text>";
    if (r.period === state.period) {
      bars += '<rect class="seg-sel" x="' + (x - 5) + '" y="' + padT + '" width="' + (barW + 10) +
        '" height="' + (innerH + 8) + '" rx="6"></rect>';
    }
  });

  const qy = y0 - scale(QUAL_SV);
  const qline = '<line class="chart-rule" x1="' + padL + '" y1="' + qy + '" x2="' + (W - padR) + '" y2="' + qy +
    '" stroke-dasharray="5 4" stroke-width="1"></line>' +
    '<text class="chart-tick" x="' + (W - padR) + '" y="' + (qy - 5) +
    '" text-anchor="end" font-size="12">qualification 100.00</text>';

  return '<svg class="chart-svg" viewBox="0 0 ' + W + " " + H + '" aria-hidden="true" focusable="false">' +
    '<line class="chart-axis" x1="' + padL + '" y1="' + y0 + '" x2="' + (W - padR) + '" y2="' + y0 +
    '"></line>' + qline + bars + "</svg>";
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
      '<span><span class="legend-swatch" style="background:var(--c-own)"></span>Member volume</span>' +
      '<span><span class="legend-swatch" style="background:var(--c-cust)"></span>Customer volume</span>' +
      '<span>Dashed outline marks the selected period</span>' +
      "</div>" +
      srTable("Monthly Sales Volume, member and customer slices",
        ["Month", "Sales Volume", "Of which customers"],
        months.map(function (r) {
          return [periodLong(r.period), fmt2(r.sv),
            fmt2(Math.min(Number(r.sv), Number(custByMonth.get(r.period) || 0)))];
        })) +
      "</div>";

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
    dots += '<circle class="' + (sel ? "trend-dot-sel" : "trend-dot") + '" cx="' + px + '" cy="' + py +
      '" r="' + (sel ? 6 : 4) + '"></circle>';
    labels += '<text class="chart-value" x="' + px + '" y="' + (py - 10) +
      '" text-anchor="middle" font-size="13">' + fmt2(r.total_payout) + "</text>" +
      '<text class="chart-tick" x="' + px + '" y="' + (H - 8) +
      '" text-anchor="middle" font-size="13">' + esc(periodShort(r.period)) + "</text>";
  });

  return '<svg class="chart-svg" viewBox="0 0 ' + W + " " + H + '" aria-hidden="true" focusable="false">' +
    '<polyline class="trend-line" points="' + pts + '"></polyline>' + dots + labels + "</svg>";
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
      trendChartSvg(db.company) +
      srTable("Total payout by month, United States dollars",
        ["Month", "Total payout", "Members paid"],
        db.company.map(function (r) {
          return [periodLong(r.period), fmt2(r.total_payout), fmt0(r.members_paid)];
        })) +
      "</div>";

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
