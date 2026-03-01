// js/game.js
import { Shoe } from "./shoe.js";
import { evaluateHand, isBlackjack, sameRank, isTenValue, upcardValueForStrategy } from "./hand.js";
import { recommendMove, autoplayWantsInsurance } from "./strategy.js";

function nowTime() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function hiloValue(card) {
  // Hi-Lo: 2–6 = +1, 7–9 = 0, 10/J/Q/K/A = -1
  const r = card.rank;
  if (r === "A" || r === "10" || r === "J" || r === "Q" || r === "K") return -1;
  const n = Number(r);
  if (Number.isFinite(n)) {
    if (n >= 2 && n <= 6) return +1;
    if (n >= 7 && n <= 9) return 0;
  }
  return 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export class Game {
  constructor({ onEvent, getSettings }) {
    this.onEvent = onEvent || (() => {});
    this.getSettings = getSettings || (() => ({}));

    // Configurable settings (defaults)
    this.settings = {
      decks: 6,
      cutDepth: 70,
      minBet: 2,
      maxBet: 500,
      startingBankroll: 500,
      seed: "",
      training: false,
      autoplay: false,
      allowMultiSplit: false
    };

    this.roundNo = 0;
    this.bankroll = this.settings.startingBankroll;

    this.shoe = new Shoe({ decks: this.settings.decks, cutDepth: this.settings.cutDepth, seed: this.settings.seed });

    // --- Counting (Hi-Lo) ---
    this.counting = {
      running: 0,
      true: 0
    };
    this._holeCountPending = 0; // dealer hole card count is applied when revealed

    // --- Session stats ---
    this.stats = {
      hands: 0,        // rounds completed
      wagered: 0,      // total risked (incl. splits, doubles, insurance)
      returned: 0,     // total money returned to bankroll from outcomes
      net: 0,          // returned - wagered
      profitPerHand: 0 // net / hands
    };

    // --- Trainer stats (simple) ---
    this.trainer = {
      errors: 0,
      evLoss: 0 // estimated only
    };

    this._autoActing = false; // set true during autoplay to avoid trainer penalties

    this.resetRoundState(true);
  }

  emit(type, payload = {}) {
    this.onEvent({ type, time: nowTime(), ...payload });
  }

  _recalcTrueCount() {
    const decksRem = Math.max(0.25, this.shoe.decksRemaining ? this.shoe.decksRemaining() : (this.shoe.remaining() / 52));
    this.counting.true = round2(this.counting.running / decksRem);
  }

  _countCardVisible(card) {
    this.counting.running += hiloValue(card);
    this._recalcTrueCount();
  }

  _draw({ faceUp = true } = {}) {
    const c = this.shoe.draw();
    if (faceUp) this._countCardVisible(c);
    else this._holeCountPending += hiloValue(c);
    return c;
  }

  _revealHoleCountIfPending() {
    if (this._holeCountPending !== 0) {
      this.counting.running += this._holeCountPending;
      this._holeCountPending = 0;
      this._recalcTrueCount();
    }
  }

  applySettings(s) {
    const prevDecks = this.settings.decks;
    const prevSeed = this.settings.seed;

    this.settings = { ...this.settings, ...s };
    this.settings.decks = clamp(Number(this.settings.decks || 6), 1, 8);
    this.settings.cutDepth = clamp(Number(this.settings.cutDepth || 70), 1, 400);
    this.settings.minBet = Math.max(1, Number(this.settings.minBet || 2));
    this.settings.maxBet = Math.max(this.settings.minBet, Number(this.settings.maxBet || 500));
    this.settings.startingBankroll = Math.max(1, Number(this.settings.startingBankroll || 500));

    const decksChanged = this.settings.decks !== prevDecks;
    const seedChanged = this.settings.seed !== prevSeed;

    // Sync shoe config (rebuild if needed)
    this.shoe.setConfig({
      decks: this.settings.decks,
      cutDepth: this.settings.cutDepth,
      seed: this.settings.seed
    });

    // If shoe rebuilt due to decks/seed change, reset counting (new shoe)
    if (decksChanged || seedChanged) {
      this.counting.running = 0;
      this.counting.true = 0;
      this._holeCountPending = 0;
    } else {
      this._recalcTrueCount();
    }

    // If bankroll was never initialized, set it
    if (typeof this.bankroll !== "number" || !Number.isFinite(this.bankroll)) {
      this.bankroll = this.settings.startingBankroll;
    }
  }

  resetBankroll() {
    this.bankroll = this.settings.startingBankroll;
    this.emit("log", { msg: `Bankroll reset to $${this.bankroll}.` });
    this.emit("state");
  }

  resetShoe() {
    this.shoe.reshuffle({ reseed: false });

    // Reset count on fresh shuffle
    this.counting.running = 0;
    this.counting.true = 0;
    this._holeCountPending = 0;

    this.emit("log", { msg: `Shoe reset & shuffled. Seed=${this.shoe.seed}` });
    this.emit("state");
  }

  resetRoundState(keepLog = false) {
    this.phase = "betting"; // betting -> initial_deal -> insurance -> player -> dealer -> settlement -> done
    this.dealer = {
      cards: [],
      holeHidden: true
    };

    this.playerHands = [];
    this.activeHandIndex = 0;

    this.round = {
      baseBet: 0,
      insuranceOffered: false,
      insuranceTaken: false,
      insuranceBet: 0,
      dealerPeeked: false,
      dealerHasBlackjack: false,
      cutReachedAtStart: this.shoe.cutReached,
      canStartNewRound: !this.shoe.shouldReshuffleBeforeNextRound(),
      splitCount: 0,
      logCleared: keepLog,

      // stats helper
      wageredThisRound: 0,
      returnedThisRound: 0,
    };

    this.emit("state");
  }

  clearLogOnly() {
    this.emit("clearLog");
  }

  // ---------- Trainer helpers ----------
  _trainerCheck(moveName) {
    // Only penalize when:
    // - training ON
    // - autoplay OFF
    // - not currently auto-acting
    // - we are in a phase where a recommendation is meaningful
    if (!this.settings.training) return;
    if (this.settings.autoplay) return;
    if (this._autoActing) return;
    if (!(this.phase === "player" || this.phase === "insurance")) return;

    // During insurance phase, recommendation is still about play; insurance itself is not recommended.
    const hand = this.currentHand();
    if (!hand || hand.done) return;

    const legal = this._computeLegalMovesObject();
    const rec = recommendMove({
      handCards: hand.cards,
      dealerUpcard: this.dealer.cards[0],
      legalMoves: { ...legal, insurance: false }
    });

    if (!rec.move) return;

    // Normalize naming
    const chosen = moveName;
    const recommended = rec.move;

    if (chosen !== recommended) {
      this.trainer.errors += 1;

      // Simple estimated EV loss: scaled by base bet.
      // (Not claiming exact EV — this is a trainer “sting” metric.)
      const base = Number(hand.baseBet || hand.bet || this.round.baseBet || 0);
      const penalty = round2(Math.max(0.5, base * 0.02)); // $0.50 min, ~2% of base bet
      this.trainer.evLoss = round2(this.trainer.evLoss + penalty);

      this.emit("log", { msg: `[Trainer] Recommended ${recommended.toUpperCase()}, you chose ${chosen.toUpperCase()} (est. EV loss +$${penalty}).` });
    }
  }

  // ---------- Round flow ----------
  startRound(betAmount) {
    this.applySettings(this.getSettings());

    // Clear previous round table state BEFORE anything else (keeps bankroll + shoe, does NOT clear the log)
    this.phase = "betting";
    this.dealer.cards = [];
    this.dealer.holeHidden = true;
    this.playerHands = [];
    this.activeHandIndex = 0;
    this.round = {
      baseBet: 0,
      insuranceOffered: false,
      insuranceTaken: false,
      insuranceBet: 0,
      dealerPeeked: false,
      dealerHasBlackjack: false,
      cutReachedAtStart: this.shoe.cutReached,
      canStartNewRound: !this.shoe.shouldReshuffleBeforeNextRound(),
      splitCount: 0,
      logCleared: true,
      wageredThisRound: 0,
      returnedThisRound: 0,
    };
    this.emit("state");

    // Reshuffle before starting if cut reached or shoe empty
    if (this.shoe.shouldReshuffleBeforeNextRound()) {
      this.shoe.reshuffle({ reseed: false });

      // Reset count on shuffle-before-round
      this.counting.running = 0;
      this.counting.true = 0;
      this._holeCountPending = 0;

      this.emit("log", { msg: `Cut card reached — reshuffling before next round.` });
    }

    const bet = clamp(Number(betAmount || 0), this.settings.minBet, this.settings.maxBet);

    if (!Number.isFinite(bet) || bet <= 0) {
      this.emit("log", { msg: `Invalid bet.` });
      return;
    }
    if (bet < this.settings.minBet || bet > this.settings.maxBet) {
      this.emit("log", { msg: `Bet must be between $${this.settings.minBet} and $${this.settings.maxBet}.` });
      return;
    }
    if (this.bankroll < bet) {
      this.emit("log", { msg: `Insufficient bankroll for $${bet}.` });
      return;
    }

    this.roundNo += 1;
    this.phase = "initial_deal";
    this.round.baseBet = bet;

    // Take the base bet off bankroll (on table)
    this.bankroll -= bet;

    // Stats: wagered this round includes base bet
    this.round.wageredThisRound += bet;

    // Create initial player hand
    this.playerHands = [{
      id: 1,
      cards: [],
      bet,
      baseBet: bet,
      isDoubled: false,
      isSplitAce: false,
      isFromSplit: false,
      blackjackEligible: true,
      done: false,
      outcome: null
    }];
    this.activeHandIndex = 0;

    // Deal sequence: P up, D up, P up, D hole (hidden)
    const p1 = this._draw({ faceUp: true });
    const d1 = this._draw({ faceUp: true });
    const p2 = this._draw({ faceUp: true });
    const d2 = this._draw({ faceUp: false }); // hole hidden; count applied on reveal

    this.playerHands[0].cards.push(p1, p2);
    this.dealer.cards.push(d1, d2);
    this.dealer.holeHidden = true;

    this.emit("log", { msg: `Round ${this.roundNo}: Player bet $${bet}. Dealing...` });
    this.emit("log", { msg: `Player receives ${p1.rank}${p1.suit}, ${p2.rank}${p2.suit}. Dealer shows ${d1.rank}${d1.suit}.` });

    // Dealer peek rules: ONLY if upcard is Ace or ten-value
    const upcard = this.dealer.cards[0];
    const peekAllowed = (upcard.rank === "A" || isTenValue(upcard));

    if (peekAllowed) {
      this.round.dealerPeeked = true;
      const dealerBJ = isBlackjack(this.dealer.cards, { blackjackEligible: true });
      this.round.dealerHasBlackjack = dealerBJ;

      if (dealerBJ) {
        if (upcard.rank === "A") {
          // Offer insurance (optional), but player can still act; if they act we treat it as decline.
          this.phase = "insurance";
          this.round.insuranceOffered = true;
          this.emit("log", { msg: `Dealer upcard is Ace. Insurance offered (max half bet).` });
        } else {
          // Ten-value upcard, no insurance option; reveal immediately and resolve.
          this.dealer.holeHidden = false;
          this._revealHoleCountIfPending();
          this.emit("log", { msg: `Dealer peeks (10-value upcard) and has Blackjack.` });
          this._resolveDealerBlackjackImmediate();
        }
      } else {
        if (upcard.rank === "A") {
          this.phase = "insurance";
          this.round.insuranceOffered = true;
          this.emit("log", { msg: `Dealer upcard is Ace. Insurance offered (max half bet).` });
        } else {
          this.phase = "player";
          this.emit("log", { msg: `Dealer peeks (10-value upcard): no Blackjack. Player acts.` });
          this._maybeAutoPlayTick();
        }
      }
    } else {
      // No peek
      this.round.dealerPeeked = false;
      this.phase = "player";
      this.emit("log", { msg: `Dealer does not peek (upcard not Ace/10). Player acts.` });
      this._maybeAutoPlayTick();
    }

    // Player natural blackjack note
    const playerBJ = isBlackjack(this.playerHands[0].cards, { blackjackEligible: true });
    if (playerBJ) this.emit("log", { msg: `Player has Blackjack (natural).` });

    this.emit("state");
  }

  // If insurance is offered and the player takes ANY action, treat that as "insurance declined"
  _autoDeclineInsuranceOnAction() {
    if (this.phase !== "insurance" || !this.round.insuranceOffered) return false;

    // If they already took insurance, no auto-decline
    if (this.round.insuranceTaken) {
      this.phase = "player";
      return true;
    }

    this.round.insuranceTaken = false;
    this.round.insuranceBet = 0;
    this.emit("log", { msg: `Insurance declined (by action).` });

    const dealerBJ = this.round.dealerHasBlackjack === true;
    if (dealerBJ) {
      this.dealer.holeHidden = false;
      this._revealHoleCountIfPending();
      this.emit("log", { msg: `Dealer peeks (Ace upcard) and has Blackjack.` });
      this._resolveDealerBlackjackImmediate();
      this.emit("state");
      return true;
    }

    this.phase = "player";
    this.emit("log", { msg: `Dealer does not have Blackjack. Play continues.` });
    return true;
  }

  takeInsurance() {
    if (this.phase !== "insurance" || !this.round.insuranceOffered) return;

    const baseBet = this.round.baseBet;
    const maxIns = Math.floor(baseBet / 2);
    if (maxIns <= 0) {
      this.emit("log", { msg: `Insurance not available (bet too small).` });
      this._afterInsuranceChoice();
      return;
    }
    if (this.bankroll <= 0) {
      this.emit("log", { msg: `Insufficient bankroll for insurance.` });
      this._afterInsuranceChoice();
      return;
    }

    const ins = Math.min(maxIns, this.bankroll);
    this.bankroll -= ins;

    this.round.insuranceTaken = true;
    this.round.insuranceBet = ins;

    // stats wagered includes insurance
    this.round.wageredThisRound += ins;

    this.emit("log", { msg: `Insurance taken: $${ins} (pays 2:1 if dealer has Blackjack).` });
    this._afterInsuranceChoice();
  }

  declineInsurance() {
    if (this.phase !== "insurance" || !this.round.insuranceOffered) return;
    this.round.insuranceTaken = false;
    this.round.insuranceBet = 0;
    this.emit("log", { msg: `Insurance declined.` });
    this._afterInsuranceChoice();
  }

  _afterInsuranceChoice() {
    const upcard = this.dealer.cards[0];
    if (upcard.rank === "A") {
      const dealerBJ = this.round.dealerHasBlackjack === true;

      if (dealerBJ) {
        this.dealer.holeHidden = false;
        this._revealHoleCountIfPending();
        this.emit("log", { msg: `Dealer peeks (Ace upcard) and has Blackjack.` });
        this._resolveDealerBlackjackImmediate();
        this.emit("state");
        return;
      }

      if (this.round.insuranceTaken) this.emit("log", { msg: `Dealer does not have Blackjack. Insurance lost.` });
      else this.emit("log", { msg: `Dealer does not have Blackjack. Play continues.` });
    }

    this.phase = "player";
    this.emit("state");
    this._maybeAutoPlayTick();
  }

  // If dealer has BJ, round ends immediately (except pushes for player BJ).
  _resolveDealerBlackjackImmediate() {
    this.phase = "settlement";

    // Insurance settlement
    if (this.round.insuranceTaken && this.round.insuranceBet > 0) {
      const win = this.round.insuranceBet * 3; // return + 2:1 profit
      this.bankroll += win;
      this.round.returnedThisRound += win;
      this.emit("log", { msg: `Insurance pays 2:1. Returned $${win}.` });
    }

    // Main bet resolution
    for (const hand of this.playerHands) {
      const playerBJ = isBlackjack(hand.cards, { blackjackEligible: hand.blackjackEligible });
      if (playerBJ) {
        this.bankroll += hand.bet;
        this.round.returnedThisRound += hand.bet;
        hand.outcome = "push_blackjack";
        hand.done = true;
        this.emit("log", { msg: `Player Blackjack vs Dealer Blackjack: PUSH (bet returned).` });
      } else {
        hand.outcome = "lose_dealer_blackjack";
        hand.done = true;
        this.emit("log", { msg: `Dealer Blackjack: Player hand loses.` });
      }
    }

    this._finalizeRoundStats();
    this.phase = "done";
    this.emit("state");
  }

  // ---------- Player actions ----------
  currentHand() {
    return this.playerHands[this.activeHandIndex] || null;
  }

  hit() {
    if (this.phase !== "player" && this.phase !== "insurance") return;
    const hand = this.currentHand();
    if (!hand || hand.done) return;

    this._trainerCheck("hit");

    if (this.phase === "insurance") {
      this._autoDeclineInsuranceOnAction();
      if (this.phase === "done") return;
    }

    const lm = this._computeLegalMovesObject();
    if (!lm.hit) return;

    const card = this._draw({ faceUp: true });
    hand.cards.push(card);
    this.emit("log", { msg: `Player hits: ${card.rank}${card.suit}.` });

    const e = evaluateHand(hand.cards);
    if (e.isBust) {
      hand.done = true;
      hand.outcome = "bust";
      this.emit("log", { msg: `Player busts (${e.total}). Hand loses immediately.` });
      this._advanceToNextHandOrDealer();
    } else {
      this.emit("log", { msg: `Hand total: ${e.total}${e.soft ? " (soft)" : ""}.` });
    }

    this.emit("state");
    this._maybeAutoPlayTick();
  }

  stand() {
    if (this.phase !== "player" && this.phase !== "insurance") return;
    const hand = this.currentHand();
    if (!hand || hand.done) return;

    this._trainerCheck("stand");

    if (this.phase === "insurance") {
      this._autoDeclineInsuranceOnAction();
      if (this.phase === "done") return;
    }

    const lm = this._computeLegalMovesObject();
    if (!lm.stand) return;

    hand.done = true;
    hand.outcome = "stand";
    this.emit("log", { msg: `Player stands.` });

    this._advanceToNextHandOrDealer();
    this.emit("state");
    this._maybeAutoPlayTick();
  }

  doubleDown() {
    if (this.phase !== "player" && this.phase !== "insurance") return;
    const hand = this.currentHand();
    if (!hand || hand.done) return;

    this._trainerCheck("double");

    if (this.phase === "insurance") {
      this._autoDeclineInsuranceOnAction();
      if (this.phase === "done") return;
    }

    const lm = this._computeLegalMovesObject();
    if (!lm.double) {
      this.emit("log", { msg: `Double not legal (must be first decision, total 9/10/11, and enough bankroll).` });
      this.emit("state");
      return;
    }

    // Take additional bet equal to baseBet
    this.bankroll -= hand.baseBet;
    hand.bet += hand.baseBet;
    hand.isDoubled = true;

    // stats wagered includes the additional bet
    this.round.wageredThisRound += hand.baseBet;

    const card = this._draw({ faceUp: true });
    hand.cards.push(card);

    this.emit("log", { msg: `Player doubles down (+$${hand.baseBet}). One final card: ${card.rank}${card.suit}. Auto-stand.` });

    const e = evaluateHand(hand.cards);
    if (e.isBust) {
      hand.done = true;
      hand.outcome = "bust";
      this.emit("log", { msg: `Player busts (${e.total}) after double. Hand loses immediately.` });
    } else {
      hand.done = true;
      hand.outcome = "stand";
      this.emit("log", { msg: `Hand total: ${e.total}${e.soft ? " (soft)" : ""}.` });
    }

    this._advanceToNextHandOrDealer();
    this.emit("state");
    this._maybeAutoPlayTick();
  }

  split() {
    if (this.phase !== "player" && this.phase !== "insurance") return;
    const hand = this.currentHand();
    if (!hand || hand.done) return;

    this._trainerCheck("split");

    if (this.phase === "insurance") {
      this._autoDeclineInsuranceOnAction();
      if (this.phase === "done") return;
    }

    const lm = this._computeLegalMovesObject();
    if (!lm.split) {
      this.emit("log", { msg: `Split not legal (need a pair, enough bankroll, and split limit not exceeded).` });
      this.emit("state");
      return;
    }

    const [c1, c2] = hand.cards;
    if (!sameRank(c1, c2)) return;

    // Take additional bet equal to original base bet
    this.bankroll -= hand.baseBet;
    this.round.splitCount += 1;

    // stats wagered includes the split bet
    this.round.wageredThisRound += hand.baseBet;

    const left = {
      id: hand.id,
      cards: [c1],
      bet: hand.baseBet,
      baseBet: hand.baseBet,
      isDoubled: false,
      isSplitAce: (c1.rank === "A"),
      isFromSplit: true,
      blackjackEligible: false, // post-split hands not blackjack
      done: false,
      outcome: null
    };

    const right = {
      id: hand.id + 1,
      cards: [c2],
      bet: hand.baseBet,
      baseBet: hand.baseBet,
      isDoubled: false,
      isSplitAce: (c2.rank === "A"),
      isFromSplit: true,
      blackjackEligible: false, // post-split hands not blackjack
      done: false,
      outcome: null
    };

    // Replace current hand with left+right in order
    this.playerHands.splice(this.activeHandIndex, 1, left, right);

    this.emit("log", { msg: `Player splits pair. Added bet $${hand.baseBet}.` });

    if (left.isSplitAce || right.isSplitAce) {
      // Split Aces: exactly one card each, auto-stand both
      const lcard = this._draw({ faceUp: true });
      const rcard = this._draw({ faceUp: true });
      left.cards.push(lcard);
      right.cards.push(rcard);

      left.done = true;
      right.done = true;

      this.emit("log", { msg: `Split Aces: dealt one card to each and auto-stand (no further hits).` });
      this.emit("log", { msg: `Left Ace-hand gets ${lcard.rank}${lcard.suit}. Right Ace-hand gets ${rcard.rank}${rcard.suit}.` });

      this._advanceToDealerPlay();
      this.emit("state");
      return;
    }

    // Non-ace split: deal one card each
    const lcard = this._draw({ faceUp: true });
    const rcard = this._draw({ faceUp: true });
    left.cards.push(lcard);
    right.cards.push(rcard);

    this.emit("log", { msg: `Left hand receives ${lcard.rank}${lcard.suit}.` });
    this.emit("log", { msg: `Right hand receives ${rcard.rank}${rcard.suit}.` });

    this.emit("state");
    this._maybeAutoPlayTick();
  }

  _computeLegalMovesObject() {
    const hand = this.currentHand();
    const canAct = ((this.phase === "player" || this.phase === "insurance") && hand && !hand.done);
    const e = hand ? evaluateHand(hand.cards) : { total: 0, isBust: false };
    const alreadySplitThisRound = this.round.splitCount > 0;

    const canSplitRank = hand && hand.cards.length === 2 && sameRank(hand.cards[0], hand.cards[1]);
    const canSplitBankroll = hand && this.bankroll >= hand.baseBet;
    const canSplit =
      canAct &&
      canSplitRank &&
      canSplitBankroll &&
      (this.settings.allowMultiSplit ? true : !alreadySplitThisRound);

    const canDoubleTotal = (e.total === 9 || e.total === 10 || e.total === 11);
    const canDoubleBankroll = hand && this.bankroll >= hand.baseBet;
    const canDouble = canAct && hand.cards.length === 2 && !hand.isDoubled && canDoubleTotal && canDoubleBankroll;

    return {
      hit: canAct && !e.isBust,
      stand: canAct,
      double: canDouble,
      split: canSplit
    };
  }

  _advanceToNextHandOrDealer() {
    for (let i = 0; i < this.playerHands.length; i++) {
      const idx = (this.activeHandIndex + 1 + i) % this.playerHands.length;
      if (!this.playerHands[idx].done) {
        this.activeHandIndex = idx;
        this.emit("log", { msg: `Now acting on Hand ${idx + 1} of ${this.playerHands.length}.` });
        return;
      }
    }
    this._advanceToDealerPlay();
  }

  _advanceToDealerPlay() {
    this.phase = "dealer";
    this.dealer.holeHidden = false;

    // Hole card becomes visible now → apply pending count
    this._revealHoleCountIfPending();

    this.emit("log", { msg: `Dealer reveals hole card: ${this.dealer.cards[1].rank}${this.dealer.cards[1].suit}.` });

    const dealerBJ = isBlackjack(this.dealer.cards, { blackjackEligible: true });
    if (!this.round.dealerPeeked && dealerBJ) {
      this.emit("log", { msg: `Dealer has Blackjack (no earlier peek).` });
      this.phase = "settlement";
      this.round.dealerHasBlackjack = true;
      this._resolveDealerBlackjackNoInsurance();
      this._finalizeRoundStats();
      this.phase = "done";
      this.emit("state");
      return;
    }

    this._dealerPlayLoop();

    this.phase = "settlement";
    this._settleAllHands();
    this._finalizeRoundStats();
    this.phase = "done";
    this.emit("state");
  }

  _resolveDealerBlackjackNoInsurance() {
    for (const hand of this.playerHands) {
      const playerBJ = isBlackjack(hand.cards, { blackjackEligible: hand.blackjackEligible });
      if (playerBJ) {
        this.bankroll += hand.bet;
        this.round.returnedThisRound += hand.bet;
        hand.outcome = "push_blackjack";
        this.emit("log", { msg: `Blackjack vs Blackjack: PUSH (bet returned).` });
      } else {
        hand.outcome = "lose_dealer_blackjack";
        this.emit("log", { msg: `Dealer Blackjack: player hand loses.` });
      }
      hand.done = true;
    }
  }

  _dealerPlayLoop() {
    while (true) {
      const e = evaluateHand(this.dealer.cards);

      if (e.isBust) {
        this.emit("log", { msg: `Dealer busts (${e.total}).` });
        break;
      }

      if (e.total < 17) {
        const c = this._draw({ faceUp: true });
        this.dealer.cards.push(c);
        this.emit("log", { msg: `Dealer hits: ${c.rank}${c.suit}. (Total now ${evaluateHand(this.dealer.cards).total})` });
        continue;
      }

      if (e.total === 17 && e.soft) {
        this.emit("log", { msg: `Dealer stands on soft 17.` });
        break;
      }

      this.emit("log", { msg: `Dealer stands on ${e.total}${e.soft ? " (soft)" : ""}.` });
      break;
    }
  }

  _settleAllHands() {
    const dealerEval = evaluateHand(this.dealer.cards);
    const dealerBust = dealerEval.isBust;
    const dealerTotal = dealerEval.total;

    const dealerBJ = isBlackjack(this.dealer.cards, { blackjackEligible: true });
    if (dealerBJ) {
      this._resolveDealerBlackjackNoInsurance();
      return;
    }

    for (const hand of this.playerHands) {
      const e = evaluateHand(hand.cards);
      const playerBust = e.isBust;

      const playerBJ = isBlackjack(hand.cards, { blackjackEligible: hand.blackjackEligible });

      if (playerBust) {
        hand.outcome = "lose_bust";
        this.emit("log", { msg: `Hand loses (bust).` });
        continue;
      }

      // Blackjack payout BEFORE dealer bust payout
      if (playerBJ) {
        const pay = Math.floor(hand.bet * 2.5 * 100) / 100; // total returned
        this.bankroll += pay;
        this.round.returnedThisRound += pay;
        hand.outcome = "win_blackjack";
        this.emit("log", { msg: `Blackjack! Pays 3:2. Paid $${pay}.` });
        continue;
      }

      if (dealerBust) {
        const pay = hand.bet * 2;
        this.bankroll += pay;
        this.round.returnedThisRound += pay;
        hand.outcome = "win_dealer_bust";
        this.emit("log", { msg: `Dealer busts. Hand wins 1:1. Paid $${pay}.` });
        continue;
      }

      const playerTotal = e.total;
      if (playerTotal > dealerTotal) {
        const pay = hand.bet * 2;
        this.bankroll += pay;
        this.round.returnedThisRound += pay;
        hand.outcome = "win";
        this.emit("log", { msg: `Hand wins ${playerTotal} vs dealer ${dealerTotal}. Paid $${pay}.` });
      } else if (playerTotal < dealerTotal) {
        hand.outcome = "lose";
        this.emit("log", { msg: `Hand loses ${playerTotal} vs dealer ${dealerTotal}.` });
      } else {
        this.bankroll += hand.bet;
        this.round.returnedThisRound += hand.bet;
        hand.outcome = "push";
        this.emit("log", { msg: `Push ${playerTotal} vs dealer ${dealerTotal}. Bet returned ($${hand.bet}).` });
      }
    }
  }

  _finalizeRoundStats() {
    // Called once per completed round (including dealer blackjack immediate)
    this.stats.hands += 1;

    this.stats.wagered = round2(this.stats.wagered + this.round.wageredThisRound);
    this.stats.returned = round2(this.stats.returned + this.round.returnedThisRound);

    this.stats.net = round2(this.stats.returned - this.stats.wagered);
    this.stats.profitPerHand = this.stats.hands > 0 ? round2(this.stats.net / this.stats.hands) : 0;
  }

  // ---------- Training / Autoplay ----------
  getRecommendation() {
    if (this.phase !== "player") return { move: null, reason: "" };
    const hand = this.currentHand();
    if (!hand || hand.done) return { move: null, reason: "" };
    const up = this.dealer.cards[0];

    const legal = this._computeLegalMovesObject();
    return recommendMove({
      handCards: hand.cards,
      dealerUpcard: up,
      legalMoves: {
        hit: legal.hit,
        stand: legal.stand,
        double: legal.double,
        split: legal.split,
        insurance: false
      }
    });
  }

  _maybeAutoPlayTick() {
    this.applySettings(this.getSettings());
    if (!this.settings.autoplay) return;

    this._autoActing = true;
    try {
      if (this.phase === "insurance") {
        if (autoplayWantsInsurance()) this.takeInsurance();
        else this.declineInsurance();
        return;
      }
      if (this.phase !== "player") return;

      const hand = this.currentHand();
      if (!hand || hand.done) return;

      const e = evaluateHand(hand.cards);
      if (e.isBust) {
        hand.done = true;
        this._advanceToNextHandOrDealer();
        this.emit("state");
        return;
      }

      const legal = this._computeLegalMovesObject();
      const rec = recommendMove({
        handCards: hand.cards,
        dealerUpcard: this.dealer.cards[0],
        legalMoves: { ...legal, insurance: false }
      });

      if (!rec.move) return;

      this.emit("log", { msg: `[Auto-play] chooses ${rec.move.toUpperCase()} — ${rec.reason}` });

      if (rec.move === "split" && legal.split) return this.split();
      if (rec.move === "double" && legal.double) return this.doubleDown();
      if (rec.move === "hit" && legal.hit) return this.hit();
      if (rec.move === "stand" && legal.stand) return this.stand();

      if (legal.stand) return this.stand();
      if (legal.hit) return this.hit();
    } finally {
      this._autoActing = false;
    }
  }

  // ---------- UI-facing snapshot ----------
  snapshot() {
    const up = this.dealer.cards[0] || null;
    const dealerEval = this.dealer.cards.length ? evaluateHand(this.dealer.cards) : null;

    return {
      settings: { ...this.settings },
      phase: this.phase,
      roundNo: this.roundNo,
      bankroll: this.bankroll,
      shoe: {
        remaining: this.shoe.remaining(),
        total: this.shoe.totalCards(),
        cutDepth: this.shoe.cutDepth,
        cutReached: this.shoe.cutReached,
        statusText: this.shoe.statusText(),
        seed: this.shoe.seed
      },
      counting: {
        running: this.counting.running,
        true: this.counting.true
      },
      stats: {
        hands: this.stats.hands,
        wagered: this.stats.wagered,
        returned: this.stats.returned,
        net: this.stats.net,
        profitPerHand: this.stats.profitPerHand
      },
      trainer: {
        errors: this.trainer.errors,
        evLoss: this.trainer.evLoss
      },
      dealer: {
        cards: this.dealer.cards.slice(),
        holeHidden: this.dealer.holeHidden,
        upcard: up,
        total: dealerEval ? dealerEval.total : null,
        soft: dealerEval ? dealerEval.soft : null
      },
      playerHands: this.playerHands.map((h, idx) => {
        const e = evaluateHand(h.cards);
        return {
          ...h,
          index: idx,
          eval: e,
          isActive: idx === this.activeHandIndex,
          isBlackjack: isBlackjack(h.cards, { blackjackEligible: h.blackjackEligible })
        };
      }),
      insurance: {
        offered: this.round.insuranceOffered,
        taken: this.round.insuranceTaken,
        bet: this.round.insuranceBet
      }
    };
  }
}