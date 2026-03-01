<!-- README.md -->
# Blackjack Simulator (Static GitHub Pages)

A casino-style Blackjack simulator that runs **fully offline** as a static site (HTML/CSS/JS only). Implements the **Bicycle casino rules as specified in the prompt**, including:

- Shoe with multiple decks (default **6**)
- Cut card behavior (don’t start a new round once the cut card is reached; configurable “cards not dealt”)
- Dealer hole-card & peek rules
- Full action set: **Hit, Stand, Double Down (9/10/11), Split, Insurance**
- Split Aces: **one card each, auto-stand**, and **A + ten after split is NOT blackjack** (pays 1:1 only)
- Blackjack pays **3:2** (when dealer does not have blackjack)
- Dealer hits ≤16, stands ≥17, and **stands on soft 17** per requirement
- Context-sensitive UI, action log, training recommendations, and optional auto-play

## Run locally (offline)

Just open `index.html` in a browser.

If your browser blocks module imports from `file://`, run a tiny local server:

### Option A (Python)
```bash
python -m http.server 8000