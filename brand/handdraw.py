"""Hand-drawn artwork for Wormy, to match the marker logo: every line wobbles a little, loops
overshoot where a pen would, and color sits slightly off the outline. Seeded, so the output is
the same every run.

    python3 brand/handdraw.py > hand.json

prints the icon strokes and drawings (pasted into app.js: ICONS, HEART, SPINES, BURST, ATOM,
CORNERS) and the CSS images (pasted into app.css :root as --hand-* and --m-* tokens)."""
import math, random, json

def f(v):
    s = f"{v:.1f}"
    s = s.rstrip("0").rstrip(".") if "." in s else s
    return "0" if s == "-0" else s

def path(pts, closed=False):
    n = len(pts)
    d = f"M{f(pts[0][0])} {f(pts[0][1])}"
    for i in range(n if closed else n - 1):
        p0 = pts[(i - 1) % n] if (closed or i > 0) else pts[i]
        p1, p2 = pts[i], pts[(i + 1) % n]
        p3 = pts[(i + 2) % n] if (closed or i + 2 < n) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f"C{f(c1[0])} {f(c1[1])} {f(c2[0])} {f(c2[1])} {f(p2[0])} {f(p2[1])}"
    return d + ("Z" if closed else "")

def noise(rng):
    ph = [rng.uniform(0, 2 * math.pi) for _ in range(3)]
    return lambda t: (math.sin(t + ph[0]) + 0.5 * math.sin(2 * t + ph[1]) + 0.25 * math.sin(3 * t + ph[2])) / 1.75

def loop(cx, cy, rx, ry, jit=0.3, seed=1, start=-100, sweep=372, drift=0.06, rot=0, step=24):
    """A hand-drawn ellipse: starts, goes round, and ends a little past where it began."""
    rng = random.Random(seed); nz = noise(rng)
    pts = []; k = max(6, int(sweep / step))
    for i in range(k + 1):
        a = math.radians(start + sweep * i / k)
        r = 1 + jit * nz(a * 1.0) / max(rx, ry) - drift * i / k
        x, y = rx * r * math.cos(a), ry * r * math.sin(a)
        t = math.radians(rot)
        pts.append((cx + x * math.cos(t) - y * math.sin(t), cy + x * math.sin(t) + y * math.cos(t)))
    return path(pts)

def blob(cx, cy, rx, ry, jit=0.4, seed=1, n=9):
    rng = random.Random(seed); nz = noise(rng)
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.12, 0.12)
        r = 1 + jit * nz(a) / max(rx, ry)
        pts.append((cx + rx * r * math.cos(a), cy + ry * r * math.sin(a)))
    return path(pts, closed=True)

def line(pts, bow=0.3, seed=1):
    """A stroke through the given points, each edge bowed slightly like a quick pen line."""
    rng = random.Random(seed); out = [pts[0]]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy) or 1
        px, py = -dy / L, dx / L
        b = rng.uniform(-bow, bow)
        for t, w in ((0.35, b), (0.68, b * 0.8 + rng.uniform(-bow, bow) * 0.3)):
            out.append((x0 + dx * t + px * w, y0 + dy * t + py * w))
        out.append((x1, y1))
    return path(out)

def outline(corners, bow=0.3, seed=1, over=0.22, tight=0.1):
    """A closed shape drawn in one go: corners stay crisp-ish and the end overlaps the start."""
    rng = random.Random(seed); n = len(corners); out = []
    for i in range(n + 1):
        (x0, y0), (x1, y1) = corners[i % n], corners[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy) or 1
        px, py = -dy / L, dx / L; b = rng.uniform(-bow, bow)
        if i == n:
            out.append((x0 + dx * over + px * 0.5, y0 + dy * over + py * 0.5)); break
        out += [(x0, y0), (x0 + dx * tight, y0 + dy * tight), (x0 + dx * 0.5 + px * b, y0 + dy * 0.5 + py * b), (x0 + dx * (1 - tight), y0 + dy * (1 - tight))]
    return path(out)

def fill(corners, jit=0.4, seed=1, dx=0, dy=0, tight=0.12):
    rng = random.Random(seed); n = len(corners); out = []
    for i in range(n):
        (x0, y0), (x1, y1) = corners[i], corners[(i + 1) % n]
        ex, ey = x1 - x0, y1 - y0
        j = lambda: rng.uniform(-jit, jit)
        out += [(x0 + dx + j(), y0 + dy + j()), (x0 + ex * tight + dx, y0 + ey * tight + dy), (x0 + ex * (1 - tight) + dx + j(), y0 + ey * (1 - tight) + dy + j())]
    return path(out, closed=True)

