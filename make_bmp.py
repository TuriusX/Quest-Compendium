import struct

def color(hex_str):
    # hex_str like "#2d2a45"
    r = int(hex_str[1:3], 16)
    g = int(hex_str[3:5], 16)
    b = int(hex_str[5:7], 16)
    return struct.pack('BBBB', b, g, r, 255) # BGRA

T = struct.pack('BBBB', 0, 0, 0, 0) # transparent
BG = color("#2d2a45")
SHADOW = color("#0f0c1b")
PAGES1 = color("#d6cda4")
PAGES2 = color("#a49a71")
COVER = color("#16112c")
SPINE = color("#1c1635")
GOLD = color("#f4c535")
GEM1 = color("#ab77fa")
GEM2 = color("#ffffff")

# Draw 32x32
pixels = [[T]*32 for _ in range(32)]

# Background
for y in range(0, 32):
    for x in range(0, 32):
        if (x==0 and y==0) or (x==31 and y==0) or (x==0 and y==31) or (x==31 and y==31):
            pixels[y][x] = T # approx rounded
        else:
            pixels[y][x] = BG

# Shadow
for y in range(8, 26):
    for x in range(9, 25):
        pixels[y][x] = SHADOW

# Pages
for y in range(7, 25):
    for x in range(22, 24):
        pixels[y][x] = PAGES1
for y in range(8, 24):
    pixels[y][24] = PAGES2

# Cover
for y in range(7, 25):
    for x in range(9, 22):
        pixels[y][x] = COVER

# Spine
for y in range(7, 25):
    for x in range(10, 12):
        pixels[y][x] = SPINE

# Corners
for (cx, cy, cw, ch) in [(8,8,4,1), (11,9,1,1), (8,23,4,1), (11,22,1,1), (20,7,2,1), (21,8,1,2), (20,24,2,1), (21,22,1,2)]:
    for y in range(cy, cy+ch):
        for x in range(cx, cx+cw):
            pixels[y][x] = GOLD

# Gem
for y in range(13, 18):
    for x in range(14, 17):
        pixels[y][x] = GEM1
for y in range(14, 17):
    for x in range(13, 18):
        pixels[y][x] = GEM1

# Gem white
for y in range(14, 17):
    pixels[y][15] = GEM2
for x in range(14, 17):
    pixels[15][x] = GEM2


# BMP format
# header: 14 bytes
# DIB header: 40 bytes (BITMAPINFOHEADER)

width = 32
height = 32
bpp = 32
image_size = width * height * 4
file_size = 54 + image_size

header = struct.pack('<ccIHHI', b'B', b'M', file_size, 0, 0, 54)
dib_header = struct.pack('<IiiHHIIiiII', 40, width, -height, 1, bpp, 0, image_size, 2835, 2835, 0, 0)

with open('public/book.bmp', 'wb') as f:
    f.write(header)
    f.write(dib_header)
    for row in pixels:
        for p in row:
            f.write(p)

print("Generated public/book.bmp")
