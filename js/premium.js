/* Progressive visual effects: no content or business behavior is replaced. */
(function () {
  'use strict';
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  var cards = Array.from(document.querySelectorAll('.store:not(.store--local), .dose__card, .note-card'));
  var resetters = [];
  cards.forEach(function (card) {
    card.classList.add('depth-card');
    var frame = 0;
    var point;
    function reset() {
      cancelAnimationFrame(frame);
      frame = 0;
      card.classList.remove('is-lit');
      ['--tilt-x', '--tilt-y', '--glare-x', '--glare-y'].forEach(function (name) { card.style.removeProperty(name); });
    }
    function paint() {
      frame = 0;
      var rect = card.getBoundingClientRect();
      var x = Math.max(-.5, Math.min(.5, (point.clientX - rect.left) / rect.width - .5));
      var y = Math.max(-.5, Math.min(.5, (point.clientY - rect.top) / rect.height - .5));
      card.style.setProperty('--tilt-x', (-y * 5).toFixed(2) + 'deg');
      card.style.setProperty('--tilt-y', (x * 5).toFixed(2) + 'deg');
      card.style.setProperty('--glare-x', (x * 24).toFixed(1) + 'px');
      card.style.setProperty('--glare-y', (y * 12).toFixed(1) + 'px');
      card.classList.add('is-lit');
    }
    card.addEventListener('pointermove', function (event) {
      if (motion.matches || !pointer.matches || event.pointerType === 'touch') return;
      point = event;
      if (!frame) frame = requestAnimationFrame(paint);
    }, { passive: true });
    card.addEventListener('pointerleave', reset);
    card.addEventListener('pointercancel', reset);
    resetters.push(reset);
  });
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      var order = 0;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        if (!motion.matches) {
          entry.target.style.setProperty('--enter-delay', (order++ % 3) * 80 + 'ms');
          entry.target.classList.add('depth-enter');
        }
        observer.unobserve(entry.target);
      });
    }, { threshold: .1 });
    cards.forEach(function (card) {
      observer.observe(card);
      card.addEventListener('animationend', function () { card.classList.remove('depth-enter'); });
    });
  }
  function preferenceChanged() { resetters.forEach(function (reset) { reset(); }); }
  motion.addEventListener('change', preferenceChanged);
  pointer.addEventListener('change', preferenceChanged);
})();
