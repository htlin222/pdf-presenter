// Presenter timer subsystem. Supports count-up and count-down (with warn/danger
// colour bands), click-to-pause on the timer element itself, and a separate
// reset button. All state is private to the factory closure.

const TICK_INTERVAL_MS = 250;

export function createTimer({ timerEl, resetBtnEl, countdownMs }) {
  let startedAt = Date.now();
  let pausedAt = null; // ms timestamp when paused, null while running

  function elapsed() {
    const base = pausedAt !== null ? pausedAt : Date.now();
    return base - startedAt;
  }

  function reset() {
    startedAt = Date.now();
    // Reset leaves pause state untouched — a reset while paused starts
    // the next run-cycle from 00:00 but still paused.
    if (pausedAt !== null) pausedAt = startedAt;
    tick();
  }

  function togglePause() {
    if (pausedAt === null) {
      pausedAt = Date.now();
    } else {
      // Shift startedAt forward by the pause duration so elapsed continues
      // from where we left off.
      startedAt += Date.now() - pausedAt;
      pausedAt = null;
    }
    tick();
  }

  function formatMs(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function tick() {
    const ms = elapsed();
    if (countdownMs !== null) {
      const remaining = countdownMs - ms;
      timerEl.textContent = formatMs(remaining >= 0 ? remaining : -remaining);
      timerEl.classList.remove("warn", "danger");
      if (remaining <= 60 * 1000) timerEl.classList.add("danger");
      else if (remaining <= 5 * 60 * 1000) timerEl.classList.add("warn");
    } else {
      timerEl.textContent = formatMs(ms);
    }
    timerEl.classList.toggle("paused", pausedAt !== null);
  }

  timerEl.addEventListener("click", (ev) => {
    ev.preventDefault();
    togglePause();
    timerEl.blur();
  });
  resetBtnEl.addEventListener("click", (ev) => {
    ev.preventDefault();
    reset();
    resetBtnEl.blur();
  });

  setInterval(tick, TICK_INTERVAL_MS);
  tick();

  return { reset, togglePause };
}
