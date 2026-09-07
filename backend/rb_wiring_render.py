"""
Server-side Resistance Bank wiring diagram renderer.

Draws the student's actual wiring (from the reliably-stored `wiring_data`
column: JSON list of [socket_a, socket_b] jumper pairs) directly on top of
the real board image, using the fixed socket pixel coordinates from
socket_positions.json.

This replaces dependence on the client-side canvas/SVG screenshot
(_rbCaptureSvgElementAsPng in assessment.js), which can fail silently
(tainted canvas, timing, image-not-loaded) and either produce a corrupted
capture or no file at all (404). wiring_data is written to the DB on every
submission regardless of whether that client-side capture succeeded, so
building the image from wiring_data here can never come back empty for a
submitted assessment, and can also backfill old/broken submissions.
"""

import os
import json
from typing import Optional, List, Tuple

from PIL import Image, ImageDraw

BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))
BOARD_IMAGE_PATH = os.path.join(BACKEND_ROOT, "..", "frontend", "assets", "resistance_bank_board.png")
SOCKET_POSITIONS_PATH = os.path.join(BACKEND_ROOT, "..", "frontend", "assets", "socket_positions_resistance_bank.json")

# Visual style constants
WIRE_COLOR = (37, 99, 235)       # blue jumper wire
WIRE_WIDTH = 6
SOCKET_RADIUS = 14
SOCKET_OUTLINE = (17, 24, 39)
SOCKET_FILL = (255, 255, 255)
NODE_A_COLOR = (220, 38, 38)     # red highlight for measurement Node A
NODE_B_COLOR = (22, 163, 74)     # green highlight for measurement Node B
NODE_HIGHLIGHT_RADIUS = 22


def _load_socket_positions() -> dict:
    with open(SOCKET_POSITIONS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {str(k): (v["x"], v["y"]) for k, v in data["sockets"].items()}


def _parse_wiring_pairs(wiring_data_json: Optional[str]) -> List[Tuple[str, str]]:
    if not wiring_data_json:
        return []
    try:
        raw = json.loads(wiring_data_json)
    except Exception:
        return []
    pairs = []
    for item in raw:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            pairs.append((str(item[0]), str(item[1])))
    return pairs


def render_wiring_image(
    wiring_data_json: Optional[str],
    node_a: Optional[str] = None,
    node_b: Optional[str] = None,
) -> Optional[Image.Image]:
    """Renders the board image with the student's jumper wires drawn on top,
    plus a highlight on the measurement nodes (if provided). Returns a PIL
    Image, or None if the board asset / socket map is missing (never raises
    on bad wiring_data — that just results in a board with no wires drawn)."""
    if not os.path.isfile(BOARD_IMAGE_PATH):
        return None
    if not os.path.isfile(SOCKET_POSITIONS_PATH):
        return None

    try:
        board = Image.open(BOARD_IMAGE_PATH).convert("RGB")
    except Exception:
        return None

    try:
        positions = _load_socket_positions()
    except Exception:
        positions = {}

    draw = ImageDraw.Draw(board)

    pairs = _parse_wiring_pairs(wiring_data_json)
    for a, b in pairs:
        pa = positions.get(a)
        pb = positions.get(b)
        if not pa or not pb:
            continue
        draw.line([pa, pb], fill=WIRE_COLOR, width=WIRE_WIDTH)

    # Draw a socket marker on every socket that's actually wired, so wire
    # endpoints look clean regardless of the underlying board art.
    wired_sockets = set()
    for a, b in pairs:
        wired_sockets.add(a)
        wired_sockets.add(b)
    for sock in wired_sockets:
        p = positions.get(sock)
        if not p:
            continue
        x, y = p
        draw.ellipse(
            [x - SOCKET_RADIUS, y - SOCKET_RADIUS, x + SOCKET_RADIUS, y + SOCKET_RADIUS],
            fill=SOCKET_FILL, outline=SOCKET_OUTLINE, width=3,
        )

    # Highlight the measurement nodes (Node A / Node B) distinctly, on top
    # of everything else, so they're easy to spot in the report.
    for node_val, color in ((node_a, NODE_A_COLOR), (node_b, NODE_B_COLOR)):
        if not node_val:
            continue
        p = positions.get(str(node_val))
        if not p:
            continue
        x, y = p
        r = NODE_HIGHLIGHT_RADIUS
        draw.ellipse([x - r, y - r, x + r, y + r], outline=color, width=4)

    return board


def render_wiring_image_bytes(
    wiring_data_json: Optional[str],
    node_a: Optional[str] = None,
    node_b: Optional[str] = None,
) -> Optional[bytes]:
    """Same as render_wiring_image but returns encoded PNG bytes, ready to
    hand to reportlab / write to disk."""
    img = render_wiring_image(wiring_data_json, node_a, node_b)
    if img is None:
        return None
    import io
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
