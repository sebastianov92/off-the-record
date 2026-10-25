"""Generate Liria concept SVGs (black on transparent). Re-run after edits; output goes to ../concepts."""

from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "concepts"
INK = "#111111"


def svg(w, h, body, title):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
        f'role="img" aria-labelledby="t"><title id="t">{title}</title>\n{body}\n</svg>\n'
    )


def ring(cx, cy, ro, ri):
    """Annulus: outer clockwise, hole counter-clockwise (nonzero), like every other shape."""
    return (
        f"M{cx - ro} {cy} A{ro} {ro} 0 1 1 {cx + ro} {cy} A{ro} {ro} 0 1 1 {cx - ro} {cy} Z "
        f"M{cx - ri} {cy} A{ri} {ri} 0 1 0 {cx + ri} {cy} A{ri} {ri} 0 1 0 {cx - ri} {cy} Z"
    )


def circle(cx, cy, r):
    return f"M{cx - r} {cy} A{r} {r} 0 1 1 {cx + r} {cy} A{r} {r} 0 1 1 {cx - r} {cy} Z"


def rect(x, y, w, h):
    return f"M{x} {y} H{x + w} V{y + h} H{x} Z"


# ---------- wordmark "liria" ----------
# Units: baseline 176, x-height top 96 (x = 80), ascender top 56. Stem 18, round stroke 19.
S = 22  # stem
XT, BL, AT = 96, 176, 56
DOT_R = 13
DOT_CY = 68


def r_letter(x):
    """Geometric r: stem + quarter ring (outer 40 / inner 22) from stem to the top."""
    cx, cy, ro, ri = x + 42, XT + 42, 42, 20
    stem = rect(x, XT, S, BL - XT)
    arm = (
        f"M{x} {cy} A{ro} {ro} 0 0 1 {cx} {XT} H{cx + 8} V{XT + S} H{cx} "
        f"A{ri} {ri} 0 0 0 {x + S} {cy} Z"
    )
    return stem + " " + arm


def a_letter(x):
    """Single-storey a: ring (outer 41 with 1-unit overshoot, stroke 19) + right stem."""
    cx, cy = x + 42, XT + 40
    return ring(cx, cy, 42, 19) + " " + rect(x + 84 - S, XT, S, BL - XT)


LI_LIGATURE = "M0 56 H22 V154 H30 A18 18 0 0 0 48 136 V96 H70 V136 A40 40 0 0 1 30 176 H0 Z"


def wordmark(dots=("solid", "solid"), ligature=False):
    """Return (path_d, width). dots: style for the two i-dots: solid | ring."""
    parts = []
    i1 = 48
    if ligature:
        parts.append(LI_LIGATURE)  # L + i in one stroke
    else:
        parts.append(rect(0, AT, S, BL - AT))  # l
        parts.append(rect(i1, XT, S, BL - XT))  # i
    r = 96
    parts.append(r_letter(r))  # r  (arm ends at r+50)
    i2 = 162
    parts.append(rect(i2, XT, S, BL - XT))  # i
    a = 204
    parts.append(a_letter(a))  # a  (ends at a+84)
    for x, style in zip((i1, i2), dots):
        cx = x + S / 2
        parts.append(
            circle(cx, DOT_CY, DOT_R)
            if style == "solid"
            else ring(cx, DOT_CY, DOT_R + 1, DOT_R - 6)
        )
    return " ".join(parts), a + 84


def place(d, dx, dy, k=1.0):
    return f'<path transform="translate({dx} {dy}) scale({k})" fill="{INK}" fill-rule="nonzero" d="{d}"/>'


# ---------- A: Lira (Li ligature) ----------
A_SYMBOL = (
    "M56 28 H96 V180 H128 A32 32 0 0 0 160 148 V100 H200 V148 A72 72 0 0 1 128 220 H56 Z "
    + circle(180, 60, 20)
)

