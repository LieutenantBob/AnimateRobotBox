import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createFoldAnimation } from './animation.js';
import { applyMaterials } from './materials.js';
import { setupStudio } from './lighting.js';

// --- Scene setup ---
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 10, 60000);
camera.position.set(2000, 1500, 2000);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
document.body.appendChild(renderer.domElement);

const studio = setupStudio(scene, renderer);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(600, 500, 0);
controls.autoRotate = false;
controls.autoRotateSpeed = 0.5;
controls.update();


// --- State ---
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const loadingDiv = document.getElementById('loading');
const controlsDiv = document.getElementById('controls');
const btnPlay = document.getElementById('btn-play');
const btnReset = document.getElementById('btn-reset');
const btnSpeed = document.getElementById('btn-speed');
const scrubber = document.getElementById('scrubber');
const timeLabel = document.getElementById('time-label');
const partLabel = document.getElementById('part-label');
const stepLabel = document.getElementById('step-label');

const btnLighting = document.getElementById('btn-lighting');
const lightingPanel = document.getElementById('lighting-panel');

let animator = null;
let modelRoot = null; // reference to the loaded model for raycasting
let isPlaying = false;
let currentTime = 0;
let totalDuration = 18;
let speedMultiplier = 1;
const speeds = [0.25, 0.5, 1, 2, 4];
let speedIndex = 2;

// Asset paths — absolute from site root
const MODEL_PATH = '/assets/decimated/unfolded/robot_decimated.glb';
const SEQUENCE_PATH = '/config/fold_sequence.json';
const MATERIALS_PATH = '/config/materials.json';

/**
 * The CAD export stores non-ASCII characters as literal "\xNN" escapes
 * (e.g. "Langsstiver_\xd8H"). Decode them once so every lookup can use
 * real names ("Langsstiver_ØH").
 */
function decodeNodeNames(root) {
  root.traverse((node) => {
    node.name = node.name.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  });
}

/** 3/4 view that fits the object's current bounds (the closed box at t=0). */
function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const fitFov = camera.aspect < 1 ? 2 * Math.atan(Math.tan(fov / 2) * camera.aspect) : fov;
  const distance = (sphere.radius / Math.sin(fitFov / 2)) * 1.15;
  const direction = new THREE.Vector3(1, 0.65, 1).normalize();
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(direction, distance);
  controls.update();
}

// --- Add AirVR logos to front panel and TV screen ---
function addLogos(model) {
  const textureLoader = new THREE.TextureLoader();
  const logoTexture = textureLoader.load('/assets/airvr_logo.png');
  logoTexture.colorSpace = THREE.SRGBColorSpace;

  // Front panel (Forside2) — logo on outer face
  const forside = model.getObjectByName('Forside2');
  if (forside && forside.geometry) {
    if (!forside.geometry.boundingBox) forside.geometry.computeBoundingBox();
    const bb = forside.geometry.boundingBox;
    const size = bb.getSize(new THREE.Vector3());
    // Panel is flat in XY plane; outer face at Z=max
    // Logo: 50% of panel width, square, centered on panel
    const logoSize = Math.min(size.x, size.y) * 0.5;
    const center = bb.getCenter(new THREE.Vector3());
    const logoGeo = new THREE.PlaneGeometry(logoSize, logoSize);
    const logoMat = new THREE.MeshBasicMaterial({
      map: logoTexture,
      side: THREE.DoubleSide,
    });
    const logo = new THREE.Mesh(logoGeo, logoMat);
    logo.position.set(center.x, center.y, bb.min.z - 0.5);
    logo.rotation.x = Math.PI; // flip to face outward
    logo.name = '__logo_front';
    forside.add(logo);
  }

  // TV screen — logo centered on screen face
  const tv = model.getObjectByName('TV');
  if (tv && tv.geometry) {
    if (!tv.geometry.boundingBox) tv.geometry.computeBoundingBox();
    const bb = tv.geometry.boundingBox;
    const size = bb.getSize(new THREE.Vector3());
    const center = bb.getCenter(new THREE.Vector3());
    // TV is a flat panel — find the thinnest axis (that's the normal direction)
    // Place logo on the face with the largest area
    const logoGeo = new THREE.PlaneGeometry(size.x * 0.7, size.y * 0.7);
    const logoMat = new THREE.MeshBasicMaterial({
      map: logoTexture.clone(),
      side: THREE.DoubleSide,
    });
    logoMat.map.colorSpace = THREE.SRGBColorSpace;
    const logo = new THREE.Mesh(logoGeo, logoMat);
    // Thinnest axis = normal direction
    if (size.z <= size.x && size.z <= size.y) {
      // Z is thinnest — logo on Z face
      logo.position.set(center.x, center.y, bb.max.z + 0.5);
    } else if (size.y <= size.x && size.y <= size.z) {
      // Y is thinnest — logo on Y face
      logo.position.set(center.x, bb.max.y + 0.5, center.z);
      logo.rotation.x = Math.PI / 2;
      // Resize logo for XZ plane
      logo.geometry.dispose();
      logo.geometry = new THREE.PlaneGeometry(size.x * 0.7, size.z * 0.7);
    } else {
      // X is thinnest — logo on X face
      logo.position.set(bb.max.x + 0.5, center.y, center.z);
      logo.rotation.y = Math.PI / 2;
      logo.geometry.dispose();
      logo.geometry = new THREE.PlaneGeometry(size.z * 0.7, size.y * 0.7);
    }
    logo.name = '__logo_screen';
    tv.add(logo);
  }
}

