#!/usr/bin/env python3
"""Ikona administrace (admin/icon-*.png): z icon-source.png přebarví tyrkysové
pozadí na tmavou fialovomodrou, titulek na fialový a přidá oranžový štítek ADMIN,
aby se na ploše nepletla s appkou."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

src = Image.open('icon-source.png').convert('RGB')
W = src.width
BG = (0x6d, 0xec, 0xe0)
TEAL = (0x2e, 0xc4, 0xb6)
GRAY = (0x73, 0x73, 0x73)

def dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5

# tmavé pozadí s jemným přechodem
grad = Image.new('RGB', (W, W))
gd = ImageDraw.Draw(grad)
top, bot = (0x2b, 0x2f, 0x6b), (0x12, 0x14, 0x2c)
for y in range(W):
    t = y / (W - 1)
    gd.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))

px = src.load()
out = src.copy()
op = out.load()
gp = grad.load()
for y in range(W):
    for x in range(W):
        c = px[x, y]
        db = dist(c, BG)
        dt = dist(c, TEAL)
        dg = dist(c, GRAY)
        if db < 60:  # pozadí (s měkkým okrajem)
            a = min(1.0, max(0.0, (60 - db) / 30))
            g = gp[x, y]
            op[x, y] = tuple(int(g[i] * a + c[i] * (1 - a)) for i in range(3))
        elif dt < 70:  # titulek UČ SE!
            a = min(1.0, max(0.0, (70 - dt) / 35))
            v = (0x5b, 0x4b, 0xd6)
            op[x, y] = tuple(int(v[i] * a + c[i] * (1 - a)) for i in range(3))
        elif dg < 70 and y > W * 0.6:  # podtitulek (jen pod plachtou) → světlý
            a = min(1.0, max(0.0, (70 - dg) / 35))
            v = (0xd4, 0xd6, 0xec)
            op[x, y] = tuple(int(v[i] * a + c[i] * (1 - a)) for i in range(3))

img = out.convert('RGBA')
# štítek ADMIN dole
d = ImageDraw.Draw(img)
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 150)
text = 'ADMIN'
tb = d.textbbox((0, 0), text, font=font)
tw, th = tb[2] - tb[0], tb[3] - tb[1]
pw, ph = tw + 120, th + 70
x0 = (W - pw) // 2
y0 = W - ph - 95
shadow = Image.new('RGBA', img.size, (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle([x0, y0 + 12, x0 + pw, y0 + ph + 12], radius=ph // 2, fill=(0, 0, 0, 120))
img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(14)))
d = ImageDraw.Draw(img)
d.rounded_rectangle([x0, y0, x0 + pw, y0 + ph], radius=ph // 2, fill=(0xff, 0x6a, 0x45, 255))
d.text(((W - tw) // 2 - tb[0], y0 + (ph - th) // 2 - tb[1]), text, font=font, fill=(255, 255, 255, 255))

img = img.convert('RGB')
for size in (512, 192, 180):
    img.resize((size, size), Image.LANCZOS).save(f'admin/icon-{size}.png', optimize=True)
print('ok')
