/**
 * Showroom lighting: the dark "car reveal" studio.
 *
 *   - Reflections come from a custom studio environment: a black room with
 *     large emissive softboxes (one overhead, two tall side strips, a back
 *     strip). Glossy panels and metal pick these up as long clean highlights.
 *   - An overhead rect-area softbox and two rim strips light the product
 *     directly; a near-vertical directional light adds soft contact shadows.
 *   - The floor is a real mirror (Reflector) under a black glossy plane whose
 *     opacity rises with distance, so the reflection is strongest under the
 *     product and the floor dissolves into the black backdrop.
 *
 * Scene units are millimetres, world is Y-up. The product sits around
 * x 600, z -400 (CAD y 400); the unfolded layout spans roughly 3.2 x 4.7 m.
 */
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

const FLOOR_Y = -151;
const CENTER = new THREE.Vector3(600, 0, -400);
const BLACK = 0x030304;
/** Layer for objects the floor mirror must not reflect (the floor itself). */
export const NO_REFLECT_LAYER = 1;

/** Base intensities; the lighting panel scales these. */
export const LIGHT_DEFAULTS = Object.freeze({
  exposure: 0.85,
  key: 2.2,      // overhead softbox (rect-area, nits-like units)
  rim: 5.0,      // rear side strips
  front: 1.6,    // low front softbox
  shadow: 0.7,   // directional light used for contact shadows
  ambient: 0.06, // hemisphere, keeps the blacks from crushing completely
  env: 1.0,      // studio reflections
});

/** HDR-emissive plane for the environment scene. */
function softbox(w, h, intensity) {
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  mat.color.setScalar(intensity);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

/** Black studio with softboxes, baked into a PMREM environment map. */
function makeStudioEnvironment(renderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x000000);
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(40, 16, 40),
    new THREE.MeshBasicMaterial({ color: 0x050506, side: THREE.BackSide }),
  );
  room.position.y = 6;
  env.add(room);

  const top = softbox(14, 5, 2.2);         // big overhead box -> long top highlights
  top.rotation.x = Math.PI / 2;
  top.position.set(0, 13, 0);
  const left = softbox(1.6, 10, 4);        // tall strips -> vertical highlight lines
  left.position.set(-16, 6, 4);
  left.rotation.y = Math.PI / 2;
  const right = softbox(1.6, 10, 4);
  right.position.set(16, 6, -4);
  right.rotation.y = -Math.PI / 2;
  const back = softbox(18, 1.2, 3);        // horizon strip -> crisp rim line on tops
  back.position.set(0, 3, -19);
  const front = softbox(10, 0.6, 1.5);     // faint low kicker so fronts are not dead
  front.position.set(0, 1.5, 19);
  front.rotation.y = Math.PI;
  env.add(top, left, right, back, front);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return texture;
}

function makeBackdrop() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Color(BLACK);
  const g = ctx.createRadialGradient(size / 2, size * 0.38, 0, size / 2, size * 0.38, size * 0.72);
  g.addColorStop(0, '#16191e');
  g.addColorStop(0.55, '#08090b');
  g.addColorStop(1, '#020203');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Alpha ramp for the floor's gloss plane: see-through near the product, opaque far away. */
function floorFadeTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgb(170,170,170)');   // ~33% of the mirror shows through
  g.addColorStop(0.28, 'rgb(205,205,205)');
  g.addColorStop(0.6, 'rgb(255,255,255)');
  g.addColorStop(1, 'rgb(255,255,255)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function makeFloor(renderer) {
  const group = new THREE.Group();
  group.name = '__floor';
  const ratio = Math.min(renderer.getPixelRatio(), 1.5);
  const mirror = new Reflector(new THREE.PlaneGeometry(36000, 36000), {
    clipBias: 0.003,
    textureWidth: Math.round(window.innerWidth * ratio * 0.6),
    textureHeight: Math.round(window.innerHeight * ratio * 0.6),
    color: 0x8a8d94,
  });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.set(CENTER.x, FLOOR_Y, CENTER.z);

  // Unlit black lacquer over the mirror: lights can't paint hotspots on it,
  // and its opacity ramp fades the reflection out with distance.
  const lacquer = new THREE.Mesh(
    new THREE.PlaneGeometry(36000, 36000),
    new THREE.MeshBasicMaterial({
      color: 0x040405, transparent: true, alphaMap: floorFadeTexture(), depthWrite: false,
      // Win the depth test against the mirror just below, even far away.
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
  );
  lacquer.rotation.x = -Math.PI / 2;
  lacquer.position.set(CENTER.x, FLOOR_Y + 2, CENTER.z);
  lacquer.layers.set(NO_REFLECT_LAYER);
  lacquer.renderOrder = 1;

  // Contact shadows only.
  const shadows = new THREE.Mesh(
    new THREE.PlaneGeometry(12000, 12000),
    new THREE.ShadowMaterial({
      opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }),
  );
  shadows.rotation.x = -Math.PI / 2;
  shadows.position.set(CENTER.x, FLOOR_Y + 4, CENTER.z);
  shadows.receiveShadow = true;
  shadows.layers.set(NO_REFLECT_LAYER);
  shadows.renderOrder = 2;

  group.add(mirror, lacquer, shadows);
  return { group, mirror };
}

function makeRectLight(color, intensity, w, h, position, lookAt) {
  const light = new THREE.RectAreaLight(color, intensity, w, h);
  light.position.copy(position);
  light.lookAt(lookAt);
  return light;
}

function makeShadowLight() {
  const light = new THREE.DirectionalLight(0xffffff, LIGHT_DEFAULTS.shadow);
  light.position.set(CENTER.x - 900, 7000, CENTER.z + 1400);
  light.target.position.copy(CENTER);
  light.castShadow = true;
  light.shadow.mapSize.set(4096, 4096);
  const cam = light.shadow.camera;
  cam.left = -3400; cam.right = 3400; cam.top = 3400; cam.bottom = -3400;
  cam.near = 2000; cam.far = 12000;
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 2.5;
  light.shadow.radius = 9;
  light.shadow.blurSamples = 20;
  return light;
}

/**
 * Builds the showroom around `scene`. `apply(levels)` takes the lighting
 * panel's multipliers (1 = default); `setFade(k)` dims everything for the
 * lights-up intro (0 = black, 1 = full).
 */
export function setupStudio(scene, renderer, camera) {
  RectAreaLightUniformsLib.init();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // honours shadow.radius

  camera.layers.enable(NO_REFLECT_LAYER);
  scene.background = makeBackdrop();
  scene.fog = new THREE.Fog(BLACK, 9000, 24000);
  scene.environment = makeStudioEnvironment(renderer);

  const above = CENTER.clone().setY(3400);
  const key = makeRectLight(0xffffff, LIGHT_DEFAULTS.key, 3600, 1800, above, CENTER);
  const rimL = makeRectLight(0xdfe8ff, LIGHT_DEFAULTS.rim, 260, 2600,
    new THREE.Vector3(CENTER.x - 3400, 700, CENTER.z - 2400), CENTER.clone().setY(600));
  const rimR = makeRectLight(0xdfe8ff, LIGHT_DEFAULTS.rim, 260, 2600,
    new THREE.Vector3(CENTER.x + 3400, 700, CENTER.z - 2400), CENTER.clone().setY(600));
  // Low, wide front softbox so the closed box's front reads in the opening shot.
  const front = makeRectLight(0xf4f6fa, LIGHT_DEFAULTS.front, 3000, 700,
    new THREE.Vector3(CENTER.x, 450, CENTER.z + 3800), CENTER.clone().setY(500));
  const shadow = makeShadowLight();
  const ambient = new THREE.HemisphereLight(0xcfd8e6, 0x000000, LIGHT_DEFAULTS.ambient);
  const floor = makeFloor(renderer);

  scene.add(key, rimL, rimR, front, shadow, shadow.target, ambient, floor.group);

  let levels = { exposure: 1, contrast: 1, key: 1, fill: 1, ambient: 1, env: 1 };
  let fade = 1;

  function refresh() {
    const m = levels;
    renderer.toneMappingExposure = LIGHT_DEFAULTS.exposure * m.exposure * fade;
    key.intensity = LIGHT_DEFAULTS.key * m.key * m.contrast;
    shadow.intensity = LIGHT_DEFAULTS.shadow * m.key * m.contrast;
    rimL.intensity = LIGHT_DEFAULTS.rim * m.fill;
    rimR.intensity = LIGHT_DEFAULTS.rim * m.fill;
    front.intensity = LIGHT_DEFAULTS.front * m.fill;
    ambient.intensity = LIGHT_DEFAULTS.ambient * m.ambient / Math.max(m.contrast, 0.05);
    scene.environmentIntensity = LIGHT_DEFAULTS.env * m.env;
  }

  /** @param {{ exposure: number, contrast: number, key: number, fill: number, ambient: number, env: number }} next */
  function apply(next) {
    levels = { ...next };
    refresh();
  }

  function setFade(k) {
    fade = Math.min(1, Math.max(0, k));
    refresh();
  }

  function setSize(width, height) {
    const ratio = Math.min(renderer.getPixelRatio(), 1.5);
    floor.mirror.getRenderTarget().setSize(Math.round(width * ratio * 0.6), Math.round(height * ratio * 0.6));
  }

  refresh();
  return { apply, setFade, setSize };
}
