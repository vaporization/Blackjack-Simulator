// js/ui.js
import { evaluateHand, upcardValueForStrategy } from "./hand.js";

function $(id) { return document.getElementById(id); }
function $opt(id) { return document.getElementById(id) || null; }

/**
 * Creates a flippable card:
 *  - wrapper (.cardWrap) for deal-in animation
 *  - inner (.card3d) for 3D flip
 *  - two faces: front = .card, back = .card.back
 *
 * This preserves your existing card visuals exactly.
 */
function cardEl(card, { hidden = false, animate = false, flipOnReveal = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "cardWrap" + (animate ? " deal-in" : "");
  wrap.setAttribute("role", "presentation");

  const c3d = document.createElement("div");
  c3d.className = "card3d " + (hidden ? "facedown" : "faceup") + (flipOnReveal ? " flip" : "");
  c3d.setAttribute("role", "img");

  // FRONT FACE (your normal card)
  const frontFace = document.createElement("div");
  frontFace.className = "cardFace front";

  const front = document.createElement("div");
  front.className = "card";
  front.dataset.suit = card.suit;

  if (!hidden) {
    front.setAttribute("aria-label", `Card ${card.rank} of ${card.suit}`);
  }

  const r = document.createElement("div");
  r.className = "r";
  r.textContent = card.rank;

  const s = document.createElement("div");
  s.className = "s";
  s.textContent = card.suit;

  const mini = document.createElement("div");
  mini.className = "mini";
  mini.textContent = `${card.rank}${card.suit}`;

  front.appendChild(r);
  front.appendChild(s);
  front.appendChild(mini);
  frontFace.appendChild(front);

  // BACK FACE (your normal back)
  const backFace = document.createElement("div");
  backFace.className = "cardFace back";

  const back = document.createElement("div");
  back.className = "card back";
  back.dataset.suit = card.suit; // harmless
  back.setAttribute("aria-label", "Dealer hole card (hidden)");
  backFace.appendChild(back);

  c3d.appendChild(frontFace);
  c3d.appendChild(backFace);
  wrap.appendChild(c3d);

  // aria label for the whole thing
  if (hidden) c3d.setAttribute("aria-label", "Dealer hole card (hidden)");
  else c3d.setAttribute("aria-label", `Card ${card.rank} of ${card.suit}`);

  return wrap;
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return "—";
  const hasCents = Math.abs(n % 1) > 1e-9;
  return hasCents ? n.toFixed(2) : String(Math.trunc(n));
}

export class UI {
  constructor() {
    this.el = {
      bankroll: $("bankroll"),
      shoeStatus: $("shoeStatus"),
      roundNo: $("roundNo"),
      phase: $("phase"),

      dealerCards: $("dealerCards"),
      dealerTotal: $("dealerTotal"),
      dealerNote: $("dealerNote"),

      playerHands: $("playerHands"),
      playerNote: $("playerNote"),

      betInput: $("betInput"),
      minBetHint: $("minBetHint"),
      maxBetHint: $("maxBetHint"),

      btnDeal: $("btnDeal"),
      btnHit: $("btnHit"),
      btnStand: $("btnStand"),
      btnDouble: $("btnDouble"),
      btnSplit: $("btnSplit"),
      btnInsurance: $("btnInsurance"),
      btnResetShoe: $("btnResetShoe"),
      btnResetBankroll: $("btnResetBankroll"),
      btnResetRound: $("btnResetRound"),

      log: $("log"),

      decks: $("decks"),
      cutDepth: $("cutDepth"),
      cutDepthReadout: $("cutDepthReadout"),
      minBet: $("minBet"),
      maxBet: $("maxBet"),
      startingBankroll: $("startingBankroll"),
      seed: $("seed"),

      toggleTraining: $("toggleTraining"),
      toggleAutoplay: $("toggleAutoplay"),
      toggleMultiSplit: $("toggleMultiSplit"),

      recommendation: $("recommendation"),

      // OPTIONAL (only if you add them to index.html)
      countRunning: $opt("countRunning"),
      countTrue: $opt("countTrue"),

      statHands: $opt("statHands"),
      statWagered: $opt("statWagered"),
      statReturned: $opt("statReturned"),
      statNet: $opt("statNet"),
      statPPH: $opt("statPPH"),

      trainerErrors: $opt("trainerErrors"),
      trainerEvLoss: $opt("trainerEvLoss"),
    };

    this.el.betInput.value = 10;
    this._logLines = [];

    // For animations: track previous counts so we only animate newly added cards
    this._prev = {
      dealerCount: 0,
      dealerHoleHidden: true,
      playerCardCounts: [] // per hand
    };

    this.el.cutDepth.addEventListener("input", () => {
      this.el.cutDepthReadout.textContent = String(this.el.cutDepth.value);
    });
  }

  bind(game) {
    this.game = game;

    const press = (btn) => {
      if (!btn) return;
      btn.classList.remove("press");
      // force reflow so animation can replay
      void btn.offsetWidth;
      btn.classList.add("press");
    };

    // Buttons
    this.el.btnDeal.addEventListener("click", () => { press(this.el.btnDeal); game.startRound(this.el.betInput.value); });
    this.el.btnHit.addEventListener("click", () => { press(this.el.btnHit); game.hit(); });
    this.el.btnStand.addEventListener("click", () => { press(this.el.btnStand); game.stand(); });
    this.el.btnDouble.addEventListener("click", () => { press(this.el.btnDouble); game.doubleDown(); });
    this.el.btnSplit.addEventListener("click", () => { press(this.el.btnSplit); game.split(); });

    // Insurance button = TAKE insurance (optional). Player can also just act to implicitly decline.
    this.el.btnInsurance.addEventListener("click", () => { press(this.el.btnInsurance); game.takeInsurance(); });

    this.el.btnResetShoe.addEventListener("click", () => game.resetShoe());
    this.el.btnResetBankroll.addEventListener("click", () => game.resetBankroll());
    this.el.btnResetRound.addEventListener("click", () => this.clearLog());

    // Keyboard
    window.addEventListener("keydown", (e) => {
      const tag = (e.target && e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      const k = e.key.toLowerCase();
      if (k === "d") return game.startRound(this.el.betInput.value);
      if (k === "h") return game.hit();
      if (k === "s") return game.stand();
      if (k === "x") return game.doubleDown();
      if (k === "p") return game.split();
      if (k === "i") return game.takeInsurance();
      // Note: decline insurance is implicit by taking any action (Hit/Stand/Double/Split)
    });

    this.el.toggleAutoplay.addEventListener("change", () => {
      this.syncAll(game);
    });
  }

  getSettings() {
    const decks = Number(this.el.decks.value);
    const cutDepth = Number(this.el.cutDepth.value);
    const minBet = Number(this.el.minBet.value);
    const maxBet = Number(this.el.maxBet.value);
    const startingBankroll = Number(this.el.startingBankroll.value);
    const seed = this.el.seed.value;

    const training = !!this.el.toggleTraining.checked;
    const autoplay = !!this.el.toggleAutoplay.checked;
    const allowMultiSplit = !!this.el.toggleMultiSplit.checked;

    if (Number.isFinite(minBet) && Number.isFinite(maxBet)) {
      this.el.betInput.min = String(minBet);
      this.el.betInput.max = String(maxBet);
    }

    return { decks, cutDepth, minBet, maxBet, startingBankroll, seed, training, autoplay, allowMultiSplit };
  }

  handleEvent(evt) {
    if (evt.type === "log") {
      this.addLog(evt.time, evt.msg);
      return;
    }

    if (evt.type === "clearLog") {
      this.clearLog();
      return;
    }

    if (evt.type === "state") {
      if (!this.game) return;
      this.syncAll(this.game);
      return;
    }
  }

  addLog(time, msg) {
    this._logLines.push({ time, msg });
    const p = document.createElement("div");
    p.className = "logline";
    p.innerHTML = `<span class="t">[${time}]</span> ${escapeHtml(msg)}`;
    this.el.log.appendChild(p);
    this.el.log.scrollTop = this.el.log.scrollHeight;
  }

  clearLog() {
    this._logLines = [];
    this.el.log.innerHTML = "";
    this.addLog(new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}), "Log cleared.");
  }

  syncAll(game) {
    const s = game.snapshot();

    // Top status
    this.el.bankroll.textContent = `$${s.bankroll}`;
    this.el.shoeStatus.textContent = s.shoe.statusText;
    this.el.roundNo.textContent = String(s.roundNo);
    this.el.phase.textContent = s.phase;

    // Settings hints
    this.el.minBetHint.textContent = `$${s.settings.minBet}`;
    this.el.maxBetHint.textContent = `$${s.settings.maxBet}`;
    this.el.betInput.min = String(s.settings.minBet);
    this.el.betInput.max = String(s.settings.maxBet);

    // OPTIONAL: Counting + Stats + Trainer (only if your Game.snapshot() includes these)
    if (s.counting) {
      if (this.el.countRunning) this.el.countRunning.textContent = String(s.counting.running);
      if (this.el.countTrue) this.el.countTrue.textContent = (Number.isFinite(s.counting.true) ? s.counting.true.toFixed(2) : "—");
    }
    if (s.stats) {
      if (this.el.statHands) this.el.statHands.textContent = String(s.stats.hands ?? 0);
      if (this.el.statWagered) this.el.statWagered.textContent = `$${fmtMoney(s.stats.wagered ?? 0)}`;
      if (this.el.statReturned) this.el.statReturned.textContent = `$${fmtMoney(s.stats.returned ?? 0)}`;
      if (this.el.statNet) this.el.statNet.textContent = `$${fmtMoney(s.stats.net ?? 0)}`;
      if (this.el.statPPH) this.el.statPPH.textContent = `$${fmtMoney(s.stats.profitPerHand ?? 0)}`;
    }
    if (s.trainer) {
      if (this.el.trainerErrors) this.el.trainerErrors.textContent = String(s.trainer.errors ?? 0);
      if (this.el.trainerEvLoss) this.el.trainerEvLoss.textContent = `$${fmtMoney(s.trainer.evLoss ?? 0)}`;
    }

    // ---- Dealer UI (with flip + deal animation) ----
    this.el.dealerCards.innerHTML = "";
    const dealerCards = s.dealer.cards;

    const dealerCountNow = dealerCards.length;
    const holeWasHidden = !!this._prev.dealerHoleHidden;
    const holeIsHidden = !!s.dealer.holeHidden;

    dealerCards.forEach((c, idx) => {
      const isHole = (idx === 1);
      const hidden = isHole && holeIsHidden;

      // animate new dealer cards (after initial render) OR flip on reveal
      const flipOnReveal = isHole && holeWasHidden && !holeIsHidden;
      const animate =
        (dealerCountNow > this._prev.dealerCount && idx >= this._prev.dealerCount) ||
        flipOnReveal;

      this.el.dealerCards.appendChild(cardEl(c, { hidden, animate, flipOnReveal }));
    });

    const dealerUp = s.dealer.upcard;
    if (!dealerUp) {
      this.el.dealerTotal.textContent = "Total: —";
      this.el.dealerNote.textContent = "";
    } else {
      if (s.dealer.holeHidden) {
        this.el.dealerTotal.textContent = "Total: —";
        const upNum = upcardValueForStrategy(dealerUp);
        this.el.dealerNote.textContent = `Upcard: ${dealerUp.rank}${dealerUp.suit} (${upNum === 11 ? "A" : upNum})`;
      } else {
        const e = evaluateHand(dealerCards);
        this.el.dealerTotal.textContent = `Total: ${e.total}${e.soft ? " (soft)" : ""}`;
        this.el.dealerNote.textContent = "";
      }
    }

    // ---- Player hands UI (deal animation for newly added cards) ----
    this.el.playerHands.innerHTML = "";
    const nextCounts = [];

    s.playerHands.forEach((h, idx) => {
      const hand = document.createElement("div");
      hand.className = "hand" + (h.isActive && (s.phase === "player" || s.phase === "insurance") ? " active" : "");

      const head = document.createElement("div");
      head.className = "hand-head";

      const left = document.createElement("div");
      left.className = "left";

      const label = document.createElement("span");
      label.className = "badge";
      label.textContent = `Hand ${idx + 1}`;

      const bet = document.createElement("span");
      bet.className = "badge";
      bet.textContent = `Bet $${h.bet}`;

      const total = document.createElement("span");
      total.className = "badge";
      total.textContent = `Total ${h.eval.total}${h.eval.soft ? " (soft)" : ""}${h.eval.isBust ? " BUST" : ""}`;

      left.appendChild(label);
      left.appendChild(bet);
      left.appendChild(total);

      const right = document.createElement("div");
      const outcome = badgeForOutcome(h.outcome, h.isBlackjack);
      if (outcome) right.appendChild(outcome);

      head.appendChild(left);
      head.appendChild(right);

      const cards = document.createElement("div");
      cards.className = "hand-cards";

      const prevCount = this._prev.playerCardCounts[idx] ?? 0;
      nextCounts[idx] = h.cards.length;

      h.cards.forEach((c, cidx) => {
        const animate = (h.cards.length > prevCount) && (cidx >= prevCount);
        cards.appendChild(cardEl(c, { hidden: false, animate, flipOnReveal: false }));
      });

      hand.appendChild(head);
      hand.appendChild(cards);
      this.el.playerHands.appendChild(hand);
    });

    // Phase note
    this.el.playerNote.textContent = phaseNote(s);

    // Buttons enabled/disabled based on legality
    const legal = computeLegalFromSnapshot(s);

    this.el.btnDeal.disabled = (s.phase !== "betting" && s.phase !== "done");
    this.el.btnHit.disabled = !legal.hit;
    this.el.btnStand.disabled = !legal.stand;
    this.el.btnDouble.disabled = !legal.double;
    this.el.btnSplit.disabled = !legal.split;

    // Insurance button only enabled during insurance phase (taking insurance is optional)
    this.el.btnInsurance.disabled = !(s.phase === "insurance");
    this.el.btnInsurance.textContent = (s.phase === "insurance")
      ? "Take Insurance (½ bet)"
      : "Insurance";

    // Recommendation
    const trainingOn = !!s.settings.training;
    if (trainingOn) {
      const rec = game.getRecommendation();
      if (!rec.move) this.el.recommendation.textContent = "—";
      else this.el.recommendation.textContent = `${rec.move.toUpperCase()} — ${rec.reason}`;
    } else {
      this.el.recommendation.textContent = "—";
    }

    // Sync toggles
    this.el.toggleTraining.checked = !!s.settings.training;
    this.el.toggleAutoplay.checked = !!s.settings.autoplay;

    // Shoe & cut display
    this.el.cutDepthReadout.textContent = String(this.el.cutDepth.value);

    // Save prev snapshot bits for next animation diff
    this._prev.dealerCount = dealerCountNow;
    this._prev.dealerHoleHidden = holeIsHidden;
    this._prev.playerCardCounts = nextCounts;
  }
}