// --- Load model and animation config ---
async function loadModel() {
  const loader = new GLTFLoader();

  // Load configs in parallel
  let sequence = null;
  let materialsConfig = null;

  const [seqResult, matResult] = await Promise.allSettled([
    fetch(SEQUENCE_PATH).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    fetch(MATERIALS_PATH).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
  ]);

  if (seqResult.status === 'fulfilled') {
    sequence = seqResult.value;
  } else {
    progressText.textContent = 'Animation config failed to load. Please refresh.';
    progressFill.style.width = '100%';
    progressFill.style.background = '#ff8844';
    console.error('Could not load fold_sequence.json:', seqResult.reason);
    return;
  }

  if (matResult.status === 'fulfilled') {
    materialsConfig = matResult.value;
  } else {
    console.warn('Could not load materials.json — using defaults:', matResult.reason);
  }

  try {
    progressText.textContent = 'Loading model...';
    const loadPromise = new Promise((resolve, reject) => {
      loader.load(
        MODEL_PATH,
        resolve,
        (event) => {
          if (event.total > 0) {
            const pct = Math.round((event.loaded / event.total) * 100);
            progressFill.style.width = `${pct}%`;
            progressText.textContent = `Loading... ${pct}%`;
          }
        },
        reject
      );
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Model load timed out after 30 seconds')), 30000)
    );
    const gltf = await Promise.race([loadPromise, timeoutPromise]);

    // Rotate model from Z-up (OBJ/CAD convention) to Y-up (Three.js)
    // Override GLTF root scale (CAD export includes 0.063 factor) so world
    // coordinates match OBJ space and camera offsets work correctly.
    gltf.scene.rotation.x = -Math.PI / 2;
    gltf.scene.scale.set(1, 1, 1);
    scene.add(gltf.scene);
    modelRoot = gltf.scene;
    decodeNodeNames(gltf.scene);

    // Apply PBR materials and enable shadows
    if (materialsConfig) {
      applyMaterials(gltf.scene, materialsConfig);
    }
    gltf.scene.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });

    // Set up programmatic animation
    if (sequence) {
      animator = createFoldAnimation(gltf.scene, sequence);
      totalDuration = animator.totalDuration;
      // Start at t=0: fully closed box on the floor
      currentTime = 0;
      animator.update(currentTime);
      scrubber.value = 0;
      timeLabel.textContent = '0.0s';
    }

    frameObject(gltf.scene);

    // Add AirVR logo to front panel and TV screen
    addLogos(gltf.scene);

    loadingDiv.classList.add('hidden');
    controlsDiv.classList.remove('hidden');

    // Product reveal title fade-in, then auto-fade after 4s
    const titleOverlay = document.getElementById('title-overlay');
    if (titleOverlay) {
      setTimeout(() => { titleOverlay.style.opacity = '1'; }, 500);
      setTimeout(() => { titleOverlay.style.opacity = '0'; }, 4500);
    }

    if (!animator) {
      progressText.textContent = '';
      loadingDiv.classList.add('hidden');
    }

  } catch (e) {
    progressText.textContent = 'Failed to load model. Run the decimation pipeline first.';
    progressFill.style.width = '100%';
    progressFill.style.background = '#ff4444';
    console.error('Model load error:', e.message);
  }
}

// --- UI Controls ---
btnPlay.addEventListener('click', () => {
  if (!animator) return;

  if (isPlaying) {
    isPlaying = false;
    btnPlay.innerHTML = '&#9654; Play';
  } else {
    if (currentTime >= totalDuration) {
      currentTime = 0;
    }
    isPlaying = true;
    btnPlay.innerHTML = '&#9646;&#9646; Pause';
    // Fade out title on play
    const titleOverlay = document.getElementById('title-overlay');
    if (titleOverlay) titleOverlay.style.opacity = '0';
  }
});

