/* ============================================================
   Orvanna catalog: the single source of truth for every item
   the shop sells. Loaded by shop.html and product.html; nothing
   else defines a price, a Personal Volume (PV) figure, or an
   icon. Round 4 (Phase 4C.2).

   Billing modes, per the house pricing rule:
   - Subscription is the DEFAULT mode on every item.
   - The one-time alternative uses the 10x rule: the one-time
     price shows what the product is WORTH without subscription.
     Domain agents: $100.00 / month becomes $1,000.00 once.
     Support agents: $50.00 / month becomes $500.00 once.
     Bundles and packs follow the same 10x rule.
   - PV always equals dollars, in both modes.

   Cart storage: localStorage key "orvannaCart", entries keyed
   "sku|mode" where mode is "sub" or "one". Old round-3 carts
   used bare sku keys; loadCart migrates those to "sku|sub".
   ============================================================ */

window.ORVANNA = (function () {
  'use strict';

  /* ---------- icon builders (brand hexagon, inline SVG) ---------- */

  /* THE SHARED HEXAGON FRAME WAS DROPPED 2026-08-19.

     Sixteen marks each wrapped in the same polygon is sixteen identical
     hexagons: the frame was the loudest shape in every cell, so the set
     could not be told apart at a glance, which is the one job an index
     of sixteen has. The glyphs are untouched -- they do the telling
     apart now.

     Dropped in BOTH copies. This project had two: this one, and
     mark() in js/library-icons.js. Removing one would have left the same
     sixteen agents framed on one page and unframed on the next, which a
     customer moving from the Library to the Shop sees immediately.

     THE CONSTANT SURVIVES for one caller that is not one of the sixteen:
     shop.html builds its empty-cart placeholder from it, an empty vessel
     with a single dot inside. There the hexagon IS the symbol rather than
     a frame around one, so it stays. */
  var HEX = '<polygon points="32,6 54.5,19 54.5,45 32,58 9.5,45 9.5,19" fill="none" stroke="#1B1917" stroke-width="3.5" stroke-linejoin="round"/>';

  /* The name is kept: it is exported, and renaming an exported identifier
     to describe its new internals is how call sites get missed. */
  function hexIcon(inner) {
    return '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>';
  }

  /* ---------- the catalog ---------- */
  /* Each item:
     sku       stable identifier, used in product.html?sku=
     tier      domain | support | bundle | pack
     name      display name
     blurb     one-line card description
     sub       { price, pv }  monthly subscription (default mode)
     once      { price, pv }  one-time purchase (10x rule)
     includes  array of child skus (bundles and packs only)
     icon      inline SVG string                                 */

  var PRODUCTS = [

    /* ----- Domain agents: $100.00 / month, 100 PV ----- */
    { sku: 'payment', tier: 'domain', name: 'Payment Agent',
      blurb: 'Runs checkout, retries, and settlement without a break.',
      sub: { price: 100, pv: 100 }, once: { price: 1000, pv: 1000 }, includes: null,
      icon: hexIcon('<rect x="20" y="24" width="24" height="17" rx="2.5" fill="none" stroke="#1B1917" stroke-width="2.4"/><line x1="20" y1="30" x2="44" y2="30" stroke="#1B1917" stroke-width="2.4"/><circle cx="26" cy="35.5" r="2" fill="#EC3013"/>') },
    { sku: 'shipping', tier: 'domain', name: 'Shipping Agent',
      blurb: 'Books carriers, tracks parcels, and clears delays.',
      sub: { price: 100, pv: 100 }, once: { price: 1000, pv: 1000 }, includes: null,
      icon: hexIcon('<path d="M 20 36 h 14 v -9 h -14 z" fill="none" stroke="#1B1917" stroke-width="2.4" stroke-linejoin="round"/><path d="M 34 30 h 6 l 4 4 v 2 h -10 z" fill="none" stroke="#1B1917" stroke-width="2.4" stroke-linejoin="round"/><circle cx="25" cy="39.5" r="2.4" fill="#EC3013"/><circle cx="38" cy="39.5" r="2.4" fill="#1B1917"/>') },
    { sku: 'pricing', tier: 'domain', name: 'Pricing Agent',
      blurb: 'Watches the market and keeps every price sharp.',
      sub: { price: 100, pv: 100 }, once: { price: 1000, pv: 1000 }, includes: null,
      icon: hexIcon('<line x1="24" y1="41" x2="40" y2="23" stroke="#1B1917" stroke-width="2.4" stroke-linecap="round"/><circle cx="25.5" cy="26.5" r="3.4" fill="none" stroke="#1B1917" stroke-width="2.2"/><circle cx="38.5" cy="38.5" r="3.4" fill="none" stroke="#EC3013" stroke-width="2.2"/>') },
    { sku: 'inventory', tier: 'domain', name: 'Inventory Agent',
      blurb: 'Counts stock and reorders before shelves go bare.',
      sub: { price: 100, pv: 100 }, once: { price: 1000, pv: 1000 }, includes: null,
      icon: hexIcon('<rect x="21" y="33" width="9.5" height="9.5" fill="none" stroke="#1B1917" stroke-width="2.2" stroke-linejoin="round"/><rect x="33.5" y="33" width="9.5" height="9.5" fill="none" stroke="#1B1917" stroke-width="2.2" stroke-linejoin="round"/><rect x="27" y="21.5" width="9.5" height="9.5" fill="none" stroke="#EC3013" stroke-width="2.2" stroke-linejoin="round"/>') },
    { sku: 'marketing', tier: 'domain', name: 'Marketing Agent',
      blurb: 'Writes, schedules, and measures every campaign.',
      sub: { price: 100, pv: 100 }, once: { price: 1000, pv: 1000 }, includes: null,
      icon: hexIcon('<circle cx="26" cy="32" r="2.6" fill="#EC3013"/><path d="M 32 24 a 10.5 10.5 0 0 1 0 16" fill="none" stroke="#1B1917" stroke-width="2.4" stroke-linecap="round"/><path d="M 37 19.5 a 16.5 16.5 0 0 1 0 25" fill="none" stroke="#1B1917" stroke-width="2.4" stroke-linecap="round"/>') },
    { sku: 'tax', tier: 'domain', name: 'Tax Agent',
      blurb: 'Prepares every filing on time, ready for your sign-off.',
      sub: { price: 100, pv: 100 }, once: { price: 1000, pv: 1000 }, includes: null,
      icon: hexIcon('<line x1="24" y1="40" x2="40" y2="24" stroke="#1B1917" stroke-width="2.4" stroke-linecap="round"/><circle cx="26" cy="26" r="2.6" fill="#1B1917"/><circle cx="38" cy="38" r="2.6" fill="#EC3013"/><line x1="21" y1="45.5" x2="43" y2="45.5" stroke="#1B1917" stroke-width="2.2" stroke-linecap="round"/>') },

    /* ----- Support agents: $50.00 / month, 50 PV ----- */
    { sku: 'engineer', tier: 'support', name: 'Software Engineer',
      blurb: 'Ships fixes and features on request.',
      sub: { price: 50, pv: 50 }, once: { price: 500, pv: 500 }, includes: null,
      icon: hexIcon('<path d="M 26 25 L 19.5 32 L 26 39" fill="none" stroke="#1B1917" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M 38 25 L 44.5 32 L 38 39" fill="none" stroke="#1B1917" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><line x1="34" y1="23" x2="30" y2="41" stroke="#EC3013" stroke-width="2.4" stroke-linecap="round"/>') },
    { sku: 'qa', tier: 'support', name: 'Quality Assurance',
      blurb: 'Tests everything twice before customers see it.',
      sub: { price: 50, pv: 50 }, once: { price: 500, pv: 500 }, includes: null,
      icon: hexIcon('<path d="M 22 32.5 L 29.5 40 L 42 25" fill="none" stroke="#EC3013" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>') },
    { sku: 'secretary', tier: 'support', name: 'Secretary',
      blurb: 'Keeps the calendar, notes, and follow-ups straight.',
      sub: { price: 50, pv: 50 }, once: { price: 500, pv: 500 }, includes: null,
      icon: hexIcon('<rect x="21" y="23" width="22" height="19" rx="2.5" fill="none" stroke="#1B1917" stroke-width="2.4"/><line x1="21" y1="29.5" x2="43" y2="29.5" stroke="#1B1917" stroke-width="2.2"/><line x1="27" y1="20" x2="27" y2="25" stroke="#1B1917" stroke-width="2.2" stroke-linecap="round"/><line x1="37" y1="20" x2="37" y2="25" stroke="#1B1917" stroke-width="2.2" stroke-linecap="round"/><circle cx="27" cy="35.5" r="2" fill="#EC3013"/>') },
    { sku: 'executive', tier: 'support', name: 'Chief Executive',
      blurb: 'Sets direction and keeps every agent aligned.',
      sub: { price: 50, pv: 50 }, once: { price: 500, pv: 500 }, includes: null,
      icon: hexIcon('<circle cx="32" cy="24.5" r="3.2" fill="#EC3013"/><circle cx="23" cy="39" r="3" fill="#1B1917"/><circle cx="41" cy="39" r="3" fill="#1B1917"/><line x1="32" y1="27.5" x2="24" y2="36.5" stroke="#1B1917" stroke-width="2.2"/><line x1="32" y1="27.5" x2="40" y2="36.5" stroke="#1B1917" stroke-width="2.2"/>') },
    { sku: 'accounting', tier: 'support', name: 'Accounting',
      blurb: 'Balances books to the cent, month after month.',
      sub: { price: 50, pv: 50 }, once: { price: 500, pv: 500 }, includes: null,
      icon: hexIcon('<line x1="24" y1="42" x2="24" y2="33" stroke="#1B1917" stroke-width="3" stroke-linecap="round"/><line x1="32" y1="42" x2="32" y2="26" stroke="#EC3013" stroke-width="3" stroke-linecap="round"/><line x1="40" y1="42" x2="40" y2="29.5" stroke="#1B1917" stroke-width="3" stroke-linecap="round"/>') },
    { sku: 'care', tier: 'support', name: 'Customer Care',
      blurb: 'Answers customers day and night, in any tone.',
      sub: { price: 50, pv: 50 }, once: { price: 500, pv: 500 }, includes: null,
      icon: hexIcon('<path d="M 23 36 v -3.5 a 9 9 0 0 1 18 0 V 36" fill="none" stroke="#1B1917" stroke-width="2.4" stroke-linecap="round"/><rect x="20.5" y="34" width="5" height="8" rx="2.4" fill="#1B1917"/><rect x="38.5" y="34" width="5" height="8" rx="2.4" fill="#EC3013"/>') },

    /* ----- Bundle: the Manager Agent ----- */
    /* A parent item whose children are three support agents. Priced
       above the sum of its parts ($150.00) because the management
       layer itself is the product: one agent that runs the trio. */
    { sku: 'manager', tier: 'bundle', name: 'Manager Agent',
      blurb: 'One agent that runs your back office: engineering, scheduling, and the books, coordinated as a single ensemble.',
      sub: { price: 200, pv: 200 }, once: { price: 2000, pv: 2000 },
      includes: ['engineer', 'secretary', 'accounting'],
      icon: hexIcon('<circle cx="32" cy="22.5" r="3.6" fill="#EC3013"/><circle cx="21.5" cy="40" r="3" fill="#1B1917"/><circle cx="32" cy="42.5" r="3" fill="#1B1917"/><circle cx="42.5" cy="40" r="3" fill="#1B1917"/><line x1="32" y1="26" x2="22.5" y2="37.5" stroke="#1B1917" stroke-width="2.2"/><line x1="32" y1="26" x2="32" y2="39" stroke="#1B1917" stroke-width="2.2"/><line x1="32" y1="26" x2="41.5" y2="37.5" stroke="#1B1917" stroke-width="2.2"/>') },

    /* ----- Digital packs: curated ensembles, even pricing, PV = dollars ----- */
    { sku: 'ignition', tier: 'pack', name: 'Ignition Pack',
      blurb: 'The first-storefront trio: take payments, answer customers, keep the calendar straight.',
      sub: { price: 200, pv: 200 }, once: { price: 2000, pv: 2000 },
      includes: ['payment', 'care', 'secretary'],
      icon: hexIcon('<path d="M 32 42 V 25" stroke="#1B1917" stroke-width="2.6" stroke-linecap="round"/><path d="M 25 32 L 32 24 L 39 32" fill="none" stroke="#1B1917" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="32" cy="44" r="2.6" fill="#EC3013"/>') },
    { sku: 'momentum', tier: 'pack', name: 'Momentum Pack',
      blurb: 'Five agents tuned for growth: sell it, promote it, price it, build it, test it.',
      sub: { price: 400, pv: 400 }, once: { price: 4000, pv: 4000 },
      includes: ['payment', 'marketing', 'pricing', 'engineer', 'qa'],
      icon: hexIcon('<path d="M 21 24 L 30 32 L 21 40" fill="none" stroke="#1B1917" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M 33 24 L 42 32 L 33 40" fill="none" stroke="#EC3013" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>') },
    { sku: 'constellation', tier: 'pack', name: 'Constellation Pack',
      blurb: 'The full formation: every domain agent, plus the Manager Agent running support behind them.',
      sub: { price: 800, pv: 800 }, once: { price: 8000, pv: 8000 },
      includes: ['payment', 'shipping', 'pricing', 'inventory', 'marketing', 'tax', 'manager'],
      icon: hexIcon('<circle cx="32" cy="32" r="3.4" fill="#EC3013"/><circle cx="23" cy="25" r="2.4" fill="#1B1917"/><circle cx="41" cy="25" r="2.4" fill="#1B1917"/><circle cx="23" cy="39" r="2.4" fill="#1B1917"/><circle cx="41" cy="39" r="2.4" fill="#1B1917"/><line x1="32" y1="32" x2="23.8" y2="25.8" stroke="#1B1917" stroke-width="1.8"/><line x1="32" y1="32" x2="40.2" y2="25.8" stroke="#1B1917" stroke-width="1.8"/><line x1="32" y1="32" x2="23.8" y2="38.2" stroke="#1B1917" stroke-width="1.8"/><line x1="32" y1="32" x2="40.2" y2="38.2" stroke="#1B1917" stroke-width="1.8"/>') }
  ];

  /* ---------- product page prose (Round 1 content pass) ----------
     Written by orvanna-writer. Three sections per item, matching the
     product.html headings: help ("How this helps your business"),
     day ("What this agent does day to day"), ensemble ("Works with your
     ensemble"). An ensemble is the set of agents a Conductor owns; the
     people a Conductor sponsors are their team, which is a different
     thing and never called an ensemble. Text only: prices, PV, and
     every other fact stay in the PRODUCTS entries above. */

  var PROSE = {

    payment: {
      help: [
        'Failed payments are quiet losses. A card expires, a bank declines, a retry never happens, and the sale walks away. The Payment Agent watches every transaction from authorization to settlement and works the ones that stall.',
        'It retries declines on a schedule that fits the decline reason, reconciles what the processor paid against what you sold, and flags every mismatch with the records already attached. You see recovered revenue and a clean ledger, not a queue.'
      ],
      day: [
        'Each morning it reconciles yesterday\'s settlements against your orders, down to the cent. Through the day it monitors authorizations, categorizes declines, and schedules retries for the ones worth another attempt.',
        'When a refund, chargeback, or mismatch needs a human decision, it escalates to you with the transaction history, the processor\'s response codes, and a drafted reply. It closes the day by writing a settlement summary you can read in one minute.'
      ],
      ensemble: [
        'It hands clean payment records to the Accounting agent and dispute evidence to whoever answers your disputes. Ask it about any transaction and it answers with the full trail.',
        'You approve anything unusual: large refunds, new retry rules, changes to how declines are handled. The agent proposes; you decide.'
      ]
    },

    shipping: {
      help: [
        'Every late parcel becomes a support ticket, and every support ticket costs more than the postage did. The Shipping Agent books the right carrier at the right rate and watches every shipment until it lands.',
        'It catches delays while they are still fixable: a label that never scanned, a customs hold, a carrier running behind. Customers hear about problems from you first, with a plan, instead of discovering them alone.'
      ],
      day: [
        'Orders come in; it compares carrier rates and delivery estimates, books the shipment, and sends the tracking link. It checks every open shipment several times a day and marks the ones that stopped moving.',
        'Stalled parcels get a carrier inquiry filed right away. Lost ones get a claim drafted with the paperwork attached, waiting for your approval before it is submitted.'
      ],
      ensemble: [
        'It feeds delivery status to Customer Care so support answers are current, and shipping costs to Accounting so freight lands in the right column.',
        'Carrier changes, claim submissions, and refund promises stay in your hands. The agent prepares each one and asks.'
      ]
    },

    pricing: {
      help: [
        'Prices go stale quietly. Costs move, competitors move, and last quarter\'s price sheet keeps selling at last quarter\'s margin. The Pricing Agent watches all three and tells you when a number no longer makes sense.',
        'It proposes changes with the reasoning shown: the cost that moved, the competitor that dropped, the margin you would keep. Nothing reprices on its own; you approve the sheet and it takes effect.'
      ],
      day: [
        'It tracks your costs and your competitors\' listed prices through the day and recomputes margin on every item you sell. Items that drift outside the bands you set go on a review list.',
        'Once a week it drafts a full price review: what to raise, what to hold, what to discount, each with the numbers behind it. You approve line by line or all at once.'
      ],
      ensemble: [
        'It shares margin data with the Marketing agent so promotions are built on real numbers, and cost data with Accounting so the books match the shelf.',
        'Your pricing strategy stays yours. The agent runs the arithmetic, keeps the watchlist, and brings you decisions worth making.'
      ]
    },

    inventory: {
      help: [
        'Stockouts lose the sale; overstock loses the cash. The Inventory Agent counts what you have, watches how fast it moves, and reorders before the shelf goes bare, at quantities that match how each item actually sells.',
        'Slow movers get flagged before they become dead stock. Fast movers get deeper safety margins. The cash tied up in your stockroom starts matching the sales coming out of it.'
      ],
      day: [
        'It reconciles stock counts against sales and receipts every night and investigates any gap. During the day it tracks velocity per item and recalculates reorder points as the numbers move.',
        'When an item crosses its reorder point, it drafts the purchase order with the supplier, quantity, and expected cost filled in. You approve; it sends the order and then tracks the delivery.'
      ],
      ensemble: [
        'It tells the Shipping agent what is arriving, the Pricing agent what is aging, and Accounting what the stockroom is worth.',
        'Supplier choices and every purchase order remain your call. The agent never spends money without a yes.'
      ]
    },

    marketing: {
      help: [
        'Consistent marketing beats brilliant marketing that ships twice a year. The Marketing Agent drafts the campaigns, schedules the sends, and measures what each one returned, week after week.',
        'It learns from your results, not from someone else\'s playbook: which subject lines your customers open, which offers they act on, which channels quietly earn nothing. Budget follows the evidence.'
      ],
      day: [
        'It drafts posts, emails, and product copy in your voice for your review each morning. Approved pieces go out on schedule; the rest wait for your edits.',
        'It watches campaign results through the day and files a weekly readout: what ran, what it cost, what came back. Underperformers come with a proposed fix, not just a red number.'
      ],
      ensemble: [
        'It pulls margin from the Pricing agent before proposing any discount and hands warm inquiries to Customer Care with context attached.',
        'Nothing publishes without your approval. The agent drafts and measures; the brand voice and the final word are yours.'
      ]
    },

    tax: {
      help: [
        'Tax deadlines do not care how busy your quarter was. The Tax Agent tracks every filing obligation in every region you sell, prepares the returns as deadlines approach, and keeps the records an auditor would ask for.',
        'The boundary is deliberate: it prepares, it never files on its own. Every return goes to you or your accountant for review and signature. What changes is the scramble; the numbers are ready days early instead of hours late.'
      ],
      day: [
        'It categorizes transactions for tax treatment as they occur and maintains a live calendar of upcoming obligations by region. Rate changes in places you sell get flagged the day it learns of them.',
        'Ahead of each deadline it assembles the return, the supporting schedules, and a plain-language summary of what changed since last period, then hands the packet to your reviewer.'
      ],
      ensemble: [
        'It draws clean figures from the Accounting agent and payment records from the Payment agent, so the return matches the books by construction.',
        'Your accountant stays the authority. The agent is the preparer that never misses a date and never loses a receipt.'
      ]
    },

    engineer: {
      help: [
        'Small software problems wait for months because calling a developer about a broken form feels like too much. The Software Engineer agent takes those requests in plain language and ships the fix.',
        'Bug fixes, small features, connections between the tools you already use: described in a sentence, delivered as working code with the change documented.'
      ],
      day: [
        'It works a request queue you write in plain English. Each item becomes a scoped change: written, tested against your setup, and staged for your approval before anything goes live.',
        'It also watches your site and internal tools for errors, and files a short report when something breaks, usually with the fix already attached.'
      ],
      ensemble: [
        'It pairs naturally with Quality Assurance, which checks its work before you see it, and it takes escalations from any domain agent that hits a technical wall.',
        'Nothing deploys without your go-ahead. You read a two-line summary of each change, not the code, unless you want the code.'
      ]
    },

    qa: {
      help: [
        'Most defects are found by customers, which is the most expensive way to find them. Quality Assurance checks your changes before they ship: pages, flows, forms, checkout, the paths your revenue walks through.',
        'It tests like a difficult customer: wrong inputs, slow connections, small screens, double clicks. What it finds, you fix before anyone else ever sees it.'
      ],
      day: [
        'Every change to your site or tools triggers a test pass: does each page load, does each form submit, does checkout complete, do the numbers on screen match the records underneath.',
        'Findings are filed by severity with steps to reproduce and screenshots. A clean pass is reported too, so silence never means untested.'
      ],
      ensemble: [
        'It reviews the Software Engineer agent\'s changes as a matter of routine, and it takes test requests from you in plain language: check this page, try this flow, break this if you can.',
        'It blocks nothing on its own authority. It reports, you decide what ships.'
      ]
    },

    secretary: {
      help: [
        'The Secretary keeps the operational memory a busy owner drops: who you promised to call, what the meeting decided, which follow-up is now overdue.',
        'Scheduling stops being correspondence. It finds times, sends invitations, absorbs the reschedules, and protects the blocks you mark as yours.'
      ],
      day: [
        'It maintains your calendar, drafts your routine mail for approval, and turns meetings into short notes with the decisions and action items pulled out.',
        'Each morning it hands you the day on one page: appointments, promised follow-ups, and the three things that will slip if today ignores them.'
      ],
      ensemble: [
        'It books around the people you meet, follows up politely so you do not have to, and keeps notes any teammate can search later.',
        'It signs nothing and commits you to nothing. Drafts go out only after your yes, and your calendar rules are its law.'
      ]
    },

    executive: {
      help: [
        'The Chief Executive agent is the standing-back function a small business rarely has time for. It reads the whole picture across sales, costs, and operations, and keeps your goals in front of the daily noise.',
        'It will not run your company. It will tell you, every week, where the numbers disagree with the plan, and which single decision would matter most.'
      ],
      day: [
        'It reviews the day\'s figures across every agent you run and keeps a scorecard against the targets you set. Drift gets named early, while it is still cheap to correct.',
        'Once a week it writes the briefing you would want from a chief of staff: three numbers that moved, why they moved, and one recommendation with the reasoning shown.'
      ],
      ensemble: [
        'It reads from every agent on your account and gives each one priorities that match your stated goals, so the whole ensemble pulls in one direction.',
        'It recommends; it never decides. Strategy, hiring, spending, and direction stay where they belong, with you.'
      ]
    },

    accounting: {
      help: [
        'Books that are current are rare, and books that are current and correct are rarer. The Accounting agent categorizes transactions as they happen and reconciles accounts continuously, not at month end.',
        'Month end becomes a review instead of an excavation. The statements are drafted, the oddities are flagged, and your accountant starts from clean.'
      ],
      day: [
        'It ingests the day\'s transactions, categorizes them against your chart of accounts, and reconciles bank and processor balances to the cent. Anything it cannot place with confidence goes on a short question list for you.',
        'At each month\'s close it drafts the statements and a plain-language note on what changed and why. Locked periods stay locked.'
      ],
      ensemble: [
        'It receives settlement data from the Payment agent, freight costs from Shipping, and stock values from Inventory, and it feeds clean figures to the Tax agent.',
        'It proposes journal entries; it does not invent them. You or your accountant approve anything outside the routine.'
      ]
    },

    care: {
      help: [
        'Answering the same twenty questions consumes the hours you meant to spend on the business. Customer Care answers them at once, around the clock, in the tone you choose.',
        'The hard cases still reach you, but they arrive sorted, summarized, and attached to the customer\'s history, so five minutes of your attention actually resolves them.'
      ],
      day: [
        'It watches your inbox and chat, answers the questions it can prove from your own records, and drafts replies for the ones it cannot. Order status questions get live answers pulled from the Shipping agent.',
        'Everything is logged: who asked what, what was answered, what is still open. Patterns in the questions become a weekly note, because a repeated question is product feedback in disguise.'
      ],
      ensemble: [
        'It escalates refunds and exceptions to you with a recommendation attached, and passes product complaints to the agents whose domain they touch.',
        'It never promises money, credit, or policy changes on its own. Those drafts wait for your approval, every time.'
      ]
    },

    manager: {
      help: [
        'Three support agents are useful. Three support agents with a manager are a back office. The Manager Agent runs the Software Engineer, Secretary, and Accounting agents as one coordinated ensemble.',
        'You stop dispatching tasks to individual agents. You tell the Manager what you need in plain language, and it decides who does what, in what order, and reports back once, when the work is done.'
      ],
      day: [
        'It holds the shared task list, assigns work across its three agents, and resolves the collisions: the code change that affects the books, the meeting that conflicts with the monthly close.',
        'You get one daily summary instead of three: what the ensemble finished, what is in motion, and the items waiting on your decision.'
      ],
      ensemble: [
        'The Manager is the single point of contact for its trio and answers for their combined output. Questions about any of the three go to it.',
        'Its authority ends where yours begins: it sequences and delegates inside the ensemble, and brings everything external, financial, or irreversible to you.'
      ]
    },

    ignition: {
      help: [
        'The Ignition Pack is the first-storefront set: take the money, answer the customers, keep the calendar honest. Three agents covering the three jobs that start on day one and never stop.',
        'It is deliberately small. Run these three for a month, see the hours they hand back, and add agents when the next bottleneck shows itself.'
      ],
      day: [
        'The Payment Agent reconciles your sales and works your declines. Customer Care answers the inbox from your own records. The Secretary runs the calendar and the follow-ups.',
        'Together they cover the storefront\'s daily heartbeat: money in and accounted for, questions answered, commitments kept.'
      ],
      ensemble: [
        'The three share what they know: a payment question in the inbox gets answered with real transaction data, and a promised callback lands on your calendar by itself.',
        'Each agent keeps its own approval boundary. Refunds, unusual replies, and new commitments all still come to you.'
      ]
    },

    momentum: {
      help: [
        'The Momentum Pack is built for the growth phase: sell it, promote it, price it, build it, test it. Five agents pointed at the same outcome, revenue that compounds.',
        'Growth usually breaks a business at the seams: campaigns outrun margins, features outrun testing. This pack staffs both sides of that seam at once.'
      ],
      day: [
        'Marketing drafts and measures campaigns while Pricing keeps the margins honest underneath them. The Payment Agent recovers the declines that growth multiplies.',
        'The Software Engineer ships the changes your growth demands, and Quality Assurance checks every one before your customers meet it.'
      ],
      ensemble: [
        'The five trade data constantly: campaign results inform pricing reviews, pricing shapes promotions, and every site change is tested before it can cost a sale.',
        'You set the direction and approve the changes. The pack supplies the throughput a growth push actually needs.'
      ]
    },

    constellation: {
      help: [
        'The Constellation Pack is the full formation: all six domain agents running your payments, shipping, pricing, inventory, marketing, and tax preparation, with the Manager Agent running the back office behind them.',
        'It is the closest thing in the catalog to a staffed operations department. Every function covered, every handoff automatic, one place to look each morning.'
      ],
      day: [
        'Each domain agent works its own function through the day, and the Manager keeps its support trio moving underneath: the books current, the small fixes shipped, the calendar clean.',
        'The day ends in one combined report: money, parcels, prices, stock, campaigns, and filing obligations, with the exceptions that need you listed first.'
      ],
      ensemble: [
        'This is the pack where coordination pays most: settlements flow to the books, stock levels flow to reorders, costs flow to prices, and figures flow to filings without a human ferrying spreadsheets.',
        'Scale changes nothing about authority. Every filing, payment change, and purchase order still stops at your desk for a yes.'
      ]
    }
  };

  var BY_SKU = {};
  PRODUCTS.forEach(function (p) { BY_SKU[p.sku] = p; p.prose = PROSE[p.sku] || null; });

  /* ---------- shared formatting ---------- */

  function fmtMoney(n) {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtPv(n) {
    return n.toLocaleString('en-US') + ' PV';
  }

  /* price and pv for an item in a given mode */
  function priceOf(p, mode) { return mode === 'one' ? p.once.price : p.sub.price; }
  function pvOf(p, mode)    { return mode === 'one' ? p.once.pv    : p.sub.pv; }

  /* ---------- cart (localStorage, shared by every page) ---------- */

  var CART_KEY = 'orvannaCart';

  function loadCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      if (!raw) return {};
      var data = JSON.parse(raw);
      var clean = {};
      Object.keys(data).forEach(function (key) {
        var q = parseInt(data[key], 10);
        if (!(q > 0)) return;
        /* migrate round-3 keys (bare sku) to sku|sub */
        var parts = key.indexOf('|') >= 0 ? key.split('|') : [key, 'sub'];
        var sku = parts[0];
        var mode = parts[1] === 'one' ? 'one' : 'sub';
        if (BY_SKU[sku]) {
          var k = sku + '|' + mode;
          clean[k] = Math.min((clean[k] || 0) + q, 99);
        }
      });
      return clean;
    } catch (err) { return {}; }
  }

  function saveCart(cart) {
    try {
      if (Object.keys(cart).length === 0) {
        localStorage.removeItem(CART_KEY);
      } else {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
      }
    } catch (err) { /* storage unavailable: cart lives for the session */ }
  }

  function keyParts(key) {
    var parts = key.split('|');
    return { sku: parts[0], mode: parts[1] === 'one' ? 'one' : 'sub' };
  }

  /* totals across the cart:
     subMoney  monthly money (subscription lines)
     oneMoney  billed-today money (one-time lines)
     pv        total PV regardless of mode (the meter counts everything)
     count     unit count for the nav badge */
  function cartTotals(cart) {
    var subMoney = 0, oneMoney = 0, pv = 0, count = 0;
    Object.keys(cart).forEach(function (key) {
      var kp = keyParts(key);
      var p = BY_SKU[kp.sku];
      if (!p) return;
      var q = cart[key];
      if (kp.mode === 'one') { oneMoney += p.once.price * q; } else { subMoney += p.sub.price * q; }
      pv += pvOf(p, kp.mode) * q;
      count += q;
    });
    return { subMoney: subMoney, oneMoney: oneMoney, pv: pv, count: count };
  }

  /* ---------- public surface ---------- */

  return {
    PRODUCTS: PRODUCTS,
    bySku: BY_SKU,
    get: function (sku) { return BY_SKU[sku] || null; },
    hexIcon: hexIcon,
    HEX: HEX,
    fmtMoney: fmtMoney,
    fmtPv: fmtPv,
    priceOf: priceOf,
    pvOf: pvOf,
    loadCart: loadCart,
    saveCart: saveCart,
    keyParts: keyParts,
    cartTotals: cartTotals
  };
})();
