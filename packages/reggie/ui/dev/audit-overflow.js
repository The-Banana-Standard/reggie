/**
 * ui/dev/audit-overflow.js — a browser-console check that nothing on the board is painted outside
 * the map stage and that no label is cut off by its own box. Load it from a page under the server:
 *
 *   await import("/ui/dev/audit-overflow.js"); window.__audit();
 *
 * "Outside" means visually outside: an element a scroll container hides is not a defect, so each
 * element is intersected with every clipping ancestor before it is compared with the stage.
 */
// Visual-overflow audit: an element is "drawn outside" only when its painted box escapes every
// ancestor that clips it. A scroll container that hides part of a tall column is not a defect.
window.__audit = function () {
  const clipRect = (el) => {
    let r = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity };
    let p = el.parentElement;
    while (p) {
      const cs = getComputedStyle(p);
      const clips = ["hidden", "auto", "scroll", "clip"].includes(cs.overflowX) || ["hidden", "auto", "scroll", "clip"].includes(cs.overflowY);
      if (clips) {
        const b = p.getBoundingClientRect();
        if (["hidden", "auto", "scroll", "clip"].includes(cs.overflowX)) {
          r.l = Math.max(r.l, b.left);
          r.r = Math.min(r.r, b.right);
        }
        if (["hidden", "auto", "scroll", "clip"].includes(cs.overflowY)) {
          r.t = Math.max(r.t, b.top);
          r.b = Math.min(r.b, b.bottom);
        }
      }
      p = p.parentElement;
    }
    return r;
  };
  const stage = document.getElementById("map-stage").getBoundingClientRect();
  const out = [];
  for (const el of document.querySelectorAll("#map-stage *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    const c = clipRect(el);
    // The part of the element that is actually painted.
    const vis = { l: Math.max(b.left, c.l), t: Math.max(b.top, c.t), r: Math.min(b.right, c.r), b: Math.min(b.bottom, c.b) };
    if (vis.r <= vis.l || vis.b <= vis.t) continue; // fully clipped: nothing painted
    const eps = 1.5;
    if (vis.r > stage.right + eps || vis.l < stage.left - eps || vis.b > stage.bottom + eps || vis.t < stage.top - eps) {
      out.push({ cls: String(el.className?.baseVal ?? el.className).slice(0, 44), tag: el.tagName, box: [Math.round(vis.l), Math.round(vis.t), Math.round(vis.r), Math.round(vis.b)], txt: (el.textContent || "").trim().slice(0, 34) });
    }
  }
  // Text that is clipped by its own box (a label that lost its end).
  const clipped = [];
  for (const el of document.querySelectorAll("#map-stage .btn, #map-stage .chip, #map-stage .board__head-label, #map-stage .board__def, #map-stage .seg__btn, #map-stage .board__card-title, #map-stage .done-row__title")) {
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") {
      clipped.push({ cls: String(el.className).slice(0, 40), txt: (el.textContent || "").trim().slice(0, 40), sw: el.scrollWidth, cw: el.clientWidth });
    }
  }
  return {
    iw: innerWidth,
    ih: innerHeight,
    bodyOverflow: document.documentElement.scrollWidth - innerWidth,
    stage: [Math.round(stage.left), Math.round(stage.top), Math.round(stage.right), Math.round(stage.bottom)],
    outside: out,
    outsideCount: out.length,
    clippedText: clipped,
  };
};
"installed";
