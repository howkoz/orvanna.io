/* ============================================================
   ORVANNA SHARED PAYMENT ENGINE (www/js/payments.js)

   Extracted 2026-08-16 (stabilization plan, Step 2). Before this
   file existed, shop.html and staff.html each carried a full copy
   of the live payment machinery, marked "DELIBERATE SECOND COPY,
   change both together". Every one of six auditors ranked ending
   that duplication as the highest-leverage fix in the project.
   This module is that fix: ONE payment engine, consumed by both
   pages through the factory below.

   WHAT IS SHARED HERE: the machinery. Opening, mounting, and
   confirming a payment against the HyperSwitch rail; the amount
   signature that ties an open payment to the order it was priced
   for; the tax quote debounce; the resume storage that survives a
   bank redirect; the bank-approval overlay chrome and its reveal
   logic; the receipt classifiers and the polling clocks; the
   record-tax bookkeeping call on success.

   WHAT IS NEVER SHARED: the words. Shopper copy speaks to the
   person holding the card in the second person; staff copy
   instructs an agent on a live phone call, including the line
   "Do not ask the caller for any code". Every user-facing string
   is injected per page through the copy table in the config, so a
   wording fix on one page can never silently change the other.

   Load order: after js/catalog.js (window.ORVANNA supplies the
   money formatter), before the page's own script.
   ============================================================ */
