// js/main.js
import { Game } from "./game.js";
import { UI } from "./ui.js";
import { ThreeTable } from "./renderer3d.js";

const ui = new UI();

const game = new Game({
  onEvent: (evt) => ui.handleEvent(evt),
  getSettings: () => ui.getSettings()
});

// Bind UI first so state sync cannot crash
ui.bind(game);

// Apply settings + initialize round after binding
game.applySettings(ui.getSettings());
game.resetRoundState(true);

// --- View toggle: 2D / 3D (rendering only) ---
const viewSel = document.getElementById("viewMode");
const threeStage = document.getElementById("threeStage");
const hudDealer = document.getElementById("threeDealerHud");
const hudPlayer = document.getElementById("threePlayerHud");

const three = new ThreeTable({ hudDealerEl: hudDealer, hudPlayerEl: hudPlayer });

function setView(mode) {
  const is3d = mode === "3d";
  document.body.classList.toggle("view-3d", is3d);

  if (!threeStage) return;

  if (is3d) {
    threeStage.hidden = false;
    if (!three.renderer) three.init(threeStage);
    three.render(game.snapshot());
  } else {
    threeStage.hidden = true;
    if (three.renderer) three.destroy();
  }
}

if (viewSel) {
  viewSel.addEventListener("change", () => setView(viewSel.value));
  setView(viewSel.value || "2d");
}

// Wrap UI.syncAll so 3D updates whenever state updates
const _origSyncAll = ui.syncAll.bind(ui);
ui.syncAll = (g) => {
  _origSyncAll(g);
  if (document.body.classList.contains("view-3d")) {
    three.render(g.snapshot());
  }
};

// Initial sync
ui.syncAll(game);