def rot(pts, cx, cy, deg):
    t = math.radians(deg)
    return [(cx + (x - cx) * math.cos(t) - (y - cy) * math.sin(t), cy + (x - cx) * math.sin(t) + (y - cy) * math.cos(t)) for x, y in pts]

# ---------------- icons (24 x 24) ----------------
I = {}
I["discover"] = ([loop(12, 12, 8.7, 8.6, 0.35, 11), fill([(15.8, 8.2), (13.6, 13.6), (8.2, 15.8), (10.4, 10.4)], 0.15, 12, tight=0.08)], blob(13, 12.9, 6.6, 6.4, 0.6, 13), "sun")
I["shelf"] = ([outline([(3.4, 4.3), (8.1, 4.1), (8.2, 19.4), (3.5, 19.5)], 0.25, 21), line([(5.1, 7.6), (6.5, 7.5)], 0.1, 26), outline([(10.4, 7.2), (14.6, 7.1), (14.5, 19.4), (10.5, 19.5)], 0.25, 22),
               outline(rot([(15.6, 6.4), (19.8, 6.4), (19.8, 19.4), (15.6, 19.4)], 17.7, 19.4, -12), 0.25, 23), line([(2.2, 21.4), (21.8, 21.2)], 0.4, 24)], blob(11.5, 13.2, 6.8, 6.4, 0.6, 25), "sea")
I["scan"] = ([line([(4, 8.6), (4.2, 4.4), (8.5, 4.2)], 0.15, 31), line([(15.6, 4.1), (19.8, 4.3), (20, 8.4)], 0.15, 32), line([(20.1, 15.5), (19.8, 19.8), (15.5, 20)], 0.15, 33), line([(8.4, 19.9), (4.2, 19.7), (3.9, 15.6)], 0.15, 34),
              line([(8.2, 8.3), (8.1, 15.8)], 0.3, 35), line([(11.1, 8), (11, 16)], 0.3, 36), line([(14, 8.4), (14.1, 15.7)], 0.3, 37), line([(16.9, 8.1), (17, 15.9)], 0.3, 38)], None, None)
I["exchanges"] = ([line([(5.2, 7.4), (18.7, 7.1)], 0.4, 41), line([(15.6, 4.1), (18.8, 7.1), (15.8, 10.2)], 0.15, 42), line([(18.8, 16.7), (5.3, 17)], 0.4, 43), line([(8.4, 13.9), (5.2, 16.9), (8.2, 20)], 0.15, 44)], blob(12, 12.4, 7.2, 5.6, 0.6, 45), "lilac")
I["profile"] = ([loop(12, 8.1, 3.9, 3.9, 0.25, 51, start=-70), line([(4.3, 20.8), (5.4, 16.6), (8.6, 14.2), (12, 13.7), (15.4, 14.2), (18.6, 16.7), (19.7, 20.7)], 0.2, 52)], blob(12.6, 13.6, 6.4, 7, 0.6, 53), "blush")
I["bell"] = ([path([(4.6, 18.3), (6.2, 16.3), (6.2, 11.4), (7.6, 7.1), (12, 4.9), (16.3, 7), (17.8, 11.3), (17.8, 16.2), (19.4, 18.2), (12, 18.6), (4.2, 18.4)]), line([(10.1, 20.4), (12, 21.4), (13.9, 20.3)], 0.1, 62)], blob(12.8, 12.6, 6.2, 6.6, 0.6, 63), "sun")
I["search"] = ([loop(10.6, 10.6, 6.6, 6.5, 0.3, 71, start=-60), line([(15.6, 15.7), (20.2, 20.1)], 0.3, 72)], None, None)
I["x"] = ([line([(6.2, 6.1), (17.9, 17.9)], 0.45, 81), line([(17.8, 6.2), (6.2, 17.8)], 0.45, 82)], None, None)
I["arrow"] = ([line([(4.6, 12.2), (19, 12)], 0.4, 91), line([(13.3, 6.3), (19.1, 12), (13.5, 17.8)], 0.2, 92)], None, None)
I["credit"] = ([loop(12, 12, 8.5, 8.4, 0.35, 101), line([(8.9, 9.6), (15.1, 9.4)], 0.3, 102), line([(8.9, 12.6), (15, 12.5)], 0.3, 103), line([(8.9, 15.6), (12.6, 15.5)], 0.3, 104)], None, None)
HEART = "M12 20.4C8.6 18 4.1 14.8 3.9 10.2 3.8 7.4 5.8 5.3 8.3 5.4 9.9 5.4 11.2 6.4 12 7.8 12.8 6.3 14.2 5.3 15.9 5.3 18.4 5.4 20.3 7.6 20.1 10.2 19.8 14.6 15.6 17.8 12 20.4Z"

