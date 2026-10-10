#!/usr/bin/env python3
"""
Derive the app's artwork from the restaurant's master logo.

Run this whenever the master logo changes:

    python3 tools/make-assets.py path/to/logo.png

It writes three files into app/assets/:

    saba-logo.png        the mark itself, trimmed and resized for screen use
    saba-watermark.png   an alpha-only silhouette, used as a CSS mask so the
                         watermark takes its colour from the theme rather than
                         being a washed-out copy of the artwork
    saba-icon.png        a small square for the browser tab

Pure standard library on purpose: this is a build tool, and nobody installing
the POS should have to install an image library to run it.
"""

import os
import struct
import sys
import zlib

# ---------------------------------------------------------------- PNG I/O ---


def read_png(path):
    """Return (width, height, RGBA bytearray). Handles the colour types a
    designer's export actually produces: RGB, RGBA, grey and grey+alpha."""
    data = open(path, 'rb').read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise SystemExit(f'{path} is not a PNG')

    pos, idat = 8, b''
    width = height = depth = colour = None
    palette = None
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b'IHDR':
            width, height, depth, colour, _, _, interlace = struct.unpack('>IIBBBBB', body)
            if depth != 8:
                raise SystemExit('only 8-bit PNGs are supported')
            if interlace:
                raise SystemExit('interlaced PNGs are not supported')
        elif kind == b'PLTE':
            palette = body
        elif kind == b'IDAT':
            idat += body
        elif kind == b'IEND':
            break

    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colour]
    stride = width * channels
    raw = zlib.decompress(idat)

    # Undo the per-scanline filters.
    out = bytearray(stride * height)
    prev = bytearray(stride)
    src = 0
    for y in range(height):
        ftype = raw[src]
        src += 1
        line = bytearray(raw[src:src + stride])
        src += stride
        if ftype == 1:
            for x in range(channels, stride):
                line[x] = (line[x] + line[x - channels]) & 255
        elif ftype == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif ftype == 3:
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif ftype == 4:
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                b = prev[x]
                c = prev[x - channels] if x >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        elif ftype != 0:
            raise SystemExit(f'unknown PNG filter {ftype}')
        out[y * stride:(y + 1) * stride] = line
        prev = line

    # Normalise everything to RGBA so the rest of this script has one case.
    rgba = bytearray(width * height * 4)
    for i in range(width * height):
        s = i * channels
        d = i * 4
        if colour == 6:
            rgba[d:d + 4] = out[s:s + 4]
        elif colour == 2:
            rgba[d:d + 3] = out[s:s + 3]
            rgba[d + 3] = 255
        elif colour == 0:
            v = out[s]
            rgba[d:d + 4] = bytes((v, v, v, 255))
        elif colour == 4:
            v = out[s]
            rgba[d:d + 4] = bytes((v, v, v, out[s + 1]))
        elif colour == 3:
            p = out[s] * 3
            rgba[d:d + 3] = palette[p:p + 3]
            rgba[d + 3] = 255
    return width, height, rgba


def write_png(path, width, height, pixels, channels):
    """Write an 8-bit PNG. `channels` is 4 for RGBA or 2 for grey+alpha."""
    colour = {4: 6, 2: 4}[channels]
    stride = width * channels
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter 0; the shapes here compress well without one
        raw += pixels[y * stride:(y + 1) * stride]

    def chunk(kind, body):
        return (struct.pack('>I', len(body)) + kind + body
                + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, colour, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    open(path, 'wb').write(png)
    return len(png)


# ------------------------------------------------------------- operations ---


def trim(width, height, rgba, threshold=8):
    """Crop away fully transparent margins, keeping the mark square and
    centred so it can be dropped into a circle without drifting."""
    top, left = height, width
    bottom = right = -1
    for y in range(height):
        row = y * width * 4
        for x in range(width):
            if rgba[row + x * 4 + 3] > threshold:
                if y < top: top = y
                if y > bottom: bottom = y
                if x < left: left = x
                if x > right: right = x
    if bottom < 0:
        return width, height, rgba

    # Grow the tighter axis so the result stays square and centred.
    w, h = right - left + 1, bottom - top + 1
    side = max(w, h)
    cx, cy = left + w // 2, top + h // 2
    left, top = cx - side // 2, cy - side // 2

    out = bytearray(side * side * 4)
    for y in range(side):
        sy = top + y
        if sy < 0 or sy >= height:
            continue
        for x in range(side):
            sx = left + x
            if sx < 0 or sx >= width:
                continue
            s = (sy * width + sx) * 4
            d = (y * side + x) * 4
            out[d:d + 4] = rgba[s:s + 4]
    return side, side, out


def resize(width, height, rgba, size):
    """Box-filter downscale, averaging in premultiplied alpha so the edges of
    the mark do not pick up a halo of the background colour."""
    out = bytearray(size * size * 4)
    for y in range(size):
        y0 = y * height // size
        y1 = max(y0 + 1, (y + 1) * height // size)
        for x in range(size):
            x0 = x * width // size
            x1 = max(x0 + 1, (x + 1) * width // size)
            r = g = b = a = n = 0
            for sy in range(y0, y1):
                base = sy * width * 4
                for sx in range(x0, x1):
                    s = base + sx * 4
                    alpha = rgba[s + 3]
                    r += rgba[s] * alpha
                    g += rgba[s + 1] * alpha
                    b += rgba[s + 2] * alpha
                    a += alpha
                    n += 1
            d = (y * size + x) * 4
            if a:
                out[d] = min(255, r // a)
                out[d + 1] = min(255, g // a)
                out[d + 2] = min(255, b // a)
            out[d + 3] = a // n if n else 0
    return out


def silhouette(size, rgba, floor=0.10):
    """Turn the mark into an alpha-only stencil.

    The watermark is drawn by masking a flat block of the theme colour with
    this, so what matters is *where there is ink*, not what colour it was.
    Lifting the white field to a low floor keeps the medallion reading as a
    disc rather than as disconnected scraps of lettering.
    """
    out = bytearray(size * size * 2)
    for i in range(size * size):
        s = i * 4
        r, g, b, a = rgba[s], rgba[s + 1], rgba[s + 2], rgba[s + 3]
        if a == 0:
            ink = 0
        else:
            # Perceptual darkness, so navy ink and gold ink both register.
            lum = (r * 299 + g * 587 + b * 114) // 1000
            ink = 255 - lum
            ink = int(floor * 255 + (1 - floor) * ink)
            ink = ink * a // 255
        out[i * 2] = 0          # grey value is irrelevant under a mask
        out[i * 2 + 1] = ink    # alpha carries the stencil
    return out


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else 'brand/saba-logo-master.png'
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(here, 'app', 'assets')
    os.makedirs(out_dir, exist_ok=True)

    print(f'  reading {source}')
    w, h, rgba = read_png(source)
    print(f'  {w}x{h}')

    w, h, rgba = trim(w, h, rgba)
    print(f'  trimmed to {w}x{h}')

    for name, size, kind in (
        ('saba-logo.png', 512, 'rgba'),
        ('saba-icon.png', 96, 'rgba'),
        ('saba-watermark.png', 448, 'mask'),
    ):
        scaled = resize(w, h, rgba, size)
        path = os.path.join(out_dir, name)
        if kind == 'mask':
            written = write_png(path, size, size, silhouette(size, scaled), 2)
        else:
            written = write_png(path, size, size, scaled, 4)
        print(f'  {name:<22} {size}x{size}  {written / 1024:.0f} KB')


if __name__ == '__main__':
    main()