function computeLegalFromSnapshot(s) {
  const phase = s.phase;
  const hand = s.playerHands.find(h => h.isActive);
  if (!hand) return { hit:false, stand:false, double:false, split:false };

  // ✅ Allow acting during insurance phase (insurance is optional)
  const canAct = (phase === "player" || phase === "insurance") && !hand.done;

  const hit = canAct && !hand.eval.isBust;
  const stand = canAct;

  const canDouble = canAct &&
    hand.cards.length === 2 &&
    !hand.isDoubled &&
    (hand.eval.total === 9 || hand.eval.total === 10 || hand.eval.total === 11) &&
    (s.bankroll >= hand.baseBet);

  const canSplit = canAct &&
    hand.cards.length === 2 &&
    (hand.cards[0]?.rank === hand.cards[1]?.rank) &&
    (s.bankroll >= hand.baseBet) &&
    (s.settings.allowMultiSplit ? true : (countSplits(s.playerHands) === 0));

  return { hit, stand, double: canDouble, split: canSplit };
}

function countSplits(hands) {
  return (hands.length > 1) ? 1 : 0;
}

function badgeForOutcome(outcome, isBJ) {
  if (!outcome && !isBJ) return null;
  const b = document.createElement("span");
  b.className = "badge";

  if (isBJ) {
    b.classList.add("good");
    b.textContent = "BLACKJACK";
    return b;
  }

  const map = {
    win: ["good", "WIN"],
    win_blackjack: ["good", "BJ WIN"],
    win_dealer_bust: ["good", "WIN (dealer bust)"],
    push: ["warn", "PUSH"],
    push_blackjack: ["warn", "PUSH (BJ)"],
    bust: ["bad", "BUST"],
    lose: ["bad", "LOSE"],
    lose_bust: ["bad", "LOSE (bust)"],
    lose_dealer_blackjack: ["bad", "LOSE (dealer BJ)"],
    stand: ["", "STOOD"]
  };
  const entry = map[outcome];
  if (!entry) return null;

  if (entry[0]) b.classList.add(entry[0]);
  b.textContent = entry[1];
  return b;
}

function phaseNote(s) {
  if (s.phase === "betting") return "Place a bet and press Deal.";
  if (s.phase === "initial_deal") return "Dealing...";
  if (s.phase === "insurance") return "Dealer shows Ace: Insurance is optional. Take insurance or just play to decline.";
  if (s.phase === "player") return `Your turn — play the highlighted hand.`;
  if (s.phase === "dealer") return "Dealer playing out hand...";
  if (s.phase === "settlement") return "Settling bets...";
  if (s.phase === "done") return "Round complete — place a new bet to deal again.";
  return "";
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}