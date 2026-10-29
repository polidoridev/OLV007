/* Opt-in soundtrack: a pre-rendered 1:00–2:00 loop with a 1.5-second
   crossfade. Native audio supports both file:// previews and hosted pages. */
(function () {
  "use strict";
  var entry = document.getElementById("entry");
  var wrap = document.getElementById("ambient");
  var toggle = document.getElementById("ambientToggle");
  var volume = document.getElementById("ambientVol");
  var status = document.getElementById("musicStatus");
  if (!entry || !wrap) return;

  var player = new Audio("assets/audio/casino-de-capri-loop.wav");
  player.preload = "none";
  player.loop = true;
  player.volume = Number(volume.value) / 100;
  var enabled = false;
  var generation = 0;
  function words(en, fr) { return document.documentElement.lang === "fr" ? fr : en; }
  function paint() {
    wrap.classList.toggle("is-playing", !player.paused);
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.setAttribute("aria-label", enabled
      ? words("Turn music off", "Désactiver la musique")
      : words("Turn music on", "Activer la musique"));
  }
  function message(text) {
    status.textContent = text;
    status.hidden = !text;
  }
  function setMusic(on) {
    enabled = on;
    var request = ++generation;
    message("");
    if (!on) {
      player.pause();
      paint();
      return;
    }
    message(words("Loading music…", "Chargement de la musique…"));
    // Call play directly in the click gesture; no fetch or async decoding step.
    player.play().then(function () {
      if (request !== generation) return;
      if (!enabled) { player.pause(); return; }
      message("");
      paint();
    }).catch(function (error) {
      if (request === generation) {
        console.warn("OLV007 soundtrack playback failed:", error);
        failed(request);
      }
    });
    paint();
  }
  player.addEventListener("playing", function () {
    if (!enabled) { player.pause(); return; }
    message("");
    paint();
  });
  player.addEventListener("pause", paint);
  player.addEventListener("error", function () {
    if (enabled) failed(generation);
  });
  function failed(request) {
    if (request !== generation) return;
    enabled = false;
    player.pause();
    message(words("Music couldn’t start. Tap the music button to try again.", "La musique n’a pas démarré. Appuyez sur le bouton pour réessayer."));
    paint();
  }
  function enter(on) {
    entry.close();
    setMusic(on);
    toggle.focus({ preventScroll: true });
  }
  volume.addEventListener("input", function () {
    player.volume = Number(volume.value) / 100;
  });
  document.getElementById("enterMusic").addEventListener("click", function () { enter(true); });
  document.getElementById("enterSilent").addEventListener("click", function () { enter(false); });
  entry.addEventListener("cancel", function (event) { event.preventDefault(); enter(false); });
  toggle.addEventListener("click", function () { setMusic(!enabled); });
  document.getElementById("langToggle").addEventListener("click", paint);
  paint();
  entry.showModal();
})();
