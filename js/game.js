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

    this.resetRoundState(true);
  }

  emit(type, payload = {}) {
    this.onEvent({ type, time: nowTime(), ...payload });
  }

  applySettings(s) {
    this.settings = { ...this.settings, ...s };
    this.settings.decks = clamp(Number(this.settings.decks || 6), 1, 8);
    this.settings.cutDepth = clamp(Number(this.settings.cutDepth || 70), 1, 400);
    this.settings.minBet = Math.max(1, Number(this.settings.minBet || 2));
    this.settings.maxBet = Math.max(this.settings.minBet, Number(this.settings.maxBet || 500));
    this.settings.startingBankroll = Math.max(1, Number(this.settings.startingBankroll || 500));

    // Sync shoe config (rebuild if needed)
    this.shoe.setConfig({
      decks: this.settings.decks,
      cutDepth: this.settings.cutDepth,
      seed: this.settings.seed
    });

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
      logCleared: keepLog
    };

    this.emit("state");
  }

  clearLogOnly() {
    this.emit("clearLog");
  }

  // ---------- Insurance behavior ----------
  // If insurance is currently offered, any player action should be allowed to implicitly decline it.
  _declineInsuranceIfOffered() {
    if (this.phase !== "insurance") return;
    if (!this.round.insuranceOffered) return;

    // If player already took/declined via button, nothing to do
    // (insuranceTaken=false is same as declined, but we still need to advance phase)
    if (this.round.insuranceTaken) {
      // Insurance already taken via button; flow will advance via _afterInsuranceChoice()
      return;
    }

    // Explicitly mark declined (clean state)
    this.round.insuranceTaken = false;
    this.round.insuranceBet = 0;

    // Now resolve peek result and continue
    if (this.round.dealerHasBlackjack) {
      this.dealer.holeHidden = false;
      this.emit("log", { msg: `Player declines insurance. Dealer has Blackjack.` });
      this._resolveDealerBlackjackImmediate();
      return;
    }

    this.phase = "player";
    this.emit("log", { msg: `Player declines insurance. Dealer peeks: no Blackjack. Player acts.` });
    this.emit("state");
    this._maybeAutoPlayTick();
  }

  // ---------- Round flow ----------
  startRound(betAmount) {
    this.applySettings(this.getSettings());

    // ✅ Clear previous round table state BEFORE anything else (keep bankroll + shoe, do NOT clear log)
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
      logCleared: true
    };
    this.emit("state");

    // Reshuffle before starting if cut reached or shoe empty
    if (this.shoe.shouldReshuffleBeforeNextRound()) {
      this.shoe.reshuffle({ reseed: false });
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

    // Deal sequence: P up, D up, P up, D hole
    const p1 = this.shoe.draw();
    const d1 = this.shoe.draw();
    const p2 = this.shoe.draw();
    const d2 = this.shoe.draw();

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
          this.phase = "insurance";
          this.round.insuranceOffered = true;
          this.emit("log", { msg: `Dealer upcard is Ace. Insurance offered (max half bet).` });
        } else {
          this.dealer.holeHidden = false;
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
      this.round.dealerPeeked = false;
      this.phase = "player";
      this.emit("log", { msg: `Dealer does not peek (upcard not Ace/10). Player acts.` });
      this._maybeAutoPlayTick();
    }

    const playerBJ = isBlackjack(this.playerHands[0].cards, { blackjackEligible: true });
    if (playerBJ) {
      this.emit("log", { msg: `Player has Blackjack (natural).` });
    }

    this.emit("state");
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
    if (this.bankroll < maxIns) {
      if (this.bankroll <= 0) {
        this.emit("log", { msg: `Insufficient bankroll for insurance.` });
        this._afterInsuranceChoice();
        return;
      }
    }

    const ins = Math.min(maxIns, this.bankroll);
    this.bankroll -= ins;

    this.round.insuranceTaken = true;
    this.round.insuranceBet = ins;

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
    // After insurance decision, if dealer peeked and had blackjack => resolve immediately
    const upcard = this.dealer.cards[0];
    if (upcard.rank === "A") {
      const dealerBJ = this.round.dealerHasBlackjack === true;

      if (dealerBJ) {
        this.dealer.holeHidden = false;
        this.emit("log", { msg: `Dealer peeks (Ace upcard) and has Blackjack.` });
        this._resolveDealerBlackjackImmediate();
        this.emit("state");
        return;
      }

      if (this.round.insuranceTaken) {
        this.emit("log", { msg: `Dealer does not have Blackjack. Insurance lost.` });
      } else {
        this.emit("log", { msg: `Dealer does not have Blackjack. Play continues.` });
      }
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
      this.emit("log", { msg: `Insurance pays 2:1. Returned $${win}.` });
    }

    // Main bet resolution
    for (const hand of this.playerHands) {
      const playerBJ = isBlackjack(hand.cards, { blackjackEligible: hand.blackjackEligible });
      if (playerBJ) {
        this.bankroll += hand.bet;
        hand.outcome = "push_blackjack";
        hand.done = true;
        this.emit("log", { msg: `Player Blackjack vs Dealer Blackjack: PUSH (bet returned).` });
      } else {
        hand.outcome = "lose_dealer_blackjack";
        hand.done = true;
        this.emit("log", { msg: `Dealer Blackjack: Player hand loses.` });
      }
    }

    this.phase = "done";
    this.emit("state");
  }

  // ---------- Player actions ----------
  currentHand() {
    return this.playerHands[this.activeHandIndex] || null;
  }

  legalMoves() {
    const hand = this.currentHand();
    const up = this.dealer.cards[0];
    const upNum = up ? upcardValueForStrategy(up) : null;

    // ✅ Allow actions during insurance (they will implicitly decline)
    const canAct = ((this.phase === "player" || this.phase === "insurance") && hand && !hand.done);

    const evald = hand ? evaluateHand(hand.cards) : { total: 0, isBust: false, soft: false };
    const alreadySplitThisRound = this.round.splitCount > 0;

    // split legality
    const canSplitRank = hand && hand.cards.length === 2 && sameRank(hand.cards[0], hand.cards[1]);
    const canSplitBankroll = hand && this.bankroll >= hand.bet;
    const canSplitByRules = canSplitRank && canSplitBankroll && canAct;

    const canSplit =
      canSplitByRules &&
      (this.settings.allowMultiSplit ? true : !alreadySplitThisRound);

    // double legality (Bicycle default)
    const canDoubleTotal = (evald.total === 9 || evald.total === 10 || evald.total === 11);
    const canDoubleBankroll = hand && this.bankroll >= hand.bet;
    const canDouble = canAct && hand.cards.length === 2 && !hand.isDoubled && canDoubleTotal && canDoubleBankroll;

    const canInsurance = (this.phase === "insurance" && this.round.insuranceOffered);

    return {
      hit: canAct && !evald.isBust,
      stand: canAct,
      double: canDouble,
      split: canSplit,
      insurance: canInsurance,
      dealerUp: upNum
    };
  }

  hit() {
    // ✅ If insurance is pending, allow hit to implicitly decline it
    this._declineInsuranceIfOffered();

    if (this.phase !== "player") return;
    const hand = this.currentHand();
    if (!hand || hand.done) return;

    const lm = this._computeLegalMovesObject();
    if (!lm.hit) return;

    const card = this.shoe.draw();
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
    // ✅ If insurance is pending, allow stand to implicitly decline it
    this._declineInsuranceIfOffered();

    if (this.phase !== "player") return;
    const hand = this.currentHand();
    if (!hand || hand.done) return;

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
    // ✅ If insurance is pending, allow double to implicitly decline it
    this._declineInsuranceIfOffered();

    if (this.phase !== "player") return;
    const hand = this.currentHand();
    if (!hand || hand.done) return;

    const lm = this._computeLegalMovesObject();
    if (!lm.double) {
      this.emit("log", { msg: `Double not legal (must be first decision, total 9/10/11, and enough bankroll).` });
      this.emit("state");
      return;
    }

    // Take additional bet
    this.bankroll -= hand.bet;
    hand.bet += hand.baseBet;
    hand.isDoubled = true;

    const card = this.shoe.draw();
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
    // ✅ If insurance is pending, allow split to implicitly decline it
    this._declineInsuranceIfOffered();

    if (this.phase !== "player") return;
    const hand = this.currentHand();
    if (!hand || hand.done) return;

    const lm = this._computeLegalMovesObject();
    if (!lm.split) {
      this.emit("log", { msg: `Split not legal (need a pair, enough bankroll, and split limit not exceeded).` });
      this.emit("state");
      return;
    }

    const [c1, c2] = hand.cards;
    if (!sameRank(c1, c2)) return;

    // Take additional bet equal to original
    this.bankroll -= hand.baseBet;

    this.round.splitCount += 1;

    const left = {
      id: hand.id,
      cards: [c1],
      bet: hand.baseBet,
      baseBet: hand.baseBet,
      isDoubled: false,
      isSplitAce: (c1.rank === "A"),
      isFromSplit: true,
      blackjackEligible: false,
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
      blackjackEligible: false,
      done: false,
      outcome: null
    };

    this.playerHands.splice(this.activeHandIndex, 1, left, right);

    this.emit("log", { msg: `Player splits pair. Added bet $${hand.baseBet}. Now playing left hand first.` });

    if (left.isSplitAce || right.isSplitAce) {
      const lcard = this.shoe.draw();
      const rcard = this.shoe.draw();
      left.cards.push(lcard);
      right.cards.push(rcard);

      left.done = true;
      right.done = true;

      this.emit("log", { msg: `Split Aces: dealt one card to each and auto-stand (no further hits).` });
      this.emit("log", { msg: `Left Ace-hand gets ${lcard.rank}${lcard.suit}. Right Ace-hand gets ${rcard.rank}${rcard.suit}.` });

      this._advanceToDealerPlay();
      this.emit("state");
      return;
    } else {
      const lcard = this.shoe.draw();
      left.cards.push(lcard);
      this.emit("log", { msg: `Left hand receives ${lcard.rank}${lcard.suit}.` });

      this.emit("state");
      this._maybeAutoPlayTick();
    }
  }

  _computeLegalMovesObject() {
    const hand = this.currentHand();
    const canAct = (this.phase === "player" && hand && !hand.done);
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

    this.emit("log", { msg: `Dealer reveals hole card: ${this.dealer.cards[1].rank}${this.dealer.cards[1].suit}.` });

    const dealerBJ = isBlackjack(this.dealer.cards, { blackjackEligible: true });
    if (!this.round.dealerPeeked && dealerBJ) {
      this.emit("log", { msg: `Dealer has Blackjack (no earlier peek).` });
      this.phase = "settlement";
      this.round.dealerHasBlackjack = true;
      this._resolveDealerBlackjackNoInsurance();
      this.phase = "done";
      this.emit("state");
      return;
    }

    this._dealerPlayLoop();

    this.phase = "settlement";
    this._settleAllHands();
    this.phase = "done";
    this.emit("state");
  }

  _resolveDealerBlackjackNoInsurance() {
    for (const hand of this.playerHands) {
      const playerBJ = isBlackjack(hand.cards, { blackjackEligible: hand.blackjackEligible });
      if (playerBJ) {
        this.bankroll += hand.bet;
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

      if (e.total < 17) {
        const c = this.shoe.draw();
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

      if (dealerBust) {
        const pay = hand.bet * 2;
        this.bankroll += pay;
        hand.outcome = "win_dealer_bust";
        this.emit("log", { msg: `Dealer busts. Hand wins 1:1. Paid $${pay}.` });
        continue;
      }

      if (playerBJ) {
        const pay = Math.floor(hand.bet * 2.5 * 100) / 100;
        this.bankroll += pay;
        hand.outcome = "win_blackjack";
        this.emit("log", { msg: `Blackjack! Pays 3:2. Paid $${pay}.` });
        continue;
      }

      const playerTotal = e.total;
      if (playerTotal > dealerTotal) {
        const pay = hand.bet * 2;
        this.bankroll += pay;
        hand.outcome = "win";
        this.emit("log", { msg: `Hand wins ${playerTotal} vs dealer ${dealerTotal}. Paid $${pay}.` });
      } else if (playerTotal < dealerTotal) {
        hand.outcome = "lose";
        this.emit("log", { msg: `Hand loses ${playerTotal} vs dealer ${dealerTotal}.` });
      } else {
        this.bankroll += hand.bet;
        hand.outcome = "push";
        this.emit("log", { msg: `Push ${playerTotal} vs dealer ${dealerTotal}. Bet returned ($${hand.bet}).` });
      }
    }
  }

  // ---------- Training / Autoplay ----------
  getRecommendation() {
    if (this.phase !== "player") return { move: null, reason: "" };
    const hand = this.currentHand();
    if (!hand || hand.done) return { move: null, reason: "" };
    const up = this.dealer.cards[0];

    const legal = this._computeLegalMovesObject();
    const rec = recommendMove({
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
    return rec;
  }

  _maybeAutoPlayTick() {
    this.applySettings(this.getSettings());
    if (!this.settings.autoplay) return;

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