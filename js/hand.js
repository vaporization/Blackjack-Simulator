// js/hand.js
// Hand evaluation logic (soft totals, blackjack detection, etc.)

export function cardValue(card) {
  const r = card.rank;
  if (r === "A") return 11; // initially count as 11; we'll reduce via soft logic
  if (r === "K" || r === "Q" || r === "J") return 10;
  return Number(r); // 2..10
}

export function isTenValue(card) {
  return card.rank === "10" || card.rank === "J" || card.rank === "Q" || card.rank === "K";
}

export function isAce(card) {
  return card.rank === "A";
}

export function sameRank(c1, c2) {
  return c1 && c2 && c1.rank === c2.rank;
}

export function evaluateHand(cards) {
  // Returns best total <=21 if possible, else lowest total (bust total),
  // plus soft flag indicating an Ace is currently being counted as 11.
  let total = 0;
  let aces = 0;

  for (const c of cards) {
    if (c.rank === "A") aces++;
    total += cardValue(c);
  }

  // Reduce Aces from 11 -> 1 as needed to avoid bust.
  let soft = false;
  while (total > 21 && aces > 0) {
    total -= 10; // convert one Ace from 11 to 1
    aces--;
  }

  // If total <= 21 and we still have at least one Ace counted as 11, it's soft.
  // How to detect: if there exists an Ace that *could* be 11 without bust.
  // Compute minimal total (all Aces as 1), then see if we can add 10.
  const minTotal = cards.reduce((sum, c) => {
    if (c.rank === "A") return sum + 1;
    if (c.rank === "K" || c.rank === "Q" || c.rank === "J") return sum + 10;
    return sum + Number(c.rank);
  }, 0);
  if (minTotal <= 11 && cards.some(c => c.rank === "A") && total <= 21) {
    // There is at least one Ace that can be 11 (minTotal + 10 <= 21)
    if (minTotal + 10 <= 21) soft = true;
  }

  const isBust = total > 21;
  return { total, soft, isBust };
}

export function isBlackjack(cards, { blackjackEligible = true } = {}) {
  // Blackjack only if exactly 2 cards: Ace + ten-value, AND eligible.
  if (!blackjackEligible) return false;
  if (cards.length !== 2) return false;
  const [a, b] = cards;
  return (isAce(a) && isTenValue(b)) || (isAce(b) && isTenValue(a));
}

export function formatCard(card) {
  // Pretty display rank + suit
  return `${card.rank}${card.suit}`;
}

export function upcardValueForStrategy(card) {
  // Map dealer upcard ranks to numeric for comparisons in strategy heuristics.
  // A => 11
  if (!card) return null;
  if (card.rank === "A") return 11;
  if (card.rank === "K" || card.rank === "Q" || card.rank === "J") return 10;
  return Number(card.rank);
}