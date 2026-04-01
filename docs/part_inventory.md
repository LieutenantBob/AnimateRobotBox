# Part Inventory — Robot-in-a-Box

> Auto-generated from STEP and OBJ analysis. Please review and correct.

## Folded State (The Box)

Bounding box: **1200 × 1000 × ~1214 mm** (with feet on top)

### STEP Hierarchy (Folded)

```
Robot-in-a-box_folded v0.3
├── Robot_in_a_box_Unfolded
│   ├── Bund001 (base assembly)
│   │   ├── Palle          — pallet/base platform (1200×1000×150mm)
│   │   ├── Jernplade       — iron plate (1190×990×10mm)
│   │   └── Sandwich_plade  — sandwich plate (1140×940×22mm)
│   └── Foots
│       └── Fodder_Top      — feet on top (1160×902×160mm)
├── Sider                   — all side panels combined (1190×987×1000mm)
└── Top                     — top lid (1190×965×22mm)
```

### OBJ Groups (Folded) — 176 vertices total

| Group | Vertices | Faces | Dimensions (mm) | Z-range |
|-------|----------|-------|------------------|---------|
| Palle | 24 | 52 | 1200 × 1000 × 150 | -150 to 0 |
| Jernplade | 8 | 12 | 1190 × 990 × 10 | 0 to 10 |
| Sandwich_plade | 8 | 12 | 1140 × 940 × 22 | 0 to 22 |
| Fodder_Top | 96 | 152 | 1160 × 902 × 160 | 1054 to 1214 |
| Sider | 32 | 60 | 1190 × 987 × 1000 | 32 to 1032 |
| Top | 8 | 12 | 1190 × 965 × 22 | 1032 to 1054 |

### Stacking Order (bottom to top, based on Z coordinates)

1. **Palle** (Z: -150 to 0) — the wooden pallet base
2. **Jernplade** (Z: 0 to 10) — iron plate sitting on pallet
3. **Sandwich_plade** (Z: 0 to 22) — sandwich plate on top of iron plate
4. **Sider** (Z: 32 to 1032) — side walls, 1000mm tall
5. **Top** (Z: 1032 to 1054) — lid on top of sides
6. **Fodder_Top** (Z: 1054 to 1214) — feet stacked on very top of lid

---

## Unfolded State (The Robot Workstation)

### STEP Hierarchy (Unfolded) — 536 products, 24 colors

