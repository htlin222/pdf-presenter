// Cursor sync: mirrors the presenter's mouse position over the Current
// canvas to the audience view as a red laser dot. Coordinates are sent
// normalized ([0,1]) over the existing BroadcastChannel and throttled
// via requestAnimationFrame so a fast drag won't spam messages.

export function createCursorSync({ canvas, channel }) {
  let enabled = false;
  let pending = null; // {x, y} | null
  let rafId = 0;
  let hiddenPosted = true;

  function postPending() {
    rafId = 0;
    if (!enabled) return;
    if (!pending) return;
    channel.postMessage({ type: "cursor", x: pending.x, y: pending.y });
    hiddenPosted = false;
    pending = null;
  }

  function schedulePost(x, y) {
    pending = { x, y };
    if (rafId) return;
    rafId = requestAnimationFrame(postPending);
  }

  function onMove(ev) {
    if (!enabled) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      postHide();
      return;
    }
    schedulePost(x, y);
  }

  function postHide() {
    if (hiddenPosted) return;
    pending = null;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    channel.postMessage({ type: "cursor", hidden: true });
    hiddenPosted = true;
  }

  function onLeave() {
    postHide();
  }

  function setEnabled(on) {
    if (on === enabled) return;
    enabled = on;
    if (enabled) {
      canvas.addEventListener("mousemove", onMove);
      canvas.addEventListener("mouseleave", onLeave);
    } else {
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      postHide();
    }
  }

  return {
    setEnabled,
    toggle: () => {
      setEnabled(!enabled);
      return enabled;
    },
    isEnabled: () => enabled,
  };
}
