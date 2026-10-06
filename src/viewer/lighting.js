/**
 * Studio lighting for the product viewer.
 *
 * One soft key light with shadows, a sky/ground hemisphere fill, a cool rim
 * light, and a neutral studio environment map for reflections. The matte
 * floor fades into a vignetted backdrop through fog of the same colour, so
 * the model sits in a seamless "infinite cove" instead of a black void.
 *
 * Scene units are millimetres, world is Y-up (the CAD model is rotated in
 * viewer.js). The unfolded layout spans roughly x -1000..2200, z -2700..2000.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const BACKDROP = { center: '#4a525d', edge: '#1d2127' };
const FOG_COLOR = 0x2b3038;
const FLOOR_Y = -151;

/** Base intensities; the lighting panel scales these. */
export const LIGHT_DEFAULTS = Object.freeze({
  exposure: 0.9,
  key: 3.2,
  fill: 0.55,    // hemisphere sky/ground fill
  rim: 1.4,
  ambient: 0.1,  // flat fill so dark parts never go pure black
  env: 0.4,      // environment-map reflections
});

function makeBackdrop() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Color(FOG_COLOR);
  const g = ctx.createRadialGradient(size / 2, size * 0.42, 0, size / 2, size * 0.42, size * 0.75);
  g.addColorStop(0, BACKDROP.center);
  g.addColorStop(1, BACKDROP.edge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFloor() {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30000, 96),
    new THREE.MeshStandardMaterial({ color: 0x5a616b, roughness: 0.92, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  floor.name = '__floor';
  return floor;
}

function makeKeyLight() {
  const key = new THREE.DirectionalLight(0xfff4e6, LIGHT_DEFAULTS.key);
  // Front-left and high: the camera looks from front-right, so faces turn
  // away from the key and the box reads as a solid instead of a flat cutout.
  key.position.set(-1900, 7400, 3700);
  key.target.position.set(600, 0, -350);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  const cam = key.shadow.camera;
  cam.left = -3600; cam.right = 3600; cam.top = 3600; cam.bottom = -3600;
  cam.near = 1000; cam.far = 14000;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 2.5;
  key.shadow.radius = 5;          // soft edges (PCF filtering)
  key.shadow.blurSamples = 16;
  return key;
}

/**
 * Builds the studio around `scene`. Returns the lights and an `apply(levels)`
 * function the lighting panel calls with slider multipliers (1 = default).
 */
export function setupStudio(scene, renderer) {
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = LIGHT_DEFAULTS.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // honours shadow.radius for soft edges

  scene.background = makeBackdrop();
  scene.fog = new THREE.Fog(FOG_COLOR, 9000, 26000);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const key = makeKeyLight();
  const hemi = new THREE.HemisphereLight(0xe4ecff, 0x50463c, LIGHT_DEFAULTS.fill);
  const rim = new THREE.DirectionalLight(0xc8d8ff, LIGHT_DEFAULTS.rim);
  rim.position.set(3800, 2200, -4200);
  const ambient = new THREE.AmbientLight(0xffffff, LIGHT_DEFAULTS.ambient);

  scene.add(key, key.target, hemi, rim, ambient, makeFloor());

  /**
   * @param {{ exposure: number, contrast: number, key: number, fill: number, ambient: number, env: number }} m
   *   multipliers from the lighting panel (1 = default). Contrast trades
   *   directional light against soft fill.
   */
  function apply(m) {
    renderer.toneMappingExposure = LIGHT_DEFAULTS.exposure * m.exposure;
    key.intensity = LIGHT_DEFAULTS.key * m.key * m.contrast;
    rim.intensity = LIGHT_DEFAULTS.rim * m.key * m.contrast;
    const soften = 1 / Math.max(m.contrast, 0.05);
    hemi.intensity = LIGHT_DEFAULTS.fill * m.fill * soften;
    ambient.intensity = LIGHT_DEFAULTS.ambient * m.ambient * soften;
    scene.environmentIntensity = LIGHT_DEFAULTS.env * m.env;
  }

  apply({ exposure: 1, contrast: 1, key: 1, fill: 1, ambient: 1, env: 1 });
  return { key, hemi, rim, ambient, apply };
}