btnReset.addEventListener('click', () => {
  if (!animator) return;
  currentTime = 0;
  isPlaying = false;
  controls.autoRotate = false;
  btnPlay.innerHTML = '&#9654; Play';
  scrubber.value = 0;
  timeLabel.textContent = '0.0s';
  animator.update(0);
  updateStepLabel(0.5);
  // Re-show title on reset
  const titleOverlay = document.getElementById('title-overlay');
  if (titleOverlay) {
    titleOverlay.style.opacity = '1';
    setTimeout(() => { titleOverlay.style.opacity = '0'; }, 4000);
  }
});

btnSpeed.addEventListener('click', () => {
  speedIndex = (speedIndex + 1) % speeds.length;
  speedMultiplier = speeds[speedIndex];
  btnSpeed.textContent = `${speedMultiplier}x`;
});

// --- Lighting controls ---
btnLighting.addEventListener('click', () => {
  lightingPanel.classList.toggle('visible');
  btnLighting.classList.toggle('active');
});

// Each slider is a multiplier on the studio defaults (100 = 1.0x).
const lightLevels = { exposure: 1, contrast: 1, key: 1, fill: 1, ambient: 1, env: 1 };
for (const id of Object.keys(lightLevels)) {
  const slider = document.getElementById(`sl-${id}`);
  const valEl = document.getElementById(`val-${id}`);
  if (!slider || !valEl) continue;
  slider.value = '100';
  valEl.textContent = '1.0x';
  slider.addEventListener('input', () => {
    const level = Number(slider.value) / 100;
    if (!Number.isFinite(level)) return;
    lightLevels[id] = level;
    valEl.textContent = `${level.toFixed(1)}x`;
    studio.apply(lightLevels);
  });
}

let isScrubbing = false;
scrubber.addEventListener('input', () => {
  if (!animator) return;
  isScrubbing = true;
  currentTime = (parseFloat(scrubber.value) / 1000) * totalDuration;
  animator.update(currentTime);
  isPlaying = false;
  controls.autoRotate = false;
  btnPlay.innerHTML = '&#9654; Play';
  timeLabel.textContent = `${currentTime.toFixed(1)}s`;
  updateStepLabel(currentTime);
});
scrubber.addEventListener('change', () => { isScrubbing = false; });

// Show current animation step
function updateStepLabel(t) {
  if (!animator || !stepLabel) return;
  let currentStep = '';
  for (const step of animator.steps) {
    if (t >= step.startTime && t < step.startTime + step.duration) {
      currentStep = step.name;
      break;
    }
  }
  if (t >= totalDuration) currentStep = 'Fully Unfolded';
  stepLabel.textContent = currentStep;
  stepLabel.style.display = currentStep ? 'block' : 'none';
}

// --- Raycasting for part identification (throttled to rAF) ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let raycastPending = false;

renderer.domElement.addEventListener('mousemove', (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycastPending = true;
});

function performRaycast() {
  if (!raycastPending || !modelRoot) return;
  raycastPending = false;

  raycaster.setFromCamera(mouse, camera);
  // Only intersect model, not grid/lights
  const intersects = raycaster.intersectObject(modelRoot, true);

  if (intersects.length > 0) {
    const hit = intersects[0].object;
    const name = hit.name || hit.parent?.name || '';
    if (name) {
      partLabel.style.display = 'block';
      partLabel.textContent = name;
    } else {
      partLabel.style.display = 'none';
    }
  } else {
    partLabel.style.display = 'none';
  }
}

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Animation loop ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (animator && isPlaying) {
    currentTime += delta * speedMultiplier;
    if (currentTime >= totalDuration) {
      currentTime = totalDuration;
      isPlaying = false;
      btnPlay.innerHTML = '&#9654; Play';
      // Enable slow auto-rotate when animation finishes
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.8;
    }
    animator.update(currentTime);

    // Slow auto-rotate during playback for cinematic feel
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.3;

    if (!isScrubbing) {
      scrubber.value = Math.round((currentTime / totalDuration) * 1000);
      timeLabel.textContent = `${currentTime.toFixed(1)}s`;
      updateStepLabel(currentTime);
    }
  }

  performRaycast();
  controls.update();
  renderer.render(scene, camera);
}

// Stop auto-rotate when user interacts (registered ONCE, outside the loop)
renderer.domElement.addEventListener('pointerdown', () => {
  controls.autoRotate = false;
});

// --- Start ---
loadModel();
animate();
