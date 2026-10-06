import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { createFoldAnimation } from './animation.js';
import { applyMaterials } from './materials.js';

// --- Scene setup (product reveal aesthetic) ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a12);
scene.fog = new THREE.FogExp2(0x0a0a12, 0.00012);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 1, 50000);
camera.position.set(2000, 1500, 2000);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- Post-processing (subtle bloom for cinematic glow) ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.15,   // strength — subtle
  0.4,    // radius
  0.85    // threshold — only bright highlights bloom
);
composer.addPass(bloomPass);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(600, 500, 0);
controls.autoRotate = false;
controls.autoRotateSpeed = 0.5;
controls.update();

// --- Dramatic product-reveal lighting ---
// Very low ambient — drama comes from directional lights
scene.add(new THREE.AmbientLight(0x222233, 0.25));

// Hero key light — warm, coming from upper-right front
const mainLight = new THREE.DirectionalLight(0xfff0dd, 2.5);
mainLight.position.set(1500, 2500, 2000);
mainLight.castShadow = true;
mainLight.shadow.mapSize.width = 4096;
mainLight.shadow.mapSize.height = 4096;
mainLight.shadow.camera.left = -3000;
mainLight.shadow.camera.right = 3000;
mainLight.shadow.camera.top = 3000;
mainLight.shadow.camera.bottom = -3000;
mainLight.shadow.camera.near = 100;
mainLight.shadow.camera.far = 8000;
mainLight.shadow.bias = -0.0005;
mainLight.shadow.normalBias = 0.02;
scene.add(mainLight);

// Cool fill from the left — creates color contrast
const fillLight = new THREE.DirectionalLight(0x8899cc, 0.4);
fillLight.position.set(-2000, 800, -500);
scene.add(fillLight);

// Rim/backlight — edge highlighting for product silhouette
const rimLight = new THREE.DirectionalLight(0xaabbff, 0.8);
rimLight.position.set(-500, 200, -2500);
scene.add(rimLight);

// Subtle top light
const topLight = new THREE.DirectionalLight(0xffffff, 0.15);
topLight.position.set(0, 5000, 0);
scene.add(topLight);

// Hemisphere for subtle color gradient (sky to ground)
const hemiLight = new THREE.HemisphereLight(0x1a1a2e, 0x0a0a0a, 0.3);
scene.add(hemiLight);

// Spotlight — dramatic focused light on the product
const spotLight = new THREE.SpotLight(0xffffff, 1.5, 6000, Math.PI / 6, 0.5, 1);
spotLight.position.set(600, 3000, 600);
spotLight.target.position.set(600, 0, -400);
spotLight.castShadow = true;
spotLight.shadow.mapSize.width = 2048;
spotLight.shadow.mapSize.height = 2048;
scene.add(spotLight);
scene.add(spotLight.target);

// Environment map — darker, more dramatic
const pmremGenerator = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.background = new THREE.Color(0x111122);
const envLight1 = new THREE.DirectionalLight(0xffffff, 1.5);
envLight1.position.set(1, 1, 1);
envScene.add(envLight1);
const envLight2 = new THREE.DirectionalLight(0x334466, 0.8);
envLight2.position.set(-1, 0.5, -1);
envScene.add(envLight2);
const envLight3 = new THREE.DirectionalLight(0x222244, 0.5);
envLight3.position.set(0, -1, 0);
envScene.add(envLight3);
const envTexture = pmremGenerator.fromScene(envScene).texture;
scene.environment = envTexture;
pmremGenerator.dispose();

// --- Reflective showroom floor ---
const floorGeo = new THREE.PlaneGeometry(8000, 8000);
const floorMat = new THREE.MeshPhysicalMaterial({
  color: 0x111115,
  roughness: 0.15,
  metalness: 0.8,
  clearcoat: 0.3,
  clearcoatRoughness: 0.1,
  envMapIntensity: 0.6,
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -151;
floor.receiveShadow = true;
scene.add(floor);

// Subtle radial gradient on floor (spotlight pool)
const gradientGeo = new THREE.PlaneGeometry(4000, 4000);
const gradientCanvas = document.createElement('canvas');
gradientCanvas.width = 512;
gradientCanvas.height = 512;
const gCtx = gradientCanvas.getContext('2d');
const grad = gCtx.createRadialGradient(256, 256, 0, 256, 256, 256);
grad.addColorStop(0, 'rgba(60, 65, 80, 0.3)');
grad.addColorStop(0.5, 'rgba(30, 30, 40, 0.1)');
grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
gCtx.fillStyle = grad;
gCtx.fillRect(0, 0, 512, 512);
const gradientTex = new THREE.CanvasTexture(gradientCanvas);
const gradientMat = new THREE.MeshBasicMaterial({
  map: gradientTex,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const gradientMesh = new THREE.Mesh(gradientGeo, gradientMat);
gradientMesh.rotation.x = -Math.PI / 2;
gradientMesh.position.y = -149;
scene.add(gradientMesh);

// No walls — infinite dark void
// No grid — clean showroom look

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
    gltf.scene.traverse((node) => {
      if (node.isMesh && node.material) cachedMeshes.push(node);
    });

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

// Base values for each light (the defaults from scene setup)
const lightDefaults = {
  exposure: 1.0,
  key: 2.5,
  fill: 0.4,
  ambient: 0.25,
  env: 1.0,
};

function setupSlider(id, baseVal, onChange) {
  const slider = document.getElementById(`sl-${id}`);
  const valEl = document.getElementById(`val-${id}`);
  slider.addEventListener('input', () => {
    const pct = parseFloat(slider.value) / 100;
    const val = baseVal * pct;
    valEl.textContent = val.toFixed(1);
    onChange(val, pct);
  });
}

setupSlider('exposure', lightDefaults.exposure, (val) => {
  renderer.toneMappingExposure = val;
});

// Model meshes for the material sliders (filled once the model has loaded)
const cachedMeshes = [];

setupSlider('contrast', 1.0, (val) => {
  for (const mesh of cachedMeshes) {
    mesh.material.envMapIntensity = val;
  }
});

setupSlider('key', lightDefaults.key, (val) => {
  mainLight.intensity = val;
});

setupSlider('fill', lightDefaults.fill, (val) => {
  fillLight.intensity = val;
});

setupSlider('ambient', lightDefaults.ambient, (val) => {
  scene.children.forEach((child) => {
    if (child.isAmbientLight) child.intensity = val;
  });
  hemiLight.intensity = val * 1.25;
});

setupSlider('env', lightDefaults.env, (val) => {
  for (const mesh of cachedMeshes) {
    if (mesh.material.envMapIntensity !== undefined) {
      mesh.material.envMapIntensity = val;
    }
  }
});

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
  composer.setSize(window.innerWidth, window.innerHeight);
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
  // Use post-processing composer instead of direct render
  composer.render();
}

// Stop auto-rotate when user interacts (registered ONCE, outside the loop)
renderer.domElement.addEventListener('pointerdown', () => {
  controls.autoRotate = false;
});

// --- Start ---
loadModel();
animate();
