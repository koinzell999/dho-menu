from PIL import Image
import numpy as np

img = Image.open('menu-all.png')
w, h = img.size
arr = np.array(img)

print(f"Image size: {w} x {h}")
print()

# Find horizontal section breaks by looking at row brightness
# Header/text rows tend to be very bright (white/near-white background)
row_avg = arr.mean(axis=1).mean(axis=1)  # average brightness per row

# Find bands of bright rows (headers/gaps)
threshold = 220
in_bright = False
sections = []
bright_bands = []

for y in range(h):
    if row_avg[y] > threshold:
        if not in_bright:
            in_bright = True
            band_start = y
    else:
        if in_bright:
            in_bright = False
            bright_bands.append((band_start, y))
if in_bright:
    bright_bands.append((band_start, h))

print("=== Bright horizontal bands (headers/gaps) ===")
for b in bright_bands:
    print(f"  y={b[0]:4d} to y={b[1]:4d}  (height={b[1]-b[0]}px)")

# Content bands are between the bright bands
print()
print("=== Content bands (image rows) ===")
prev_end = 0
content_bands = []
for b in bright_bands:
    if b[0] > prev_end + 5:
        content_bands.append((prev_end, b[0]))
    prev_end = b[1]
if prev_end < h - 5:
    content_bands.append((prev_end, h))

for i, cb in enumerate(content_bands):
    print(f"  Band {i}: y={cb[0]:4d} to y={cb[1]:4d}  (height={cb[1]-cb[0]}px)")

# For each content band, detect columns by looking at vertical brightness
print()
print("=== Column analysis per band ===")
for i, (y1, y2) in enumerate(content_bands):
    band = arr[y1:y2, :, :]
    col_avg = band.mean(axis=0).mean(axis=1)
    
    # Find white/bright vertical gaps
    bright_cols = []
    in_gap = False
    for x in range(w):
        if col_avg[x] > 230:
            if not in_gap:
                in_gap = True
                gap_start = x
        else:
            if in_gap:
                in_gap = False
                if x - gap_start > 3:
                    bright_cols.append((gap_start, x))
    if in_gap and w - gap_start > 3:
        bright_cols.append((gap_start, w))
    
    # Derive cell boundaries
    cells_x = []
    prev = 0
    for gx1, gx2 in bright_cols:
        mid = (gx1 + gx2) // 2
        if gx1 > prev + 20:
            cells_x.append((prev, gx1))
        prev = gx2
    if prev < w - 20:
        cells_x.append((prev, w))
    
    print(f"  Band {i} (y {y1}-{y2}): {len(cells_x)} columns")
    for j, (cx1, cx2) in enumerate(cells_x):
        print(f"    Col {j}: x={cx1:4d} to x={cx2:4d} (width={cx2-cx1}px)")
