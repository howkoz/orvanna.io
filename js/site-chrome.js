/* ============================================================
   ORVANNA SHARED SITE CHROME
   www/js/site-chrome.js

   One file owns the two behaviours that every corporate page
   needs and that every corporate page used to hand-roll:

     1. The theme control. One icon-only button, one storage
        key, one default. Dark is the default everywhere.
     2. The Support control. One copy of the chat wiring,
        instead of the five inline copies that used to sit in
        index, shop, product, team and faq.

   WHY THIS FILE EXISTS. Nine corporate pages each carried their
   own navigation, their own theme toggle and their own support
   script. They were pasted, then edited separately, and they
   drifted: four different theme controls, four pages with no
   theme control, and a Support button that did nothing on four
   pages. This is the same disease the payment engine had before
   payments.js, and it gets the same cure: a single module the
   pages consume, plus a build lint that fails when the shared
   markup drifts. See docs/CORPORATE-CHROME-CONTRACT.md.

   NOT LOADED BY the three sign-in pages (login.html,
   staff.html, staff-operations.html). Those keep their own
   chrome by explicit instruction and are out of scope.

   Acronym key: Cascading Style Sheets (CSS), Scalable Vector
   Graphics (SVG), Hypertext Markup Language (HTML).
   ============================================================ */
