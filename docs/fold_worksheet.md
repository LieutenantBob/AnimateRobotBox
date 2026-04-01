# Fold/Unfold Worksheet — Robot-in-a-Box

> Please fill in this worksheet so we can build the animation correctly.
> Refer to `docs/part_inventory.md` for the full part list.

---

## Section 1: Box Packing — What's Inside?

When the box is fully closed, which parts are packed inside?

**Base (stays in place):**
- [ ] Palle (pallet) — always at bottom
- [ ] Jernplade (iron plate) — on top of pallet
- [ ] Sandwich_plade — on top of iron plate

**Equipment packed inside the box:**
_(Check all that apply and note approximate position: bottom/middle/top, left/center/right)_

- [ ] UR30 (robot arm) — Position: _______________
- [ ] Body (main frame) — Position: _______________
- [ ] Tripod — Position: _______________
- [ ] PC2 (computer) — Position: _______________
- [ ] TV (monitor) — Position: _______________
- [ ] Hylde (shelf) — Position: _______________
- [ ] keyboard — Position: _______________
- [ ] Mouse 2 — Position: _______________
- [ ] Controller_OEM (+ cables) — Position: _______________
- [ ] Kontakt (electrical contacts) — Position: _______________
- [ ] Other: _______________

**Parts NOT inside the box (added separately / not transported):**
- _______________

---

## Section 2: Panels and Sides

### How do the side panels work?

In the folded model, `Sider` is one piece. In the unfolded model, there are 4 separate panels: `Forside2` (front), `Bag2` (back), `Left2`, `Right2`.

**Question:** Are these 4 separate panels that are held together by clamps when folded? Or is it one piece that we should treat as 4 panels for animation?

Answer: _______________

### Panel hinge edges

For each panel, where is the hinge (the edge it rotates around when opening)?

| Panel | Hinge Edge | Hinge At | Opens By Rotating... | Angle |
|-------|-----------|----------|---------------------|-------|
| Top2 (lid) | _____ edge | top / bottom | upward? | ___°  |
| Forside2 (front) | _____ edge | top / bottom | outward/downward? | ___° |
| Bag2 (back) | _____ edge | top / bottom | outward/downward? | ___° |
| Left2 | _____ edge | top / bottom | outward/downward? | ___° |
| Right2 | _____ edge | top / bottom | outward/downward? | ___° |

---

## Section 3: Unfold Sequence

What order do things open/deploy? Number each step.

| Step | Action | Description |
|------|--------|-------------|
| ___ | Remove feet from top | Fodder_Top and other feet are lifted off |
| ___ | Open lid (Top2) | Lid swings open |
| ___ | Release clamps | Clamps are undone |
| ___ | Open front panel (Forside2) | Front panel folds down/out |
| ___ | Open back panel (Bag2) | Back panel folds down/out |
| ___ | Open left panel (Left2) | Left panel folds down/out |
| ___ | Open right panel (Right2) | Right panel folds down/out |
| ___ | Deploy stiffeners (Afstivning) | Bracing members extend |
| ___ | Deploy side mechanisms | Side_left / Side_right extend |
| ___ | UR30 rises / unfolds | Robot arm deploys from box |
| ___ | Equipment setup | TV, PC, Tripod, etc. are placed |
| ___ | Other: _______________ | _______________ |

---

## Section 4: Feet (Foots)

There are 5 foot assemblies in the unfolded model:
- `Fodder_Forside` (front)
- `Fodder_Top` (top — also exists in folded model)
- `Fodder_Bagside` (back)
- `Fodder_venstre` (left)
- `Fodder_Højre` (right)

**Questions:**
1. Where are the feet stored when folded? On top of the lid? Inside the box?
   Answer: _______________

2. In the unfolded state, where do the feet go? Under the pallet? On the sides?
   Answer: _______________

3. Are the feet attached or separate pieces?
   Answer: _______________

---

## Section 5: Side Deployment Mechanisms

`Side_left` and `Side_right` each contain bars (Stang), crossbar plates, clamps, and bottom rods.

**Questions:**
1. What do these mechanisms do? (fold out to create a wider platform? support panels?)
   Answer: _______________

2. How do they deploy? (swing out? slide? telescope?)
   Answer: _______________

---

## Section 6: Bracing / Stiffeners (Afstivning)

8 stiffener parts: 5 longitudinal (`Langsstiver`), 3 transverse (`Tvarstiver`).

The naming suggests directional placement:
- NH = nord/høj? (north high?)
- ØV = øst/venstre? (east left?)
- ØH = øst/høj? (east high?)
- NV = nord/venstre? (north left?)

**Questions:**
1. Are these part of the box walls, or separate pieces that slide in?
   Answer: _______________

2. Do they fold flat against the walls when closed?
   Answer: _______________

3. Where do they go when deployed?
   Answer: _______________

---

## Section 7: Clamps and Handles

**Clamps** (40+ individual clamp parts):
- Bottom clamps: `Clamps_bund_Left`, `Clamps_bund_Right`
- Side clamps: front/back/top for left and right sides
- Crossbar clamps: `Clamp_Tværstang_left/right`
- Handle clamps: `Clamp_Left`, `Clamp_Right`

**Handles**: `Handle_Left`, `Handle_Right`

**Questions:**
1. Do clamps need to be animated (opening/closing), or can we just show them static?
   Answer: _______________

2. Are handles used for carrying the box, or for something else in unfolded state?
   Answer: _______________

---

## Section 8: Visual Preferences

1. **Color scheme**: Should we use the colors from the STEP file, or do you have specific brand colors?
   Answer: _______________

2. **Any parts that should be highlighted** (different color/material to stand out)?
   Answer: _______________

3. **Animation style**: Smooth and slow (presentation style)? Or fast and mechanical (realistic)?
   Answer: _______________

4. **Camera**: Should the camera orbit during animation, or stay fixed?
   Answer: _______________

---

## Section 9: Anything Else?

Any other details about how the robot-in-a-box works that would help us animate it correctly?

Notes: _______________