# ---------------- illustrations ----------------
# sign-in: an atom, drawn in three colored marker loops
atom = []
for c, r, s in (("var(--sea)", 30, 201), ("var(--peach)", -30, 202), ("var(--sun)", 90, 203)):
    atom.append(f'<path d="{loop(60, 60, 52, 18, 1.4, s, start=-150, sweep=378, drift=0.03, rot=r, step=18)}" fill="none" stroke="{c}" stroke-width="4.6" stroke-linecap="round"/>')
atom.append(f'<path d="{blob(60.6, 60.8, 9, 9, 1.2, 204)}" fill="var(--lilac)"/><path d="{loop(60, 60, 9, 9, 0.8, 205, start=-60)}" fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-linecap="round"/>')
atom.append(f'<path d="{blob(104, 37, 4.4, 4.2, 0.6, 206, 7)}" fill="var(--sage)"/>')
ATOM = "".join(atom)

# empty shelf: three spines, color laid down a hair off the ink outline
sp = []
books = [([(14, 12), (31, 11), (32, 66), (15, 66)], "var(--sea)", 301), ([(35, 19), (50, 19), (50, 66), (35, 66)], "var(--sun)", 302),
         (rot([(54, 8), (67, 8), (67, 66), (54, 66)], 60, 66, 9), "var(--peach)", 303)]
for corners, col, s in books:
    sp.append(f'<path d="{fill(corners, 0.8, s, 1.6, 1.4)}" fill="{col}"/>')
for corners, col, s in books:
    sp.append(f'<path d="{outline(corners, 0.7, s + 10, over=0.12)}"/>')
sp.append(f'<path d="{line([(5, 67.6), (91, 67)], 0.9, 311)}"/>')
sp.append(f'<path d="{line([(18.5, 22), (27.5, 21.6)], 0.4, 312)}"/><path d="{line([(18.5, 26), (27.5, 25.6)], 0.4, 313)}"/>')
sp.append(f'<path d="{line([(38.6, 31), (46.6, 30.8)], 0.4, 314)}"/>')
SPINES = "".join(sp)

# celebration burst: uneven points, like it was cut out by hand
rng = random.Random(401); pts = []
P = 14
for i in range(P * 2):
    r = (50 if i % 2 == 0 else 37) + rng.uniform(-3.2, 3.2)
    a = math.pi * i / P - math.pi / 2 + rng.uniform(-0.05, 0.05)
    pts.append(f"{f(50 + r * math.cos(a))},{f(50 + r * math.sin(a))}")
BURST = " ".join(pts)

# scanner corners (viewBox 100 x 60, stretched; strokes keep their width)
CORNERS = "".join(f'<path d="{line(p, 0.5, s)}"/>' for p, s in (
    ([(0, 24), (0.5, 1), (22, 0.4)], 501), ([(78, 0.5), (99.6, 1), (100, 24)], 502), ([(99.7, 36), (99.4, 59.4), (78, 59.8)], 503), ([(22, 59.6), (0.4, 59.2), (0.2, 36)], 504)))

# ---------------- CSS images (data URIs) ----------------
def uri(svg):
    svg = " ".join(svg.split())
    return 'url("data:image/svg+xml,' + svg.replace("%", "%25").replace("#", "%23").replace("<", "%3C").replace(">", "%3E").replace('"', "'") + '")'

def rough(freq, scale, seed=3):
    return f"<filter id='r' x='-10%' y='-10%' width='120%' height='120%'><feTurbulence type='fractalNoise' baseFrequency='{freq}' numOctaves='2' seed='{seed}'/><feDisplacementMap in='SourceGraphic' scale='{scale}' xChannelSelector='R' yChannelSelector='G'/></filter>"

