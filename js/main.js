// js/main.js
import { Game } from "./game.js";
import { UI } from "./ui.js";

const ui = new UI();
const game = new Game({
  onEvent: (evt) => ui.handleEvent(evt),
  getSettings: () => ui.getSettings()
});

ui.bind(game);
ui.syncAll(game);

// Start in betting phase with defaults applied
game.applySettings(ui.getSettings());
game.resetRoundState(true);
ui.syncAll(game);