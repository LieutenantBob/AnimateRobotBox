/**
 * Fold layout: every number that defines where things sit in the closed box
 * and how they travel to their working positions.
 *
 * Coordinates are the model's CAD frame (Z-up, millimetres), identical to the
 * unfolded geometry baked into the GLB. The base (pallet + plates) never moves,
 * so "closed box" positions use the same frame.
 *
 * Timing never lives here — moves reference a step `action` from
 * config/fold_sequence.json plus an optional [from, to] fraction of that
 * step's duration (used to stagger parts within one step).
 */

export const FLOOR_Z = -150;

/** Usable inside of the closed box (walls hinge outside the base footprint). */
export const BOX_INTERIOR = Object.freeze({ min: [0, 0, 10], max: [1200, 1000, 1032] });

const range = (prefix, from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(3, '0')}`);

export const ROBOT_PARTS = [
  'C-2003903', 'C-2003904', 'C-2003907', 'C-2003908',
  'C-2007307', 'C-2007308', 'C-2007310', 'C-2007311', 'C-2007588',
  '704-250-01_filled', '704-251-01_filled', '1005866',
];

/** Angle of the lid relative to the front wall once opened (0 = coplanar, 90 = closed). */
export const LID_OPEN_DEG = -90;
/** Robot base-joint rotation while packed (0 = working pose). */
export const ROBOT_PARK_DEG = -8;

/**
 * Hinges, parent first. Pivot and axis are in the parent's unfolded frame.
 * `angles` is the keyframe list: initial value, then moves to new values.
 */
export const HINGES = [
  {
    name: 'front', parent: null, pivot: [600, 0, 32], axis: [-1, 0, 0],
    members: ['Forside2'],
    initial: 90, moves: [{ step: 'fold_panels', to: 0 }],
  },
  {
    // The lid hinges on the top edge of the front wall ("treasure chest").
    // Opening swings it 180° out over the front; when the front wall folds
    // down the lid counter-rotates so it stays level and lands flat beyond it.
    name: 'lid', parent: 'front', pivot: [600, -1001, 32], axis: [-1, 0, 0],
    members: ['Top2', 'Fodder_Top'],
    initial: 90, moves: [
      { step: 'open_lid', to: LID_OPEN_DEG },
      { step: 'fold_panels', to: 0 },
    ],
  },
  {
    name: 'back', parent: null, pivot: [600, 1000, 32], axis: [1, 0, 0],
    members: ['Bag2'],
    initial: 90, moves: [{ step: 'fold_panels', to: 0 }],
  },
  {
    name: 'left', parent: null, pivot: [0, 500, 32], axis: [0, 1, 0],
    members: ['Left2'],
    initial: 90, moves: [{ step: 'fold_panels', to: 0 }],
  },
  {
    name: 'right', parent: null, pivot: [1200, 500, 32], axis: [0, -1, 0],
    members: ['Right2'],
    initial: 90, moves: [{ step: 'fold_panels', to: 0 }],
  },
  {
    // Base joint of the UR30: the whole arm swings about the vertical axis
    // through its base flange.
    name: 'robot', parent: null, pivot: [299, 396, 0], axis: [0, 0, 1],
    members: ROBOT_PARTS,
    initial: ROBOT_PARK_DEG, moves: [{ step: 'robot_joints', to: 0 }],
  },
];

/**
 * Which hinge a loose mounted part (clamp, pad, plate, cable tray...) rides
 * with, decided from where its centre lies in the unfolded layout.
 * Returns null for parts over the base footprint (they never move).
 */
export function hingeForPoint(x, y) {
  if (x < 0) return 'left';
  if (x > 1200) return 'right';
  if (y < -1001) return 'lid';
  if (y < 0) return 'front';
  if (y > 1000) return 'back';
  return null;
}

/**
 * Feet start stacked on the closed lid (Fodder_Top at the bottom) and are
 * moved one by one, top of the stack first, onto the outside of their wall.
 */
/*
 * Each foot is three loose skids (50 x 160 x 900 mm). Fodder_Top's skids lie
 * along Y at x = 20, 575, 1130 on the closed lid. The two side feet are
 * narrower (skids 380 mm apart), so turned 90° they slot in between those
 * skids in the same 160 mm layer:
 *
 *   x:  20  100  270  480  575  650  860  1030  1130
 *       Top  L    R    L   Top   R    L    R    Top
 *
 * Front and back feet are as wide as the lid, so they lie on top as layers
 * two and three. Stack height: 3 x 160 = 480 mm.
 */
const LID_LAYER_Z = 1135; // centre of a skid layer lying on the closed lid (lid top is z=1055)
const SKID_HEIGHT = 160;
const FLAT = [['x', 180]];
const FLAT_TURNED = [['z', 90], ['x', 180]];

/** Removed top layer first; side feet lift straight up out of the lid layer. */
export const FEET = [
  {
    name: 'foot_back', members: ['Fodder_Bagside'], hinge: 'back', outward: [0, 1, 0], window: [0.0, 0.35],
    stack: { center: [600, 500, LID_LAYER_Z + 2 * SKID_HEIGHT], rot: FLAT },
  },
  {
    name: 'foot_front', members: ['Fodder_Forside'], hinge: 'front', outward: [0, -1, 0], window: [0.2, 0.55],
    stack: { center: [600, 500, LID_LAYER_Z + SKID_HEIGHT], rot: FLAT },
  },
  {
    name: 'foot_left', members: ['Fodder_venstre'], hinge: 'left', outward: [-1, 0, 0], window: [0.45, 0.8],
    stack: { center: [505, 500, LID_LAYER_Z], rot: FLAT_TURNED },
  },
  {
    name: 'foot_right', members: ['Fodder_Højre'], hinge: 'right', outward: [1, 0, 0], window: [0.65, 1.0],
    stack: { center: [675, 500, LID_LAYER_Z], rot: FLAT_TURNED },
  },
];

/**
 * Stiffeners: packed as a rack under the lid, lifted out onto the floor
 * beside the box (outside every panel's landing zone), then inserted.
 * Langsstivere are turned 90° to lie along X in the rack.
 */
const ALONG_X = [['z', 90]];
export const STIFFENERS = [
  { name: 'Langsstiver_NH', packed: { center: [600, 70, 1010], rot: ALONG_X }, staging: [-880, -500, -140] },
  { name: 'Langsstiver_NV_2', packed: { center: [600, 110, 1010], rot: ALONG_X }, staging: [-760, -500, -140] },
  { name: 'Langsstiver_NV_master002', packed: { center: [600, 150, 1010], rot: ALONG_X }, staging: [-640, -500, -140] },
  { name: 'Langsstiver_ØH', packed: { center: [600, 190, 1010], rot: ALONG_X }, staging: [-520, -500, -140] },
  { name: 'Langsstiver_ØV', packed: { center: [600, 230, 1010], rot: ALONG_X }, staging: [-400, -500, -140] },
  { name: 'Tvarstiver_Vandret_NH', packed: { center: [600, 270, 1010], rot: [] }, staging: [1700, 1250, -140] },
  { name: 'Tvarstiver_Vandret_ØH', packed: { center: [600, 310, 1010], rot: [] }, staging: [1700, 1400, -140] },
  { name: 'Tvarstiver_Vandret_ØV', packed: { center: [600, 350, 1010], rot: [] }, staging: [1700, 1550, -140] },
];
export const STIFFENER_TRAVEL_Z = 1350;

/**
 * Loose equipment packed inside the box.
 *   packed  — centre + rotation sequence inside the closed box
 *   step    — action id from fold_sequence.json, window = fraction of it
 *   liftZ   — absolute height the centre rises to before travelling
 *   arrive  — offset from the final centre of the last waypoint
 *             ([0,0,h] = lowered in from above, [0,-d,0] = slid in from the front)
 */
const LYING_ALONG_X = [['y', 90], ['x', 90]];
export const EQUIPMENT = [
  {
    name: 'strut_left', members: ['Stang_Venstre', 'Handle_Left', ...range('SOLID', 17, 21)],
    packed: { center: [600, 640, 760], rot: LYING_ALONG_X },
    step: 'deploy_struts', window: [0, 0.9], liftZ: 1600, arrive: [0, 0, 650], rotWindow: [0.15, 0.7],
  },
  {
    name: 'strut_right', members: ['Stang_Hojre', 'Handle_Right', ...range('SOLID', 22, 26)],
    packed: { center: [600, 380, 740], rot: LYING_ALONG_X },
    step: 'deploy_struts', window: [0.1, 1], liftZ: 1600, arrive: [0, 0, 650], rotWindow: [0.15, 0.7],
  },
  {
    name: 'shelf', members: ['Hylde', 'SOLID', ...range('SOLID', 1, 11)],
    packed: { center: [505, 620, 741], rot: [['x', 90], ['z', 90]] },
    step: 'place_shelf_tv', window: [0, 0.7], liftZ: 1600, arrive: [0, 0, 700], rotWindow: [0.15, 0.7],
  },
  {
    name: 'tripod', members: ['Body', ...range('SOLID', 12, 16)],
    packed: { center: [660, 545, 700], rot: [['y', 90], ['z', 35]] },
    step: 'place_shelf_tv', window: [0, 0.75], liftZ: 1600, arrive: [0, 0, 750], rotWindow: [0.15, 0.7],
  },
  {
    name: 'tv', members: ['TV'],
    packed: { center: [600, 88, 445], rot: [] },
    step: 'place_shelf_tv', window: [0.3, 1], liftZ: 1950, arrive: [0, -600, 160], rotWindow: [0, 1],
  },
  {
    name: 'pc', members: ['PC2'],
    packed: { center: [300, 880, 260], rot: [['z', 90]] },
    step: 'move_pc', window: [0, 1], liftZ: 900, arrive: [0, 0, 450], rotWindow: [0.2, 0.8],
  },
  {
    name: 'keyboard', members: ['keyboard'],
    packed: { center: [800, 900, 52], rot: [['z', 90]] },
    step: 'place_keyboard', window: [0, 0.85], liftZ: 950, arrive: [0, -600, 0], rotWindow: [0.2, 0.8],
  },
  {
    name: 'mouse', members: ['1', '1005867'],
    packed: { center: [1060, 900, 62], rot: [] },
    step: 'place_keyboard', window: [0.15, 1], liftZ: 950, arrive: [0, -600, 0], rotWindow: [0.2, 0.8],
  },
];
