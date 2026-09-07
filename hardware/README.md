# Power Converter Hardware Kit

This folder holds the original hardware-side files for the Power Converter
trainer board.

- **sketch_jul02a.ino** — Arduino firmware. Scans all 34 board sockets for
  continuity (jumper wires), debounces/confirms each connection, and streams
  one JSON line per loop over USB serial at 115200 baud:
  `{"connections":[[a,b],...],"groups":[[n1,n2,...],...]}`

- **trial3_desktop_twin.py** — the original standalone PySide6 desktop app
  that read this same serial stream, drew the wiring on screen, and checked
  it against the answer key. Kept here for reference / offline use.

- **socket_positions_reference.json** — the desktop app's own socket pixel
  coordinates (for its board.jpg image). **Not used by the web app** — the
  web frontend has its own coordinate set (`PC_SOCKETS` in
  `frontend/assessment.js`), already calibrated to
  `frontend/assets/power_converter_board.png` and the SVG viewBox used on
  the site, so wiring lines up correctly there.

## Where the hardware kit is actually used now

You no longer need to run `trial3_desktop_twin.py` to use the hardware kit
with EduNexus. Both the **Experiments** page (practice / no marks) and the
**Assessment** page (graded) now read the *same* serial JSON stream directly
in the browser via the Web Serial API (Chrome/Edge on desktop):

1. Plug the trainer board into the computer over USB (with `sketch_jul02a.ino`
   flashed onto it).
2. On the Experiments or Assessment page, click **Connect Hardware Kit** and
   pick the board's serial port.
3. Wires the student plugs in appear live on the on-screen board and are
   checked against the same answer key (`PC_GROUPS` in `assessment.js`) used
   everywhere else in the app.

The desktop app remains useful only if you want an offline tool with no
browser involved at all.
