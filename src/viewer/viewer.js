import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createFoldAnimation } from './animation.js';
import { applyMaterials } from './materials.js';

// --- Scene setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x232340);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 50000);
camera.position.set(2000, 1500, 2000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.LinearToneMapping;
renderer.toneMappingExposure = 1.5;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(600, 500, 0);
controls.update();

// --- Lighting (bright studio-style for PBR materials) ---
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const mainLight = new THREE.DirectionalLight(0xfff5e6, 2.0);
mainLight.position.set(2000, 3000, 1500);
mainLight.castShadow = true;
mainLight.shadow.mapSize.width = 2048;
mainLight.shadow.mapSize.height = 2048;
mainLight.shadow.camera.left = -3000;
mainLight.shadow.camera.right = 3000;
mainLight.shadow.camera.top = 3000;
mainLight.shadow.camera.bottom = -3000;
mainLight.shadow.camera.near = 100;
mainLight.shadow.camera.far = 8000;
mainLight.shadow.bias = -0.001;
scene.add(mainLight);

const fillLight = new THREE.DirectionalLight(0xc4d4ff, 0.8);
fillLight.position.set(-1500, 1000, -1000);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.6);
rimLight.position.set(0, -500, -2000);
scene.add(rimLight);

// Top-down light for even illumination
const topLight = new THREE.DirectionalLight(0xffffff, 0.5);
topLight.position.set(0, 5000, 0);
scene.add(topLight);

// Hemisphere light for soft ground-bounce
const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x667788, 0.5);
scene.add(hemiLight);

// Environment map for metallic reflections
const pmremGenerator = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.background = new THREE.Color(0xbbbbcc);
const envLight1 = new THREE.DirectionalLight(0xffffff, 2);
envLight1.position.set(1, 1, 1);
envScene.add(envLight1);
const envLight2 = new THREE.DirectionalLight(0x8899bb, 1);
envLight2.position.set(-1, 0.5, -1);
envScene.add(envLight2);
const envTexture = pmremGenerator.fromScene(envScene).texture;
scene.environment = envTexture;
pmremGenerator.dispose();

// --- Room environment ---
// Floor
const floorGeo = new THREE.PlaneGeometry(8000, 8000);
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x555560,
  roughness: 0.8,
  metalness: 0.1,
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -151;
floor.receiveShadow = true;
scene.add(floor);

// Back wall
const wallGeo = new THREE.PlaneGeometry(8000, 4000);
const wallMat = new THREE.MeshStandardMaterial({
  color: 0x666670,
  roughness: 0.9,
  metalness: 0.0,
});
const backWall = new THREE.Mesh(wallGeo, wallMat);
backWall.position.set(0, 1849, -3000);
scene.add(backWall);

// Left wall
const leftWall = new THREE.Mesh(wallGeo, wallMat);
leftWall.rotation.y = Math.PI / 2;
leftWall.position.set(-3000, 1849, 0);
scene.add(leftWall);

// Subtle floor grid overlay
const gridHelper = new THREE.GridHelper(8000, 40, 0x444450, 0x3a3a45);
gridHelper.position.y = -150;
gridHelper.material.opacity = 0.3;
gridHelper.material.transparent = true;
scene.add(gridHelper);

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

let animator = null;
let modelRoot = null; // reference to the loaded model for raycasting
let isPlaying = false;
let currentTime = 0;
let totalDuration = 18;
let speedMultiplier = 1;
const speeds = [0.25, 0.5, 1, 2, 4];
let speedIndex = 2;

// Paths relative to src/viewer/ — only the unfolded model is used
const MODEL_PATH = '../../assets/decimated/unfolded/robot_decimated.glb';
const SEQUENCE_PATH = '../../config/fold_sequence.json';
const MATERIALS_PATH = '../../config/materials.json';

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
    console.warn('Could not load fold_sequence.json:', seqResult.reason);
  }

  if (matResult.status === 'fulfilled') {
    materialsConfig = matResult.value;
  } else {
    console.warn('Could not load materials.json:', matResult.reason);
  }

  try {
    progressText.textContent = 'Loading model...';
    const gltf = await new Promise((resolve, reject) => {
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

    // Rotate model from Z-up (OBJ/CAD convention) to Y-up (Three.js)
    gltf.scene.rotation.x = -Math.PI / 2;
    scene.add(gltf.scene);
    modelRoot = gltf.scene;

    // Center camera on model
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    controls.target.copy(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    camera.position.set(
      center.x + maxDim * 1.5,
      center.y + maxDim * 1.0,
      center.z + maxDim * 1.5
    );
    controls.update();

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
      animator.update(0);
    }

    loadingDiv.classList.add('hidden');
    controlsDiv.classList.remove('hidden');

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
  }
});

btnReset.addEventListener('click', () => {
  if (!animator) return;
  currentTime = 0;
  isPlaying = false;
  btnPlay.innerHTML = '&#9654; Play';
  scrubber.value = 0;
  timeLabel.textContent = '0.0s';
  animator.update(0);
  updateStepLabel(0);
});

btnSpeed.addEventListener('click', () => {
  speedIndex = (speedIndex + 1) % speeds.length;
  speedMultiplier = speeds[speedIndex];
  btnSpeed.textContent = `${speedMultiplier}x`;
});

let isScrubbing = false;
scrubber.addEventListener('input', () => {
  if (!animator) return;
  isScrubbing = true;
  currentTime = (parseFloat(scrubber.value) / 1000) * totalDuration;
  animator.update(currentTime);
  isPlaying = false;
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
  // getDelta() must be called every frame to prevent large spikes after pause
  const delta = clock.getDelta();

  if (animator && isPlaying) {
    currentTime += delta * speedMultiplier;
    if (currentTime >= totalDuration) {
      currentTime = totalDuration;
      isPlaying = false;
      btnPlay.innerHTML = '&#9654; Play';
    }
    animator.update(currentTime);

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

// --- Start ---
loadModel();
animate();
