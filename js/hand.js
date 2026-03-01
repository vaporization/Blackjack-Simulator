// js/hand.js
// Core hand utilities for Blackjack

// Card shape expected throughout:
// { rank: "A"|"2"|...|"10"|"J"|"Q"|"K", suit: "♠"|"♥"|"♦"|"♣" }

export function formatCard(c) {
  if (!c) return "";
  return `${c.rank}${c.suit}`;
}

export function sameRank(a, b) {
  if (!a || !b) return false;
  return String(a.rank) === String(b.rank);
}

export function isTenValue(card) {
  if (!card) return false;
  const r = String(card.rank);
  return r === "10" || r === "J" || r === "Q" || r === "K";
}

// For strategy tables, Ace is treated as 11 (often shown as "A")
export function upcardValueForStrategy(card) {
  if (!card) return 0;
  const r = String(card.rank);

  if (r === "A") return 11;
  if (r === "K" || r === "Q" || r === "J" || r === "10") return 10;

  const n = Number(r);
  return Number.isFinite(n) ? n : 0;
}

function cardValueForTotal(card) {
  const r = String(card.rank);

  // ✅ Ace starts as 11 in Blackjack hand totals
  if (r === "A") return 11;

  // Face cards / ten
  if (r === "K" || r === "Q" || r === "J" || r === "10") return 10;

  const n = Number(r);
  return Number.isFinite(n) ? n : 0;
}

// Returns: { total, soft, isBust }
export function evaluateHand(cards = []) {
  let total = 0;
  let aces = 0;

  for (const c of cards) {
    if (!c) continue;
    const r = String(c.rank);
    if (r === "A") aces += 1;
    total += cardValueForTotal(c);
  }

  // ✅ If we're over 21, convert A(11) -> A(1) by subtracting 10 per Ace
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  // "soft" means at least one Ace is still being counted as 11
  const soft = cards.some(c => c && String(c.rank) === "A") && total <= 21 && (() => {
    // Recompute: if we can add 10 without busting, it means at least one Ace is still 11.
    // Easier: detect whether any Ace is effectively 11 by checking if treating one Ace as 11 is possible.
    // We can do this by computing a "hard total" (all aces as 1) and seeing if we added +10.
    let hardTotal = 0;
    for (const c of cards) {
      if (!c) continue;
      const r = String(c.rank);
      if (r === "A") hardTotal += 1;
      else hardTotal += cardValueForTotal(c);
    }
    return (hardTotal + 10) === total;
  })();

  return {
    total,
    soft,
    isBust: total > 21
  };
}

export function isBlackjack(cards = [], { blackjackEligible = true } = {}) {
  if (!blackjackEligible) return false;
  if (!Array.isArray(cards) || cards.length !== 2) return false;

  const [a, b] = cards;
  if (!a || !b) return false;

  const ar = String(a.rank);
  const br = String(b.rank);

  const oneAce = (ar === "A") || (br === "A");
  const otherTen = (ar !== "A" && isTenValue(a)) || (br !== "A" && isTenValue(b));

  return oneAce && otherTen;
}