# ---------- B: Turno (two i's, sung dot + next dot) ----------
B_SYMBOL = " ".join(
    [rect(60, 108, 44, 112), rect(152, 108, 44, 112), circle(82, 61, 24), ring(174, 61, 24, 12)]
)


# ---------- C: Dos versos (karaoke two-line layout) ----------
def capsule(x, y, w, h):
    r = h / 2
    return f"M{x + r} {y} H{x + w - r} A{r} {r} 0 0 1 {x + w - r} {y + h} H{x + r} A{r} {r} 0 0 1 {x + r} {y} Z"


def capsule_ring(x, y, w, h, t):
    """Outlined capsule: outer capsule + inner capsule wound the other way."""
    r, ri = h / 2, h / 2 - t
    outer = capsule(x, y, w, h)
    xi, yi, wi = x + t, y + t, w - 2 * t
    inner = (
        f"M{xi + ri} {yi} A{ri} {ri} 0 0 0 {xi + ri} {yi + 2 * ri} H{xi + wi - ri} "
        f"A{ri} {ri} 0 0 0 {xi + wi - ri} {yi} Z"
    )
    return outer + " " + inner


def wipe_capsule(x, y, w, h, t, sung):
    """Capsule outlined, filled solid from the left up to x+sung (the karaoke wipe)."""
    r = h / 2
    solid = f"M{x + r} {y} H{x + sung} V{y + h} H{x + r} A{r} {r} 0 0 1 {x + r} {y} Z"
    return capsule_ring(x, y, w, h, t) + " " + solid


# C1: line being sung solid, next line outlined.  C2: the sung line mid-wipe.
C1_SYMBOL = capsule(32, 68, 144, 48) + " " + capsule_ring(80, 140, 144, 48, 12)
C2_SYMBOL = wipe_capsule(32, 68, 144, 48, 12, 96) + " " + capsule_ring(80, 140, 144, 48, 12)


def write(name, w, h, body, title):
    (OUT / name).write_text(svg(w, h, body, title))


def lockup(name, symbol_d, title, dots=("solid", "solid"), sym_right=204):
    wm, ww = wordmark(dots)
    k = 1.0
    gap = 44
    x0 = sym_right + gap
    body = f'<path fill="{INK}" fill-rule="nonzero" d="{symbol_d}"/>\n' + place(wm, x0, 12, k)
    write(name, int(x0 + ww * k + 32), 256, body, title)


def main():
    OUT.mkdir(exist_ok=True)
    write(
        "a-symbol.svg",
        256,
        256,
        f'<path fill="{INK}" fill-rule="nonzero" d="{A_SYMBOL}"/>',
        "Liria A symbol",
    )
    write(
        "b-symbol.svg",
        256,
        256,
        f'<path fill="{INK}" fill-rule="nonzero" d="{B_SYMBOL}"/>',
        "Liria B symbol",
    )
    write(
        "c1-symbol.svg",
        256,
        256,
        f'<path fill="{INK}" fill-rule="nonzero" d="{C1_SYMBOL}"/>',
        "Liria C1 symbol",
    )
    write(
        "c2-symbol.svg",
        256,
        256,
        f'<path fill="{INK}" fill-rule="nonzero" d="{C2_SYMBOL}"/>',
        "Liria C2 symbol",
    )
    lockup("c1-lockup.svg", C1_SYMBOL, "Liria C1 lockup", sym_right=224)
    lockup("c2-lockup.svg", C2_SYMBOL, "Liria C2 lockup", sym_right=224)
    for name, dots, lig in (
        ("a-wordmark.svg", ("solid", "solid"), True),
        ("b-wordmark.svg", ("solid", "ring"), False),
    ):
        wm, ww = wordmark(dots, ligature=lig)
        write(name, int(ww + 32), 256, place(wm, 16, 12), f"Liria {name[0].upper()} wordmark")


if __name__ == "__main__":
    main()
