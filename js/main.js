/* ============================================================
   OLV007 - scroll-scrub frame engine
   Load frames near the scroll position, pre-decode, paint to <canvas>
   on scroll via rAF. No <video> seeking → no flick-scroll lag.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- config ---------- */
  var FRAME_COUNT = 145;

  // Serve a lighter, downscaled frame set to phones. The full 1440px frames are
  // overkill for a small screen and - decoded x145 - heavy enough to make iOS
  // Safari evict and re-decode mid-scroll (the classic scrub stutter). The 900px
  // set is still sharp at mobile sizes but ~3x cheaper to decode and hold.
  var isMobile = (window.matchMedia &&
      window.matchMedia("(max-width: 780px), (pointer: coarse)").matches) ||
      Math.min(window.innerWidth, window.innerHeight) <= 820;
  var FRAME_DIR = isMobile ? "/assets/frames/mobile/" : "/assets/frames/";
  // Bump this whenever the frame images are replaced. The frames are cached
  // `immutable` for a year, so reusing the same filenames would otherwise serve
  // stale frames from the browser cache - this query string forces a refetch.
  var FRAME_VERSION = "2";
  var framePath = function (i) {
    return FRAME_DIR + "frame_" + String(i + 1).padStart(4, "0") + ".webp?v=" + FRAME_VERSION;
  };

  // Keep all 145 original frames; request only the first ten on arrival.
  var INITIAL_FRAMES = 10;
  var MAX_REQUESTS = 4;

  /* ---------- elements ---------- */
  var body = document.body;
  var canvas = document.getElementById("frames");
  var ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  var scrub = document.querySelector(".scrub");
  var hero = document.getElementById("hero");
  var scrollCue = document.getElementById("scrollCue");
  var bgScrim = document.getElementById("bgScrim");
  var nav = document.getElementById("nav");
  var loader = document.getElementById("loader");
  var loaderFill = document.getElementById("loaderFill");
  var loaderPct = document.getElementById("loaderPct");



  /* ---------- state ---------- */
  var images = new Array(FRAME_COUNT);
  var pending = [];
  var requested = new Set();
  var activeRequests = 0;
  var renderedFrame = -1;
  var currentFrame = 0;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var cw = 0, ch = 0;          // canvas backing-store size (px)
  var imgW = 1440, imgH = 805; // native frame size (updated from first image)
  var ticking = false;
  var scrubTop = 0, scrubRange = 1; // cached scroll geometry (recomputed on resize)

  /* ---------- canvas sizing (cover fit, DPR aware) ---------- */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = Math.round(canvas.clientWidth * dpr);
    ch = Math.round(canvas.clientHeight * dpr);
    canvas.width = cw;
    canvas.height = ch;
    // re-apply: setting canvas.width resets all context state
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // Cache the scrub's scroll geometry here so the per-frame scroll handler
    // never has to read layout (getBoundingClientRect/offsetHeight) - those
    // force a synchronous reflow and are the main source of scroll jank.
    scrubTop = scrub.offsetTop;
    scrubRange = Math.max(1, scrub.offsetHeight - window.innerHeight);
    renderedFrame = -1; // force a repaint at new size
  }

  function draw(index) {
    var img = images[index];
    if (!img || !img.complete || img.naturalWidth === 0) {
      // fall back to nearest already-loaded frame so we never blank out
      var alt = nearestLoaded(index);
      if (alt === -1) return;
      img = images[alt];
      index = alt;
    }
    // The frames are 16:9 landscape. Keep the immersive "cover" fill on every
    // viewport (incl. portrait/mobile) so the pour always fills the screen at
    // its native 16:9 framing rather than being letterboxed into a tall strip.
    var scale = Math.max(cw / imgW, ch / imgH);
    var w = imgW * scale;
    var h = imgH * scale;
    var x = (cw - w) * 0.5;
    var y = (ch - h) * 0.5;
    // Clear first so the letterbox bars (in contain mode) read as background.
    ctx.fillStyle = "#070807";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, x, y, w, h);
    renderedFrame = index;
  }

  function nearestLoaded(index) {
    for (var d = 0; d < FRAME_COUNT; d++) {
      if (images[index - d] && images[index - d].complete && images[index - d].naturalWidth) return index - d;
      if (images[index + d] && images[index + d].complete && images[index + d].naturalWidth) return index + d;
    }
    return -1;
  }

  /* ---------- scroll → frame mapping ---------- */
  function frameFromScroll() {
    var scrolled = window.pageYOffset - scrubTop;
    var p = scrolled / scrubRange;
    if (p < 0) p = 0; else if (p > 1) p = 1;
    return {
      p: p,
      over: scrolled - scrubRange, // pixels scrolled past the end of the pour
      frame: Math.min(FRAME_COUNT - 1, Math.round(p * (FRAME_COUNT - 1)))
    };
  }

  function update() {
    ticking = false;
    var s = frameFromScroll();
    currentFrame = s.frame;
    queueFrames(currentFrame, s.p > 0 ? 30 : INITIAL_FRAMES - 1);
    if (currentFrame !== renderedFrame) draw(currentFrame);

    // hero text fades out within the first ~12% of the scrub
    var heroFade = 1 - Math.min(s.p / 0.12, 1);
    hero.style.opacity = heroFade;
    hero.style.transform = "translateY(" + (-s.p * 60) + "px)";
    if (scrollCue) scrollCue.style.opacity = heroFade;

    // the whole video plays out at full brightness; the scrim only begins
    // to fade in AFTER the pour completes, as you scroll into the content
    if (bgScrim) {
      var scrim = s.over / (window.innerHeight * 0.6);
      if (scrim < 0) scrim = 0; else if (scrim > 1) scrim = 1;
      bgScrim.style.opacity = scrim;
    }

    // nav solid once we leave the very top
    if (window.scrollY > 40) nav.classList.add("is-solid");
    else nav.classList.remove("is-solid");
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }

  /* ---------- bounded, scroll-driven frame loading ---------- */
  function queueFrames(index, ahead) {
    // Re-prioritize on fast scrolls, including jumps back to the beginning.
    pending = [];
    for (var distance = 0; distance <= ahead; distance++) {
      [index + distance, index - distance].forEach(function (candidate) {
        if (candidate >= 0 && candidate < FRAME_COUNT &&
            !requested.has(candidate) && pending.indexOf(candidate) === -1) {
          pending.push(candidate);
        }
      });
    }
    pumpFrames();
  }

  function pumpFrames() {
    while (activeRequests < MAX_REQUESTS && pending.length) {
      loadFrame(pending.shift());
    }
  }

  function loadFrame(index) {
    requested.add(index);
    activeRequests++;
    var img = new Image();
    img.decoding = "async";
    if (index === 0) img.fetchPriority = "high";
    images[index] = img;
    function done() {
      activeRequests--;
      if (img.naturalWidth) {
        imgW = img.naturalWidth;
        imgH = img.naturalHeight;
        draw(currentFrame);
      }
      pumpFrames();
    }
    img.onload = function () {
      if (img.decode) img.decode().then(done, done);
      else done();
    };
    img.onerror = done;
    img.src = framePath(index);
  }

  function preload() {
    // Content is available immediately, even when media is slow or unavailable.
    loader.classList.add("is-hidden");
    body.classList.remove("loading");
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () { resize(); draw(currentFrame); });
    window.addEventListener("orientationchange", function () { resize(); draw(currentFrame); });
  }

  function initFilm() {
    var video = document.querySelector(".filmstrip__video");
    if (!video) return;
    var connection = navigator.connection;
    if ((connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType))) ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var source = video.querySelector("source");
    var started = false;
    function play() {
      if (!started) {
        source.src = isMobile ? source.dataset.mobileSrc : source.dataset.src;
        video.load();
        started = true;
      }
      video.play().catch(function () { /* Keep the poster if autoplay is unavailable. */ });
    }
    if (!("IntersectionObserver" in window)) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) play();
        else video.pause();
      });
    }, { rootMargin: "300px" });
    observer.observe(video);
  }

  /* ---------- scroll-reveal for content sections ---------- */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    // Reveal as soon as any part of a section enters the viewport (threshold 0).
    // A ratio-based threshold (e.g. 0.18) can never be met by a section taller
    // than the viewport - on mobile the tall "Register" list (54 entries, ~5000px)
    // would otherwise stay stuck at opacity:0, leaving a huge blank white gap.
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { threshold: 0, rootMargin: "0px 0px -8% 0px" });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- in-page anchors (nav "Acquire", footer links) ---------- */
  // Two things break a plain #hash jump on this page:
  //   1. CSS scroll-behavior:smooth is speed-capped, so a jump like hero →
  //      #acquire (~18,000px) crawls and never lands.
  //   2. Images carry no intrinsic size, so lazy ones loading mid-scroll shift
  //      the target's offset underneath us.
  // So: animate it ourselves over a fixed duration, then re-aim once settled.
  function initAnchors() {
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var DURATION = 800;
    var root = document.documentElement;

    function offsetOf(el) {
      // Stop short of the fixed nav (mirrors the scroll-margin-top in CSS).
      var pad = Math.min(104, Math.max(78, window.innerWidth * 0.11));
      var max = root.scrollHeight - window.innerHeight;
      return Math.max(0, Math.min(max, el.getBoundingClientRect().top + window.pageYOffset - pad));
    }

    function jump(top) {
      var prev = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto"; // the CSS default would re-smooth this
      window.scrollTo(0, top);
      root.style.scrollBehavior = prev;
    }

    function animate(el) {
      var start = window.pageYOffset;
      var t0 = performance.now();

      (function step(now) {
        var p = Math.min(1, (now - t0) / DURATION);
        var eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        // Re-read the target each frame so late-loading images can't strand us.
        jump(start + (offsetOf(el) - start) * eased);
        if (p < 1) requestAnimationFrame(step);
        else setTimeout(function () { jump(offsetOf(el)); }, 260);
      })(t0);
    }

    document.addEventListener("click", function (ev) {
      var a = ev.target.closest ? ev.target.closest('a[href^="#"]') : null;
      if (!a) return;
      var id = a.getAttribute("href").slice(1);
      if (!id) return;
      var target = document.getElementById(id);
      if (!target) return;

      ev.preventDefault();
      // A section still waiting on the reveal observer must be made visible
      // before we land on it, otherwise the user arrives at a blank stretch.
      target.classList.add("is-in");
      history.replaceState(null, "", "#" + id);

      if (reduced) jump(offsetOf(target));
      else animate(target);
    });
  }

  /* ---------- language preference (the URL controls the page language) ---------- */
  function initLang() {
    var link = document.getElementById("langToggle");
    if (!link) return;
    link.addEventListener("click", function () {
      try { localStorage.setItem("olvLang", link.hreflang.slice(0, 2)); } catch (e) {}
    });
  }

  /* ---------- boot ---------- */
  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  initLang();
  initAnchors();
  resize();
  initReveal();
  initFilm();
  preload();
})();
