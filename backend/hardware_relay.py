"""
Faculty Controlled Hardware Unlock — fail-safe relay control.

Sends "UNLOCK" / "HEARTBEAT" / "LOCK" text commands to the Arduino over a
serial port that is separate from (and does not interfere with) the
browser's Web Serial connection used for wiring/resistance scanning. This
module owns its own dedicated pyserial connection to the physical port
configured by RELAY_SERIAL_PORT.

FAIL-SAFE DESIGN
-----------------
The relay must NEVER remain energized because of stale/lost communication.
The Arduino independently enforces a 3-second heartbeat timeout and will
auto-LOCK itself if no UNLOCK/HEARTBEAT arrives in time — this module's
job is simply to hold up its end of that contract:

  - Send UNLOCK exactly once when the relay transitions to unlocked
    (never repeatedly).
  - While the relay is unlocked, send HEARTBEAT once per second on a
    dedicated background thread, refreshing the Arduino's timeout timer.
  - Send LOCK immediately on reject, on backend shutdown, or whenever the
    caller explicitly wants the relay off.
  - Never assume prior state on startup/reconnect — this module does not
    send UNLOCK on its own during connect/startup.
  - Reuse a single open serial connection; reconnect automatically if the
    port drops; flush buffers before every write; never reopen COM per
    command.

If communication is ever lost (backend crash, USB unplug, process kill),
no more HEARTBEATs are physically possible to send — so the Arduino's own
3-second timeout, not this module, is what guarantees the relay drops to
LOCKED. This module is best-effort only and must never block or affect
the assessment approve/reject database flow.
"""

import os
import threading
import time
from dotenv import load_dotenv

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=False)

try:
    import serial  # pyserial
except ImportError:
    serial = None

RELAY_SERIAL_PORT = os.environ.get("RELAY_SERIAL_PORT", "COM8")
RELAY_SERIAL_BAUD = int(os.environ.get("RELAY_SERIAL_BAUD", "115200"))

# Heartbeat cadence. Must stay comfortably under the Arduino's 3s timeout.
HEARTBEAT_INTERVAL_SECONDS = 1.0

_lock = threading.RLock()
_conn = None

# Relay state as tracked by the backend. Only two states, mirroring the
# Arduino's own state machine. Starts LOCKED — this module never assumes
# the relay is unlocked on process start.
_state = "LOCKED"

# Background heartbeat thread bookkeeping.
_heartbeat_thread = None
_heartbeat_stop_event = threading.Event()

# Diagnostic log buffer for live console (keeps last 50 events)
_log_buffer: list = []
_MAX_LOGS = 60


def _log(msg: str, level: str = "info") -> None:
    print(f"[Relay] {msg}")
    with _lock:
        entry = {
            "time": time.strftime("%H:%M:%S"),
            "timestamp": time.time(),
            "msg": msg,
            "level": level,
        }
        _log_buffer.append(entry)
        if len(_log_buffer) > _MAX_LOGS:
            _log_buffer.pop(0)


def get_relay_diagnostics() -> dict:
    """Return complete relay diagnostic status and recent event logs."""
    with _lock:
        is_open = _conn is not None and getattr(_conn, "is_open", False)
        return {
            "state": _state,
            "port": RELAY_SERIAL_PORT,
            "baud": RELAY_SERIAL_BAUD,
            "port_open": is_open,
            "pyserial_installed": serial is not None,
            "heartbeat_active": _heartbeat_thread is not None and _heartbeat_thread.is_alive(),
            "logs": list(_log_buffer),
        }


def _get_connection():
    """Lazily open (or reopen) the dedicated relay serial connection.
    Returns None on any failure — callers must treat that as best-effort.
    Reuses the existing connection whenever possible; never reopens the
    port for every single command."""
    global _conn
    if serial is None:
        return None
    if _conn is not None and getattr(_conn, "is_open", False):
        return _conn
    try:
        _log(f"Opening {RELAY_SERIAL_PORT}")
        _conn = serial.Serial(RELAY_SERIAL_PORT, RELAY_SERIAL_BAUD, timeout=2)
        _log(f"Connected to {RELAY_SERIAL_PORT} successfully", level="success")
        return _conn
    except Exception as e:
        _log(f"Could not open {RELAY_SERIAL_PORT}: {e}", level="error")
        _conn = None
        return None


