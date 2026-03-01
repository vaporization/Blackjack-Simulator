// js/shoe.js
// Shoe / deck manager with deterministic shuffle (seeded PRNG), cut-card behavior.
// - "cutDepth" is the number of cards at the end of the shoe that we do NOT deal into.
// - We allow finishing the current round even if the cut is reached mid-round,
//   but we reshuffle BEFORE the next round begins.

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function hashStringToUint32(str) {
  // Simple, stable string hash -> uint32
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Shoe {
  constructor({ decks = 6, cutDepth = 70, seed = "" } = {}) {
    this.decks = decks;
    this.cutDepth = cutDepth;
    this.seedRaw = seed;
    this.seed = this._normalizeSeed(seed);
    this._rng = mulberry32(this.seed);
    this.cards = [];
    this.position = 0;
    this.cutReached = false;
    this._buildAndShuffle();
  }

  _normalizeSeed(seed) {
    if (seed === null || seed === undefined || seed === "") {
      // No seed => random-ish seed from time
      return (Date.now() & 0xffffffff) >>> 0;
    }
    if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
    const s = String(seed);
    // If numeric-looking, parse; else hash.
    const n = Number(s);
    if (Number.isFinite(n) && s.trim() !== "") return (n >>> 0);
    return hashStringToUint32(s);
  }

  _buildDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ rank, suit });
      }
    }
    return deck;
  }

  _buildAndShuffle() {
    this.cards = [];
    for (let d = 0; d < this.decks; d++) {
      this.cards.push(...this._buildDeck());
    }
    // Fisher-Yates
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(this._rng() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    this.position = 0;
    this.cutReached = false;
  }

  setConfig({ decks, cutDepth, seed }) {
    const decksChanged = (decks !== undefined && decks !== this.decks);
    const cutChanged = (cutDepth !== undefined && cutDepth !== this.cutDepth);
    const seedChanged = (seed !== undefined && seed !== this.seedRaw);

    if (decks !== undefined) this.decks = decks;
    if (cutDepth !== undefined) this.cutDepth = cutDepth;

    if (seed !== undefined) {
      this.seedRaw = seed;
      this.seed = this._normalizeSeed(seed);
      this._rng = mulberry32(this.seed);
    }

    // Rebuild if decks/seed changed. If only cut depth changed, keep shoe but update cut logic.
    if (decksChanged || seedChanged) {
      this._buildAndShuffle();
    } else if (cutChanged) {
      // Evaluate cutReached under new depth
      this._updateCutReached();
    }
  }

  remaining() {
    return this.cards.length - this.position;
  }

  totalCards() {
    return this.cards.length;
  }

  cutIndex() {
    // When position >= (total - cutDepth), we consider the cut reached
    return Math.max(0, this.cards.length - this.cutDepth);
  }

  _updateCutReached() {
    if (this.position >= this.cutIndex()) this.cutReached = true;
  }

  shouldReshuffleBeforeNextRound() {
    return this.cutReached || this.remaining() <= 0;
  }

  draw() {
    if (this.remaining() <= 0) {
      // Hard-stop: no cards left. Caller should reshuffle then retry.
      throw new Error("Shoe is empty. Reshuffle required.");
    }
    const card = this.cards[this.position++];
    this._updateCutReached();
    return card;
  }

  reshuffle({ reseed = false } = {}) {
    if (reseed) {
      this.seed = (Date.now() & 0xffffffff) >>> 0;
      this.seedRaw = "";
      this._rng = mulberry32(this.seed);
    } else {
      // Keep same seed -> deterministic but note: reshuffle will continue RNG stream.
      // That’s fine for reproducibility within a session.
    }
    this._buildAndShuffle();
  }

  statusText() {
    const rem = this.remaining();
    const total = this.totalCards();
    const cutAt = total - this.cutDepth;
    const cutStr = this.cutReached ? "CUT REACHED" : `cut @ ${cutAt}`;
    return `${rem}/${total} • ${cutStr}`;
  }
}