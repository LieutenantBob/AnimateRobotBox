import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createFoldAnimation } from './animation.js';

// --- Scene setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 50000);
camera.position.set(2000, 1500, 2000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(600, 500, 0);
controls.update();

// --- Lighting ---
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
mainLight.position.set(2000, 3000, 1500);
scene.add(mainLight);

const fillLight = new THREE.DirectionalLight(0x8888ff, 0.4);
fillLight.position.set(-1500, 1000, -1000);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
rimLight.position.set(0, -500, -2000);
scene.add(rimLight);

// Ground grid
const gridHelper = new THREE.GridHelper(5000, 50, 0x333355, 0x222244);
gridHelper.position.y = -150;
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
let isPlaying = false;
let currentTime = 0;
let totalDuration = 18;
let speedMultiplier = 1;
const speeds = [0.25, 0.5, 1, 2, 4];
let speedIndex = 2;

// --- Model paths ---
const MODEL_PATHS = [
  '../../assets/decimated/unfolded/robot_decimated.glb',
  '../../assets/decimated/folded/robot_decimated.glb',
];

const SEQUENCE_PATH = '../../config/fold_sequence.json';

// --- Load model and animation config ---
async function loadModel() {
  const loader = new GLTFLoader();

  // Load fold sequence config
  let sequence = null;
  try {
    const resp = await fetch(SEQUENCE_PATH);
    sequence = await resp.json();
    console.log('Loaded fold sequence:', sequence.sequence.length, 'steps');
  } catch (e) {
    console.warn('Could not load fold_sequence.json:', e);
  }

  for (const path of MODEL_PATHS) {
    try {
      progressText.textContent = `Loading ${path.split('/').pop()}...`;
      const gltf = await new Promise((resolve, reject) => {
        loader.load(
          path,
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

      console.log(`Loaded: ${path}`);
      scene.add(gltf.scene);

      // Log all mesh names and vertex counts
      let meshCount = 0;
      gltf.scene.traverse((node) => {
        if (node.isMesh) {
          meshCount++;
        }
      });
      console.log(`  ${meshCount} meshes in scene`);

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

      // Set up programmatic animation
      if (sequence) {
        animator = createFoldAnimation(gltf.scene, sequence);
        totalDuration = animator.totalDuration;
        // Start at time 0 (fully folded = unfolded state, before any animation)
        animator.update(0);
      }

      loadingDiv.classList.add('hidden');
      controlsDiv.classList.remove('hidden');
      return;

    } catch (e) {
      console.warn(`Failed to load ${path}:`, e.message || e);
    }
  }

  progressText.textContent = 'No model file found. Run the decimation pipeline first.';
  progressFill.style.width = '100%';
  progressFill.style.background = '#ff4444';
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

// --- Raycasting for part identification ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

renderer.domElement.addEventListener('mousemove', (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children, true);

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
});

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
    }
    animator.update(currentTime);

    if (!isScrubbing) {
      scrubber.value = Math.round((currentTime / totalDuration) * 1000);
      timeLabel.textContent = `${currentTime.toFixed(1)}s`;
      updateStepLabel(currentTime);
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

// --- Start ---
loadModel();
animate();