def _send_command(command: str) -> bool:
    """Best-effort send of a single command line ('UNLOCK' / 'HEARTBEAT' /
    'LOCK'). Never raises — returns True/False so callers can log but must
    not let this affect the already-committed database update. Flushes
    input/output buffers before every write and reconnects automatically
    on failure."""
    with _lock:
        conn = _get_connection()
        if conn is None:
            return False
        try:
            conn.reset_input_buffer()
            conn.reset_output_buffer()
            conn.write((command + "\n").encode("utf-8"))
            conn.flush()
            _log(f"Transmitted signal: {command} -> {RELAY_SERIAL_PORT}", level="success" if command in ("UNLOCK", "LOCK") else "info")
            return True
        except Exception as e:
            _log(f"Failed to transmit {command}: {e}", level="error")
            global _conn
            try:
                conn.close()
            except Exception:
                pass
            _conn = None
            return False


def _heartbeat_loop():
    """Runs on a dedicated background thread only while the relay is
    UNLOCKED. Sends HEARTBEAT once per second so the Arduino's timeout
    timer never expires. Stops immediately (and does not send a final
    HEARTBEAT) once the stop event is set, e.g. on LOCK/shutdown."""
    while not _heartbeat_stop_event.wait(HEARTBEAT_INTERVAL_SECONDS):
        with _lock:
            if _state != "UNLOCKED":
                break
        _send_command("HEARTBEAT")


def _start_heartbeat_thread():
    global _heartbeat_thread
    _heartbeat_stop_event.clear()
    if _heartbeat_thread is not None and _heartbeat_thread.is_alive():
        return
    _heartbeat_thread = threading.Thread(
        target=_heartbeat_loop, name="relay-heartbeat", daemon=True
    )
    _heartbeat_thread.start()


def _stop_heartbeat_thread():
    _heartbeat_stop_event.set()


def unlock_hardware() -> bool:
    """Called after faculty APPROVE is committed to the database AND
    circuit verification passed. Sends UNLOCK exactly once (only on a
    state transition into UNLOCKED — repeated calls while already
    unlocked are no-ops for the UNLOCK command itself) and starts the
    once-per-second HEARTBEAT thread that keeps the relay alive on the
    Arduino side."""
    with _lock:
        already_unlocked = (_state == "UNLOCKED")
        globals()["_state"] = "UNLOCKED"
    ok = True
    if not already_unlocked:
        ok = _send_command("UNLOCK")
    _start_heartbeat_thread()
    return ok


def lock_hardware() -> bool:
    """Called on faculty REJECT, circuit-incorrect, experiment finished,
    student logout, or backend shutdown. Immediately switches the relay
    OFF and stops the HEARTBEAT thread so no further keep-alive traffic
    is sent for this session."""
    with _lock:
        globals()["_state"] = "LOCKED"
    _stop_heartbeat_thread()
    ok = _send_command("LOCK")
    _log("Relay OFF" if ok else "Relay OFF requested (send failed, relying on Arduino heartbeat timeout)")
    return ok


def get_relay_state() -> str:
    """Returns the backend's tracked relay state: 'LOCKED' or 'UNLOCKED'.
    This is the backend's view only — the Arduino is the source of truth
    and will independently force LOCKED on any communication timeout."""
    with _lock:
        return _state


def shutdown_relay() -> None:
    """Call on backend process shutdown. Stops the heartbeat thread and
    sends a final LOCK so the relay drops immediately rather than waiting
    out the Arduino's 3-second timeout. Best-effort — if the send fails
    (e.g. the process is already going down hard), the Arduino's own
    timeout still guarantees the relay de-energizes within 3 seconds."""
    _log("Backend shutting down — locking relay")
    lock_hardware()


def release_port() -> bool:
    """Explicitly give up this backend's hold on RELAY_SERIAL_PORT so the
    browser's Web Serial connection can open the SAME physical COM port
    for wiring/resistance-bank scanning again (a COM port can only be
    held open by one process at a time).

    Called by the frontend (POST /relay/release) right before it
    reconnects Web Serial for a new experiment attempt, so it doesn't hit
    an "Access is denied" error from this backend still holding the port
    open from a prior approval/rejection cycle.

    Safety first: if the relay is currently UNLOCKED, this locks it
    before closing the connection, so the port is never released while
    still energized. Stops the heartbeat thread and closes the serial
    connection; does not otherwise touch relay state tracking beyond
    that. Best-effort — never raises."""
    with _lock:
        was_unlocked = (_state == "UNLOCKED")
    if was_unlocked:
        _log("Releasing port while UNLOCKED — locking first")
        lock_hardware()
    global _conn
    with _lock:
        if _conn is not None:
            try:
                _conn.close()
            except Exception as e:
                _log(f"Error closing {RELAY_SERIAL_PORT} during release: {e}")
            _conn = None
    _log(f"Released {RELAY_SERIAL_PORT} — port is free for Web Serial to use")
    return True
