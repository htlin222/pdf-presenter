// Entry barrel. Both audience.html and presenter.html import from this
// module via /assets/presenter.js. The actual view logic lives in
// ./audience.js and ./presenter-main.js respectively, and the shared
// subsystems live under ./modules/.

export { initAudience } from "./audience.js";
export { initPresenter } from "./presenter-main.js";
