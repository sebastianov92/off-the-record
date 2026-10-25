"""Spelling-proof artist identity and credit splitting."""

import re
import unicodedata
from collections.abc import Callable

# "Song feat. Guest": everything after the marker is a guest.
_FEATURING = re.compile(r"\s+(?:feat\.?|ft\.?|featuring|con|with)\s+", re.IGNORECASE)
# Joiners between names. Only trusted when a part is a known artist: duos such as
# "Simon & Garfunkel" or "Earth, Wind & Fire" are one artist.
_JOINERS = re.compile(r"\s*(?:,|&|\+|\s+y\s+|\s+x\s+|\s+and\s+|\s+e\s+)\s*", re.IGNORECASE)


def fold(text: str) -> str:
    """Lowercase without accents: what search and identity compare."""
    decomposed = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def artist_key(name: str) -> str:
    """Identity of an artist name: "Gloria Estefán", "GLORIA ESTEFAN" and "gloria estefan." agree."""
    key = fold(name).replace("&", " and ")
    key = re.sub(r"[^\w\s]", " ", key)
    key = re.sub(r"\s+", " ", key).strip()
    return key[4:] if key.startswith("the ") else key


def sort_name(name: str) -> str:
    stripped = re.sub(r"^the\s+", "", name.strip(), flags=re.IGNORECASE)
    return fold(stripped)


def is_single_name(name: str) -> bool:
    """No joiner in it: safe to tie to one iTunes artist id."""
    return len([p for p in _JOINERS.split(name) if p.strip()]) == 1


def split_credit(credit: str, is_known: Callable[[str], bool]) -> tuple[list[str], list[str]]:
    """Split "A & B feat. C" into main artists [A, B] and guests [C]."""
    parts = _FEATURING.split(credit.strip(), maxsplit=1)
    main_part = parts[0].strip()
    guests = [g for g in _JOINERS.split(parts[1]) if g.strip()] if len(parts) > 1 else []
    candidates = [c for c in _JOINERS.split(main_part) if c.strip()]
    mains = candidates if len(candidates) > 1 and any(is_known(c) for c in candidates) else []
    return (mains or [main_part]), [g.strip() for g in guests]
