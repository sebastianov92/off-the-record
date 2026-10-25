"""Round 3: modern treatment (gradient glyph on night tile), music/karaoke readable. Output -> ../concepts"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import circle, rect, wordmark  # noqa: E402
from build2 import ellipse_d, hole_capsule, rounded_bottom_rect  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "concepts"
NIGHT = "#15111F"
CORAL, PINK = "#FF8A5C", "#FF4D8D"


def grad(gid, y1=40, y2=220):
    return (
        f'<defs><linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="0" y1="{y1}" x2="0" y2="{y2}">'
        f'<stop offset="0" stop-color="{CORAL}"/><stop offset="1" stop-color="{PINK}"/></linearGradient></defs>'
    )


def svg(w, h, body, title):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
        f'role="img" aria-labelledby="t"><title id="t">{title}</title>\n{body}\n</svg>\n'
    )


# ---------- glyphs: each returns (svg body using fill/stroke "PAINT", bbox right edge) ----------
def glyph_a():
    """The i of Liria is a microphone: the dot is the grille (two lyric lines), the stem the handle."""
    head = f"{circle(128, 92, 46)} {hole_capsule(94, 77, 50, 12)} {hole_capsule(112, 97, 50, 12)}"
    handle = rounded_bottom_rect(112, 152, 32, 58, 16)
    return (
        f'<path fill="PAINT" fill-rule="evenodd" d="{head}"/><path fill="PAINT" d="{handle}"/>',
        174,
    )


def glyph_b():
    """Lyre, drawn thin: horned arms, crossbar, base; the middle string is a voice wave."""
    st = 'fill="none" stroke="PAINT" stroke-linecap="round" stroke-linejoin="round"'
    arms = (
        f'<path {st} stroke-width="14" d="M88 44 C46 58 40 148 104 196 '
        f'M168 44 C210 58 216 148 152 196 M100 204 H156"/>'
    )
    bar = f'<path {st} stroke-width="12" d="M62 72 H194"/>'
    strings = f'<path {st} stroke-width="8" d="M104 72 V196 M152 72 V196"/>'
    wave = f'<path {st} stroke-width="8" d="M128 72 C144 92 112 112 128 134 C144 156 112 176 128 196"/>'
    return arms + bar + strings + wave, 220


def glyph_c():
    """Down-stem eighth note = handheld mic; head carries two lyric lines; flag is a clean arc."""
    head = (
        f"{ellipse_d(146, 80, 54, 40, -20)} "
        f"{hole_capsule(110, 63, 56, 12)} {hole_capsule(126, 85, 56, 12)}"
    )
    stem = rect(92, 88, 18, 136)
    flag = '<path fill="none" stroke="PAINT" stroke-width="18" stroke-linecap="round" d="M101 215 A70 70 0 0 0 171 150"/>'
    body = (
        f'<path fill="PAINT" fill-rule="evenodd" d="{head}"/><path fill="PAINT" d="{stem}"/>' + flag
    )
    return (
        f'<g transform="translate(-14 0)">{body}</g>',
        190,
    )  # optical centring: head carries the mass


GLYPHS = {"a": glyph_a, "b": glyph_b, "c": glyph_c}


def paint(body, gid):
    return body.replace("PAINT", f"url(#{gid})")


TILE_SCALE = {"a": 1.0, "b": 0.86, "c": 0.92}


def tile(key):
    """App icon: glyph scaled about the centre into the icon's optical zone."""
    body, _ = GLYPHS[key]()
    g = f"g{key}"
    k = TILE_SCALE[key]
    t = f"translate({128 - 128 * k:.1f} {128 - 128 * k:.1f}) scale({k})"
    return (
        grad(g)
        + f'<rect width="256" height="256" rx="56" fill="{NIGHT}"/>'
        + f'<g transform="{t}">{paint(body, g)}</g>'
    )


def lockup(key, ink, bg=None):
    body, right = GLYPHS[key]()
    g = f"l{key}"
    wm, ww = wordmark(("solid", "solid"))
    x0 = right + 36
    w = int(x0 + ww + 40)
    back = f'<rect width="{w}" height="256" fill="{bg}"/>' if bg else ""
    return (
        w,
        grad(g)
        + back
        + paint(body, g)
        + f'<path transform="translate({x0} 12)" fill="{ink}" d="{wm}"/>',
    )


def main():
    OUT.mkdir(exist_ok=True)
    for k in GLYPHS:
        (OUT / f"{k}-tile.svg").write_text(svg(256, 256, tile(k), f"Liria {k} app icon"))
        body, _ = GLYPHS[k]()
        (OUT / f"{k}-glyph.svg").write_text(
            svg(256, 256, grad(f"s{k}") + paint(body, f"s{k}"), f"Liria {k} symbol")
        )
        w, b = lockup(k, NIGHT)
        (OUT / f"{k}-lockup.svg").write_text(svg(w, 256, b, f"Liria {k} lockup"))
        w, b = lockup(k, "#FFFFFF", NIGHT)
        (OUT / f"{k}-lockup-dark.svg").write_text(svg(w, 256, b, f"Liria {k} lockup on dark"))


if __name__ == "__main__":
    main()
