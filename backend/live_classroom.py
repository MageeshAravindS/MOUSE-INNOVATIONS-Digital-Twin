"""
EduNexus Live Classroom Hub
Handles real-time circuit synchronization between online students working on assignments
and teachers monitoring the live classroom laboratory.
Supports native WebSockets with automatic REST fallback.
"""

import time
import json
import logging
from typing import Dict, Set, Optional, Any
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("edunexus.live_classroom")


class LiveClassroomHub:
    """
    In-memory registry and broadcast manager for real-time student circuit sessions.
    """
    def __init__(self):
        # active_students[student_id] = {
        #   "student_id": int/str,
        #   "student_name": str,
        #   "student_email": str,
        #   "assignment_id": str,
        #   "assignment_title": str,
        #   "kit_id": str,                 # "resistance_bank" | "power_converter"
        #   "wires": list,                 # e.g. [[1, 7], [2, 8]]
        #   "diodes": list,                # for power converter
        #   "node_a": str,
        #   "node_b": str,
        #   "student_answer": str,
        #   "calculated_rth": Optional[float],
        #   "mode": str,                   # "manual" | "hardware"
        #   "status": str,                 # "wiring" | "evaluating" | "submitted"
        #   "last_active": float,          # epoch seconds
        #   "history": list,               # recent event logs
        # }
        self.active_students: Dict[str, dict] = {}
        
        # Teacher WebSocket connections listening to classroom events
        self.teacher_sockets: Set[WebSocket] = set()
        
        # Student WebSocket connections for receiving direct teacher hints
        self.student_sockets: Dict[str, WebSocket] = {}

    def prune_stale_sessions(self, max_idle_seconds: float = 180.0):
        """Removes sessions that haven't sent a heartbeat/update in over max_idle_seconds."""
        now = time.time()
        stale_ids = [
            sid for sid, data in self.active_students.items()
            if now - data.get("last_active", 0) > max_idle_seconds
        ]
        for sid in stale_ids:
            logger.info(f"Pruning stale student session: {sid}")
            del self.active_students[sid]

    def update_student_circuit(self, payload: dict) -> dict:
        """
        Updates an online student's live circuit state.
        payload contains: student_id, student_name, student_email, assignment_id,
        assignment_title, kit_id, wires, diodes, node_a, node_b, student_answer, mode, status.
        """
        self.prune_stale_sessions()
        student_id = str(payload.get("student_id") or "anonymous")
        now = time.time()

        prev = self.active_students.get(student_id, {})
        prev_wires = prev.get("wires", [])
        new_wires = payload.get("wires", prev_wires)

        # Log action history for teacher observation
        history = prev.get("history", [])
        if len(new_wires) > len(prev_wires):
            history.append({"time": now, "msg": f"Added jumper wire (Total: {len(new_wires)})"})
        elif len(new_wires) < len(prev_wires):
            history.append({"time": now, "msg": f"Removed wire (Total: {len(new_wires)})"})
        elif payload.get("node_a") != prev.get("node_a") or payload.get("node_b") != prev.get("node_b"):
            history.append({"time": now, "msg": f"Changed terminals: A={payload.get('node_a')}, B={payload.get('node_b')}"})

        # Keep history compact (last 15 actions)
        if len(history) > 15:
            history = history[-15:]

        session_data = {
            "student_id": student_id,
            "student_name": payload.get("student_name") or prev.get("student_name") or f"Student #{student_id}",
            "student_email": payload.get("student_email") or prev.get("student_email") or "",
            "assignment_id": payload.get("assignment_id") or prev.get("assignment_id") or "assignment_1",
            "assignment_title": payload.get("assignment_title") or prev.get("assignment_title") or "Circuit Lab Assessment",
            "kit_id": payload.get("kit_id") or prev.get("kit_id") or "resistance_bank",
            "wires": new_wires,
            "diodes": payload.get("diodes", prev.get("diodes", [])),
            "node_a": str(payload.get("node_a") if payload.get("node_a") is not None else prev.get("node_a", "")),
            "node_b": str(payload.get("node_b") if payload.get("node_b") is not None else prev.get("node_b", "")),
            "student_answer": str(payload.get("student_answer") if payload.get("student_answer") is not None else prev.get("student_answer", "")),
            "calculated_rth": payload.get("calculated_rth", prev.get("calculated_rth")),
            "mode": payload.get("mode") or prev.get("mode") or "manual",
            "status": payload.get("status") or "wiring",
            "last_active": now,
            "history": history,
        }

        self.active_students[student_id] = session_data
        return session_data

    def remove_student_session(self, student_id: str):
        """Explicitly cleans up a student session when they leave an assignment."""
        sid = str(student_id)
        if sid in self.active_students:
            del self.active_students[sid]
        if sid in self.student_sockets:
            del self.student_sockets[sid]

    def get_all_active_students(self) -> list:
        """Returns list of currently active student sessions sorted by last active."""
        self.prune_stale_sessions()
        students = list(self.active_students.values())
        students.sort(key=lambda s: s.get("last_active", 0), reverse=True)
        return students

    def get_student_session(self, student_id: str) -> Optional[dict]:
        sid = str(student_id)
        return self.active_students.get(sid)

    async def register_teacher(self, websocket: WebSocket):
        """Registers a teacher socket and sends initial list of active students."""
        self.teacher_sockets.add(websocket)
        students = self.get_all_active_students()
        try:
            await websocket.send_json({
                "type": "initial_state",
                "students": students,
                "timestamp": time.time(),
            })
        except Exception:
            self.teacher_sockets.discard(websocket)

    def unregister_teacher(self, websocket: WebSocket):
        self.teacher_sockets.discard(websocket)

    async def register_student_socket(self, student_id: str, websocket: WebSocket):
        sid = str(student_id)
        self.student_sockets[sid] = websocket

    def unregister_student_socket(self, student_id: str, websocket: WebSocket):
        sid = str(student_id)
        if self.student_sockets.get(sid) == websocket:
            del self.student_sockets[sid]

    async def broadcast_to_teachers(self, message: dict):
        """Broadcasts updates to all connected teacher monitoring screens."""
        dead_sockets = set()
        for ws in list(self.teacher_sockets):
            try:
                await ws.send_json(message)
            except Exception:
                dead_sockets.add(ws)
        for ws in dead_sockets:
            self.teacher_sockets.discard(ws)

    async def send_hint_to_student(self, student_id: str, hint_text: str, teacher_name: str = "Faculty Instructor") -> bool:
        """Sends a real-time hint or coaching note to an active student's screen."""
        sid = str(student_id)
        # Update session history
        if sid in self.active_students:
            self.active_students[sid].setdefault("history", []).append({
                "time": time.time(),
                "msg": f"Teacher note sent: '{hint_text}'"
            })
            
        ws = self.student_sockets.get(sid)
        if ws:
            try:
                await ws.send_json({
                    "type": "teacher_hint",
                    "hint": hint_text,
                    "teacher_name": teacher_name,
                    "timestamp": time.time(),
                })
                return True
            except Exception:
                self.student_sockets.pop(sid, None)
        return False


# Global singleton instance
classroom_hub = LiveClassroomHub()
