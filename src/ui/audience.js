// Audience view entry. Loaded via presenter.js barrel from audience.html.

import {
  CHANNEL_NAME,
  readConfig,
  loadDocument,
  renderPage,
  clampSlide,
} from "./modules/pdf-render.js";

export async function initAudience() {
  const config = readConfig();
  const pdf = await loadDocument(config.pdfUrl);
  const total = pdf.numPages;
  const canvas = document.getElementById("slide-canvas");
  const blackOverlay = document.getElementById("black-overlay");
  const freezeIndicator = document.getElementById("freeze-indicator");
  const status = document.getElementById("status");

  let currentSlide = 1;
  let frozenAt = null;
  const channel = new BroadcastChannel(CHANNEL_NAME);

  async function show(n) {
    const slide = clampSlide(n, total);
    if (frozenAt !== null) return;
    currentSlide = slide;
    await renderPage(pdf, slide, canvas);
    if (status) status.textContent = `${slide} / ${total}`;
  }

  function setFrozen(frozen) {
    if (frozen) {
      frozenAt = currentSlide;
      freezeIndicator.classList.remove("hidden");
    } else {
      frozenAt = null;
      freezeIndicator.classList.add("hidden");
      show(currentSlide);
    }
  }

  function setBlack(on) {
    blackOverlay.classList.toggle("hidden", !on);
  }

  channel.addEventListener("message", (ev) => {
    const msg = ev.data;
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "slide":
        if (frozenAt === null) show(msg.slide);
        break;
      case "freeze":
        setFrozen(!!msg.value);
        break;
      case "black":
        setBlack(!!msg.value);
        break;
      case "hello":
        channel.postMessage({ type: "audience-ready" });
        break;
    }
  });

  // Keyboard nav (audience can also advance on its own if standalone).
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowRight" || ev.key === "PageDown" || ev.key === " ") {
      show(currentSlide + 1);
      channel.postMessage({ type: "slide", slide: clampSlide(currentSlide, total) });
    } else if (ev.key === "ArrowLeft" || ev.key === "PageUp") {
      show(currentSlide - 1);
      channel.postMessage({ type: "slide", slide: clampSlide(currentSlide, total) });
    } else if (ev.key === "p" || ev.key === "P") {
      window.open("/presenter", "pdf-presenter-presenter");
    }
  });

  window.addEventListener("resize", () => {
    if (frozenAt === null) renderPage(pdf, currentSlide, canvas);
  });

  await show(1);
  channel.postMessage({ type: "audience-ready" });
}
