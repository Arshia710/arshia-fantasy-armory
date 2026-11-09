import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

let renderer, scene, camera, controls, currentModel, raf, host;

export function closeViewer() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  if (renderer) {
    renderer.dispose();
    renderer.domElement.remove();
    renderer = null;
  }
  scene = null;
  camera = null;
  controls = null;
  currentModel = null;
  host = null;
}

export async function openViewer(container, gltfUrl, fallbackImg) {
  closeViewer();
  host = container;
  container.innerHTML = "";
  container.classList.add("has-viewer");

  const width = container.clientWidth || 480;
  const height = container.clientHeight || 420;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c10);

  camera = new THREE.PerspectiveCamera(35, width / height, 0.01, 100);
  camera.position.set(1.2, 1.0, 1.8);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const amb = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(3, 5, 4);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
  fill.position.set(-3, 1, -2);
  scene.add(fill);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;

  const loader = new GLTFLoader();
  const tryUrls = [];
  if (gltfUrl) tryUrls.push(gltfUrl);
  // also try alternate extensions
  if (gltfUrl && gltfUrl.endsWith(".glb")) tryUrls.push(gltfUrl.replace(/\.glb$/i, ".gltf"));
  if (gltfUrl && gltfUrl.endsWith(".gltf")) tryUrls.push(gltfUrl.replace(/\.gltf$/i, ".glb"));
  // unique
  const urls = [...new Set(tryUrls)];
  try {
    let gltf = null;
    let lastErr = null;
    for (const url of urls) {
      try {
        gltf = await new Promise((resolve, reject) => {
          loader.load(url, resolve, undefined, reject);
        });
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!gltf) throw lastErr || new Error("no gltf");
    currentModel = gltf.scene;
    scene.add(currentModel);

    const box = new THREE.Box3().setFromObject(currentModel);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    currentModel.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 1.4 / maxDim;
    currentModel.scale.setScalar(scale);

    camera.position.set(1.4, 1.1, 1.8);
    controls.target.set(0, 0, 0);
    controls.update();
  } catch (err) {
    console.warn("GLTF load failed, fallback image", gltfUrl, err);
    container.classList.remove("has-viewer");
    if (fallbackImg) {
      container.innerHTML = `<img src="${fallbackImg}" alt="" />`;
    } else {
      container.textContent = "No 3D model";
    }
    return;
  }

  const animate = () => {
    raf = requestAnimationFrame(animate);
    controls?.update();
    renderer?.render(scene, camera);
  };
  animate();
}

// resize when modal open
window.addEventListener("resize", () => {
  if (!renderer || !host || !camera) return;
  const w = host.clientWidth;
  const h = host.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
});
