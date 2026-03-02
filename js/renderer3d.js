// js/renderer3d.js
// 3D table renderer (rendering only; no blackjack logic).
// - Better table + lighting (clear, no "fogged glass")
// - Deal-in animation for newly appeared cards
// - Hole-card flip animation on reveal (visual only; state still controls face)
// - Supports dealer row + ALL player hands (stacked), active hand subtly highlighted

import * as THREE from "https://esm.sh/three@0.161.0";
import { OrbitControls } from "https://esm.sh/three@0.161.0/examples/jsm/controls/OrbitControls.js";

const SUIT_COLOR = { "♥": "#b91c1c", "♦": "#b91c1c", "♣": "#0b1220", "♠": "#0b1220" };

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }
function easeInOutQuad(t){ return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2)/2; }

// ---------- Textures ----------
function makeCardTexture({ rank, suit, faceUp }) {
  const w = 512, h = 712; // higher res for crisp text
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");

  g.clearRect(0,0,w,h);

  if (!faceUp) {
    // back (high contrast, not washed)
    const grad = g.createLinearGradient(0,0,w,h);
    grad.addColorStop(0, "#113a7a");
    grad.addColorStop(1, "#0b6b62");
    g.fillStyle = grad;
    g.fillRect(0,0,w,h);

    g.lineWidth = 18;
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.strokeRect(14,14,w-28,h-28);

    // pattern
    g.globalAlpha = 0.22;
    g.fillStyle = "#ffffff";
    for (let y = 36; y < h; y += 36) {
      for (let x = 36; x < w; x += 36) {
        g.beginPath();
        g.arc(x, y, 7, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1.0;

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  }

  // face (light gradient so it doesn't look foggy)
  const bg = g.createLinearGradient(0,0,0,h);
  bg.addColorStop(0, "#ffffff");
  bg.addColorStop(1, "#f2f4f8");
  g.fillStyle = bg;
  g.fillRect(0,0,w,h);

  // border
  g.lineWidth = 16;
  g.strokeStyle = "rgba(15,23,42,0.14)";
  g.strokeRect(12,12,w-24,h-24);

  // inner bevel
  g.lineWidth = 6;
  g.strokeStyle = "rgba(15,23,42,0.08)";
  g.strokeRect(36,36,w-72,h-72);

  const col = SUIT_COLOR[suit] || "#0b1220";
  g.fillStyle = col;

  // corner rank/suit
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.font = "800 120px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  g.fillText(rank, 58, 150);
  g.font = "800 104px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  g.fillText(suit, 66, 260);

  // center pip
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "800 260px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  g.fillText(suit, w/2, h/2 + 10);

  // bottom mini
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.font = "800 64px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  g.fillText(`${rank}${suit}`, 56, h - 56);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function makeCardMaterial(card, faceUp) {
  const tex = makeCardTexture({ rank: card.rank, suit: card.suit, faceUp });
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.92,
    metalness: 0.0,
    side: THREE.FrontSide
  });
  return mat;
}

// Felt texture via canvas (cheap + nice)
function makeFeltTexture() {
  const s = 512;
  const c = document.createElement("canvas");
  c.width = s; c.height = s;
  const g = c.getContext("2d");

  const grad = g.createRadialGradient(s*0.5, s*0.45, s*0.05, s*0.5, s*0.5, s*0.65);
  grad.addColorStop(0, "#0b4a38");
  grad.addColorStop(1, "#062a21");
  g.fillStyle = grad;
  g.fillRect(0,0,s,s);

  // subtle noise speckle
  const img = g.getImageData(0,0,s,s);
  const d = img.data;
  for (let i=0;i<d.length;i+=4){
    const n = (Math.random()*18)|0; // 0..17
    d[i]   = clamp(d[i]   + n, 0, 255);
    d[i+1] = clamp(d[i+1] + n, 0, 255);
    d[i+2] = clamp(d[i+2] + n, 0, 255);
  }
  g.putImageData(img,0,0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.2, 1.6);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// ---------- Card object (two-face) ----------
function makeCardObject(card, faceUp, w, h) {
  const group = new THREE.Group();

  const geo = new THREE.PlaneGeometry(w, h);

  // front is ALWAYS the face texture, back is ALWAYS the back texture
  const frontMat = makeCardMaterial(card, true);
  const backMat  = makeCardMaterial(card, false);

  const front = new THREE.Mesh(geo, frontMat);
  const back  = new THREE.Mesh(geo, backMat);

  // prevent z-fighting
  const eps = 0.002;
  front.position.z = +eps;
  back.position.z  = -eps;

  // back faces opposite direction
  back.rotation.y = Math.PI;

  // ONLY frontside so no mirroring artifacts
  front.material.side = THREE.FrontSide;
  back.material.side  = THREE.FrontSide;

  group.add(front);
  group.add(back);

  group.userData = {
    rank: card.rank,
    suit: card.suit,
    faceUp,
    _front: front,
    _back: back
  };

  return group;
}

function disposeObject3D(obj) {
  if (!obj) return;
  obj.traverse((n) => {
    if (n.isMesh) {
      if (n.material?.map) n.material.map.dispose();
      n.material?.dispose?.();
      n.geometry?.dispose?.();
    }
  });
}

// ---------- Renderer ----------
export class ThreeTable {
  constructor({ hudDealerEl = null, hudPlayerEl = null } = {}) {
    this.hudDealerEl = hudDealerEl;
    this.hudPlayerEl = hudPlayerEl;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.container = null;

    this._raf = 0;
    this._resizeObs = null;

    this._cards = new Map(); // key -> THREE.Group (two-face card)
    this._anims = new Map(); // key -> {type, t0, dur, fromPos, toPos, fromRot, toRot}
    this._lastSig = "";
    this._lastHoleHidden = true;

    // layout
    this._shoePos = new THREE.Vector3(2.6, 0.05, 1.75); // where cards "come from"
  }

  init(container) {
    this.container = container;

    this.scene = new THREE.Scene();

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 520;

    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 120);
    this.camera.position.set(0, 4.2, 6.8);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);

    // Orbit controls (pan/zoom/orbit)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 14.0;
    this.controls.maxPolarAngle = Math.PI * 0.48; // keep above table
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.renderer.setClearColor(0x000000, 0);

    // Clear, non-washed color
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    container.innerHTML = "";
    container.appendChild(this.renderer.domElement);

    // Table
    const feltTex = makeFeltTexture();
    const tableGeo = new THREE.PlaneGeometry(8.4, 5.2);
    const tableMat = new THREE.MeshStandardMaterial({
      map: feltTex,
      roughness: 1.0,
      metalness: 0.0
    });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.03;
    this.scene.add(table);

    // Rail / vignette ring
    const ringGeo = new THREE.RingGeometry(2.4, 3.25, 84);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x0a1222,
      roughness: 1.0,
      metalness: 0.0,
      transparent: true,
      opacity: 0.28
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.028;
    this.scene.add(ring);

    // Lights (tuned to avoid washout)
    const amb = new THREE.AmbientLight(0xffffff, 0.40);
    this.scene.add(amb);

    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(2.8, 6.0, 3.8);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x7fb7ff, 0.22);
    fill.position.set(-3.0, 3.5, 2.0);
    this.scene.add(fill);

    const rim = new THREE.PointLight(0x66ffd9, 0.20, 20);
    rim.position.set(0.0, 2.0, -3.2);
    this.scene.add(rim);

    // Resize observer
    this._resizeObs = new ResizeObserver(() => this._resize());
    this._resizeObs.observe(container);

    this._tick();
  }

  _resize() {
    if (!this.container || !this.renderer || !this.camera) return;

    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 520;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);

    if (this.controls) this.controls.update();
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._resizeObs) this._resizeObs.disconnect();

    for (const obj of this._cards.values()) disposeObject3D(obj);
    this._cards.clear();
    this._anims.clear();

    if (this.renderer) this.renderer.dispose();
    if (this.container) this.container.innerHTML = "";

    this.scene = this.camera = this.renderer = this.container = null;
    this._lastSig = "";
  }

  _tick = (now = performance.now()) => {
    this._raf = requestAnimationFrame(this._tick);

    // advance animations
    if (this._anims.size) {
      for (const [key, a] of this._anims.entries()) {
        const obj = this._cards.get(key);
        if (!obj) { this._anims.delete(key); continue; }

        const t = clamp((now - a.t0) / a.dur, 0, 1);
        const e = (a.type === "deal") ? easeOutCubic(t) : easeInOutQuad(t);

        if (a.fromPos && a.toPos) obj.position.lerpVectors(a.fromPos, a.toPos, e);

        if (a.fromRot && a.toRot) {
          obj.rotation.set(
            a.fromRot.x + (a.toRot.x - a.fromRot.x) * e,
            a.fromRot.y + (a.toRot.y - a.fromRot.y) * e,
            a.fromRot.z + (a.toRot.z - a.fromRot.z) * e
          );
        }

        if (t >= 1) this._anims.delete(key);
      }
    }

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
    const changed = (sig !== this._lastSig);
    this._lastSig = sig;

    const needed = new Set();

    // Layout sizing
    const cardW = 0.98;
    const cardH = cardW * (712 / 512);

    // -----------------------
    // Dealer row
    // -----------------------
    dealer.forEach((card, i) => {
      const key = `D${i}`;
      needed.add(key);

      const isHole = i === 1;
      const faceUp = !(isHole && s.dealer?.holeHidden);

      const x = -1.65 + i * 1.08;
      const z = -1.55;
      const y = 0.035 + i * 0.001;
      const rotY = (i - (dealer.length - 1) / 2) * 0.04;

      this._upsertCard({
        key, card, faceUp,
        x, y, z,
        rotY,
        w: cardW, h: cardH,
        animateOnNew: changed
      });
    });

    // -----------------------
    // Player hands (ALL hands)
    // -----------------------
    const activeIdx = hands.findIndex(h => h.isActive);

    const baseZ = 1.45;
    const handSpacing = 1.20;

    hands.forEach((hand, hIdx) => {
      const z = baseZ + (hIdx * handSpacing);
      const lift = (hIdx === activeIdx ? 0.012 : 0);

      (hand.cards || []).forEach((card, i) => {
        const key = `P${hIdx}_${i}`;
        needed.add(key);

        const x = -1.65 + i * 1.08;
        const y = 0.035 + i * 0.001 + lift;
        const rotY = (i - ((hand.cards.length - 1) / 2)) * 0.06;

        this._upsertCard({
          key, card, faceUp: true,
          x, y, z,
          rotY,
          w: cardW, h: cardH,
          animateOnNew: changed
        });
      });
    });

    // -----------------------
    // Hole-card reveal flip
    // -----------------------
    const holeHidden = !!s.dealer?.holeHidden;
    if (this._lastHoleHidden && !holeHidden) {
      const holeKey = "D1";
      const obj = this._cards.get(holeKey);
      if (obj) {
        const fromRot = obj.rotation.clone();
        const toRot = obj.rotation.clone();
        // flip like a real card (x goes from +PI/2 facedown to -PI/2 faceup)
        toRot.x = -Math.PI / 2;

        this._anims.set(holeKey, {
          type: "flip",
          t0: performance.now(),
          dur: 520,
          fromRot,
          toRot
        });
      }
    }
    this._lastHoleHidden = holeHidden;

    // Remove unused
    for (const key of Array.from(this._cards.keys())) {
      if (!needed.has(key)) {
        const obj = this._cards.get(key);
        this.scene.remove(obj);
        disposeObject3D(obj);
        this._cards.delete(key);
        this._anims.delete(key);
      }
    }
  }

  _upsertCard({ key, card, faceUp, x, y, z, rotY, w, h, animateOnNew }) {
    let obj = this._cards.get(key);

    const targetPos = new THREE.Vector3(x, y, z);

    // desired orientation:
    // faceUp => front up => x = -PI/2
    // faceDown => back up => x = +PI/2
    const targetRotX = faceUp ? (-Math.PI / 2) : (+Math.PI / 2);

    if (!obj) {
      obj = makeCardObject(card, faceUp, w, h);

      // set initial rotations
      obj.rotation.x = targetRotX;
      obj.rotation.y = rotY;

      // spawn at shoe
      obj.position.copy(this._shoePos);

      this.scene.add(obj);
      this._cards.set(key, obj);

      // Deal-in animation (position only)
      this._anims.set(key, {
        type: "deal",
        t0: performance.now(),
        dur: 260,
        fromPos: this._shoePos.clone(),
        toPos: targetPos.clone()
      });

      return;
    }

    // Update face texture if rank/suit changed
    const ud = obj.userData || {};
    const changedFace = ud.rank !== card.rank || ud.suit !== card.suit;

    if (changedFace && ud._front) {
      const front = ud._front;

      if (front.material?.map) front.material.map.dispose();
      front.material?.dispose?.();

      const newFrontMat = makeCardMaterial(card, true);
      newFrontMat.side = THREE.FrontSide;
      front.material = newFrontMat;
    }

    // Update stored state
    obj.userData.rank = card.rank;
    obj.userData.suit = card.suit;
    obj.userData.faceUp = faceUp;

    // Position always updates
    obj.position.copy(targetPos);

    // Yaw always updates
    obj.rotation.y = rotY;

    // If not currently flipping, snap to correct up/down state
    const a = this._anims.get(key);
    const isFlipping = a && a.type === "flip";
    if (!isFlipping) obj.rotation.x = targetRotX;
  }
}