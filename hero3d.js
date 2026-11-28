// hero3d.js - rotating 3D showcase in the hero section (loaded lazily by script.js).
//
// Kept light on purpose:
//   - ONE renderer for the whole page, models are swapped (old one is disposed)
//   - renders at most 30 frames per second, pixel ratio capped at 1.5, "low-power" GPU hint
//   - completely idle (no rendering) while the hero is off-screen, the tab is hidden or the item modal is open
//   - the next model is downloaded while the current one is shown, one at a time
//   - prefers-reduced-motion: no spinning / flipbook, a single still frame per model
//   - if anything fails the emoji hero stays as it is
import * as THREE from "three";
import { loadBBModel, frameModel, addDefaultLights } from "./bbmodel-loader.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param stage    #hero-stage element
 * @param label    #hero-label element (item name)
 * @param items    database items that have a model
 * @param urlOf    item -> .bbmodel url
 * @param display  "gui" | null  (same meaning as BB_DISPLAY in viewer.js; keep them equal)
 * @param onReady  called once, when the first model is on screen
 */
export async function startHero3D({ stage, label, items, urlOf, display = null, onReady, showMs = 6000, fadeMs = 280, fps = 30 }) {
  if (!items.length) return false;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // every model is shown once per round (shuffled), then the round restarts
  let queue = [];
  const nextItem = () => {
    if (!queue.length) {
      queue = items.slice();
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
    }
    return queue.pop();
  };
  const load = async (item) => {
    try {
      return { item, model: await loadBBModel(urlOf(item), { size: 1.4, display }) };
    } catch (e) {
      console.warn("[hero3d] could not load", item.id, e.message || e);
      return null;
    }
  };

  // ---------- activity: draw only when somebody can see it ----------
  const modal = document.getElementById("modal");
  let visible = true, tabVisible = !document.hidden, modalOpen = false;
  const isActive = () => visible && tabVisible && !modalOpen;
  let waiters = [];
  const whenActive = () => (isActive() ? Promise.resolve() : new Promise((r) => waiters.push(r)));

  // ---------- three.js (created when the first model is ready) ----------
  let renderer, scene, camera, canvas, current = null, raf = 0, last = 0, angle = 0;
  const target = new THREE.Vector3();
  const draw = () => renderer.render(scene, camera);

  const frame = (t) => {
    raf = requestAnimationFrame(frame);
    if (t - last < 1000 / fps - 2) return; // frame cap
    const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
    last = t;
    if (current) {
      angle += dt * 0.6; // about one turn every 10 s
      current.model.object.rotation.y = angle;
      current.model.update(dt); // flipbook textures
    }
    draw();
  };

  const sync = () => {
    if (isActive()) {
      waiters.splice(0).forEach((r) => r());
      if (!raf && renderer && !reduced) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const fit = () => {
    const obj = current.model.object;
    const y = obj.rotation.y;
    obj.rotation.y = 0; // measure the un-rotated model
    frameModel(camera, { target, update() {} }, current.model);
    camera.lookAt(target);
    obj.rotation.y = y;
  };

  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (current) {
      fit();
      if (!raf) draw();
    }
  };

  const ensureRenderer = () => {
    if (renderer) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer = new THREE.WebGLRenderer({ antialias: dpr < 1.5, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(dpr);
    canvas = renderer.domElement;
    canvas.className = "hero-canvas";
    scene = new THREE.Scene();
    addDefaultLights(scene);
    camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    stage.appendChild(canvas);
    stage.classList.add("has-3d");
    new ResizeObserver(resize).observe(stage);
    resize();
  };

  const swap = async (entry) => {
    ensureRenderer();
    if (current) {
      canvas.style.opacity = "0"; // quick fade out
      await sleep(fadeMs);
      scene.remove(current.model.object);
      current.model.dispose(); // frees geometry, materials and textures
    }
    current = entry;
    angle = 0;
    entry.model.playing = !reduced;
    entry.model.update(0);
    scene.add(entry.model.object);
    fit();
    label.textContent = entry.item.name;
    if (!raf) draw(); // still frame (also used for reduced motion)
    canvas.style.opacity = "1";
  };

  // ---------- observers ----------
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }, { threshold: 0.05 }).observe(stage);
  document.addEventListener("visibilitychange", () => { tabVisible = !document.hidden; sync(); });
  if (modal) {
    new MutationObserver(() => { modalOpen = !modal.classList.contains("hidden"); sync(); })
      .observe(modal, { attributes: true, attributeFilter: ["class"] });
    modalOpen = !modal.classList.contains("hidden");
  }

  // ---------- main loop ----------
  try {
    let pending = load(nextItem());
    let fails = 0, first = true;
    for (;;) {
      const entry = await pending;
      if (!entry) {
        if (++fails >= 6) return false; // nothing loads: leave the emoji hero alone
        pending = load(nextItem());
        continue;
      }
      fails = 0;
      await whenActive();
      await swap(entry);
      sync();
      if (first) { first = false; onReady?.(); }
      pending = load(nextItem()); // download the next one while this one is shown
      await sleep(showMs);
      await whenActive();
    }
  } catch (e) {
    console.warn("[hero3d] stopped", e);
    return false;
  }
}
