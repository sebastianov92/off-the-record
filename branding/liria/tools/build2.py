"""Round 2 concepts for Liria: music/karaoke reads at a glance. Output -> ../concepts/*.svg"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import (  # noqa: E402  (round-1 helpers + wordmark)
    capsule,
    circle,
    rect,
    wordmark,
)

OUT = Path(__file__).resolve().parent.parent / "concepts"
INK = "#111111"


def svg(w, h, body, title):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
        f'role="img" aria-labelledby="t"><title id="t">{title}</title>\n{body}\n</svg>\n'
    )


def hole_capsule(x, y, w, h):
    """Capsule wound counter-clockwise: a hole under nonzero."""
    r = h / 2
    return (
        f"M{x + r} {y} A{r} {r} 0 0 0 {x + r} {y + h} H{x + w - r} "
        f"A{r} {r} 0 0 0 {x + w - r} {y} Z"
    )


def rounded_bottom_rect(x, y, w, h, r):
    return (
        f"M{x} {y} H{x + w} V{y + h - r} A{r} {r} 0 0 1 {x + w - r} {y + h} H{x + r} "
        f"A{r} {r} 0 0 1 {x} {y + h - r} Z"
    )


def fill(d):
    return f'<path fill="{INK}" fill-rule="nonzero" d="{d}"/>'


# ---------- A: micrófono de versos ----------
def mic(slits=True):
    head = circle(128, 84, 60)  # grille ball, y 24..144
    parts = [head]
    if slits:  # karaoke layout: line 1 left, line 2 right
        parts += [hole_capsule(84, 64, 68, 18), hole_capsule(104, 98, 68, 18)]
    parts.append(rect(98, 152, 60, 14))  # collar ring
    parts.append(rounded_bottom_rect(106, 174, 44, 62, 22))  # handle, round end
    return " ".join(parts)


A_UP = fill(mic())


def mic_tilted():
    """Body rotated 30 deg; the round head is drawn unrotated so its lyric slits stay horizontal."""
    body = " ".join([rect(98, 152, 60, 14), rounded_bottom_rect(106, 174, 44, 62, 22)])
    cx, cy = 152, 94  # head centre after the rotation
    head = " ".join(
        [
            circle(cx, cy, 60),
            hole_capsule(cx - 46, cy - 22, 70, 18),
            hole_capsule(cx - 26, cy + 10, 70, 18),
        ]
    )
    return f'<g transform="rotate(30 128 132) translate(0 4)">{fill(body)}</g>{fill(head)}'


A_TILT = mic_tilted()


# ---------- B: lira ----------
def lyre(bowed=True):
    w = 16  # frame stroke
    arms = (
        f'<path fill="none" stroke="{INK}" stroke-width="{w}" stroke-linecap="round" '
        f'd="M86 34 C40 52 34 150 98 198 M170 34 C216 52 222 150 158 198"/>'
    )
    base = f'<path fill="none" stroke="{INK}" stroke-width="{w}" stroke-linecap="round" d="M98 204 H158"/>'
    bar = f'<path fill="none" stroke="{INK}" stroke-width="12" stroke-linecap="round" d="M62 70 H194"/>'
    s = 7
    strings = (
        f'<path fill="none" stroke="{INK}" stroke-width="{s}" stroke-linecap="round" '
        f'd="M100 70 V198 M156 70 V198"/>'
    )
    mid = "M128 70 C146 110 110 158 128 198" if bowed else "M128 70 V198"
    middle = (
        f'<path fill="none" stroke="{INK}" stroke-width="{s}" stroke-linecap="round" d="{mid}"/>'
    )
    return arms + base + bar + strings + middle


B_LYRE = lyre()


# ---------- C: L-nota ----------
def l_note(flag=False):
    stem = rect(68, 26, 36, 178)
    head = '<ellipse cx="146" cy="194" rx="52" ry="36" transform="rotate(-20 146 194)"/>'
    parts = f'<g fill="{INK}">{fill(stem)}{head}'
    if flag:
        parts += fill("M104 26 C104 70 168 76 168 128 C168 100 140 92 104 84 Z")
    return parts + "</g>"


def ellipse_d(cx, cy, rx, ry, rot):
    """Rotated ellipse as a path (two arcs) so holes can share its evenodd path."""
    a = math.radians(rot)
    dx, dy = rx * math.cos(a), rx * math.sin(a)
    x1, y1, x2, y2 = cx - dx, cy - dy, cx + dx, cy + dy
    return (
        f"M{x1:.2f} {y1:.2f} A{rx} {ry} {rot} 1 1 {x2:.2f} {y2:.2f} "
        f"A{rx} {ry} {rot} 1 1 {x1:.2f} {y1:.2f} Z"
    )


def note_mic(slit=False):
    """Down-stem eighth note = handheld mic: head = grille, stem = handle, flag = cable.
    With slit=True two horizontal lyric lines (karaoke layout) are carved through the head."""
    stem = rect(86, 80, 22, 156)
    flag = "M108 236 V204 C138 202 176 190 184 158 C204 196 160 222 108 236 Z"
    head = ellipse_d(146, 74, 62, 46, -20)
    if slit:
        head += f" {hole_capsule(104, 52, 64, 14)} {hole_capsule(122, 80, 64, 14)}"
    return (
        f'<g fill="{INK}"><path d="{stem} {flag}"/>' f'<path fill-rule="evenodd" d="{head}"/></g>'
    )


C_NOTE = note_mic()
C_NOTE_FLAG = note_mic(slit=True)


def centred(body, dx, dy):
    """Optical centring: one wrapper translate, as allowed in masters."""
    return f'<g transform="translate({dx} {dy})">{body}</g>'


A_TILT = centred(A_TILT, -9, 0)
B_LYRE = centred(B_LYRE, 0, 7)
C_NOTE_FLAG = centred(C_NOTE_FLAG, -16, 0)


def lockup(name, symbol_body, title, sym_right, wm_dots=("solid", "solid")):
    wm, ww = wordmark(wm_dots)
    x0 = sym_right + 44
    body = symbol_body + f'\n<path transform="translate({x0} 12)" fill="{INK}" d="{wm}"/>'
    (OUT / name).write_text(svg(int(x0 + ww + 32), 256, body, title))


def main():
    OUT.mkdir(exist_ok=True)
    files = {
        "a-mic.svg": A_UP,
        "a-mic-tilt.svg": A_TILT,
        "b-lyre.svg": B_LYRE,
        "c-notemic.svg": C_NOTE,
        "c-notemic-slit.svg": C_NOTE_FLAG,
    }
    for name, body in files.items():
        (OUT / name).write_text(svg(256, 256, body, f"Liria {name[:-4]}"))
    lockup("a-mic-lockup.svg", A_TILT, "Liria A lockup", 205)
    lockup("b-lyre-lockup.svg", B_LYRE, "Liria B lockup", 226)
    lockup("c-notemic-lockup.svg", C_NOTE_FLAG, "Liria C lockup", 190)


if __name__ == "__main__":
    main()