(function () {
  'use strict';

  /* ============================================================
     SHARED CONFIGURATION, single source of truth.

     Both pages used to carry their own copy of these values; a key
     rotation or an endpoint move had to be made twice. Now it is
     made once, here.
     ============================================================ */
  var CONFIG = {
    /* Supabase Edge Function base for the Orvanna project. */
    functionsBase: 'https://oiyibdczkokegaxkwulv.supabase.co/functions/v1',
    /* The public anonymous key: public by design, grants nothing on
       the database; it only lets the browser invoke the functions.
       Same key the portal pages already ship. */
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9peWliZGN6a29rZWdheGt3dWx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MzM1MDEsImV4cCI6MjEwMjIwOTUwMX0.NfZPoc6ZCZb-VtYhMC_toLnX73s5BJ_esKA4na-Pgdw',
    /* The sanctioned external script. This is the beta content
       delivery network path, which is the SANDBOX rail's script
       host. Decision 2026-08-16: accepted as-is for the
       demonstration; revisit before any non-sandbox deployment. */
    hyperLoaderUrl: 'https://beta.hyperswitch.io/v1/HyperLoader.js',
    /* The HyperSwitch application programming interface host that
       pairs with the sandbox script above. Used for exactly one
       thing: the client-side payment status poll that decides when
       a bank approval frame is genuinely showing a challenge (see
       the reveal logic below). Reads use the PUBLISHABLE key plus
       the payment's own client secret, both of which are public to
       this browser by design. Presentation only; it never gates
       the payment. */
    apiBase: 'https://sandbox.hyperswitch.io'
  };

  /* ---------- small shared utilities ---------- */

  /* Escape for any server-originated string that enters innerHTML.
     The staff console always had this; the shop page did not
     (code quality audit, 2026-08-15). Now both use this one. */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function friendlyError(result, fallback) {
    if (result && result.data && result.data.error && result.data.error.message) {
      return result.data.error.message;
    }
    return fallback;
  }

  var ORDER_NUMBER_RE = /^ORV-\d{4}-\d{2}-[0-9A-Z]{6}$/;

  /* ============================================================
     THE FACTORY

     createPaymentEngine(opts) builds one engine bound to one page.
     Everything page-specific arrives through opts:

       live              the page's LIVE_PAYMENTS flag
       channel           'shop' or 'staff_console'
       returnPage        'shop.html' or 'staff.html' (a page NAME,
                         never a full address: the server builds the
                         return address from its own allowed origin)
       resumeKey         storage key for resume state
       mountId           element id the secure card form mounts into
       buttonId          the pay button
       statusId          the live status line (role=status element)
       skeletonId        optional card-form placeholder element
       inertSelectors    CSS selector string: every control that can
                         move the amount while a payment is in flight
       signaturePayload  function returning { items, activation,
                         tax_id, member_code, and on the shop the
                         guest tax address fields }: the exact fields
                         the server prices. Doubles as the quote
                         payload, which is why adding a field here
                         automatically joins BOTH the quote debounce
                         and the amount
                         signature: a changed field re-asks the tax
                         question, and a change after a payment opened
                         discards and reopens that payment. The staff
                         console sends no guest address on purpose: its
                         quick order always has a caller attached, so
                         there is no guest whose address could apply.
       quoteGate         function: page-specific extra gates before a
                         tax quote may be asked (view active, caller
                         loaded, and so on)
       totals            { taxLabelId, taxId, totalId, hintClass }
       onTotalsApplied   hook(t): page updates its pay button label
       copy              the copy table, documented at each use below
       hooks             { onChallengeOpen, onChallengeClose,
                           onFinishing(on), onInertChange(on),
                           onReset(message), onWaiting(receipt),
                           onSuccess(receipt), onFailure(receipt),
                           onTimeout(receipt), onCheckError(result) }
     ============================================================ */
  function createPaymentEngine(opts) {

    var O = window.ORVANNA;
    var fmtMoney = opts.formatMoney || O.fmtMoney;
    var copy = opts.copy;
    var hooks = opts.hooks || {};

    function byId(id) { return document.getElementById(id); }

    /* ---------- engine state ---------- */

    var state = {
      orderNumber: null,
      clientSecret: null,
      publishableKey: null,
      hyper: null,
      widgets: null,
      busy: false,
      /* true once the bank's approval overlay has been seen for this
         attempt: it changes both the waiting schedule and the wording */
      sawChallenge: false,
      /* true once a payment has been handed to the bank and the button
         may only ask what happened, never submit again */
      checkOnly: false,
      /* true while an on-load resume is unresolved, so nothing can
         start a second payment behind it */
      resuming: false
    };

    /* The signature the currently open payment was created against. */
    var openedForSig = null;

    /* What the server actually opened the payment for. Null until it
       answers. The page cannot work tax out for itself: a real engine
       knows what California charges for software and a browser does
       not. So this is the authority for the tax row and the pay button
       once it arrives. */
    var serverTotals = null;

    var statusEl = byId(opts.statusId);
    var payButton = byId(opts.buttonId);

    /* FAILURE MESSAGES READ AS FAILURES (owner request, 2026-08-16).
       When the status line carries a failure ending it gets this
       class, which both pages' stylesheets paint in the design
       system's light red; any other status paint removes it, so a
       new attempt, a success, or neutral narration clears the red on
       its own. The engine decides by IDENTITY, not by guessing at
       wording: it remembers the exact string the six-ending builder
       last produced (every outcomeMessage output is a failure story),
       plus the one failure string the engine itself mints
       (copy.loaderFailed, which the pages print verbatim from the
       loader rejection). Page-composed catch messages are the pages'
       own strings and are out of this file's reach; graded separately
       if the delta gate wants them red too. */
    var STATUS_FAILURE_CLASS = 'pay-status-failure';
    var lastFailureMessage = null;

    function status(message) {
      statusEl.hidden = !message;
      statusEl.textContent = message || '';
      var isFailure = !!message &&
        (message === lastFailureMessage || message === copy.loaderFailed);
      statusEl.classList.toggle(STATUS_FAILURE_CLASS, isFailure);
    }

    /* ---------- Edge Function transport ---------- */

    /* invoke an Edge Function; resolves { status, data } and never
       rejects on an HTTP error status (the caller reads status) */
    function fnCall(name, method, body) {
      return fetch(CONFIG.functionsBase + '/' + name, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + CONFIG.anonKey,
          'apikey': CONFIG.anonKey
        },
        body: body ? JSON.stringify(body) : undefined
      }).then(function (resp) {
        return resp.json().catch(function () { return {}; }).then(function (data) {
          return { status: resp.status, data: data };
        });
      });
    }

    /* ============================================================
       RESUME STATE

       The bank's approval step can take the whole page away with a
       history-replacing navigation, so anything we want back must be
       written BEFORE the payment is confirmed, never in a callback.

       Two copies, on purpose:
       - sessionStorage survives a same-tab redirect and is scoped to
         the tab, which is the correct default. The client secret, a
         bearer token for this one payment, lives here and nowhere
         else.
       - localStorage is the fallback for a bank application that
         bounces the person back into a NEW tab, which starts with an
         empty sessionStorage. It carries no secret and expires after
         thirty minutes.
       ============================================================ */

    var RESUME_MAX_AGE_MS = 30 * 60 * 1000;

    function resumeSave(patch) {
      var base = resumeRead() || {};
      var next = {
        v: 1,
        order_number: patch.order_number || base.order_number || null,
        client_secret: patch.client_secret || base.client_secret || null,
        total_cents: typeof patch.total_cents === 'number' ? patch.total_cents : (base.total_cents || null),
        saw_challenge: patch.saw_challenge === true || base.saw_challenge === true,
        created_at_ms: base.created_at_ms || Date.now(),
        channel: opts.channel
      };
      try {
        window.sessionStorage.setItem(opts.resumeKey, JSON.stringify(next));
      } catch (e) { /* private mode: the query parameter still carries the order */ }
      try {
        var lean = JSON.parse(JSON.stringify(next));
        lean.client_secret = null;          /* never a bearer token in localStorage */
        window.localStorage.setItem(opts.resumeKey, JSON.stringify(lean));
      } catch (e) { /* same */ }
    }

    function parseStore(store) {
      try {
        var raw = store.getItem(opts.resumeKey);
        if (!raw) return null;
        var v = JSON.parse(raw);
        if (!v || v.v !== 1 || !v.order_number) return null;
        if (Date.now() - Number(v.created_at_ms || 0) > RESUME_MAX_AGE_MS) return null;
        return v;
      } catch (e) { return null; }
    }

    /* sessionStorage first (it has the secret and the right scope),
       then localStorage (the new-tab case) */
    function resumeRead() {
      var s = null, l = null;
      try { s = parseStore(window.sessionStorage); } catch (e) { s = null; }
      try { l = parseStore(window.localStorage); } catch (e) { l = null; }
      if (s && l && s.order_number === l.order_number) {
        s.saw_challenge = s.saw_challenge || l.saw_challenge;
      }
      return s || l;
    }

    function resumeClear() {
      try { window.sessionStorage.removeItem(opts.resumeKey); } catch (e) { /* nothing to clear */ }
      try { window.localStorage.removeItem(opts.resumeKey); } catch (e) { /* nothing to clear */ }
    }

    /* The address the bank comes back to. Built from the origin and
       the path, never from the live address bar, so no leftover query
       or hash from an earlier attempt rides along. The server builds
       the same address from the return_page we send it; this copy is
       what the widget itself uses. */
    function canonicalReturnUrl(orderNum) {
      var url = new URL(window.location.pathname, window.location.origin);
      url.search = '';
      url.hash = '';
      if (orderNum) url.searchParams.set('orv', orderNum);
      return url.toString();
    }

    /* ============================================================
       THE AMOUNT SIGNATURE

       A payment carries an AMOUNT, fixed at the moment it is
       created. Any control that can move the total re-derives this
       signature; a payment whose signature no longer matches the
       screen is stale and must be discarded rather than charged.
       Server totals are stamped with the signature of the order they
       were computed for, so a late answer about an order nobody is
       placing any more can never be painted as though it were
       current.
       ============================================================ */

    function amountSignature() {
      return JSON.stringify(opts.signaturePayload());
    }

    function totalsAreCurrent() {
      if (!serverTotals || !serverTotals.__sig) return false;
      return serverTotals.__sig === amountSignature();
    }

    /* Store the server's totals without painting them (used when the
       caller wants to decide for itself whether they are current). */
    function storeServerTotals(t) {
      if (!t) return;
      if (!t.__sig) t.__sig = amountSignature();
      serverTotals = t;
    }

    /* Paint the figures the SERVER priced. This is the only place a
       calculated tax figure or a real order total reaches a page. */
    function applyServerTotals(t) {
      if (!t) return;
      storeServerTotals(t);
      var taxLabelEl = byId(opts.totals.taxLabelId);
      /* A jurisdiction is only ever letters, spaces and commas, so the
         allow list drops anything else and the escape helper stands
         behind it as a second belt before innerHTML. */
      var place = esc(String(t.tax_jurisdiction || '').replace(/[^A-Za-z, ]/g, '').slice(0, 40));
      var where = place ? ' ' + place : '';
      var hint = opts.totals.hintClass;
      var label;
      if (t.tax_cents === 0) {
        /* A zero is two different facts and the reason is the only
           thing that separates them. not_collecting means we hold no
           registration there, which is ours to fix; anything else
           means the place genuinely does not tax this, which is the
           right answer. */
        label = t.tax_reason === 'not_collecting'
          ? 'Tax <span class="' + hint + '">not collected' + where + '</span>'
          : 'Tax <span class="' + hint + '">none due' + where + '</span>';
      } else {
        label = 'Tax <span class="' + hint + '">' +
          (t.tax_source === 'flat_fallback' ? 'estimated' : 'calculated' + where) + '</span>';
      }
      /* OPTIONAL PAGE DECORATION SEAM (2026-08-16, owner defect).
         A real figure can still deserve different WORDS: the shop's
         guest checkout prices the unpicked Illinois default, and a
         label that states "calculated IL, US" as settled fact, next
         to a picker that changes it, misleads exactly as far as it
         informs. The engine cannot know page state like "is anyone
         signed in", so the page may rewrite the label: it receives
         the totals, the already-sanitized place text, and the label
         the engine built, and returns replacement HTML or a falsy
         value to keep the engine's wording. WORDS ONLY: the figures
         painted below are not the page's to touch, and any dynamic
         text a decorator injects must be its own constants or the
         sanitized place it was handed, never raw server strings. */
      if (opts.totals.decorateTaxLabel) {
        label = opts.totals.decorateTaxLabel(t, place, label) || label;
      }
      taxLabelEl.innerHTML = label;
      byId(opts.totals.taxId).textContent = fmtMoney(t.tax_cents / 100);
      byId(opts.totals.totalId).textContent = fmtMoney(t.total_cents / 100);
      if (opts.onTotalsApplied) opts.onTotalsApplied(t);
    }

    /* THE RECEIPT MUST NAME THE RATE IT ACTUALLY CHARGED.
       The rate is DERIVED from the receipt's own numbers rather than
       passed alongside them, so it cannot disagree with the amount
       printed beside it, and it keeps working on a resumed page where
       the checkout's own state is long gone. Two decimals, because a
       combined rate like New York City's 8.875 is not a whole number
       and rounding it to 9 would misstate what was charged. */
    function receiptTaxHint(r) {
      var taxable = (r.subtotal_one_cents || 0) + (r.subtotal_sub_cents || 0) +
                    (r.activation_fee_cents || 0);
      if (!taxable || !r.tax_cents) return 'none due';
      var pct = (r.tax_cents / taxable) * 100;
      var text = pct.toFixed(2).replace(/\.00$/, '') + ' percent';
      var rawPlace = r.tax_jurisdiction ||
        (serverTotals && serverTotals.tax_jurisdiction) ||
        '';
      var place = rawPlace
        ? String(rawPlace).replace(/[^A-Za-z, ]/g, '').slice(0, 40)
        : '';
      return place ? text + ', ' + place : text;
    }

    /* ============================================================
       ASKING WHAT TAX IS OWED, WITHOUT STARTING A PAYMENT

       quote-tax prices an order and answers. It creates NOTHING: no
       order row, no payment at the processor, no tax record. It
       exists so the figure on screen is the figure the card will be
       charged, before the card is ever involved. create-payment
       remains the authority: it reprices the same order from scratch
       when the payment opens, through the very same shared server
       code, and the pages defer to its figure the moment it exists.

       WHY A SHORT DEBOUNCE: a quote is cheap and creates nothing, so
       it can afford to be eager. Its rate limit is its own bucket
       and deliberately looser, precisely so that a shopper changing
       their mind repeatedly can still pay at the end of it.
       ============================================================ */
    var QUOTE_DEBOUNCE_MS = 350;
    var quoteTimer = null;
    var quoteInFlight = null;   /* the signature currently being asked about */

    function ensureQuote() {
      if (!opts.live) return;
      /* A payment already handed over, or a bank window up, means the
         amount is settled and no longer ours to re-quote. */
      if (state.checkOnly || challengeOpen) return;
      if (opts.quoteGate && !opts.quoteGate()) return;

      var signature = amountSignature();
      if (totalsAreCurrent()) return;
      if (quoteInFlight === signature) return;

      if (quoteTimer) window.clearTimeout(quoteTimer);
      quoteTimer = window.setTimeout(function () {
        quoteTimer = null;
        var asking = amountSignature();
        if (totalsAreCurrent() || quoteInFlight === asking) return;
        if (opts.quoteGate && !opts.quoteGate()) return;
        quoteInFlight = asking;
        fnCall('quote-tax', 'POST', opts.signaturePayload()).then(function (result) {
          if (quoteInFlight === asking) quoteInFlight = null;
          if (result.status !== 200 || !result.data || !result.data.totals) return;
          /* THE STALENESS CHECK. Between asking and answering the
             order may have changed. An answer to a question nobody is
             asking any more is dropped, not shown: a wrong figure
             that looks calculated is worse than an estimate that
             admits it. */
          if (amountSignature() !== asking) return;
          var t = result.data.totals;
          t.__sig = asking;
          applyServerTotals(t);
        }).catch(function () {
          if (quoteInFlight === asking) quoteInFlight = null;
          /* Silent on purpose. The estimate is already on screen and
             already labelled an estimate, and create-payment will
             price the order properly a moment later regardless. */
        });
      }, QUOTE_DEBOUNCE_MS);
    }

    /* ============================================================
       THE SANCTIONED EXTERNAL SCRIPT

       Cached behind one promise, so calling this more than once can
       never append a second copy of the script tag. The staff
       console's old private loader was uncached and could
       double-append; this one pattern now serves both pages.
       ============================================================ */
    var hyperLoaderPromise = null;

    function loadHyperLoader() {
      if (window.Hyper) return Promise.resolve();
      if (hyperLoaderPromise) return hyperLoaderPromise;
      hyperLoaderPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = CONFIG.hyperLoaderUrl;
        s.onload = function () { resolve(); };
        s.onerror = function () {
          /* let a later attempt try again rather than failing forever */
          hyperLoaderPromise = null;
          reject(new Error(copy.loaderFailed));
        };
        document.head.appendChild(s);
      });
      return hyperLoaderPromise;
    }

    /* Start fetching the card-form script before the payment step can
       possibly need it, so the download runs in parallel with the
       server call instead of after it. Failure here is deliberately
       ignored: the real attempt later reports it properly. */
    function warmHyperLoader() {
      if (!opts.live) return;
      try { loadHyperLoader().catch(function () { /* reported at use */ }); }
      catch (e) { /* never let warming break the page */ }
    }

    /* mount the provider's secure payment form; card and wallet data
       go only into that form, never into this page's inputs */
    function mountWidget(publishableKey) {
      state.publishableKey = publishableKey;
      state.hyper = window.Hyper(publishableKey);
      state.widgets = state.hyper.widgets({ clientSecret: state.clientSecret });
      state.widgets.create('payment', {
        layout: 'tabs',
        wallets: {
          walletReturnUrl: canonicalReturnUrl(state.orderNumber)
        }
      }).mount('#' + opts.mountId);
      setCardSkeleton(false);
    }

    /* hand the card to the provider; resolves to an SDK error object
       or null. The verdict is ADVISORY: a decline can reach the bank
       and come back through the form as an error, so the caller must
       always ask OUR server for the truth afterward. */
    function confirmPayment() {
      return state.hyper.confirmPayment({
        widgets: state.widgets,
        confirmParams: { return_url: canonicalReturnUrl(state.orderNumber) },
        redirect: 'if_required'
      }).then(
        function (sdkResult) {
          return sdkResult && sdkResult.error ? sdkResult.error : null;
        },
        function (err) {
          return { message: (err && err.message) || copy.sdkSubmitFailed };
        }
      );
    }

    /* a pure form-validation problem never left the browser: keep the
       form up for editing rather than treating it as an outcome */
    function isValidationError(sdkError) {
      return !!(sdkError &&
        /incomplete|invalid|required|expir|number|cvc|cvv|blank|empty/i.test(sdkError.message || ''));
    }

    /* ============================================================
       THE FINISHING STATE

       Between the bank's approval window closing and our server
       saying what happened, there are a few seconds of waiting. The
       provider's card form is still mounted underneath, so without
       this the person watches the page snap back to an empty card
       form and then jump to the receipt, which reads as though the
       payment failed and then changed its mind. Reported 2026-08-15
       on the shop; the staff console had the same fault until this
       extraction, which is why the finishing state lives HERE and
       both pages get it.

       While finishing, the card form and the button go away and only
       the status line remains. Nothing here decides the outcome; it
       is presentation over a wait whose answer still comes from the
       server.
       ============================================================ */
    function setFinishing(on) {
      var mount = byId(opts.mountId);
      if (mount) mount.hidden = !!on;
      if (payButton) payButton.hidden = !!on;
      if (on) statusEl.hidden = false;
      if (hooks.onFinishing) hooks.onFinishing(!!on);
    }

    /* The placeholder that stands in for the card form while the
       server opens the payment. Presentation only; torn down the
       instant the real form mounts, and again on any reset. */
    function setCardSkeleton(on) {
      if (!opts.skeletonId) return;
      var sk = byId(opts.skeletonId);
      if (sk) sk.hidden = !on;
    }

    /* ============================================================
       INERT WHILE A PAYMENT IS IN FLIGHT

       Nothing the person can reach may change the amount that is
       currently being authorized. Really disabled, not dimmed, so a
       keyboard user cannot tab into it either.
       ============================================================ */
    var inertOn = false;

    function setInert(on) {
      if (on === inertOn) return;
      inertOn = on;
      [].slice.call(document.querySelectorAll(opts.inertSelectors)).forEach(function (el) {
        if (on) {
          if (el.disabled) el.setAttribute('data-was-disabled', '1');
          el.disabled = true;
        } else if (el.getAttribute('data-was-disabled')) {
          el.removeAttribute('data-was-disabled');
        } else {
          el.disabled = false;
        }
      });
      if (hooks.onInertChange) hooks.onInertChange(on);
    }

    /* ============================================================
       THE BANK APPROVAL OVERLAY

       The payment widget injects a full-screen frame of its own for
       the bank's approval screen. We do not control its contents, so
       what we control is everything around it: the page behind it
       goes inert, the page's chrome bar carries the order number and
       the honest instruction, focus moves into the dialog and stays
       there, and screen readers are told what happened.
       ============================================================ */

    var challengeChrome = byId('challengeChrome');
    var ccOrderNum = byId('ccOrderNum');
    var ccCancel = byId('ccCancel');
    var challengeOpen = false;
    var focusBeforeChallenge = null;

    function challengeFrame() {
      return document.getElementById('orca-fullscreen');
    }

    function openChallengeChrome() {
      if (challengeOpen) return;
      challengeOpen = true;
      state.sawChallenge = true;
      resumeSave({ order_number: state.orderNumber, saw_challenge: true });
      focusBeforeChallenge = document.activeElement;
      ccOrderNum.textContent = state.orderNumber || 'not yet issued';
      /* Move this bar to the very end of <body> before showing it.
         The widget appends its full-screen bank frame to the body when
         the challenge starts, so by then that frame is AFTER us in
         document order. Both elements sit at the maximum z-index a
         browser will honour (see the note in shop.css), and at equal
         z-index the later element wins. Without this line the bar is
         painted behind the bank frame and the person never sees the
         order number, the notice, or the way out. */
      try { document.body.appendChild(challengeChrome); } catch (e) { /* best effort */ }
      challengeChrome.hidden = false;
      setInert(true);
      status(copy.challengeOpenStatus);
      if (hooks.onChallengeOpen) hooks.onChallengeOpen();
      try { ccCancel.focus(); } catch (e) { /* focus is best effort */ }
      document.addEventListener('keydown', challengeKeydown, true);
    }

    function closeChallengeChrome() {
      if (!challengeOpen) return;
      challengeOpen = false;
      challengeChrome.hidden = true;
      document.removeEventListener('keydown', challengeKeydown, true);
      /* The bank's window has gone but the payment is still in
         flight. Put the page into the finishing state so the card
         form does not reappear for a second on the way to the
         receipt. Deliberately says nothing about the outcome: the
         person may have approved, failed, or closed the window, and
         only the server knows which. A cancel handler that writes
         its own message straight after this correctly replaces the
         finishing copy. */
      if (state.busy) {
        setFinishing(true);
        status(copy.finishingStatus);
      }
      /* The close hook fires on EVERY close, before the focus work
         below, because its contract is "fires on close" and the
         focus-restore path used to return early past it (verifier
         finding L3, fixed 2026-08-16). The pages' hooks are
         idempotent presentation work, so firing on the early-return
         path is harmless and the contract now matches the code. */
      if (hooks.onChallengeClose) hooks.onChallengeClose();
      /* focus must never be left on the control that just
         disappeared. It goes back where it came from when that is
         still a real, usable control, and otherwise to the status
         line, which is exactly where the outcome is about to be
         written. */
      var back = focusBeforeChallenge;
      focusBeforeChallenge = null;
      var CONTROLS = /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/;
      if (back && document.contains(back) && !back.disabled && !back.hidden &&
          CONTROLS.test(back.tagName || '')) {
        try { back.focus(); return; } catch (e) { /* fall through */ }
      }
      try {
        statusEl.hidden = false;
        statusEl.focus();
      } catch (e) { /* fall through to the button */ }
      if (document.activeElement !== statusEl) {
        try { payButton.focus(); } catch (err) { /* best effort */ }
      }
    }

    /* Keyboard containment. The bank's own screen is a cross-origin
       frame, so once focus is inside it the browser handles the
       tabbing; what we guarantee is that Tab never lands back on the
       page behind the overlay, and that Escape does not silently
       drop the person somewhere undefined (Escape must not orphan a
       live payment). */
    function challengeKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        return;
      }
      if (e.key !== 'Tab') return;
      var frame = challengeFrame();
      var stops = [ccCancel];
      if (frame) stops.push(frame);
      var index = stops.indexOf(document.activeElement);
      e.preventDefault();
      var next = e.shiftKey
        ? stops[(index <= 0 ? stops.length : index) - 1]
        : stops[(index + 1) % stops.length];
      try { next.focus(); } catch (err) { /* best effort */ }
    }

    /* ============================================================
       A BLANK WINDOW IS NOT A CHALLENGE

       3-D Secure 2 has two phases and the payment widget runs BOTH
       in the same full-screen frame. The first phase is silent: the
       card's bank looks at the device and the transaction and, most
       of the time, approves without asking anything. Only if it
       wants proof does a second, visible phase draw a passcode form.
       So the frame appearing means "authentication is running", NOT
       "a challenge is up". Showing it immediately produced the
       reported blank white window over a frictionless approval.

       THE CORRECT FIX (2026-08-16, replacing the old fixed timer):
       the frame is made invisible the moment it appears, and the
       engine asks the payment service DIRECTLY what state the
       payment is in, using the publishable key and this payment's
       own client secret, both public to this browser by design. The
       frame is revealed only when the payment genuinely reports
       requires_customer_action with a next_action attached, which is
       the service saying a real challenge is waiting. A frictionless
       authentication never reaches that state, so its frame is never
       shown at all, which is the whole point of frictionless.

       The old timer survives ONLY as the fallback for when the
       status poll itself errors, and a hard cap reveals a
       still-present frame regardless, so a real challenge can never
       be trapped invisible. All of this is presentation: it never
       gates the payment, and the outcome still comes from our
       server either way.
       ============================================================ */
    var CHALLENGE_REVEAL_MS = 1400;      /* fallback timer, poll-error case */
    var REVEAL_POLL_MS = 400;            /* how often to ask while deciding */
    var REVEAL_POLL_MAX_MS = 10000;      /* hard cap: reveal a lingering frame */
    var challengePendingTimer = null;
    var challengePollTimer = null;
    var revealActive = false;

    function placeChallengeFrame(frame) {
      if (!frame) return;
      /* The provider injects this node with its own full-screen
         positioning. Keep the challenge above checkout chrome but
         below our instruction bar, and put the passcode card where a
         shopper looks first: top center, not over the sticky total. */
      frame.style.setProperty('position', 'fixed', 'important');
      frame.style.setProperty('top', '86px', 'important');
      frame.style.setProperty('left', '50%', 'important');
      frame.style.setProperty('right', 'auto', 'important');
      frame.style.setProperty('bottom', 'auto', 'important');
      frame.style.setProperty('transform', 'translateX(-50%)', 'important');
      frame.style.setProperty('width', 'min(480px, calc(100vw - 32px))', 'important');
      frame.style.setProperty('height', 'min(620px, calc(100vh - 108px))', 'important');
      frame.style.setProperty('max-height', 'calc(100vh - 108px)', 'important');
      frame.style.setProperty('overflow', 'hidden', 'important');
      frame.style.setProperty('z-index', '2147483646', 'important');
      frame.style.setProperty('box-shadow', '0 24px 70px rgba(2, 6, 20, 0.55)', 'important');
      frame.style.setProperty('border-radius', '10px', 'important');
      frame.style.setProperty('background', '#fff', 'important');
    }

    function setChallengeFrameVisible(frame, visible) {
      if (!frame) return;
      if (visible) placeChallengeFrame(frame);
      frame.style.opacity = visible ? '1' : '0';
      frame.style.pointerEvents = visible ? 'auto' : 'none';
      /* M6, quality assurance audit 2026-08-15. The keyboard trap
         moves focus between the cancel button and this frame, but an
         element with no tabindex cannot take focus, so Tab simply
         stayed on Cancel and a keyboard user could never reach into
         the bank's window at all. Setting it here rather than in
         markup is deliberate: the widget creates this element
         itself, so this is the only moment we are certain it
         exists. */
      if (visible) { try { frame.setAttribute('tabindex', '-1'); } catch (e) { /* best effort */ } }
    }

    /* Cancels any pending reveal, both the poll and the fallback
       timer. Wired into every reset path, because a stale timer that
       fires after a reset would reveal and announce a challenge for
       a payment that no longer exists. */
    function cancelChallengeReveal() {
      revealActive = false;
      if (challengePendingTimer) {
        window.clearTimeout(challengePendingTimer);
        challengePendingTimer = null;
      }
      if (challengePollTimer) {
        window.clearTimeout(challengePollTimer);
        challengePollTimer = null;
      }
    }

    /* One read of the payment's own status from the payment service.
       The payment identifier is the client secret's own prefix. */
    function pollPaymentStatusOnce() {
      var secret = state.clientSecret || '';
      var cut = secret.indexOf('_secret_');
      var paymentId = cut > 0 ? secret.slice(0, cut) : null;
      if (!paymentId || !state.publishableKey) {
        return Promise.reject(new Error('no client credentials to poll with'));
      }
      return fetch(
        CONFIG.apiBase + '/payments/' + encodeURIComponent(paymentId) +
          '?client_secret=' + encodeURIComponent(secret) + '&force_sync=false',
        { headers: { 'api-key': state.publishableKey, 'Accept': 'application/json' } }
      ).then(function (r) {
        if (!r.ok) throw new Error('status poll answered HTTP ' + r.status);
        return r.json();
      });
    }

    function scheduleChallengeReveal() {
      revealActive = true;
      var startedAt = Date.now();

      function revealNow() {
        if (!revealActive && !challengePendingTimer) return;
        cancelChallengeReveal();
        var still = challengeFrame();
        /* gone already: the silent phase finished and there was never
           anything for the person to look at */
        if (!still) return;
        setChallengeFrameVisible(still, true);
        openChallengeChrome();
      }

      function tick() {
        challengePollTimer = null;
        if (!revealActive) return;
        if (!challengeFrame()) { cancelChallengeReveal(); return; }
        pollPaymentStatusOnce().then(function (p) {
          if (!revealActive) return;
          var st = String((p && p.status) || '').toLowerCase();
          if (st === 'requires_customer_action' && p.next_action) {
            revealNow();
            return;
          }
          if (Date.now() - startedAt > REVEAL_POLL_MAX_MS) {
            /* the service never said challenge but the frame is still
               here: reveal it rather than risk trapping a real
               challenge invisible */
            revealNow();
            return;
          }
          challengePollTimer = window.setTimeout(tick, REVEAL_POLL_MS);
        }).catch(function () {
          if (!revealActive) return;
          /* the poll cannot answer: fall back to the old timer
             heuristic, reveal if the frame is still present a beat
             from now */
          revealActive = false;
          challengePendingTimer = window.setTimeout(function () {
            challengePendingTimer = null;
            revealNow();
          }, CHALLENGE_REVEAL_MS);
        });
      }
      tick();
    }

    /* Watch for the widget's overlay appearing and disappearing. */
    if (window.MutationObserver) {
      new MutationObserver(function () {
        var frame = challengeFrame();
        if (frame && !challengeOpen && !revealActive && !challengePendingTimer) {
          setChallengeFrameVisible(frame, false);
          scheduleChallengeReveal();
        }
        if (!frame) {
          cancelChallengeReveal();
          if (challengeOpen) closeChallengeChrome();
        }
      }).observe(document.body, { childList: true, subtree: true });
    }

    function removeChallengeFrame() {
      var frame = challengeFrame();
      if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
    }

    /* ============================================================
       READING THE SERVER RECEIPT

       The server sends back a short plain-English `reason` and a set
       of named authentication fields. Those two are what let a page
       tell six genuinely different stories apart, instead of showing
       one generic decline for all of them. Everything here tolerates
       their absence, because the older server shape had neither
       field.
       ============================================================ */

    function authOf(r) { return (r && r.authentication) || {}; }
    function reasonOf(r) { return (r && typeof r.reason === 'string') ? r.reason : ''; }

    function transStatus(r) {
      return String(authOf(r).trans_status || '').toUpperCase();
    }

    /* the bank confirmed the person's identity */
    function authApproved(r) {
      var ts = transStatus(r);
      if (ts === 'Y' || ts === 'A') return true;
      var st = String(authOf(r).status || '').toLowerCase();
      return st === 'success' || st === 'authenticated' || st === 'authentication_successful';
    }

    /* the identity check ran and came back no, or never finished */
    function authRefused(r) {
      var ts = transStatus(r);
      if (ts === 'N' || ts === 'R' || ts === 'U') return true;
      var st = String(authOf(r).status || '').toLowerCase();
      if (st === 'failed' || st === 'authentication_failed') return true;
      return /authentication_failed|challenge_abandoned|attempt_reset|not_submitted/.test(reasonOf(r));
    }

    /* the identity check itself broke: nobody said no, it simply
       could not run */
    function authBroke(r) {
      var a = authOf(r);
      if (a.error_code || a.error_message) return true;
      return /authentication_error|three_ds_error|3ds_error|unavailable/.test(reasonOf(r));
    }

    function awaitingAuthentication(r) {
      if (reasonOf(r) === 'awaiting_authentication') return true;
      var st = String((r && r.processor && r.processor.status) || '').toLowerCase();
      return st === 'requires_customer_action';
    }

    /* ============================================================
       THE SIX ENDINGS

       Four come from the authentication object. Two more exist
       because the processor's OWN 3-D Secure (which is what this
       rail uses today) does not populate that object, and a person
       who typed a correct passcode and was then declined must never
       land on a bare "Declined.", which reads as though the approval
       step did nothing (hit and reported 2026-08-15; the staff
       console carried the same fault until this extraction).

       What a page knows first-hand is whether the approval window
       opened, because the engine watched it open (sawChallenge).
       That alone does not say whether the approval SUCCEEDED, so
       the wording is decided by what the processor actually said: a
       plain processor decline means the money was refused after the
       approval step, whereas anything else may well be the approval
       step itself failing. We stop short of claiming the bank
       confirmed anyone's identity, because on this rail we genuinely
       cannot see that.

       Every string comes from the page's copy table. The engine
       decides WHICH story; the page decides the words.
       ============================================================ */
    /* Public face: remembers the exact failure string it hands out,
       so the status painter above can recognise it on arrival and
       dress it as a failure (see STATUS_FAILURE_CLASS). */
    function outcomeMessage(receipt) {
      var message = buildOutcomeMessage(receipt);
      lastFailureMessage = message;
      return message;
    }

    function buildOutcomeMessage(receipt) {
      var bankMsg = (receipt.processor && receipt.processor.error_message) || '';
      var bankSaid = bankMsg ? copy.bankSaidPrefix + bankMsg + '.' : '';
      /* SESSION STATE APPLIES ONLY TO THE SESSION'S OWN PAYMENT.
         Fixed 2026-08-16 (verifier finding M3, quality assurance
         finding H2): sawChallenge records that THIS session's
         approval window opened, so it may only ever colour the story
         of the order this session is holding. The staff order lookup
         fed arbitrary looked-up receipts through here while a live
         challenge had the flag set, and an agent read "the cardholder
         finished their bank approval" about an order that never saw
         one. The guard lives HERE, at the engine level, so no caller
         can repeat that mistake: every server receipt carries its
         order_number, and a receipt for any order other than the
         session's own never consults the session flag. */
      var isSessionOrder = !!(receipt && receipt.order_number &&
        receipt.order_number === state.orderNumber);
      if (authBroke(receipt)) {
        return copy.outcomeBroke(bankSaid);
      }
      if (authRefused(receipt) && !authApproved(receipt)) {
        return copy.outcomeRefused(bankSaid);
      }
      if (authApproved(receipt)) {
        return copy.outcomeApprovedThenDeclined(bankSaid);
      }
      if (isSessionOrder && state.sawChallenge) {
        var declinedByCard =
          /processor.?declined|do not honou?r|insufficient|card.?declined/i.test(bankMsg);
        return declinedByCard
          ? copy.outcomeChallengeDeclinedByCard(bankSaid)
          : copy.outcomeChallengeIncomplete(bankSaid);
      }
      return copy.outcomeDeclined(bankSaid);
    }

    /* ============================================================
       TWO WAITING CLOCKS

       Waiting for a processor takes seconds. Waiting for a person to
       read a text message from their bank takes one to three
       minutes. One schedule cannot serve both, and the old single
       schedule (three checks over seven and a half seconds) timed
       out in the middle of every real approval.
       ============================================================ */
    var PROCESSOR_WAIT_MS = 20 * 1000;
    var AUTH_WAIT_MS = 10 * 60 * 1000;

    function nextPollDelay(receipt, elapsedMs) {
      if (awaitingAuthentication(receipt) || state.sawChallenge || challengeOpen) {
        if (elapsedMs > AUTH_WAIT_MS) return -1;
        return elapsedMs < 60 * 1000 ? 5000 : 10000;
      }
      if (elapsedMs > PROCESSOR_WAIT_MS) return -1;
      return 2000;
    }

    /* The sale completed, so the tax liability is now real and the
       calculation should be recorded for reporting. Fire and forget:
       handleReceipt calls this just BEFORE handing the receipt to the
       page's onSuccess hook, and nothing awaits it, so this is
       bookkeeping and a person whose money has already moved never
       waits on it. (Comment corrected 2026-08-16, quality assurance
       finding L6: it used to claim the call fired after the receipt
       rendered, which was never what the code did.) The job is
       idempotent and picks up anything missed on its next run, so a
       failure here costs a retry, not a record. */
    function recordTax() {
      try { fnCall('record-tax', 'POST', {}).catch(function () { /* next run takes it */ }); }
      catch (e) { /* never let bookkeeping break a receipt */ }
    }

    /* act on the server's receipt: success records the tax and hands
       the receipt to the page (only the page knows how to render its
       confirmation and what local state to clear), a decline hands
       the page its outcome, in-flight waits on the right clock and
       never calls itself an error */
    function handleReceipt(receipt, startedAt) {
      if (receipt.payment_status === 'succeeded') {
        recordTax();
        hooks.onSuccess(receipt);
        return;
      }
      var reasonNow = reasonOf(receipt);
      if (receipt.payment_status === 'failed' || receipt.payment_status === 'abandoned' ||
          reasonNow === 'attempt_reset' || reasonNow === 'not_submitted') {
        hooks.onFailure(receipt);
        return;
      }

      var elapsed = Date.now() - startedAt;
      var waitingOnCardholder = awaitingAuthentication(receipt) || state.sawChallenge;
      if (waitingOnCardholder && hooks.onWaiting) hooks.onWaiting(receipt);
      var delay = nextPollDelay(receipt, elapsed);
      if (delay > 0) {
        status(waitingOnCardholder
          ? copy.waitingAuth(state.orderNumber)
          : copy.waitingProcessor(state.orderNumber));
        window.setTimeout(function () { pollReceipt(startedAt); }, delay);
        return;
      }

      /* out of patience, not out of answers: hand the button over to
         "check again" duty and say exactly where things stand */
      state.busy = false;
      state.checkOnly = true;
      setInert(false);
      /* leaving the finishing state on here would hide the very
         button this message tells the person to press */
      setFinishing(false);
      payButton.disabled = false;
      payButton.textContent = copy.checkAgainLabel;
      status(copy.timeoutStatus(state.orderNumber));
      if (hooks.onTimeout) hooks.onTimeout(receipt);
    }

    /* ask our server what happened; every chain ends in a catch, so
       the worst network day can never strand "finishing your order"
       on screen forever (audit finding A2) */
    function pollReceipt(startedAt) {
      fnCall('confirm-payment', 'POST', { order_number: state.orderNumber })
        .then(function (result) {
          if (result.status !== 200) {
            hooks.onCheckError(result);
            return;
          }
          handleReceipt(result.data, startedAt);
        })
        .catch(function () {
          hooks.onCheckError(null);
        });
    }

    /* ============================================================
       RESET

       Clears any in-flight payment. An optional message stays on
       screen (used for decline copy); the page's cart or order lines
       are NEVER touched here. The reveal cancel runs first, so a
       stale timer can never fire after the reset and announce a
       challenge for a payment that no longer exists.
       ============================================================ */
    function resetPayment(message) {
      cancelChallengeReveal();
      /* the discarded payment's amount signature goes with it, so the
         next open starts fresh */
      openedForSig = null;
      /* Server totals belong to an ORDER, not to a payment.
         Discarding a payment because the amount moved must not also
         discard a tax answer that is still correct for what is on
         screen, or the row would drop back to "estimate" and re-ask
         a question already answered. Anything that no longer matches
         is cleared. */
      if (!totalsAreCurrent()) serverTotals = null;
      state.orderNumber = null;
      state.clientSecret = null;
      state.publishableKey = null;
      state.hyper = null;
      state.widgets = null;
      state.busy = false;
      state.sawChallenge = false;
      state.checkOnly = false;
      state.resuming = false;
      resumeClear();
      setInert(false);
      var mount = byId(opts.mountId);
      if (mount) { mount.innerHTML = ''; mount.hidden = false; }
      setFinishing(false);
      setCardSkeleton(false);
      status(message || '');
      if (hooks.onReset) hooks.onReset(message || '');
    }

    /* ---------- the engine's public face ---------- */

    return {
      state: state,
      status: status,
      fnCall: fnCall,
      ensureQuote: ensureQuote,
      amountSignature: amountSignature,
      totalsAreCurrent: totalsAreCurrent,
      storeServerTotals: storeServerTotals,
      applyServerTotals: applyServerTotals,
      getServerTotals: function () { return serverTotals; },
      receiptTaxHint: receiptTaxHint,
      openedFor: function () { return openedForSig; },
      setOpenedFor: function (sig) { openedForSig = sig; },
      resumeSave: resumeSave,
      resumeRead: resumeRead,
      resumeClear: resumeClear,
      canonicalReturnUrl: canonicalReturnUrl,
      loadHyperLoader: loadHyperLoader,
      warmHyperLoader: warmHyperLoader,
      mountWidget: mountWidget,
      confirmPayment: confirmPayment,
      isValidationError: isValidationError,
      setFinishing: setFinishing,
      setCardSkeleton: setCardSkeleton,
      setInert: setInert,
      isChallengeOpen: function () { return challengeOpen; },
      closeChallengeChrome: closeChallengeChrome,
      removeChallengeFrame: removeChallengeFrame,
      cancelChallengeReveal: cancelChallengeReveal,
      authOf: authOf,
      reasonOf: reasonOf,
      authApproved: authApproved,
      authRefused: authRefused,
      authBroke: authBroke,
      awaitingAuthentication: awaitingAuthentication,
      outcomeMessage: outcomeMessage,
      nextPollDelay: nextPollDelay,
      recordTax: recordTax,
      handleReceipt: handleReceipt,
      pollReceipt: pollReceipt,
      resetPayment: resetPayment
    };
  }

  window.OrvannaPayments = {
    CONFIG: CONFIG,
    esc: esc,
    friendlyError: friendlyError,
    ORDER_NUMBER_RE: ORDER_NUMBER_RE,
    createPaymentEngine: createPaymentEngine
  };
})();
