/* ════════════════════════════════════════════════
   FERRUM — interaction engine
   fake-scroll smoothing · manual pinning · fills
   ════════════════════════════════════════════════ */
(() => {
  "use strict";

  const doc = document.documentElement;
  const smooth = document.getElementById("smooth");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ───────── state ───────── */
  let vh = innerHeight;
  let target = 0;      // native scroll position
  let current = 0;     // smoothed position
  let velocity = 0;
  const LERP = reduceMotion ? 1 : 0.09;

  /* ═══════════ CHAPTER DATA ═══════════ */
  const CHAPTERS = [
    {
      steps: [
        { t: "Ore",   cap: "FIG. 01 — HEMATITE, RAW",
          d: "Everything begins as rock. Hematite and magnetite — banded relics of ancient oceans — are mined, crushed and sintered into pellets: the raw grammar of the metallic age." },
        { t: "Fire",  cap: "FIG. 02 — TAP, 1,538 °C",
          d: "At 1,538 °C iron surrenders. The blast furnace strips oxygen away with carbon; the melt runs white, saturated and alive, tapped in rivers of light." },
        { t: "Alloy", cap: "FIG. 03 — FERROCHROME, FRACTURED",
          d: "Chemistry becomes property. A fraction of a percent of carbon decides whether steel bends, springs or shatters — and a chromium chunk like this is where stainless begins." },
      ],
    },
    {
      steps: [
        { t: "Hydrogen DRI", cap: "FIG. 01 — H₂ SHAFT, DAWN",
          d: "Hydrogen strips oxygen from ore and exhales water instead of CO₂. HYBRIT, Stegra and a wave of new plants are aimed at steel's ~7% share of global emissions." },
        { t: "Electrolysis", cap: "FIG. 02 — MOLTEN OXIDE CELL",
          d: "Boston Metal runs current straight through molten ore at 1,600 °C — iron with zero carbon, the way aluminium was set free in 1886." },
        { t: "High-Entropy", cap: "FIG. 03 — FIVE-METAL LATTICE",
          d: "Equal parts of five metals produce lattices nature never tried — cryogenic toughness, furnace-proof strength. Computation now searches trillions of recipes." },
        { t: "Printed Metal", cap: "FIG. 04 — POWDER, 15–45 µm",
          d: "Wire-arc and powder-bed printers grow turbine blades and whole bridges layer by layer — single-crystal precision with no mould at all." },
      ],
    },
  ];

  /* ═══════════ MEASUREMENT ═══════════ */
  const pins = [];      // {el, stage, top, range, steps, idx, chapterData}
  const reveals = [];   // {el, top, done}
  const fills = [];     // {el, words, top, height, lit}
  const fillChain = []; // thesis paragraphs — filled as one continuous sequence
  const parallaxes = [];// {el, top, height, factor}
  const sections = [];  // {el, top, label, navSel}
  const covers = [];    // {incomingTop, prev} — prev recedes while next slides over
  const grows = [];     // {el, top} — cards scaling 0.88 → 1 on entry
  const iparallax = []; // {img, top, h} — inner image drift
  let heroPin = null;   // {el, card, logo, h} — hero stays put while thesis covers it
  let thesisPin = null; // thesis hold — fill chain completes before release
  let stackPills = [];  // interlude pill choreography

  const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  /* wrap <br>-separated lines of [data-lines] headings in overflow masks */
  function splitLines(el) {
    if (el.dataset.linesReady) return;
    el.dataset.linesReady = "1";
    const lines = [[]];
    [...el.childNodes].forEach((n) => {
      if (n.nodeName === "BR") lines.push([]);
      else lines[lines.length - 1].push(n.cloneNode(true));
    });
    el.innerHTML = "";
    lines.forEach((nodes) => {
      const outer = document.createElement("span");
      outer.className = "line";
      const inner = document.createElement("span");
      inner.className = "line__inner";
      nodes.forEach((n) => inner.appendChild(n));
      outer.appendChild(inner);
      el.appendChild(outer);
    });
  }

  const offsetOf = (el) => {
    const r = el.getBoundingClientRect();
    const s = smooth.getBoundingClientRect();
    return r.top - s.top;
  };

  function measure() {
    vh = innerHeight;

    // clear motion transforms so cached offsets reflect the untransformed layout
    document.querySelectorAll(".hero, [data-grow], .chapter__media").forEach((el) => { el.style.transform = ""; });
    document.querySelectorAll(".hero__card, .is-coverable").forEach((el) => el.style.setProperty("--cover", 0));

    // pinned chapters: give them their scroll runway first
    // 160vh per step so each state lingers instead of flashing past
    document.querySelectorAll("[data-pin]").forEach((el) => {
      const steps = +el.dataset.steps || 1;
      el.style.height = steps * 160 + "vh";
    });
    // thesis hold: one screen plus fill runway
    const thesisEl = document.querySelector("[data-pin-thesis]");
    if (thesisEl) thesisEl.style.height = "270vh";
    const inter = document.querySelector(".interlude");

    // body height = content height
    document.body.style.height = smooth.scrollHeight + "px";

    pins.length = 0;
    document.querySelectorAll("[data-pin]").forEach((el, i) => {
      const stage = el.querySelector(".chapter__stage");
      const top = offsetOf(el);
      const range = el.offsetHeight - vh;
      pins.push({
        el, stage, top, range,
        media: el.querySelector(".chapter__media"),
        steps: +el.dataset.steps || 1,
        idx: -1,
        data: CHAPTERS[i] || null,
      });
    });
    if (inter) {
      const stack = inter.querySelector(".interlude__stack");
      pins.push({ el: inter, stage: stack, top: offsetOf(inter), range: inter.offsetHeight - vh, steps: 1, idx: -1, data: null });
    }
    thesisPin = null;
    if (thesisEl) {
      thesisPin = {
        el: thesisEl,
        stage: thesisEl.querySelector(".thesis-stage"),
        top: offsetOf(thesisEl),
        range: thesisEl.offsetHeight - vh,
        steps: 1, idx: -1, data: null,
        y: 0,
      };
      pins.push(thesisPin);
    }

    document.querySelectorAll("[data-lines]").forEach(splitLines);

    reveals.length = 0;
    document.querySelectorAll("[data-reveal], .section__meta").forEach((el) => {
      reveals.push({ el, top: offsetOf(el), done: el.classList.contains("is-in") });
    });

    // cascade delays for list-like reveals
    ["mile__row", "apps__row", "spec__card", "fact"].forEach((cls) => {
      document.querySelectorAll("." + cls).forEach((el, i) => {
        el.style.transitionDelay = `${Math.min(i % 7, 5) * 0.07}s`;
      });
    });

    // inner image drift for specimen frames
    iparallax.length = 0;
    document.querySelectorAll(".spec__frame").forEach((frame) => {
      const img = frame.querySelector("img");
      if (img) iparallax.push({ img, top: offsetOf(frame), h: frame.offsetHeight });
    });

    fills.length = 0;
    fillChain.length = 0;
    document.querySelectorAll("[data-fill]").forEach((el) => {
      if (!el.dataset.split) {
        const words = el.textContent.trim().split(/\s+/);
        el.innerHTML = words
          .map((w) => `<span class="w${/reinvented|carbon/.test(w) ? " hot-mark" : ""}">${w}</span>`)
          .join(" ");
        el.dataset.split = "1";
      }
      fills.push({
        el,
        words: [...el.querySelectorAll(".w")],
        top: offsetOf(el),
        height: el.offsetHeight,
        lit: -1,
      });
    });
    // thesis paragraphs run as one chain: the second starts only after the first completes
    fillChain.push(...fills.filter((f) => f.el.closest(".thesis")).sort((a, b) => a.top - b.top));

    parallaxes.length = 0;
    document.querySelectorAll("[data-parallax]").forEach((el) => {
      const host = el.closest("section, .interlude") || el;
      parallaxes.push({ el, top: offsetOf(host), height: host.offsetHeight, factor: +el.dataset.parallax || 0.15 });
    });

    sections.length = 0;
    document.querySelectorAll("[data-section-label]").forEach((el) => {
      sections.push({ el, top: offsetOf(el), label: el.dataset.sectionLabel, id: el.id ? "#" + el.id : null });
    });
    sections.sort((a, b) => a.top - b.top);

    // hero pin — the card holds still while the next section slides over it
    const heroSec = document.querySelector(".hero");
    heroPin = heroSec
      ? { el: heroSec, card: heroSec.querySelector(".hero__card"), logo: heroSec.querySelector(".hero__logo"), h: heroSec.offsetHeight }
      : null;

    stackPills = [...document.querySelectorAll(".interlude .stackpill")];

    // cover pairs — incoming element declares which section it buries
    covers.length = 0;
    document.querySelectorAll("[data-cover]").forEach((el) => {
      const prev = document.querySelector(el.dataset.cover);
      if (!prev) return;
      prev.classList.add("is-coverable");
      covers.push({ prev, top: offsetOf(el) });
    });

    // grow-in cards
    grows.length = 0;
    document.querySelectorAll("[data-grow]").forEach((el) => {
      grows.push({ el, top: offsetOf(el) });
    });
  }

  /* ═══════════ PIN STEP SWAP ═══════════ */
  function applyStep(pin, idx) {
    if (!pin.data || idx === pin.idx) return;
    const first = pin.idx === -1;
    pin.idx = idx;
    const step = pin.data.steps[idx];
    const scope = pin.el;
    const swap = scope.querySelector(".chapter__titleSwap");
    const desc = scope.querySelector(".chapter__desc");
    const cap = scope.querySelector(".chapter__capText");
    const imgs = scope.querySelectorAll(".chapter__img");

    // desc words get a scroll-driven tint sweep (ghost → accent → ink)
    const setDesc = () => {
      desc.innerHTML = step.d
        .split(/\s+/)
        .map((w) => `<span class="cw">${w}</span>`)
        .join(" ");
      pin.descWords = [...desc.querySelectorAll(".cw")];
      pin.lastLit = -1;
    };

    imgs.forEach((img, i) => img.classList.toggle("is-active", i === idx));

    if (first) {
      swap.textContent = step.t;
      setDesc();
      cap.textContent = step.cap;
      return;
    }
    swap.classList.remove("is-inn");
    swap.classList.add("is-out");
    desc.classList.add("is-out");
    setTimeout(() => {
      swap.textContent = step.t;
      setDesc();
      cap.textContent = step.cap;
      swap.classList.remove("is-out");
      swap.classList.add("is-inn");
      desc.classList.remove("is-out");
      setTimeout(() => swap.classList.remove("is-inn"), 500);
    }, 380);
  }

  /* ═══════════ NAV / CONTEXT ═══════════ */
  const contextPill = document.getElementById("contextPill");
  const contextLabel = document.getElementById("contextLabel");
  const navItems = [...document.querySelectorAll(".pill-group__item")];
  let currentLabel = "Intro";

  function setContext(label, id) {
    if (label === currentLabel) return;
    currentLabel = label;
    contextPill.classList.add("is-swapping");
    setTimeout(() => {
      contextLabel.textContent = label;
      contextPill.classList.remove("is-swapping");
    }, 220);
    navItems.forEach((a) => {
      const href = a.getAttribute("href");
      a.classList.toggle(
        "is-active",
        href !== "#contact" && id !== null &&
        ((href === "#foundations" && (id === "#foundations")) ||
         (href === "#timeline" && id === "#timeline") ||
         (href === "#frontier" && (id === "#frontier" || id === "#applications")))
      );
    });
  }

  /* ═══════════ MAIN LOOP ═══════════ */
  let lastCurrent = 0;
  let marqueeX = 0;
  const marquee = document.getElementById("marqueeTrack");
  let marqueeHalf = 0;
  const progressBar = document.getElementById("progressBar");

  // normalized mouse (lerped) for hero parallax
  let mTX = 0, mTY = 0, mX = 0, mY = 0;
  addEventListener("mousemove", (e) => {
    mTX = (e.clientX / innerWidth) * 2 - 1;
    mTY = (e.clientY / innerHeight) * 2 - 1;
  });

  function frame() {
    target = scrollY;
    current += (target - current) * LERP;
    if (Math.abs(target - current) < 0.05) current = target;
    velocity = current - lastCurrent;
    lastCurrent = current;

    smooth.style.transform = `translate3d(0, ${-current.toFixed(2)}px, 0)`;


    // hero pin + cover-out (thesis slides over the frozen hero card)
    if (heroPin) {
      const py = Math.min(current, heroPin.h);
      heroPin.el.style.transform = `translate3d(0, ${py.toFixed(2)}px, 0)`;
      heroPin.card.style.setProperty("--cover", clamp01(current / (heroPin.h * 0.92)).toFixed(3));
      // gentle mouse parallax on the logotype while the hero is on screen
      mX += (mTX - mX) * 0.06;
      mY += (mTY - mY) * 0.06;
      if (heroPin.logo && current < heroPin.h) {
        heroPin.logo.style.transform = `translate3d(${(mX * 14).toFixed(2)}px, ${(mY * 10).toFixed(2)}px, 0)`;
      }
    }

    // cover pairs — previous section sinks & washes out as the next arrives
    for (const c of covers) {
      const p = clamp01((current + vh - c.top) / vh);
      c.prev.style.setProperty("--cover", p.toFixed(3));
    }

    // grow-in cards — scale 0.88 → 1 while entering the viewport
    for (const g of grows) {
      const p = clamp01((current + vh - g.top) / (vh * 0.85));
      const s = 0.88 + 0.12 * easeOutCubic(p);
      g.el.style.transform = `scale(${s.toFixed(4)})`;
    }

    // pins
    for (const pin of pins) {
      const y = Math.min(Math.max(current - pin.top, 0), Math.max(pin.range, 0));
      pin.y = y;
      pin.stage.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
      if (pin.data && pin.range > 0) {
        const p = y / pin.range;
        const exact = p * pin.steps;
        const idx = Math.min(pin.steps - 1, Math.floor(exact));
        applyStep(pin, idx);
        // tint sweep: words go ghost → accent (frontier band) → ink within each step;
        // the frontier travels band-width past the end so every word settles to ink
        if (pin.descWords && pin.descWords.length) {
          const within = clamp01((exact - idx) / 0.8);
          const n = pin.descWords.length;
          const band = Math.max(2, Math.round(n * 0.24));
          const lit = Math.round(within * (n + band));
          if (lit !== pin.lastLit) {
            pin.lastLit = lit;
            pin.descWords.forEach((w, i) => {
              w.classList.toggle("is-lit", i < lit - band);
              w.classList.toggle("is-hot", i >= lit - band && i < lit);
            });
          }
        }
      }
      // media grows slightly as the chapter approaches
      if (pin.media) {
        const ap = clamp01((current + vh - pin.top) / vh);
        pin.media.style.transform = `scale(${(0.9 + 0.1 * easeOutCubic(ap)).toFixed(4)})`;
      }
      // interlude: pills pop in one by one, drifting at different speeds
      if (!pin.data && stackPills.length && pin.el.classList.contains("interlude")) {
        const pr = clamp01((current - (pin.top - vh)) / (pin.range + vh));
        stackPills.forEach((pill, i) => {
          const pi = clamp01(pr * 2.4 - i * 0.28);
          const e = easeOutCubic(pi);
          const drift = (1 - e) * (150 + i * 90);
          const rot = (1 - e) * (i % 2 ? 5 : -5);
          pill.style.opacity = Math.min(1, pi * 1.6).toFixed(3);
          pill.style.transform =
            `translate3d(0, ${drift.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${(0.72 + 0.28 * e).toFixed(4)})`;
        });
      }
    }

    // inner image drift (specimen frames)
    for (const ip of iparallax) {
      const rel = clamp01((current + vh - ip.top) / (vh + ip.h));
      ip.img.style.transform = `translate3d(0, ${(-rel * 13).toFixed(2)}%, 0)`;
    }

    // top progress bar
    if (progressBar) {
      const total = Math.max(document.body.scrollHeight - vh, 1);
      progressBar.style.transform = `scaleX(${clamp01(current / total).toFixed(4)})`;
    }

    // reveals
    const revealLine = current + vh * 0.9;
    for (const r of reveals) {
      if (!r.done && r.top < revealLine) {
        r.done = true;
        r.el.classList.add("is-in");
        r.el.querySelectorAll?.(".hl").forEach?.((h) => h.classList.add("is-lit"));
        if (r.el.querySelector("[data-count]") || r.el.matches?.(".fact")) startCount(r.el);
      }
    }
    // hl outside reveals (chapter keepers)
    for (const h of hlWatch) {
      if (!h.done && h.top < current + vh * 0.75) { h.done = true; h.el.classList.add("is-lit"); }
    }

    // word fills — chained paragraphs share one progress, filling in sequence.
    // driven by the thesis hold: words finish at 85% of the pin, then it releases
    if (fillChain.length) {
      let p;
      if (thesisPin && thesisPin.range > 0) {
        p = clamp01(thesisPin.y / (thesisPin.range * 0.85));
      } else {
        const first = fillChain[0];
        const last = fillChain[fillChain.length - 1];
        const start = first.top - vh * 0.85;
        const end = last.top - vh * 0.25 + last.height;
        p = clamp01((current - start) / (end - start));
      }
      const total = fillChain.reduce((s, f) => s + f.words.length, 0);
      let remaining = Math.round(p * total);
      for (const f of fillChain) {
        const lit = Math.max(0, Math.min(f.words.length, remaining));
        remaining -= f.words.length;
        if (lit !== f.lit) {
          f.lit = lit;
          f.words.forEach((w, i) => {
            w.classList.toggle("is-lit", i < lit);
            if (w.classList.contains("hot-mark")) w.classList.toggle("is-hot", i < lit);
          });
        }
      }
    }
    // any standalone fills keep their own local progress
    for (const f of fills) {
      if (fillChain.includes(f)) continue;
      const start = f.top - vh * 0.85;
      const end = f.top - vh * 0.25 + f.height;
      const p = clamp01((current - start) / (end - start));
      const lit = Math.round(p * f.words.length);
      if (lit !== f.lit) {
        f.lit = lit;
        f.words.forEach((w, i) => {
          w.classList.toggle("is-lit", i < lit);
          if (w.classList.contains("hot-mark")) w.classList.toggle("is-hot", i < lit);
        });
      }
    }

    // parallax
    for (const p of parallaxes) {
      const rel = (current + vh - p.top) / (p.height + vh);
      if (rel > -0.1 && rel < 1.1) {
        const shift = (rel - 0.5) * p.height * p.factor;
        p.el.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0)`;
      }
    }

    // context label
    let active = sections[0];
    for (const s of sections) if (current + vh * 0.4 >= s.top) active = s;
    if (active) setContext(active.label, active.id);

    // marquee — speed and skew react to scroll velocity
    if (marquee) {
      if (!marqueeHalf) marqueeHalf = marquee.scrollWidth / 2;
      marqueeX -= 0.6 + Math.min(Math.abs(velocity) * 0.12, 6);
      if (marqueeX <= -marqueeHalf) marqueeX += marqueeHalf;
      const skew = Math.max(-9, Math.min(9, velocity * 0.3));
      marquee.style.transform = `translate3d(${marqueeX.toFixed(2)}px, 0, 0) skewX(${skew.toFixed(2)}deg)`;
    }

    requestAnimationFrame(frame);
  }

  /* highlight pills tied to position, not data-reveal */
  const hlWatch = [];
  function measureHl() {
    hlWatch.length = 0;
    document.querySelectorAll(".chapter .hl").forEach((el) => {
      hlWatch.push({ el, top: offsetOf(el), done: el.classList.contains("is-lit") });
    });
  }

  /* ═══════════ COUNTERS ═══════════ */
  function startCount(scope) {
    const el = scope.matches("[data-count]") ? scope : scope.querySelector("[data-count]");
    if (!el || el.dataset.counted) return;
    el.dataset.counted = "1";
    const end = +el.dataset.count;
    const dur = 1400;
    const t0 = performance.now();
    (function tick(t) {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 4);
      el.textContent = Math.round(end * eased).toLocaleString("en-US");
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  /* ═══════════ PRELOADER ═══════════ */
  const loader = document.getElementById("loader");
  const loaderCount = document.getElementById("loaderCount");
  const loaderBar = document.getElementById("loaderBar");
  document.body.classList.add("is-locked");

  function runLoader() {
    const dur = reduceMotion ? 10 : 1700;
    const t0 = performance.now();
    (function tick(t) {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const n = Math.round(eased * 100);
      loaderCount.textContent = n;
      loaderBar.style.width = n + "%";
      if (p < 1) requestAnimationFrame(tick);
      else {
        setTimeout(() => {
          loader.classList.add("is-done");
          document.body.classList.remove("is-locked");
          document.body.classList.add("is-ready");
          setTimeout(() => loader.remove(), 1000);
        }, 250);
      }
    })(t0);
  }

  /* ═══════════ CURSOR + TAG ═══════════ */
  const cursor = document.getElementById("cursor");
  const cursorTag = document.getElementById("cursorTag");
  if (matchMedia("(hover: hover)").matches) {
    let cx = -100, cy = -100, tx = -100, ty = -100;
    addEventListener("mousemove", (e) => { tx = e.clientX; ty = e.clientY; });
    addEventListener("mousedown", () => cursor.classList.add("is-down"));
    addEventListener("mouseup", () => cursor.classList.remove("is-down"));
    (function moveCursor() {
      cx += (tx - cx) * 0.22;
      cy += (ty - cy) * 0.22;
      cursor.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      cursorTag.style.transform =
        `translate3d(${(cx + 20).toFixed(1)}px, ${(cy + 22).toFixed(1)}px, 0) scale(${cursorTag.classList.contains("is-on") ? 1 : 0.6})`;
      requestAnimationFrame(moveCursor);
    })();
    document.addEventListener("mouseover", (e) => {
      cursor.classList.toggle("is-hover", !!e.target.closest("[data-hover], a, button"));
      const tagged = e.target.closest("[data-cursor]");
      if (tagged) { cursorTag.textContent = tagged.dataset.cursor; cursorTag.classList.add("is-on"); }
      else cursorTag.classList.remove("is-on");
    });
  }

  /* ═══════════ MAGNETIC ELEMENTS ═══════════ */
  if (matchMedia("(hover: hover)").matches && !reduceMotion) {
    document.querySelectorAll("[data-magnet]").forEach((el) => {
      el.addEventListener("mousemove", (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        // cap the pull so wide elements don't fly off under the cursor
        const mx = Math.max(-14, Math.min(14, dx * 0.28));
        const my = Math.max(-10, Math.min(10, dy * 0.34));
        el.style.transform = `translate3d(${mx.toFixed(1)}px, ${my.toFixed(1)}px, 0)`;
      });
      el.addEventListener("mouseleave", () => { el.style.transform = ""; });
    });
  }

  /* ═══════════ TEXT ROLLOVER ═══════════ */
  document.querySelectorAll("[data-roll]").forEach((el) => {
    const label = el.textContent.trim();
    el.innerHTML = `<span class="roll"><span>${label}</span><span aria-hidden="true">${label}</span></span>`;
  });

  /* ═══════════ NAV CLICKS (smooth to anchor) ═══════════ */
  document.querySelectorAll("[data-nav]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const sel = a.dataset.nav;
      const targetEl = sel === "#top" ? null : document.querySelector(sel);
      const y = targetEl ? offsetOf(targetEl) - 10 : 0;
      scrollTo({ top: y, behavior: reduceMotion ? "auto" : "smooth" });
    });
  });
  document.getElementById("scrollCue")?.addEventListener("click", () => {
    scrollTo({ top: offsetOf(document.getElementById("thesis")), behavior: "smooth" });
  });

  /* ═══════════ QUESTIONS — folder tabs + answer card ═══════════ */
  const qcard = document.querySelector(".qcard");
  const slides = [...document.querySelectorAll(".qcard__slide")];
  const qtabs = [...document.querySelectorAll(".qtab")];
  const qPanel = document.getElementById("qPanel");
  const qPanelLabel = document.getElementById("qPanelLabel");
  const qPanelText = document.getElementById("qPanelText");
  const qRead = document.getElementById("qRead");
  const PANEL_SKINS = ["", "qcard__panel--steel", "qcard__panel--lilac"];
  const TAB_DOTS = ["var(--ember)", "#5f83b5", "#8a67d8"];
  let qi = 0;

  function syncPanel() {
    const answer = slides[qi].querySelector(".qcard__a").textContent.trim();
    // word spans → staggered blur reveal on open
    qPanelText.innerHTML = answer
      .split(/\s+/)
      .map((w, i) => `<span class="pw" style="--i:${i}">${w}</span>`)
      .join(" ");
    qPanelLabel.textContent = `ANSWER 0${qi + 1}/0${slides.length}`;
    qPanel.classList.remove(...PANEL_SKINS.filter(Boolean));
    if (PANEL_SKINS[qi]) qPanel.classList.add(PANEL_SKINS[qi]);
    qtabs.forEach((t, i) => {
      t.classList.toggle("is-active", i === qi);
      t.setAttribute("aria-selected", i === qi ? "true" : "false");
      t.style.setProperty("--qdot", TAB_DOTS[i]);
    });
  }
  function closeAnswer() {
    qcard.classList.remove("show-answer");
    qRead.textContent = "READ ANSWER";
  }
  function openAnswer() {
    syncPanel();
    qcard.classList.add("show-answer");
    qRead.textContent = "HIDE ANSWER";
  }
  function goQ(dir, keepOpen) {
    const wasOpen = qcard.classList.contains("show-answer");
    closeAnswer();
    slides[qi].classList.remove("is-active");
    qi = (qi + dir + slides.length) % slides.length;
    slides[qi].classList.add("is-active");
    syncPanel();
    if (keepOpen && wasOpen) openAnswer();
  }
  function goTo(idx) {
    if (idx === qi) return;
    closeAnswer();
    slides[qi].classList.remove("is-active");
    qi = idx;
    slides[qi].classList.add("is-active");
    syncPanel();
  }
  // arrow icon fly-through: clone each arrow's icon so hover swaps them
  document.querySelectorAll(".qcard__arrow").forEach((btn) => {
    const svg = btn.querySelector("svg");
    if (!svg) return;
    const clone = svg.cloneNode(true);
    clone.classList.add("clone");
    clone.setAttribute("aria-hidden", "true");
    btn.appendChild(clone);
  });
  ["qPrev", "qPrevIn"].forEach((id) =>
    document.getElementById(id)?.classList.add("qcard__arrow--prev")
  );

  qtabs.forEach((t) => t.addEventListener("click", () => goTo(+t.dataset.q)));
  document.getElementById("qNext").addEventListener("click", () => goQ(1));
  document.getElementById("qPrev").addEventListener("click", () => goQ(-1));
  document.getElementById("qNextIn").addEventListener("click", () => goQ(1, true));
  document.getElementById("qPrevIn").addEventListener("click", () => goQ(-1, true));
  document.getElementById("qClose").addEventListener("click", closeAnswer);
  qRead.addEventListener("click", () => {
    qcard.classList.contains("show-answer") ? closeAnswer() : openAnswer();
  });
  syncPanel();

  /* ═══════════ NAV BLOB (hover follower in the pill group) ═══════════ */
  const pillGroup = document.getElementById("pillGroup");
  const pillBlob = document.getElementById("pillBlob");
  if (pillGroup && pillBlob && matchMedia("(hover: hover)").matches) {
    pillGroup.querySelectorAll(".pill-group__item").forEach((item) => {
      item.addEventListener("mouseenter", () => {
        pillBlob.style.transform = `translateX(${item.offsetLeft}px)`;
        pillBlob.style.width = item.offsetWidth + "px";
        pillGroup.classList.add("blob-on");
      });
    });
    pillGroup.addEventListener("mouseleave", () => pillGroup.classList.remove("blob-on"));
  }

  /* ═══════════ IMAGE FALLBACK ═══════════ */
  document.querySelectorAll("img").forEach((img) => {
    img.addEventListener("error", () => { img.style.opacity = "0"; });
  });

  /* ═══════════ BOOT ═══════════ */
  function remeasure() { measure(); measureHl(); }

  addEventListener("resize", remeasure);
  addEventListener("load", remeasure);
  document.fonts?.ready.then(remeasure);
  document.querySelectorAll("img").forEach((img) => {
    if (!img.complete) img.addEventListener("load", remeasure, { once: true });
  });

  remeasure();
  runLoader();
  requestAnimationFrame(frame);
})();
