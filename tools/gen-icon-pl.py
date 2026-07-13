#!/usr/bin/env python3
"""Polska verze ikony: prekresli icon-source.png s texty UCZ SIE! / Czasowniki nieregularne.
Geometrie a barvy odmerene z originalu (1024x1024, naklon ~5.72 deg CCW):
  bg #6dece0, plachta #fbe698 (~1013x385, r~90, stred 516,426),
  titulek #2ec4b6 (serif, sirka ~86 % plachty), podtitulek #737373 (Arial Bold, sirka ~786).
"""
from PIL import Image, ImageDraw, ImageFont
import sys

S = 2  # supersample
W = 1024 * S
ANGLE = 5.72

BG = (0x6d, 0xec, 0xe0, 255)
YELLOW = (0xfb, 0xe6, 0x98, 255)
TEAL = (0x2e, 0xc4, 0xb6, 255)
GRAY = (0x73, 0x73, 0x73, 255)

TITLE = 'UCZ SIĘ!'
SUBTITLE = 'Czasowniki nieregularne'

TITLE_FONT = sys.argv[1] if len(sys.argv) > 1 else '/System/Library/Fonts/Supplemental/Didot.ttc'
TITLE_INDEX = int(sys.argv[2]) if len(sys.argv) > 2 else 2  # Didot Bold
TITLE_STROKE = int(sys.argv[3]) if len(sys.argv) > 3 else 6  # ztlusti vlasove tahy, at nezanikaji v 192 px

def fit_font(path, text, target_w, draw, stroke=0, index=0):
    size = 100
    f = ImageFont.truetype(path, size, index=index)
    w = draw.textbbox((0, 0), text, font=f, stroke_width=stroke)[2]
    size = int(size * target_w / w)
    f = ImageFont.truetype(path, size, index=index)
    return f

img = Image.new('RGBA', (W, W), BG)

# --- plachta + titulek na spolecne vrstve ---
rect_w, rect_h, rad = 1013 * S, 385 * S, 90 * S
pad = 200 * S
layer = Image.new('RGBA', (rect_w + pad, rect_h + pad), (0, 0, 0, 0))
d = ImageDraw.Draw(layer)
x0, y0 = pad // 2, pad // 2
d.rounded_rectangle([x0, y0, x0 + rect_w, y0 + rect_h], radius=rad, fill=YELLOW)

tf = fit_font(TITLE_FONT, TITLE, rect_w * 0.86, d, stroke=TITLE_STROKE, index=TITLE_INDEX)
tb = d.textbbox((0, 0), TITLE, font=tf, stroke_width=TITLE_STROKE)
tx = x0 + (rect_w - (tb[2] - tb[0])) / 2 - tb[0]
# vycentrovat opticky podle verzalek (bez ocasku E a diakritiky) — meri se 'UCZ SI!'
cb = d.textbbox((0, 0), 'UCZ SI!', font=tf, stroke_width=TITLE_STROKE)
ty = y0 + (rect_h - (cb[3] - cb[1])) / 2 - cb[1]
d.text((tx, ty), TITLE, font=tf, fill=TEAL, stroke_width=TITLE_STROKE, stroke_fill=TEAL)

layer = layer.rotate(ANGLE, resample=Image.BICUBIC, expand=True)
cx, cy = 516 * S, 426 * S
img.alpha_composite(layer, (cx - layer.width // 2, cy - layer.height // 2))

# --- podtitulek ---
sub = Image.new('RGBA', (W, 300 * S), (0, 0, 0, 0))
ds = ImageDraw.Draw(sub)
sf = fit_font('/System/Library/Fonts/Supplemental/Arial Bold.ttf', SUBTITLE, 800 * S, ds)
sb = ds.textbbox((0, 0), SUBTITLE, font=sf)
sx = (sub.width - (sb[2] - sb[0])) / 2 - sb[0]
sy = (sub.height - (sb[3] - sb[1])) / 2 - sb[1]
ds.text((sx, sy), SUBTITLE, font=sf, fill=GRAY)
sub = sub.rotate(ANGLE, resample=Image.BICUBIC, expand=True)
img.alpha_composite(sub, (513 * S - sub.width // 2, 712 * S - sub.height // 2))

out = img.convert('RGB').resize((1024, 1024), Image.LANCZOS)
if len(sys.argv) > 4:
    out.save(sys.argv[4])
    print('saved', sys.argv[4])
else:
    import os
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    out.save(os.path.join(root, 'pl/icon-source.png'))
    for s in (512, 192, 180):
        out.resize((s, s), Image.LANCZOS).save(os.path.join(root, f'pl/icon-{s}.png'))
    print('saved pl/icon-source.png + 512/192/180')
