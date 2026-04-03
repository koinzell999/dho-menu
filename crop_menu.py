from PIL import Image
import os, shutil

img = Image.open('menu-all.png').convert('RGB')
w, h = img.size
print(f"Source image: {w}x{h}")

os.makedirs('images', exist_ok=True)

# ── Grid coordinates from analysis ──────────────────────────────
# 4-column x coords (consistent across all 4-col bands)
C4 = [(9, 254), (260, 509), (515, 766), (771, 1024)]

# 6-column x coords – use midpoints with uniform 155px width
# Band 4 midpoints: 98, 260, 434, 609, 776, 943
C6_B4 = [(21, 176), (183, 338), (357, 512), (532, 687), (699, 854), (866, 1021)]
# Band 6 midpoints: 75, 262, 426, 608, 774, 951
C6_B6 = [(0, 152), (185, 340), (349, 504), (531, 686), (697, 852), (874, 1024)]

# Band definitions: (y_start, y_end, column_coords, [item_ids])
bands = [
    # ─── POPULAR + WAFFLES ───
    (39, 178, C4, ['pop1', 'waf1', 'waf2', 'waf3']),
    (186, 355, C4, ['waf4', 'waf5', 'waf6', 'waf7']),
    # ─── CREPES ───
    (399, 550, C4, ['crp1', 'crp2', 'crp3', 'crp4']),
    (559, 715, C4, ['crp5', 'crp6', 'crp7', 'crp8']),
    # ─── MILKSHAKES & ICE CREAM ───
    (773, 955, C6_B4, ['ms1', 'ms2', 'ms3', 'ms4', 'ice4', 'ice2']),
    # ─── COCKTAILS ───
    (1031, 1225, C6_B6, ['ckt1', 'ckt3', 'ckt4', 'ckt5', 'ckt6', 'ckt7']),
    # ─── FRUIT SALADS ───
    (1296, 1455, C4, ['sal1', 'sal2', 'sal3', 'sal4']),
    (1463, 1536, C4, ['sal5', 'sal6', 'sal7', 'sal8']),
]

cropped = {}
count = 0
for y1, y2, cols, items in bands:
    for i, item_id in enumerate(items):
        if i >= len(cols):
            break
        x1, x2 = cols[i]
        # Clamp to image bounds
        x1, y1c = max(0, x1), max(0, y1)
        x2, y2c = min(w, x2), min(h, y2)
        cell = img.crop((x1, y1c, x2, y2c))
        path = f'images/{item_id}.jpg'
        cell.save(path, 'JPEG', quality=88)
        cropped[item_id] = path
        count += 1
        print(f'  ✓ {path:24s}  {x2-x1}x{y2c-y1c}px')

print(f'\nCropped {count} unique images.')

# ── Create aliases for M/L size variants & missing items ────────
# Same type items share the same photo (copy file)
aliases = {
    # Waffle fallbacks (missing waf8, waf9)
    'waf8': 'waf7',   # Banana Waffle → Banana & Cream Waffle
    'waf9': 'waf4',   # Strawberry Waffle → Fruit Waffle (has berries)
    # Ice cream fallbacks
    'ice1': 'ice4',   # Fruit Ice Cream → Nuts & Honey (bowl style)
    'ice3': 'ice2',   # Mixed Ice Cream → Chocolate
    'ice5': 'ice2',   # Ice Boost → Chocolate
    # Milkshake M→L (same drink, same image)
    'ms5': 'ms4',     # Toffifee → Snickers (similar candy)
    'ms6': 'ms1',     # Kit Kat → Chocolate (similar look)
    'ms7': 'ms1', 'ms8': 'ms2', 'ms9': 'ms3',
    'ms10': 'ms4', 'ms11': 'ms4', 'ms12': 'ms1',
    # Cocktail fallbacks + M→L
    'ckt2': 'ckt1',   # Banana Milk → Fruit Cocktail
    'ckt8': 'ckt1', 'ckt9': 'ckt1', 'ckt10': 'ckt3',
    'ckt11': 'ckt4', 'ckt12': 'ckt5', 'ckt13': 'ckt6', 'ckt14': 'ckt7',
    # Special cocktails → regular cocktails
    'spc1': 'ckt1', 'spc2': 'ckt3', 'spc3': 'ckt1',
    'spc4': 'ckt6', 'spc5': 'ckt3',
    'spc6': 'ckt1', 'spc7': 'ckt3', 'spc8': 'ckt1',
    'spc9': 'ckt6', 'spc10': 'ckt3',
    # Juices → cocktail images (glass drinks)
    'jui1': 'ckt1', 'jui2': 'ckt7', 'jui3': 'ckt1', 'jui4': 'ckt6',
    'jui5': 'ckt1', 'jui6': 'ckt7', 'jui7': 'ckt1', 'jui8': 'ckt6',
    # Frozen → milkshakes/cocktails
    'frz1': 'ckt1', 'frz2': 'ms1', 'frz3': 'ms2', 'frz4': 'ckt7',
    # Cakes → crepes (plated desserts)
    'cak1': 'crp1', 'cak2': 'crp2', 'cak3': 'crp3', 'cak4': 'crp4',
    'cak5': 'crp6', 'cak6': 'crp7', 'cak7': 'crp7', 'cak8': 'crp7',
    # Salads M→L
    'sal9': 'sal4', 'sal10': 'sal5',
    # Montos → milkshakes (layered glass drinks)
    'mnt1': 'ms3', 'mnt2': 'ms1', 'mnt3': 'ms2', 'mnt4': 'ms4', 'mnt5': 'ms1',
    'mnt6': 'ms3', 'mnt7': 'ms1', 'mnt8': 'ms2', 'mnt9': 'ms4', 'mnt10': 'ms1',
    # Drinks → cocktails
    'drk1': 'ckt6', 'drk2': 'ckt5', 'drk3': 'ckt7',
}

alias_count = 0
for target_id, source_id in aliases.items():
    # Resolve chains (e.g. ms11→ms4)
    resolved = source_id
    depth = 0
    while resolved in aliases and depth < 5:
        resolved = aliases[resolved]
        depth += 1
    src = f'images/{resolved}.jpg'
    dst = f'images/{target_id}.jpg'
    if os.path.exists(src):
        shutil.copy2(src, dst)
        alias_count += 1
    else:
        print(f'  ⚠ Missing source for {target_id} → {resolved}')

print(f'Created {alias_count} alias copies.')
print(f'Total images in images/: {count + alias_count}')

# Verify completeness
all_ids = (
    ['pop1'] +
    [f'waf{i}' for i in range(1,10)] +
    [f'crp{i}' for i in range(1,9)] +
    [f'ice{i}' for i in range(1,6)] +
    [f'jui{i}' for i in range(1,9)] +
    [f'ms{i}' for i in range(1,13)] +
    [f'ckt{i}' for i in range(1,15)] +
    [f'spc{i}' for i in range(1,11)] +
    [f'frz{i}' for i in range(1,5)] +
    [f'cak{i}' for i in range(1,9)] +
    [f'sal{i}' for i in range(1,11)] +
    [f'mnt{i}' for i in range(1,11)] +
    [f'drk{i}' for i in range(1,4)]
)
missing = [x for x in all_ids if not os.path.exists(f'images/{x}.jpg')]
if missing:
    print(f'\n⚠ Still missing images for: {missing}')
else:
    print(f'\n✅ All {len(all_ids)} menu items have images!')
