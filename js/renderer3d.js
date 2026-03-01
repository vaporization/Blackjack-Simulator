// js/renderer3d.js
// Lightweight 3D table renderer (no game logic).
// Phase 1: static layout + live card textures (no dealing animation yet).

import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

const SUIT_COLOR = { "♥": "#d83a3a", "♦": "#d83a3a", "♣": "#111111", "♠": "#111111" };

function makeCardTexture({ rank, suit, faceUp }) {
  const w = 256, h = 356;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");

  // background + border
  g.fillStyle = faceUp ? "#f7f8fb" : "#163a7a";
  g.fillRect(0, 0, w, h);
  g.lineWidth = 10;
  g.strokeStyle = faceUp ? "#dfe3ee" : "#0e2a60";
  g.strokeRect(8, 8, w - 16, h - 16);

  if (!faceUp) {
    // simple back pattern
    g.globalAlpha = 0.25;
    g.fillStyle = "#ffffff";
    for (let y = 24; y < h; y += 28) {
      for (let x = 24; x < w; x += 28) {
        g.beginPath();
        g.arc(x, y, 6, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    return new THREE.CanvasTexture(c);
  }

  const col = SUIT_COLOR[suit] || "#111";
  g.fillStyle = col;

  // corner
  g.font = "bold 64px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  g.fillText(rank, 26, 78);
  g.font = "bold 56px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  g.fillText(suit, 32, 138);

  // center pip
  g.font = "bold 140px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(suit, w / 2, h / 2 + 10);

  // mini corner
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.font = "bold 34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  g.fillText(rank + suit, 26, h - 34);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function makeCardMaterial(card, faceUp) {
  const tex = makeCardTexture({ rank: card.rank, suit: card.suit, faceUp });
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true });
}

export class ThreeTable {
  constructor({ hudDealerEl = null, hudPlayerEl = null } = {}) {
    this.hudDealerEl = hudDealerEl;
    this.hudPlayerEl = hudPlayerEl;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.container = null;

    this._raf = 0;
    this._cards = new Map(); // key -> mesh
    this._lastSig = "";
    this._resizeObs = null;
  }

  init(container) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x050a14, 2.0, 7.5);

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 420;

    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 50);
    this.camera.position.set(0, 2.6, 5.2);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x000000, 0);

    // wipe any children and mount canvas
    container.innerHTML = "";
    container.appendChild(this.renderer.domElement);

    // Table plane
    const tableGeo = new THREE.PlaneGeometry(8, 4.6);
    const tableMat = new THREE.MeshBasicMaterial({ color: 0x0b3b2e });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.02;
    this.scene.add(table);

    // subtle "rail"
    const railGeo = new THREE.RingGeometry(2.2, 3.0, 64);
    const railMat = new THREE.MeshBasicMaterial({ color: 0x0a1020, transparent: true, opacity: 0.25 });
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.rotation.x = -Math.PI / 2;
    rail.position.y = -0.019;
    this.scene.add(rail);

    // Resize observer
    this._resizeObs = new ResizeObserver(() => this._resize());
    this._resizeObs.observe(container);

    this._tick();
  }

  _resize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 420;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._resizeObs) this._resizeObs.disconnect();

    for (const mesh of this._cards.values()) {
      if (mesh.material?.map) mesh.material.map.dispose();
      mesh.material?.dispose?.();
      mesh.geometry?.dispose?.();
    }
    this._cards.clear();

    if (this.renderer) this.renderer.dispose();
    if (this.container) this.container.innerHTML = "";

    this.scene = this.camera = this.renderer = this.container = null;
    this._lastSig = "";
  }

  _tick = () => {
    this._raf = requestAnimationFrame(this._tick);
    if (!this.renderer || !this.scene || !this.camera) return;
    this.renderer.render(this.scene, this.camera);
  };

  render(s) {
    if (!this.scene) return;

    // HUD
    if (this.hudDealerEl) {
      this.hudDealerEl.textContent = s.dealer?.holeHidden
        ? `Up: ${s.dealer?.upcard?.rank ?? "—"}${s.dealer?.upcard?.suit ?? ""}`
        : (s.dealer?.totalText ?? "Total: —");
    }
    if (this.hudPlayerEl) {
      const act = (s.playerHands || []).find(h => h.isActive) || (s.playerHands || [])[0];
      const t = act?.eval ? `${act.eval.total}${act.eval.soft ? " (soft)" : ""}` : "—";
      this.hudPlayerEl.textContent = `Active: ${t}`;
    }

    const dealer = s.dealer?.cards || [];
    const hands = s.playerHands || [];

    const sig = JSON.stringify({
      d: dealer.map(c => [c.rank, c.suit]),
      hh: !!s.dealer?.holeHidden,
      p: hands.map(h => h.cards.map(c => [c.rank, c.suit])),
      a: hands.findIndex(h => h.isActive)
    });
    if (sig === this._lastSig) return;
    this._lastSig = sig;

    const needed = new Set();

    // Dealer row
    dealer.forEach((card, i) => {
      const key = `D${i}`;
      needed.add(key);
      const isHole = i === 1;
      const faceUp = !(isHole && s.dealer?.holeHidden);

      const x = -1.2 + i * 0.85;
      const z = -0.8;
      const y = 0.02 + i * 0.001;
      this._upsertCard(key, card, faceUp, x, y, z, 0);
    });

    // Active hand (Phase 1)
    const activeIdx = hands.findIndex(h => h.isActive);
    const active = hands[activeIdx >= 0 ? activeIdx : 0];
    if (active?.cards) {
      active.cards.forEach((card, i) => {
        const key = `P${i}`;
        needed.add(key);
        const x = -1.2 + i * 0.85;
        const z = 0.95;
        const y = 0.02 + i * 0.001;
        const rot = (i - (active.cards.length - 1) / 2) * 0.05;
        this._upsertCard(key, card, true, x, y, z, rot);
      });
    }

    // Remove unused
    for (const key of Array.from(this._cards.keys())) {
      if (!needed.has(key)) {
        const mesh = this._cards.get(key);
        this.scene.remove(mesh);
        if (mesh.material?.map) mesh.material.map.dispose();
        mesh.material?.dispose?.();
        mesh.geometry?.dispose?.();
        this._cards.delete(key);
      }
    }
  }

  _upsertCard(key, card, faceUp, x, y, z, rotY) {
    let mesh = this._cards.get(key);
    const w = 0.78;
    const h = w * (356 / 256);

    if (!mesh) {
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = makeCardMaterial(card, faceUp);
      mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      this.scene.add(mesh);
      this._cards.set(key, mesh);
      mesh.userData = { rank: card.rank, suit: card.suit, faceUp };
    } else {
      const ud = mesh.userData || {};
      const changed = ud.rank !== card.rank || ud.suit !== card.suit || ud.faceUp !== faceUp;
      if (changed) {
        if (mesh.material?.map) mesh.material.map.dispose();
        mesh.material?.dispose?.();
        mesh.material = makeCardMaterial(card, faceUp);
        mesh.userData = { rank: card.rank, suit: card.suit, faceUp };
      }
    }

    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
  }
}
