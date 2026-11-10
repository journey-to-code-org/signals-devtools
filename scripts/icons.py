"""Draws the extension icons: two sources feeding a derived node, on a rounded square."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(sys.argv[1] if len(sys.argv) > 1 else "extension/icons")
out.mkdir(parents=True, exist_ok=True)

S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((16, 16, S - 16, S - 16), radius=112, fill=(24, 28, 38, 255))

a, b, c = (150, 160), (150, 352), (360, 256)
line = (120, 210, 255, 255)
for p in (a, b):
    d.line((p, c), fill=line, width=34)
for p, color in ((a, (255, 196, 64)), (b, (255, 196, 64)), (c, (120, 210, 255))):
    r = 62 if p == c else 50
    d.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=color)
r = 26
d.ellipse((c[0] - r, c[1] - r, c[0] + r, c[1] + r), fill=(24, 28, 38, 255))

for size in (16, 32, 48, 128):
    img.resize((size, size), Image.LANCZOS).save(out / f"icon-{size}.png")
print("icons written to", out)