(function () {
  'use strict';

  /* ----------------------------------------------------------
     1. PALETTE AND THE NAVIGATION DISCLOSURE
     ----------------------------------------------------------
     This section used to own a theme toggle: one storage key,
     'orvanna-theme', replacing the four per-page keys the site
     had grown, so a reader who picked light on the library still
     had light on the plan page.

     The redesign ended the choice. See pinPalette below for what
     replaced it and what was deliberately left alone.
     ---------------------------------------------------------- */

  var root = document.documentElement;

  /* THE PALETTE IS NO LONGER A CHOICE.

     The redesign is mono: one warm paper, one ink, one accent. A control
     that switched between two palettes has nothing left to switch, so it
     is gone from the bar rather than left there doing nothing visible.

     What is NOT done here, deliberately: the 144 `[data-theme="light"]`
     rules still in the stylesheets are not swept tonight. The attribute is
     pinned to the value every page already boots with, so every one of
     those selectors resolves exactly as it does today and this change is
     visually inert. Deleting them is a separate, mechanical pass with its
     own gate; doing it in the same commit as a nav rebuild would make a
     regression impossible to attribute.

     One real behaviour change: a returning visitor who once chose light
     now gets the same page as everybody else. The stored key is cleared
     rather than read, because a preference between two things that are now
     one thing is a trap for the next reader of this code. */
  function pinPalette() {
    root.setAttribute('data-theme', 'dark');
    try { window.localStorage.removeItem('orvanna-theme'); }
    catch (err) { /* storage blocked: nothing was stored to clear */ }
  }

  /* ----------------------------------------------------------
     THE NAVIGATION DISCLOSURE
     ----------------------------------------------------------
     Under 900px the menu collapses behind one button. Above it,
     the button is display:none and none of this runs to any
     visible effect.

     The menu is shut with `display: none` in CSS, so its links
     leave the tab order when hidden. That is the part a
     disclosure usually gets wrong: a menu you cannot see but can
     still tab into strands keyboard focus somewhere invisible.
     ---------------------------------------------------------- */

  function initDisclosure() {
    var button = document.querySelector('[data-nav-disclosure]');
    if (!button) { return; }
    var links = button.closest ? button.closest('.nav-links') : null;
    if (!links) { return; }

    function setOpen(open) {
      links.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    button.addEventListener('click', function () {
      setOpen(button.getAttribute('aria-expanded') !== 'true');
    });

    /* Escape returns focus to the control that opened the menu.
       Closing and leaving focus inside a hidden panel is the
       same strandingth e display:none above exists to prevent. */
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') { return; }
      if (button.getAttribute('aria-expanded') !== 'true') { return; }
      setOpen(false);
      button.focus();
    });

    /* A click outside shuts it. Without this the panel covers the
       page's first screen and the only way out is the button. */
    document.addEventListener('click', function (event) {
      if (button.getAttribute('aria-expanded') !== 'true') { return; }
      if (links.contains(event.target)) { return; }
      setOpen(false);
    });

    /* Dragging the window back above the breakpoint must not
       leave `is-open` set: the class would then apply to a bar
       that has no disclosure, and the desktop menu would inherit
       a state nothing can clear. */
    window.addEventListener('resize', function () {
      if (window.innerWidth > 900) { setOpen(false); }
    });
  }

  /* ----------------------------------------------------------
     2. SUPPORT
     ----------------------------------------------------------
     The chat is Botpress, a third party, and it is the second
     sanctioned external script on the property after the
     payment loader. Its own floating action button is hidden in
     the stylesheet, so the panel opens only from the Support
     item in the navigation and nothing can float over the cart
     control on a phone or over the card form at checkout.

     The two vendor scripts are appended here rather than being
     written into nine pages. async is set to false so the two
     execute in the order they are inserted: the configuration
     file calls into the loader and must run second.
     ---------------------------------------------------------- */

  var BOTPRESS_LOADER = 'https://cdn.botpress.cloud/webchat/v5.0/inject.js';
  var BOTPRESS_CONFIG = 'https://files.bpcontent.cloud/2026/08/14/20/20260814201237-9JS9TWQ7.js';

  var SUPPORT_EMAIL = 'support@orvanna.io';
  var READY_TIMEOUT_MS = 15000;

  function loadSupportWidget() {
    if (document.querySelector('script[data-orvanna-support-script]')) { return; }
    [BOTPRESS_LOADER, BOTPRESS_CONFIG].forEach(function (src) {
      var el = document.createElement('script');
      el.src = src;
      el.async = false;   /* preserves insertion order */
      el.setAttribute('data-orvanna-support-script', '');
      document.head.appendChild(el);
    });
  }

  function initSupport() {
    var triggers = document.querySelectorAll('[data-orvanna-support]');
    if (!triggers.length) { return; }

    loadSupportWidget();

    /* READINESS, NOT MERE EXISTENCE.
       The first version of this treated "window.botpress.open is a
       function" as success. That function appears about 383
       milliseconds after load, well before the widget can open, so a
       click inside that window returned true, opened nothing, never
       armed the deferred open, and gave the reader no feedback at
       all. A button that does nothing and says nothing is a dead end,
       and the standing rule on this project is that every refusal
       hands the reader a next step.

       Readiness is therefore judged on TWO signals, either of which
       counts, because the vendor's own event proved unreliable: the
       quality assurance environment never saw 'webchat:ready' fire on
       any page, on this commit or on the baseline before it, and yet
       the panel container did render. Trusting the event alone would
       tell a reader the chat is unavailable while it is sitting on
       the page working. So the panel appearing in the document counts
       as ready too. */
    var PANEL_SELECTOR = '.bpChatContainer, [class*="bpWebchat"], #webchat';

    var ready = false;
    var wantOpen = false;
    var listening = false;
    var gaveUp = false;

    function setState(state) {
      Array.prototype.forEach.call(triggers, function (trigger) {
        if (state) { trigger.setAttribute('data-support-state', state); }
        else { trigger.removeAttribute('data-support-state'); }
      });
    }

    function panelExists() {
      return !!document.querySelector(PANEL_SELECTOR);
    }

    function openNow() {
      if (!ready) { return false; }
      if (window.botpress && typeof window.botpress.open === 'function') {
        try { window.botpress.open(); return true; }
        catch (err) { return false; }
      }
      return false;
    }

    /* THE NEXT STEP, when the chat cannot be reached at all.

       Deliberately NOT window.confirm. A modal dialog blocks the page,
       it cannot be styled, and on a phone it reads like an error the
       reader caused. This instead puts the button into a state that
       says what happened, rewrites its accessible name so a screen
       reader hears the same thing a sighted reader sees, and turns the
       next press into an email to a named address. The reader is never
       left holding a control that does nothing. */
    function giveUp() {
      if (gaveUp) { return; }
      gaveUp = true;
      wantOpen = false;
      setState('unavailable');
      Array.prototype.forEach.call(triggers, function (trigger) {
        var label = 'Support chat is unavailable. Press again to email ' + SUPPORT_EMAIL + '.';
        trigger.setAttribute('aria-label', label);
        trigger.setAttribute('title', label);
      });
      /* Announced politely, so assistive technology hears the change
         without the page stealing focus. */
      var say = document.getElementById('orvanna-support-status');
      if (!say) {
        say = document.createElement('p');
        say.id = 'orvanna-support-status';
        say.setAttribute('role', 'status');
        say.setAttribute('aria-live', 'polite');
        say.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;' +
                            'padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0;';
        document.body.appendChild(say);
      }
      say.textContent = 'The support chat did not load. Press Support again to email ' +
                        SUPPORT_EMAIL + ' instead.';
    }

    function markReady() {
      if (ready) { return; }
      ready = true;
      setState(null);
      if (wantOpen) {
        wantOpen = false;
        if (!openNow()) { giveUp(); }
      }
    }

    /* The widget arrives asynchronously, so watch for its event
       interface and subscribe the moment it exists, and watch the
       document for the panel in case the event never comes. */
    /* The deadline is WALL CLOCK, not a count of ticks. A browser
       throttles setInterval in a background tab, to once a second and
       harder after a few minutes, so counting 250 per tick made the
       fifteen second deadline arrive after sixty real seconds or more
       in any tab the reader was not looking at. Caught by testing the
       failure path against an unreachable vendor host rather than
       reasoning about it. */
    var deadline = Date.now() + READY_TIMEOUT_MS;
    var poll = window.setInterval(function () {
      if (!listening && window.botpress && typeof window.botpress.on === 'function') {
        listening = true;
        try { window.botpress.on('webchat:ready', markReady); }
        catch (err) { /* vendor changed its interface: the panel check covers it */ }
      }
      if (!ready && panelExists()) { markReady(); }
      if (ready || Date.now() >= deadline) {
        window.clearInterval(poll);
        /* Fifteen seconds with neither signal means blocked, offline
           or broken. Only speak up if somebody actually asked for the
           chat; an unpressed button says nothing. */
        if (!ready && wantOpen) { giveUp(); }
      }
    }, 250);

    Array.prototype.forEach.call(triggers, function (trigger) {
      trigger.addEventListener('click', function (event) {
        event.preventDefault();
        if (gaveUp) { window.location.href = 'mailto:' + SUPPORT_EMAIL; return; }
        if (openNow()) { setState(null); return; }
        /* Not ready yet. Arm the deferred open AND show it: the
           pending state is what turns a swallowed click into a
           received one. */
        wantOpen = true;
        setState('pending');
      });
    });
  }

  /* ----------------------------------------------------------
     3. START
     ---------------------------------------------------------- */

  function start() {
    pinPalette();
    initDisclosure();
    initSupport();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
