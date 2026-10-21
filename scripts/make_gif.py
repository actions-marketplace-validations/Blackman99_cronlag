"""Render the README demo GIF from real cronlag output (ANSI captured from the CLI).
usage: python3 scripts/make_gif.py out.gif cmd1.ansi "cmd1 text" [cmd2.ansi "cmd2 text"]"""
import re, sys
from PIL import Image, ImageDraw, ImageFont

FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 15)
BOLD = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 15)
BG, FG = (27, 15, 10), (233, 239, 230)
COL = {"32": (143, 181, 71), "33": (227, 135, 111), "31": (214, 90, 122), "35": (229, 143, 208), "36": (169, 195, 220), "90": (150, 140, 128), "2": (160, 150, 138)}
CW, LH, PAD, COLS, ROWS = 9, 21, 18, 92, 27
W, H = PAD * 2 + CW * COLS, PAD * 2 + LH * ROWS + 26

def parse(line):
    segs, color, bold = [], FG, False
    for part in re.split(r"(\x1b\[[0-9;]*m)", line):
        m = re.match(r"\x1b\[([0-9;]*)m", part)
        if m:
            code = m.group(1)
            if code in ("0", ""): color, bold = FG, False
            elif code == "1": bold = True
            elif code in COL: color = COL[code]
        elif part:
            segs.append((part, color, bold))
    return segs

def frame(lines):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 26], fill=(90, 53, 34))
    for i, c in enumerate([(184, 64, 94), (227, 135, 111), (143, 181, 71)]):
        d.ellipse([12 + i * 20, 8, 24 + i * 20, 20], fill=c)
    d.text((W // 2 - 60, 5), "cronlag — demo", font=FONT, fill=(233, 239, 230))
    for r, segs in enumerate(lines[-ROWS:]):
        x = PAD
        y = 26 + PAD + r * LH
        for text, color, bold in segs:
            # Draw the lag bars (U+2581..U+2588) as crisp rectangles with a 1px gap: the font's block
            # glyphs are wider than the 9px cell, so they smear into one solid band.
            run = ""
            for ch in text + "\0":
                if "\u2581" <= ch <= "\u2588" or ch == "\0":
                    if run:
                        d.text((x, y), run, font=BOLD if bold else FONT, fill=color)
                        x += CW * len(run)
                        run = ""
                    if ch != "\0":
                        h = round((ord(ch) - 0x2580) / 8 * (LH - 4))
                        d.rectangle([x + 1, y + LH - 3 - h, x + CW - 2, y + LH - 4], fill=color)
                        x += CW
                else:
                    run += ch
    return im

args = sys.argv[1:]
out, pairs = args[0], list(zip(args[1::2], args[2::2]))
frames, durs, screen = [], [], []
for ansi, cmd in pairs:
    body = open(ansi, encoding="utf8").read().rstrip("\n").split("\n")
    prompt = [("$ ", COL["32"], True)]
    for k in range(0, len(cmd) + 1, 3):
        frames.append(frame(screen + [prompt + [(cmd[:k], FG, False)]])); durs.append(45)
    screen = screen + [prompt + [(cmd, FG, False)]]
    frames.append(frame(screen)); durs.append(600)
    for ln in body:
        screen = screen + [parse(ln)]
        frames.append(frame(screen)); durs.append(70)
    durs[-1] = 3200
    screen = screen + [[]]
frames[0].save(out, save_all=True, append_images=frames[1:], duration=durs, loop=0, optimize=True)
print(out, len(frames), "frames", W, "x", H)
