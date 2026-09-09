#!/usr/bin/env python3
"""
Przygotowuje znaki firmowe do użycia w aplikacji.

Pliki źródłowe (Logo_*.png) to kwadraty 1024×1024 z napisem pośrodku i białym tłem.
Skrypt zdejmuje tło, przycina do napisu, robi wariant jasny (czarny tusz) i ciemny
(biały tusz, czerwień SPACER zachowana), zapisuje je do public/logo/ i wstawia jako
data URI do bloku LOGOS w web/app.html.

Uruchomienie: python3 tools/logos.py
"""
import base64
import io
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "logo"
APP = ROOT / "web" / "app.html"

# nazwa w CSS -> (plik źródłowy, wysokość docelowa w px)
LOGOS = {
    "hero": ("Logo_Hero.png", 96),
    "meditag": ("Logo_MediTag.png", 80),
    "spacer": ("Logo_spacER.png", 72),
}
RED_MIN = 45      # o ile czerwony kanał musi przewyższać pozostałe, by uznać piksel za czerwień
ALPHA_MIN = 6     # niżej traktujemy piksel jako tło


def separate(img):
    """Zwraca (maska_krycia, kolor_czerwieni_lub_None) dla obrazu na białym tle."""
    img = img.convert("RGB")
    w, h = img.size
    px = img.load()
    ink = bytearray(w * h)      # krycie tuszu neutralnego
    red = bytearray(w * h)      # krycie tuszu czerwonego
    reds = []
    for y in range(h):
        row = y * w
        for x in range(w):
            r, g, b = px[x, y]
            if r - max(g, b) > RED_MIN:
                t = 255 - (g + b) // 2
                red[row + x] = t
                if t > 200:
                    reds.append((r, g, b))
            else:
                ink[row + x] = 255 - (r + g + b) // 3
    red_rgb = None
    if reds:
        red_rgb = tuple(sorted(c[i] for c in reds)[len(reds) // 2] for i in range(3))
    return (w, h), ink, red, red_rgb


def compose(size, ink, red, red_rgb, ink_rgb):
    w, h = size
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    data = []
    for i in range(w * h):
        a_ink, a_red = ink[i], red[i]
        if a_red > a_ink and red_rgb:
            data.append((*red_rgb, a_red))
        elif a_ink >= ALPHA_MIN:
            data.append((*ink_rgb, a_ink))
        else:
            data.append((0, 0, 0, 0))
    out.putdata(data)
    return out


def trim(img, pad=0.03):
    box = img.getbbox()
    if not box:
        return img
    x0, y0, x1, y1 = box
    m = int(max(x1 - x0, y1 - y0) * pad)
    return img.crop((max(0, x0 - m), max(0, y0 - m), min(img.width, x1 + m), min(img.height, y1 + m)))


def encode(img, height):
    ratio = img.width / img.height
    img = img.resize((max(1, round(height * ratio)), height), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return img, buf.getvalue()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    css = []
    for name, (src, height) in LOGOS.items():
        size, ink, red, red_rgb = separate(Image.open(ROOT / src))
        for variant, ink_rgb in (("", (0, 0, 0)), ("-dark", (255, 255, 255))):
            img, blob = encode(trim(compose(size, ink, red, red_rgb, ink_rgb)), height)
            (OUT / f"{name}{variant}.png").write_bytes(blob)
            uri = "data:image/png;base64," + base64.b64encode(blob).decode()
            css.append(f'  --logo-{name}{variant}: url("{uri}");')
            print(f"{name}{variant}.png  {img.width}×{img.height}  {len(blob) // 1024 or 1} kB"
                  + (f"  czerwień {red_rgb}" if red_rgb and not variant else ""))
        print(f"  proporcje {name}: {img.width / img.height:.3f}")

    app = APP.read_text(encoding="utf-8")
    block = "/* LOGOS:START */\n" + "\n".join(css) + "\n  /* LOGOS:END */"
    app, n = re.subn(r"/\* LOGOS:START \*/.*?/\* LOGOS:END \*/", lambda _: block, app, flags=re.S)
    if not n:
        raise SystemExit("W web/app.html brakuje znaczników /* LOGOS:START */ i /* LOGOS:END */")
    APP.write_text(app, encoding="utf-8")
    print("web/app.html: podmieniono blok LOGOS")


if __name__ == "__main__":
    main()
