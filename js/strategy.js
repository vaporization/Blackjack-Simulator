// js/strategy.js
// Bicycle-style simplified "basic strategy" heuristics (as specified).
// Not a full chart — intentionally minimal guidance.

import { evaluateHand, isBlackjack, upcardValueForStrategy, sameRank } from "./hand.js";

function dealerBucket(up) {
  // up is numeric upcard: 2..11(A)
  if (up >= 7) return "7-A";
  if (up >= 4 && up <= 6) return "4-6";
  if (up === 2 || up === 3) return "2-3";
  return "other";
}

function canDoubleHeuristic(total, dealerUp) {
  // Doubling guidance:
  // 11 always double
  // 10 double unless dealer shows 10 or A
  // 9 double only vs dealer 2–6
  if (total === 11) return true;
  if (total === 10) return (dealerUp !== 10 && dealerUp !== 11);
  if (total === 9) return (dealerUp >= 2 && dealerUp <= 6);
  return false;
}

function shouldSplitHeuristic(cards, dealerUp) {
  // Splitting guidance:
  // always split Aces and 8s
  // never split 10s or 5s
  // don’t split 4s
  // 2/3/7 split unless dealer 8/A/9/10
  // 6 split only vs dealer 2–6
  if (cards.length !== 2) return false;
  const [c1, c2] = cards;
  if (!sameRank(c1, c2)) return false;

  const r = c1.rank;
  if (r === "A" || r === "8") return true;
  if (r === "10" || r === "J" || r === "Q" || r === "K") return false;
  if (r === "5") return false;
  if (r === "4") return false;

  const badFor237 = new Set([8,9,10,11]); // 8,9,10,A
  if (r === "2" || r === "3" || r === "7") {
    return !badFor237.has(dealerUp);
  }
  if (r === "6") {
    return (dealerUp >= 2 && dealerUp <= 6);
  }
  // 9s not specified; default to "no split" under these heuristics.
  return false;
}

export function recommendMove({ handCards, dealerUpcard, legalMoves }) {
  // legalMoves: { hit, stand, double, split, insurance }
  // returns { move: "hit"|"stand"|"double"|"split"|"insurance"|null, reason: string }
  if (!handCards || handCards.length === 0) return { move: null, reason: "" };

  const up = upcardValueForStrategy(dealerUpcard);
  if (!up) return { move: null, reason: "" };

  // Insurance recommendation: Bicycle guidance isn't explicit here; we do NOT recommend it.

  // If blackjack, stand (no action needed)
  if (isBlackjack(handCards, { blackjackEligible: true })) {
    return { move: "stand", reason: "Blackjack — no further action." };
  }

  // Split heuristics first (if legal)
  if (legalMoves.split && shouldSplitHeuristic(handCards, up)) {
    return { move: "split", reason: "Heuristic: split this pair." };
  }

  const { total, soft } = evaluateHand(handCards);

  // Double heuristics (if legal + matches totals)
  if (legalMoves.double && canDoubleHeuristic(total, up)) {
    return { move: "double", reason: "Heuristic: double on 9/10/11 vs this upcard." };
  }

  // Stand/hit heuristics based on dealer upcard bucket
  const bucket = dealerBucket(up);

  if (bucket === "7-A") {
    if (soft) {
      // soft hands: hit until >= 18
      if (total < 18 && legalMoves.hit) return { move: "hit", reason: "Dealer 7–A: hit soft totals until 18+." };
      return { move: "stand", reason: "Dealer 7–A: stand on soft 18+." };
    } else {
      // hard: hit until >= 17
      if (total < 17 && legalMoves.hit) return { move: "hit", reason: "Dealer 7–A: hit until 17+." };
      return { move: "stand", reason: "Dealer 7–A: stand on 17+." };
    }
  }

  if (bucket === "4-6") {
    if (total >= 12) return { move: "stand", reason: "Dealer 4–6: stand on 12+." };
    return { move: "hit", reason: "Dealer 4–6: hit below 12." };
  }

  if (bucket === "2-3") {
    if (total >= 13) return { move: "stand", reason: "Dealer 2–3: stand on 13+." };
    return { move: "hit", reason: "Dealer 2–3: hit below 13." };
  }

  // Fallback
  return { move: legalMoves.hit ? "hit" : "stand", reason: "Fallback: choose the only legal move." };
}

export function autoplayWantsInsurance() {
  // Keep it simple: auto-play does NOT take insurance unless you add your own policy.
  return false;
}