def rays(cx, cy, n, r0, r1, w0, w1, seed, jitter=0.06, vw=200, vh=200, color="white", gap=1.0):
    rng = random.Random(seed); ps = []
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-jitter, jitter)
        L = r1 * rng.uniform(0.86, 1.0); ww = w1 * rng.uniform(0.75, 1.15)
        ca, sa = math.cos(a), math.sin(a); px, py = -sa, ca
        bend = rng.uniform(-0.04, 0.04) * L
        p = [(cx + ca * r0 + px * w0, cy + sa * r0 + py * w0), (cx + ca * (r0 + L) / 2 + px * (w0 + ww) / 2 + px * bend, cy + sa * (r0 + L) / 2 + py * (w0 + ww) / 2 + py * bend),
             (cx + ca * L + px * ww, cy + sa * L + py * ww), (cx + ca * L - px * ww, cy + sa * L - py * ww),
             (cx + ca * (r0 + L) / 2 - px * (w0 + ww) / 2 + px * bend, cy + sa * (r0 + L) / 2 - py * (w0 + ww) / 2 + py * bend), (cx + ca * r0 - px * w0, cy + sa * r0 - py * w0)]
        ps.append("M" + " ".join(f"{f(x)} {f(y)}" for x, y in p) + "Z")
    return f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {vw} {vh}' preserveAspectRatio='none'>{rough(0.06, 3)}<path filter='url(#r)' fill='{color}' d='{''.join(ps)}'/></svg>"

CSS = {}
CSS["--hand-rays"] = uri(rays(100, 100, 15, 14, 98, 1.2, 7, 601, color="#f2c14e"))
CSS["--hand-sun"] = uri(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>{rough(0.05, 4)}<path filter='url(#r)' fill='#f2c14e' d='{blob(50, 50, 45, 44, 2.4, 602, 11)}'/></svg>")
# masks for book jackets (white = shape; the color comes from the jacket)
CSS["--m-blob"] = uri(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>{rough(0.07, 3.2)}<path filter='url(#r)' fill='white' d='{blob(50, 50, 46, 46, 2.2, 701, 11)}'/></svg>")
CSS["--m-square"] = uri(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>{rough(0.07, 3)}<path filter='url(#r)' fill='white' d='{fill([(7, 8), (93, 6), (94, 93), (6, 94)], 1.6, 702, tight=0.06)}'/></svg>")
CSS["--m-bar"] = uri(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 20' preserveAspectRatio='none'>{rough(0.12, 2.4)}<path filter='url(#r)' fill='white' d='{fill([(1.5, 3), (99, 1.5), (98.5, 18), (1, 18.5)], 0.9, 703, tight=0.05)}'/></svg>")
CSS["--m-rays"] = uri(rays(90, 115.5, 22, 4, 110, 0.4, 5.2, 704, jitter=0.05, vw=180, vh=165))
rng = random.Random(705); st = []
for i in range(8):
    x = 2 + i * 15 + rng.uniform(-1, 1); w = 9 * rng.uniform(0.85, 1.12); lean = rng.uniform(-1.5, 1.5)
    st.append(fill([(x + lean, 0.5), (x + w + lean, 0.8), (x + w - lean, 25.4), (x - lean, 25.6)], 0.5, 706 + i, tight=0.08))
CSS["--m-stripes"] = uri(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 26' preserveAspectRatio='none'>{rough(0.12, 2)}<path filter='url(#r)' fill='white' d='{''.join(st)}'/></svg>")
CSS["--m-frame"] = uri(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 150' preserveAspectRatio='none'><g fill='none' stroke='white' stroke-linecap='round'><path stroke-width='1.7' d='{outline([(8, 7), (93, 6.5), (93.4, 143), (8.5, 143.6)], 0.8, 801, over=0.08, tight=0.05)}'/><path stroke-width='0.8' d='{outline([(11.5, 10.5), (89.6, 10.2), (89.8, 139.6), (11.8, 139.9)], 0.6, 802, over=0.06, tight=0.05)}'/></g></svg>")

out = {"icons": {k: {"ink": v[0], "wash": v[1], "color": v[2]} for k, v in I.items()}, "heart": HEART, "atom": ATOM, "spines": SPINES, "burst": BURST, "corners": CORNERS, "css": CSS}
print(json.dumps(out, indent=1))