```
Robot_in_a_box_Unfolded
├── UR30                          — Robot arm (10 sub-parts)
│   ├── C-2003903                 — arm segment
│   ├── C-2003904                 — arm segment
│   ├── C-2007309 (2 children)    — arm segment
│   ├── 704-251-01_filled         — arm component
│   ├── C-2007312 (2 children)    — arm segment
│   ├── 704-250-01_filled         — arm component
│   ├── C-2003907                 — arm segment
│   ├── C-2003908                 — arm segment
│   ├── C-2007588                 — arm segment
│   └── 1005866                   — arm component
│
├── Diverse001                    — Equipment group (9 sub-assemblies)
│   ├── Hylde                     — shelf
│   ├── Mouse 2 (2 children)      — mouse
│   ├── keyboard                  — keyboard
│   ├── Controller_OEM (342 ch.)  — controller + cable trays
│   ├── Kontakt (12 children)     — electrical contacts
│   ├── PC2                       — computer
│   ├── TV                        — monitor/display
│   ├── Tripod (5 children)       — tripod stand
│   └── Body                      — main body/frame
│
├── Bund001                       — Base (same as folded)
│   ├── Palle                     — pallet
│   ├── Jernplade                  — iron plate
│   └── Sandwich_plade            — sandwich plate
│
├── Afstivning                    — Bracing/stiffeners (8 parts)
│   ├── Langsstiver_NH            — longitudinal stiffener
│   ├── Langsstiver_ØV            — longitudinal stiffener
│   ├── Langsstiver_ØH            — longitudinal stiffener
│   ├── Langsstiver_NV_2          — longitudinal stiffener
│   ├── Langsstiver_NV_master002  — longitudinal stiffener
│   ├── Tvarstiver_Vandret_ØV     — transverse stiffener
│   ├── Tvarstiver_Vandret_ØH     — transverse stiffener
│   └── Tvarstiver_Vandret_NH     — transverse stiffener
│
├── Side_left                     — Left side deployment mechanism
│   ├── Stang_Venstre             — left bar/rod
│   ├── Plade_Tværstang_left      — left crossbar plate
│   ├── Clamp_Tværstang_left (4)  — left crossbar clamp
│   ├── Stang_bund001 (1)         — bottom rod
│   └── Stang_bund003 (1)         — bottom rod
│
├── Side_right                    — Right side deployment mechanism
│   ├── Stang_Hojre               — right bar/rod
│   ├── Plade_Tværstang_right     — right crossbar plate
│   ├── Clamp_Tværstang_right (4) — right crossbar clamp
│   ├── Stang_bund002             — bottom rod
│   └── Stang_bund (1)            — bottom rod
│
├── Foots                         — Feet (5 foot assemblies)
│   ├── Fodder_Forside            — front foot
│   ├── Fodder_Top                — top foot
│   ├── Fodder_Bagside            — back foot
│   ├── Fodder_venstre            — left foot
│   └── Fodder_Højre              — right foot
│
├── Clamps                        — Clamp assemblies (8 groups, ~40 parts)
│   ├── Clamps_bund_Left (4)
│   ├── Clamps_bund_Right (4)
│   ├── Clamp_Left_side_front (5)
│   ├── Clamp_Right_side_front (5)
│   ├── Clamp_Left_side_back (5)
│   ├── Clamp_Right_side_back (5)
│   ├── Clamp_Left_side_Top (5)
│   └── Clamp_Right_side_Top (5)
│
├── Handles                       — Handles + handle clamps
│   ├── Handle_Left
│   ├── Handle_Right
│   ├── Clamp_Left (5)
│   └── Clamp_Right (5)
│
├── Forside2                      — Front panel (standalone)
├── Top2                          — Top panel (standalone)
├── Left2                         — Left panel (standalone)
├── Right2                        — Right panel (standalone)
└── Bag2                          — Back panel (standalone)
```

### Parts Shared Between States

| Part Name | In Folded | In Unfolded | Notes |
|-----------|-----------|-------------|-------|
| Palle | ✅ | ✅ | Base platform — does not move |
| Jernplade | ✅ | ✅ | Iron plate on pallet — does not move |
| Sandwich_plade | ✅ | ✅ | Sandwich plate — does not move |
| Fodder_Top | ✅ | ✅ | In folded: stacked on top. In unfolded: one of 5 feet |

### Panel Mapping (Folded → Unfolded)

| Folded Name | Unfolded Name(s) | Transformation |
|-------------|-------------------|----------------|
| Sider | Forside2, Left2, Right2, Bag2 | Single piece → 4 separate panels that fold out |
| Top | Top2 | Lid opens |

### Colors from STEP (24 unique)

The unfolded model has 24 distinct RGB colors defined in the STEP file, ranging from near-black (0.098) to near-white (0.937), with some accent colors including green (0, 0.753, 0) and warm tones (0.898, 0.729, 0.392).

---

## Questions for Review

1. Is the stacking order correct (Palle → Jernplade → Sandwich_plade → Sider → Top → Fodder_Top)?
2. Are the 5 "Fodder" feet stored flat on top of the lid when folded, or inside the box?
3. Does `Sider` literally split into 4 panels, or are they always 4 separate pieces that just happen to be flush when closed?
4. What goes inside the box? Is ALL the equipment (UR30, PC, TV, Tripod, etc.) packed inside?
5. Are the bracing stiffeners (`Afstivning`) part of the box walls, or separate pieces that deploy?
6. What are `Side_left` and `Side_right`? Deployment arms/mechanisms that swing out?
