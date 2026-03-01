// js/ui.js
import { evaluateHand, formatCard, upcardValueForStrategy } from "./hand.js";

function $(id) { return document.getElementById(id); }

function suitColorClass(suit) {
  return (suit === "♥" || suit === "♦") ? "red" : "black";
}

function cardEl(card, { hidden = false } = {}) {
  const d = document.createElement("div");
  d.className = "card" + (hidden ? " back" : "");
  d.setAttribute("role", "img");
  d.dataset.suit = card.suit;

  if (hidden) {
    d.setAttribute("aria-label", "Dealer hole card (hidden)");
    return d;
  }

  d.setAttribute("aria-label", `Card ${card.rank} of ${card.suit}`);
  const r = document.createElement("div");
  r.className = "r";
  r.textContent = card.rank;

  const s = document.createElement("div");
  s.className = "s";
  s.textContent = card.suit;

  const mini = document.createElement("div");
  mini.className = "mini";
  mini.textContent = `${card.rank}${card.suit}`;

  d.appendChild(r);
  d.appendChild(s);
  d.appendChild(mini);
  return d;
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

      recommendation: $("recommendation")
    };

    this.el.betInput.value = 10;
    this._logLines = [];

    this.el.cutDepth.addEventListener("input", () => {
      this.el.cutDepthReadout.textContent = String(this.el.cutDepth.value);
    });
  }

  bind(game) {
    this.game = game;

    this.el.btnDeal.addEventListener("click", () => game.startRound(this.el.betInput.value));
    this.el.btnHit.addEventListener("click", () => game.hit());
    this.el.btnStand.addEventListener("click", () => game.stand());
    this.el.btnDouble.addEventListener("click", () => game.doubleDown());
    this.el.btnSplit.addEventListener("click", () => game.split());
    this.el.btnInsurance.addEventListener("click", () => game.takeInsurance());

    this.el.btnResetShoe.addEventListener("click", () => game.resetShoe());
    this.el.btnResetBankroll.addEventListener("click", () => game.resetBankroll());
    this.el.btnResetRound.addEventListener("click", () => this.clearLog());

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
      if (k === "n") return game.declineInsurance?.();
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

    this.el.bankroll.textContent = `$${s.bankroll}`;
    this.el.shoeStatus.textContent = s.shoe.statusText;
    this.el.roundNo.textContent = String(s.roundNo);
    this.el.phase.textContent = s.phase;

    this.el.minBetHint.textContent = `$${s.settings.minBet}`;
    this.el.maxBetHint.textContent = `$${s.settings.maxBet}`;
    this.el.betInput.min = String(s.settings.minBet);
    this.el.betInput.max = String(s.settings.maxBet);

    // Dealer UI
    this.el.dealerCards.innerHTML = "";
    const dealerCards = s.dealer.cards;
    dealerCards.forEach((c, idx) => {
      const hidden = (idx === 1 && s.dealer.holeHidden);
      this.el.dealerCards.appendChild(cardEl(c, { hidden }));
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

    // Player hands UI
    this.el.playerHands.innerHTML = "";
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
      h.cards.forEach(c => cards.appendChild(cardEl(c)));

      hand.appendChild(head);
      hand.appendChild(cards);
      this.el.playerHands.appendChild(hand);
    });

    this.el.playerNote.textContent = phaseNote(s);

    const legal = computeLegalFromSnapshot(s);

    this.el.btnDeal.disabled = (s.phase !== "betting" && s.phase !== "done");
    this.el.btnHit.disabled = !legal.hit;
    this.el.btnStand.disabled = !legal.stand;
    this.el.btnDouble.disabled = !legal.double;
    this.el.btnSplit.disabled = !legal.split;

    this.el.btnInsurance.disabled = !(s.phase === "insurance");
    this.el.btnInsurance.textContent = (s.phase === "insurance") ? "Insurance (½ bet)" : "Insurance";

    const trainingOn = !!s.settings.training;
    if (trainingOn) {
      const rec = game.getRecommendation();
      if (!rec.move) this.el.recommendation.textContent = "—";
      else this.el.recommendation.textContent = `${rec.move.toUpperCase()} — ${rec.reason}`;
    } else {
      this.el.recommendation.textContent = "—";
    }

    this.el.toggleTraining.checked = !!s.settings.training;
    this.el.toggleAutoplay.checked = !!s.settings.autoplay;

    this.el.cutDepthReadout.textContent = String(this.el.cutDepth.value);
  }
}

function computeLegalFromSnapshot(s) {
  const phase = s.phase;
  const hand = s.playerHands.find(h => h.isActive);
  if (!hand) return { hit:false, stand:false, double:false, split:false };

  const canAct = (phase === "player" || phase === "insurance") && !hand.done;

  const hit = canAct && !hand.eval.isBust;
  const stand = canAct;

  const canDouble = canAct &&
    hand.cards.length === 2 &&
    !hand.isDoubled &&
    (hand.eval.total === 9 || hand.eval.total === 10 || hand.eval.total === 11) &&
    (s.bankroll >= hand.baseBet);

  const maxHands = s.settings.allowMultiSplit ? 4 : 2;
  const underHandCap = s.playerHands.length < maxHands;
  const alreadySplit = s.playerHands.length > 1;
  const splitAllowedBySetting = s.settings.allowMultiSplit ? true : !alreadySplit;

  const canSplit = canAct &&
    underHandCap &&
    splitAllowedBySetting &&
    hand.cards.length === 2 &&
    (hand.cards[0]?.rank === hand.cards[1]?.rank) &&
    (s.bankroll >= hand.baseBet);

  return { hit, stand, double: canDouble, split: canSplit };
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
  if (s.phase === "insurance") return "Dealer shows Ace: you may buy Insurance OR just play (action = no insurance).";
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