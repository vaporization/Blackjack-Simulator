// js/tests.js
import { evaluateHand, isBlackjack } from "./hand.js";
import { Shoe } from "./shoe.js";

const out = document.getElementById("out");
const result = document.getElementById("result");

function log(line) {
  const div = document.createElement("div");
  div.className = "logline";
  div.textContent = line;
  out.appendChild(div);
}

function assert(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  log(`✅ ${name}`);
}

function run() {
  log("Running tests...");

  // Hand totals / soft logic
  const A = (s) => ({ rank: "A", suit: s });
  const K = (s) => ({ rank: "K", suit: s });
  const N = (r, s) => ({ rank: String(r), suit: s });

  let e = evaluateHand([A("♠"), N(6,"♦")]); // soft 17
  assert("Soft 17 total is 17", e.total === 17);
  assert("Soft 17 is soft", e.soft === true);

  e = evaluateHand([A("♠"), N(6,"♦"), N(9,"♣")]); // 16 hard (Ace becomes 1)
  assert("A+6+9 = 16", e.total === 16);
  assert("A+6+9 is not soft", e.soft === false);

  e = evaluateHand([A("♠"), A("♥"), N(9,"♣")]); // 21 (soft)
  assert("A+A+9 = 21", e.total === 21);
  assert("A+A+9 is soft", e.soft === true);

  e = evaluateHand([N(10,"♠"), N(9,"♥"), N(5,"♣")]); // 24 bust
  assert("10+9+5 bust", e.isBust === true);

  // Blackjack detection
  assert("A+K is blackjack eligible", isBlackjack([A("♠"), K("♦")], { blackjackEligible: true }) === true);
  assert("A+K not blackjack if ineligible", isBlackjack([A("♠"), K("♦")], { blackjackEligible: false }) === false);

  // Shoe determinism
  const s1 = new Shoe({ decks: 1, cutDepth: 60, seed: "demo-seed" });
  const s2 = new Shoe({ decks: 1, cutDepth: 60, seed: "demo-seed" });
  const c11 = s1.draw();
  const c21 = s2.draw();
  assert("Seeded shoe first card deterministic (rank)", c11.rank === c21.rank);
  assert("Seeded shoe first card deterministic (suit)", c11.suit === c21.suit);

  // Cut reached should flag at the correct place
  const s3 = new Shoe({ decks: 1, cutDepth: 60, seed: 123 });
  const cutIdx = s3.cutIndex();
  while (s3.position < cutIdx) s3.draw();
  assert("Cut not reached just before index", s3.cutReached === false);
  s3.draw();
  assert("Cut reached at/after cut index", s3.cutReached === true);

  log("All tests passed.");
  result.textContent = "PASS ✅";
}

try {
  run();
} catch (err) {
  log(String(err.stack || err));
  result.textContent = "FAIL ❌";
}