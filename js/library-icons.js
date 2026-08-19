/* ============================================================
   Orvanna Conductor Library: the sixteen product marks.

   ONE copy, shared by library.html (the index grid) and
   library-agent.html (the detail template), for the same reason
   the prices live only in catalog.js: two copies of the same
   thing drift, and artwork drifting between the index card and
   the page it opens would look like a bug to a reader.

   Every mark is the brand hexagon with one glyph inside it, and
   the sixteen are drawn to be told apart at a glance rather than
   to decorate. The frame and the glyph take currentColor, which
   the pages set from the --icon token; the single lit element
   takes --icon-lit. Both tokens restate with the theme, so the
   marks follow the theme without being redrawn.

   Keyed by the same sku as catalog.js. If a product is ever
   added there, add its mark here; library.html reports a missing
   mark rather than drawing a blank card.
   ============================================================ */

window.ORVANNA_LIBRARY_ICONS = (function () {
  'use strict';

  /* THE SHARED HEXAGON FRAME WAS DROPPED 2026-08-19.

     Sixteen marks each wrapped in the same polygon is sixteen identical
     hexagons: the frame was the loudest shape in every cell, so the set
     could not be told apart at a glance, which is the one job an index
     of sixteen has. The glyphs are untouched -- they do the telling
     apart now.

     Dropped in BOTH copies. This project had two: this one, and
     hexIcon() in the other file. Removing one would have left the same
     sixteen marks framed on one page and unframed on the next, which a
     customer moving from the Library to the Shop sees immediately. */

  function mark(glyph) {
    return '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' + glyph + '</svg>';
  }

  return {

    /* ----- domain agents ----- */

    /* a card with a magnetic stripe and a lit chip */
    payment: mark(
      '<rect x="20" y="24" width="24" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/>' +
      '<line x1="20" y1="30" x2="44" y2="30" stroke="currentColor" stroke-width="2.4"/>' +
      '<rect x="24" y="34" width="8" height="4" rx="1.2" fill="var(--icon-lit)"/>'),

    /* a parcel on a van body, two wheels */
    shipping: mark(
      '<path d="M 19 36 h 15 v -10 h -15 z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M 34 30 h 6 l 5 4.5 v 1.5 h -11 z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<circle cx="25" cy="40" r="2.6" fill="var(--icon-lit)"/>' +
      '<circle cx="39" cy="40" r="2.6" fill="currentColor"/>'),

    /* a price tag with a lit eyelet */
    pricing: mark(
      '<path d="M 43 21 v 9 l -13 13 l -9 -9 l 13 -13 z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<circle cx="38.5" cy="25.5" r="2.5" fill="var(--icon-lit)"/>'),

    /* three stacked cartons */
    inventory: mark(
      '<rect x="21" y="33" width="9.5" height="9.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<rect x="33.5" y="33" width="9.5" height="9.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<rect x="27.25" y="21.5" width="9.5" height="9.5" fill="none" stroke="var(--icon-lit)" stroke-width="2.4" stroke-linejoin="round"/>'),

    /* a lit source broadcasting two arcs */
    marketing: mark(
      '<circle cx="25" cy="32" r="3" fill="var(--icon-lit)"/>' +
      '<path d="M 31 24 a 10.5 10.5 0 0 1 0 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path d="M 36.5 19.5 a 16.5 16.5 0 0 1 0 25" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),

    /* a filed return: folded corner, a rule, a lit seal */
    tax: mark(
      '<path d="M 23 20 h 11 l 7 7 v 17 h -18 z" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/>' +
      '<path d="M 34 20 v 7 h 7" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/>' +
      '<line x1="26.5" y1="32" x2="37.5" y2="32" stroke="currentColor" stroke-width="2"/>' +
      '<circle cx="32" cy="38.5" r="3.4" fill="var(--icon-lit)"/>'),

    /* ----- support agents ----- */

    /* angle brackets around a lit slash */
    engineer: mark(
      '<path d="M 26 25 L 19.5 32 L 26 39" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M 38 25 L 44.5 32 L 38 39" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<line x1="34.5" y1="23" x2="29.5" y2="41" stroke="var(--icon-lit)" stroke-width="2.6" stroke-linecap="round"/>'),

    /* a pass mark, the whole glyph lit */
    qa: mark(
      '<path d="M 21 32.5 L 28.5 40 L 43 24" fill="none" stroke="var(--icon-lit)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'),

    /* a calendar with one lit day */
    secretary: mark(
      '<rect x="21" y="23" width="22" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/>' +
      '<line x1="21" y1="29.5" x2="43" y2="29.5" stroke="currentColor" stroke-width="2.2"/>' +
      '<line x1="27" y1="20" x2="27" y2="25" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
      '<line x1="37" y1="20" x2="37" y2="25" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
      '<rect x="25" y="33.5" width="6" height="5" rx="1.2" fill="var(--icon-lit)"/>'),

    /* a fixed star: the thing you steer by */
    executive: mark(
      '<path d="M 32 19 L 34.8 29.2 L 45 32 L 34.8 34.8 L 32 45 L 29.2 34.8 L 19 32 L 29.2 29.2 Z" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/>' +
      '<circle cx="32" cy="32" r="2.8" fill="var(--icon-lit)"/>'),

    /* three columns on a baseline, the middle one lit */
    accounting: mark(
      '<line x1="20.5" y1="44" x2="43.5" y2="44" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
      '<line x1="25" y1="40" x2="25" y2="32" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>' +
      '<line x1="32" y1="40" x2="32" y2="24" stroke="var(--icon-lit)" stroke-width="3.2" stroke-linecap="round"/>' +
      '<line x1="39" y1="40" x2="39" y2="28" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>'),

    /* a headset, one lit ear cup */
    care: mark(
      '<path d="M 23 36 v -3.5 a 9 9 0 0 1 18 0 V 36" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
      '<rect x="20.5" y="34" width="5" height="8.5" rx="2.4" fill="currentColor"/>' +
      '<rect x="38.5" y="34" width="5" height="8.5" rx="2.4" fill="var(--icon-lit)"/>'),

    /* ----- the bundle ----- */

    /* one lit hub over three open nodes: a manager and a trio */
    manager: mark(
      '<line x1="32" y1="26" x2="22.5" y2="37.5" stroke="currentColor" stroke-width="2.2"/>' +
      '<line x1="32" y1="26" x2="32" y2="39" stroke="currentColor" stroke-width="2.2"/>' +
      '<line x1="32" y1="26" x2="41.5" y2="37.5" stroke="currentColor" stroke-width="2.2"/>' +
      '<circle cx="32" cy="22.5" r="4" fill="var(--icon-lit)"/>' +
      '<circle cx="21.5" cy="40" r="3.2" fill="none" stroke="currentColor" stroke-width="2.4"/>' +
      '<circle cx="32" cy="42.5" r="3.2" fill="none" stroke="currentColor" stroke-width="2.4"/>' +
      '<circle cx="42.5" cy="40" r="3.2" fill="none" stroke="currentColor" stroke-width="2.4"/>'),

    /* ----- the packs ----- */

    /* an upward stroke off a lit launch line */
    ignition: mark(
      '<path d="M 23 32 L 32 21 L 41 32" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<line x1="32" y1="22" x2="32" y2="37" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>' +
      '<line x1="24" y1="43" x2="40" y2="43" stroke="var(--icon-lit)" stroke-width="3" stroke-linecap="round"/>'),

    /* two chevrons, the leading one lit: forward motion */
    momentum: mark(
      '<path d="M 22 23 L 31 32 L 22 41" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M 33 23 L 42 32 L 33 41" fill="none" stroke="var(--icon-lit)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'),

    /* a lit centre wired to six satellites: the full formation */
    constellation: mark(
      '<line x1="32" y1="32" x2="32" y2="21" stroke="currentColor" stroke-width="1.6"/>' +
      '<line x1="32" y1="32" x2="41.5" y2="26.5" stroke="currentColor" stroke-width="1.6"/>' +
      '<line x1="32" y1="32" x2="41.5" y2="37.5" stroke="currentColor" stroke-width="1.6"/>' +
      '<line x1="32" y1="32" x2="32" y2="43" stroke="currentColor" stroke-width="1.6"/>' +
      '<line x1="32" y1="32" x2="22.5" y2="37.5" stroke="currentColor" stroke-width="1.6"/>' +
      '<line x1="32" y1="32" x2="22.5" y2="26.5" stroke="currentColor" stroke-width="1.6"/>' +
      '<circle cx="32" cy="21" r="2.4" fill="currentColor"/>' +
      '<circle cx="41.5" cy="26.5" r="2.4" fill="currentColor"/>' +
      '<circle cx="41.5" cy="37.5" r="2.4" fill="currentColor"/>' +
      '<circle cx="32" cy="43" r="2.4" fill="currentColor"/>' +
      '<circle cx="22.5" cy="37.5" r="2.4" fill="currentColor"/>' +
      '<circle cx="22.5" cy="26.5" r="2.4" fill="currentColor"/>' +
      '<circle cx="32" cy="32" r="4" fill="var(--icon-lit)"/>')
  };
})();
