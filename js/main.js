// js/main.js
import { Game } from "./game.js";
import { UI } from "./ui.js";

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

// Now do an explicit sync
ui.syncAll(game);