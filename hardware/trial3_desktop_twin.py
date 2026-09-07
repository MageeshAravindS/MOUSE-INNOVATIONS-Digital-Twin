import sys
import json
import math
import serial
import requests

from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget,
    QVBoxLayout, QHBoxLayout, QPushButton,
    QGraphicsScene, QGraphicsView,
    QGraphicsItem, QGraphicsTextItem, QMessageBox
)

from PySide6.QtGui import (
    QPixmap, QPen, QColor, QFont,
    QPainterPath, QPainter, QPolygonF
)

from PySide6.QtCore import Qt, QTimer, QPointF, QRectF


JSON_PATH   = "socket_positions_1.json"
BOARD_IMAGE = "board.jpg"

SERIAL_PORT = "COM8"
BAUDRATE    = 115200

CLOUD_URL = "https://power-electronics-admin2-ijvp.onrender.com"

NODE_RADIUS = 12
WIRE_WIDTH  = 6

HUB_NODES = {"3", "4", "5", "6", "15", "16"}

BASE_CHAINS = [
    ["23", "2", "3"],
    ["25", "2", "3"],
    ["24", "1", "5"],
    ["26", "1", "5"],
    ["6",  "17", "19"],
    ["4",  "18", "22"],
    ["15", "30"],
    ["15", "31"],
    ["15", "30", "31"],
    ["16", "32"],
    ["16", "33"],
    ["16", "32", "33"],
]

# ─────────────────────────────────────────────────────────────────────────────
# ALL accepted correct group variants (exact frozenset match required).
#
# Group 1 variants  — hub-6 side:
#   {12,13,17,20,6}   ← variant A (20)
#   {12,13,17,19,6}   ← variant B (19)
#
# Group 2 variants  — hub-4 side:
#   {18,21,4,8,9}     ← variant A (21)
#   {18,22,4,8,9}     ← variant B (22)
#
# Group 3 variants  — AC input-1:
#   {14,2,23,3,7}     ← variant A (23)
#   {14,2,25,3,7}     ← variant B (25)
#
# Group 4 variants  — AC input-2:
#   {1,10,11,24,5}    ← variant A (24)
#   {1,10,11,26,5}    ← variant B (26)
#
# Group 5 variants  — hub-15 side (Scenario A):
#   {15,30}           ← variant A (30 only)
#   {15,31}           ← variant B (31 only)
#   {15,30,31}        ← variant C (both together)
#
# Group 6 variants  — hub-16 side (Scenario A):
#   {16,32}           ← variant A (32 only)
#   {16,33}           ← variant B (33 only)
#   {16,32,33}        ← variant C (both together)
#
# Group 7 variants  — hub-16 side (Scenario B, swapped):
#   {16,30}           ← variant A (30 only)
#   {16,31}           ← variant B (31 only)
#
# Group 8 variants  — hub-15 side (Scenario B, swapped):
#   {15,32}           ← variant A (32 only)
#   {15,33}           ← variant B (33 only)
# ─────────────────────────────────────────────────────────────────────────────

# Group 1
CORRECT_GROUP_1A = frozenset({"12", "13", "17", "20", "6"})
CORRECT_GROUP_1B = frozenset({"12", "13", "17", "19", "6"})

# Group 2
CORRECT_GROUP_2A = frozenset({"18", "21", "4", "8", "9"})
CORRECT_GROUP_2B = frozenset({"18", "22", "4", "8", "9"})

# Group 3
CORRECT_GROUP_3A = frozenset({"14", "2", "23", "3", "7"})
CORRECT_GROUP_3B = frozenset({"14", "2", "25", "3", "7"})

# Group 4
CORRECT_GROUP_4A = frozenset({"1", "10", "11", "24", "5"})
CORRECT_GROUP_4B = frozenset({"1", "10", "11", "26", "5"})

# Group 5 — Scenario A: hub 15 → 30 or 31 or both
CORRECT_GROUP_5A = frozenset({"15", "30"})
CORRECT_GROUP_5B = frozenset({"15", "31"})
CORRECT_GROUP_5C = frozenset({"15", "30", "31"})

# Group 6 — Scenario A: hub 16 → 32 or 33 or both
CORRECT_GROUP_6A = frozenset({"16", "32"})
CORRECT_GROUP_6B = frozenset({"16", "33"})
CORRECT_GROUP_6C = frozenset({"16", "32", "33"})

# Group 7 — Scenario B (swapped): hub 16 → 30 or 31
CORRECT_GROUP_7A = frozenset({"16", "30"})
CORRECT_GROUP_7B = frozenset({"16", "31"})

# Group 8 — Scenario B (swapped): hub 15 → 32 or 33
CORRECT_GROUP_8A = frozenset({"15", "32"})
CORRECT_GROUP_8B = frozenset({"15", "33"})

# All accepted exact matches
CORRECT_GROUPS_LIST: list[frozenset] = [
    CORRECT_GROUP_1A, CORRECT_GROUP_1B,
    CORRECT_GROUP_2A, CORRECT_GROUP_2B,
    CORRECT_GROUP_3A, CORRECT_GROUP_3B,
    CORRECT_GROUP_4A, CORRECT_GROUP_4B,
    CORRECT_GROUP_5A, CORRECT_GROUP_5B, CORRECT_GROUP_5C,
    CORRECT_GROUP_6A, CORRECT_GROUP_6B, CORRECT_GROUP_6C,
    CORRECT_GROUP_7A, CORRECT_GROUP_7B,
    CORRECT_GROUP_8A, CORRECT_GROUP_8B,
]


def is_group_correct(raw_group: frozenset) -> bool:
    """STRICT exact match — partial/wrong group = False."""
    return raw_group in CORRECT_GROUPS_LIST


def all_groups_present(raw_groups: list[frozenset]) -> bool:
    """
    Core 4 groups MUST all be present and correct.
    Hub-15 and Hub-16 groups are OPTIONAL —
    if they appear they must form a valid complete scenario,
    but their absence is fine and motor still runs.
    """
    has_g1 = (CORRECT_GROUP_1A in raw_groups) or (CORRECT_GROUP_1B in raw_groups)
    has_g2 = (CORRECT_GROUP_2A in raw_groups) or (CORRECT_GROUP_2B in raw_groups)
    has_g3 = (CORRECT_GROUP_3A in raw_groups) or (CORRECT_GROUP_3B in raw_groups)
    has_g4 = (CORRECT_GROUP_4A in raw_groups) or (CORRECT_GROUP_4B in raw_groups)

    # Core 4 must all be present
    if not (has_g1 and has_g2 and has_g3 and has_g4):
        return False

    # Hub 15/16 groups — check if ANY hub group is present
    hub_groups_present = any(
        g in raw_groups for g in [
            CORRECT_GROUP_5A, CORRECT_GROUP_5B, CORRECT_GROUP_5C,
            CORRECT_GROUP_6A, CORRECT_GROUP_6B, CORRECT_GROUP_6C,
            CORRECT_GROUP_7A, CORRECT_GROUP_7B,
            CORRECT_GROUP_8A, CORRECT_GROUP_8B,
        ]
    )

    if hub_groups_present:
        # Scenario A: hub15→{30|31|both}, hub16→{32|33|both}
        scenario_a_15 = (
            (CORRECT_GROUP_5A in raw_groups) or
            (CORRECT_GROUP_5B in raw_groups) or
            (CORRECT_GROUP_5C in raw_groups)
        )
        scenario_a_16 = (
            (CORRECT_GROUP_6A in raw_groups) or
            (CORRECT_GROUP_6B in raw_groups) or
            (CORRECT_GROUP_6C in raw_groups)
        )
        scenario_a_ok = scenario_a_15 and scenario_a_16

        # Scenario B swapped: hub16→{30|31}, hub15→{32|33}
        scenario_b_16 = (CORRECT_GROUP_7A in raw_groups) or (CORRECT_GROUP_7B in raw_groups)
        scenario_b_15 = (CORRECT_GROUP_8A in raw_groups) or (CORRECT_GROUP_8B in raw_groups)
        scenario_b_ok = scenario_b_16 and scenario_b_15

        # If hub groups present, one full scenario must be satisfied
        if not (scenario_a_ok or scenario_b_ok):
            return False

    return True


MOTOR_CENTER_X   = 508
MOTOR_CENTER_Y   = 900
MOTOR_DIAMETER   = 156
MOTOR_STEP_ANGLE = 8


# ── ZoomView ──────────────────────────────────────────────────────────────────

class ZoomView(QGraphicsView):

    def __init__(self):
        super().__init__()
        self.setDragMode(QGraphicsView.ScrollHandDrag)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)
        self.zoom = 1.15

    def wheelEvent(self, event):
        if event.angleDelta().y() > 0:
            self.scale(self.zoom, self.zoom)
        else:
            self.scale(1 / self.zoom, 1 / self.zoom)


# ── SocketItem ────────────────────────────────────────────────────────────────

class SocketItem(QGraphicsItem):

    def __init__(self, node_id, x, y):
        super().__init__()
        self.node_id = str(node_id)
        self.setPos(x, y)
        self.label = QGraphicsTextItem(self.node_id, self)
        self.label.setDefaultTextColor(Qt.green)
        self.label.setFont(QFont("Arial", 9, QFont.Bold))
        self.label.setPos(14, -14)

    def boundingRect(self):
        return QRectF(-NODE_RADIUS, -NODE_RADIUS, NODE_RADIUS * 2, NODE_RADIUS * 2)

    def paint(self, painter, option, widget):
        pen = QPen(QColor(255, 0, 0))
        pen.setWidth(3)
        painter.setPen(pen)
        painter.setBrush(Qt.NoBrush)
        painter.drawEllipse(QPointF(0, 0), NODE_RADIUS, NODE_RADIUS)
        painter.setPen(Qt.NoPen)
        painter.setBrush(Qt.black)
        painter.drawEllipse(QPointF(0, 0), 5, 5)

    def center(self):
        return self.pos().x(), self.pos().y()


# ── Motor helpers ─────────────────────────────────────────────────────────────

def crop_square_pixmap(pixmap, center_x, center_y, size):
    if pixmap.isNull():
        return QPixmap()
    half = size / 2.0
    x = int(round(center_x - half));  y = int(round(center_y - half))
    w = int(round(size));              h = int(round(size))
    if x < 0: w += x; x = 0
    if y < 0: h += y; y = 0
    if x + w > pixmap.width():  w = pixmap.width()  - x
    if y + h > pixmap.height(): h = pixmap.height() - y
    if w <= 0 or h <= 0:
        return QPixmap()
    return pixmap.copy(x, y, w, h)


def make_circular_pixmap(square_pixmap):
    if square_pixmap.isNull():
        return QPixmap()
    size = min(square_pixmap.width(), square_pixmap.height())
    square_pixmap = square_pixmap.copy(0, 0, size, size)
    result = QPixmap(size, size)
    result.fill(Qt.transparent)
    painter = QPainter(result)
    painter.setRenderHint(QPainter.Antialiasing, True)
    painter.setRenderHint(QPainter.SmoothPixmapTransform, True)
    path = QPainterPath()
    path.addEllipse(0, 0, size, size)
    painter.setClipPath(path)
    painter.drawPixmap(0, 0, square_pixmap)
    painter.end()
    return result


def make_motor_circle_from_board(board_pixmap):
    square = crop_square_pixmap(
        board_pixmap, MOTOR_CENTER_X, MOTOR_CENTER_Y, MOTOR_DIAMETER
    )
    if square.isNull():
        return QPixmap()
    return make_circular_pixmap(square)


# ── RotatingMotorItem ─────────────────────────────────────────────────────────

class RotatingMotorItem(QGraphicsItem):

    def __init__(self, motor_pixmap, x, y):
        super().__init__()
        self.motor_pixmap = motor_pixmap
        self.angle    = 0
        self.spinning = False
        self.setPos(x, y)
        self.setZValue(50)

    def boundingRect(self):
        if self.motor_pixmap.isNull():
            return QRectF(-100, -100, 200, 200)
        w = self.motor_pixmap.width();  h = self.motor_pixmap.height()
        pad = 24
        return QRectF(-w/2 - pad, -h/2 - pad - 26, w + pad*2, h + pad*2 + 42)

    def start(self):
        self.spinning = True;  self.update()

    def stop(self):
        self.spinning = False; self.angle = 0; self.update()

    def step(self):
        if not self.spinning:
            return
        self.angle = (self.angle + MOTOR_STEP_ANGLE) % 360
        self.update()

    def point_on_circle(self, r, deg):
        rad = math.radians(deg)
        return QPointF(r * math.cos(rad), r * math.sin(rad))

    def paint(self, painter, option, widget):
        if not self.spinning or self.motor_pixmap.isNull():
            return
        painter.setRenderHint(QPainter.Antialiasing, True)
        painter.setRenderHint(QPainter.SmoothPixmapTransform, True)
        w = self.motor_pixmap.width();  h = self.motor_pixmap.height()
        r = min(w, h) / 2.0

        painter.save()
        painter.rotate(self.angle)
        painter.drawPixmap(int(-w/2), int(-h/2), self.motor_pixmap)
        painter.restore()

        painter.save()
        painter.rotate(self.angle)
        arc_pen = QPen(QColor(255, 255, 255, 240))
        arc_pen.setWidth(3);  arc_pen.setCapStyle(Qt.RoundCap)
        painter.setPen(arc_pen);  painter.setBrush(Qt.NoBrush)
        mark_r   = r * 0.30
        arc_rect = QRectF(-mark_r, -mark_r, mark_r*2, mark_r*2)
        painter.drawArc(arc_rect, 30*16, 260*16)
        tip   = QPointF(mark_r*0.85, -mark_r*0.72)
        left  = QPointF(mark_r*0.47, -mark_r*0.72)
        right = QPointF(mark_r*0.64, -mark_r*0.39)
        painter.setPen(Qt.NoPen)
        painter.setBrush(QColor(255, 255, 255, 245))
        painter.drawPolygon(QPolygonF([tip, left, right]))
        spoke_pen = QPen(QColor(190, 230, 255, 220))
        spoke_pen.setWidth(2);  spoke_pen.setCapStyle(Qt.RoundCap)
        painter.setPen(spoke_pen)
        for offset in (0, 120, 240):
            deg = offset - 90
            p1 = self.point_on_circle(r * 0.07, deg)
            p2 = self.point_on_circle(r * 0.22, deg)
            painter.drawLine(p1, p2)
        painter.restore()

        painter.setPen(Qt.NoPen)
        painter.setBrush(QColor(190, 235, 255, 220))
        painter.drawEllipse(QPointF(0, 0), 4, 4)

        text_rect = QRectF(-34, -r - 20, 68, 16)
        painter.setPen(Qt.NoPen)
        painter.setBrush(QColor(0, 0, 0, 130))
        painter.drawRoundedRect(text_rect, 4, 4)
        painter.setPen(QColor(255, 255, 255))
        painter.setFont(QFont("Arial", 7, QFont.Bold))
        painter.drawText(text_rect, Qt.AlignCenter, "ROTATING")


# ── WireManager ───────────────────────────────────────────────────────────────

class WireManager:

    def __init__(self, scene, sockets):
        self.scene      = scene
        self.sockets    = sockets
        self.edges      = []
        self.paths      = {}
        self.edge_group : dict[tuple, frozenset] = {}
        self.raw_groups : list[frozenset]        = []

    def group_to_edges(self, group):
        nodes    = [str(n) for n in group]
        if len(nodes) < 2:
            return []
        edges    = []
        node_set = set(nodes)

        # ── Exact match check first ───────────────────────────────────────────
        for chain in BASE_CHAINS:
            if set(chain) == node_set:
                for i in range(len(chain) - 1):
                    edges.append((chain[i], chain[i + 1]))
                return edges

        # ── Subset match ─────────────────────────────────────────────────────
        for chain in BASE_CHAINS:
            if set(chain).issubset(node_set):
                for i in range(len(chain) - 1):
                    edges.append((chain[i], chain[i + 1]))
                hub = None
                for n in chain:
                    if n in HUB_NODES:
                        hub = n
                for n in nodes:
                    if n not in chain:
                        edges.append((hub, n))
                return edges

        # ── Fallback: find a hub and star-connect remaining nodes ─────────────
        hub_index = None
        for i, n in enumerate(nodes):
            if n in HUB_NODES:
                hub_index = i
                break
        if hub_index is None:
            for i in range(len(nodes) - 1):
                edges.append((nodes[i], nodes[i + 1]))
            return edges
        for i in range(hub_index):
            edges.append((nodes[i], nodes[i + 1]))
        hub = nodes[hub_index]
        for i in range(hub_index + 1, len(nodes)):
            edges.append((hub, nodes[i]))
        return edges

    # Extra "cost" added per step of order-gap between two nodes, on
    # top of raw pixel distance. Tuned so it nudges close ties toward
    # the pair plugged at the same time, without overriding distance
    # when the gap is small or unknown.
    ORDER_GAP_WEIGHT = 40

    def update(self, connections, order, groups):
        """
        connections -> candidate electrically-confirmed pairs. Because
                       shorted nodes form a clique (11-12 + 12-26 also
                       confirms 11-26), this list can contain more pairs
                       than were physically wired.
        order       -> firstSeenOrder per node from the Arduino. Two
                       nodes from the SAME physical jumper get confirmed
                       in the same scan pass and get back-to-back order
                       numbers; two nodes that are merely close together
                       on the board but wired at different times will
                       have very different order numbers. Combined with
                       distance, this disambiguates cases where the
                       shortest-distance edge alone picks the wrong pair.
        groups      -> used ONLY for validation (unchanged behaviour).
        """
        # Validation data — exactly as before.
        self.raw_groups = [frozenset(str(n) for n in g) for g in groups]

        order = {str(k): v for k, v in order.items()}

        # Weight each candidate edge by real on-board distance PLUS a
        # penalty for how far apart the two nodes were confirmed in
        # time -- this is Kruskal's MST candidate weighting.
        weighted = []
        for a, b in connections:
            ea, eb = str(a), str(b)
            if ea not in self.sockets or eb not in self.sockets:
                continue
            x1, y1 = self.sockets[ea].center()
            x2, y2 = self.sockets[eb].center()
            dist = math.hypot(x2 - x1, y2 - y1)

            if ea in order and eb in order:
                order_gap = abs(order[ea] - order[eb])
                weight = dist + self.ORDER_GAP_WEIGHT * order_gap
            else:
                # No order info for one/both ends -- fall back to pure
                # distance rather than penalising unknown data.
                weight = dist

            weighted.append((weight, ea, eb))

        # Kruskal's MST: cheapest edges first, skip anything that would
        # form a cycle (i.e. the two ends are already connected).
        weighted.sort(key=lambda e: e[0])

        mst_parent = {}
        def mst_find(x):
            mst_parent.setdefault(x, x)
            while mst_parent[x] != x:
                mst_parent[x] = mst_parent[mst_parent[x]]
                x = mst_parent[x]
            return x

        def mst_union(x, y):
            rx, ry = mst_find(x), mst_find(y)
            if rx == ry:
                return False
            mst_parent[rx] = ry
            return True

        new_edges      = []
        new_edge_group = {}
        for weight, a, b in weighted:
            if not mst_union(a, b):
                continue
            e = (a, b)
            new_edges.append(e)
            # A connection's colour still comes from whichever validated
            # group its two endpoints belong to, so approval/colouring
            # logic (recolor_after_admin) needs no changes.
            for raw_fs in self.raw_groups:
                if a in raw_fs and b in raw_fs:
                    new_edge_group[e] = raw_fs
                    break

        if set(new_edges) != set(self.edges):
            self.edges      = new_edges
            self.edge_group = new_edge_group
            self.redraw()

    def _draw_wire(self, a, b, color: QColor):
        if a not in self.sockets or b not in self.sockets:
            return None
        x1, y1 = self.sockets[a].center()
        x2, y2 = self.sockets[b].center()
        path   = QPainterPath()
        path.moveTo(x1, y1)
        dx    = (x2 - x1) * 0.5
        ctrl1 = QPointF(x1 + dx, y1)
        ctrl2 = QPointF(x1 + dx, y2)
        path.cubicTo(ctrl1, ctrl2, QPointF(x2, y2))
        pen = QPen(color)
        pen.setWidth(WIRE_WIDTH)
        item = self.scene.addPath(path, pen)
        item.setZValue(5)
        return item

    def redraw(self):
        """All wires RED before Evaluate."""
        for item in self.paths.values():
            self.scene.removeItem(item)
        self.paths.clear()
        for (a, b) in self.edges:
            item = self._draw_wire(a, b, QColor(255, 0, 0))
            if item:
                self.paths[(a, b)] = item

    def recolor_after_admin(self) -> bool:
        print("\n====== ARDUINO RAW GROUPS ======")
        for rg in self.raw_groups:
            ok = is_group_correct(rg)
            print(f"  {sorted(rg)}  →  {'✅ CORRECT' if ok else '❌ WRONG'}")
        print("================================\n")

        group_ok: dict[frozenset, bool] = {
            rg: is_group_correct(rg) for rg in self.raw_groups
        }

        for (a, b), item in self.paths.items():
            src   = self.edge_group.get((a, b))
            ok    = group_ok.get(src, False) if src else False
            color = QColor(0, 200, 0) if ok else QColor(255, 0, 0)
            pen   = item.pen()
            pen.setColor(color)
            item.setPen(pen)

        no_wrong    = all(group_ok.values()) if group_ok else False
        all_present = all_groups_present(self.raw_groups)   # ← updated
        return no_wrong and all_present

    def reset(self):
        for item in self.paths.values():
            self.scene.removeItem(item)
        self.paths.clear()
        self.edges.clear()
        self.edge_group.clear()
        self.raw_groups.clear()


# ── MainWindow ────────────────────────────────────────────────────────────────

class MainWindow(QMainWindow):

    def __init__(self):
        super().__init__()
        self.setWindowTitle("Power Converter Digital Twin")
        self.resize(1400, 900)

        self.serial         = None
        self.freeze_wires   = False
        self.admin_approved = False
        self.serial_buffer  = ""

        central = QWidget()
        self.setCentralWidget(central)
        layout  = QVBoxLayout(central)

        top = QHBoxLayout()
        self.evalBtn  = QPushButton("Evaluate")
        self.resetBtn = QPushButton("Reset")
        top.addWidget(self.evalBtn)
        top.addWidget(self.resetBtn)
        layout.addLayout(top)

        self.view  = ZoomView()
        self.scene = QGraphicsScene()
        self.view.setScene(self.scene)
        layout.addWidget(self.view)

        self.board_pixmap = QPixmap(BOARD_IMAGE)
        self.scene.addPixmap(self.board_pixmap)

        self.sockets = {}
        self.loadSockets()

        self.wires = WireManager(self.scene, self.sockets)

        self.motor = None
        self.createMotorOverlay()

        self.motorTimer = QTimer()
        self.motorTimer.timeout.connect(self.animateMotor)

        self.evalBtn.clicked.connect(self.evaluatePressed)
        self.resetBtn.clicked.connect(self.resetPressed)

        self.openSerial()

        self.serialTimer = QTimer()
        self.serialTimer.timeout.connect(self.readSerial)
        self.serialTimer.start(30)

        self.adminTimer = QTimer()
        self.adminTimer.timeout.connect(self.checkAdmin)

    def loadSockets(self):
        with open(JSON_PATH) as f:
            data = json.load(f)
        for node, pos in data.items():
            x, y = pos
            s = SocketItem(node, x, y)
            self.scene.addItem(s)
            self.sockets[node] = s

    def createMotorOverlay(self):
        motor_circle = make_motor_circle_from_board(self.board_pixmap)
        if motor_circle.isNull():
            return
        self.motor = RotatingMotorItem(motor_circle, MOTOR_CENTER_X, MOTOR_CENTER_Y)
        self.scene.addItem(self.motor)

    def animateMotor(self):
        if self.motor:
            self.motor.step()

    def startMotor(self):
        if self.motor:
            self.motor.start()
        self.motorTimer.start(40)

    def stopMotor(self):
        if self.motor:
            self.motor.stop()
        self.motorTimer.stop()

    def evaluatePressed(self):
        self.freeze_wires = True

        # 🔥 SEND TO ADMIN SERVER
        self.sendToServer()

        self.adminTimer.start(2000)

    def checkAdmin(self):
        try:
            r    = requests.get(CLOUD_URL + "/check", timeout=5)
            data = r.json()
            if data.get("approved"):
                self.adminTimer.stop()
                self.admin_approved = True

                circuit_ok = self.wires.recolor_after_admin()

                if circuit_ok:
                    QMessageBox.information(
                        self,
                        "Circuit Correct ✅",
                        "Full Wave Controlled Rectifier\n\n"
                        "All connections are correct!\nMotor starting…"
                    )
                    self.startMotor()
                else:
                    QMessageBox.warning(
                        self,
                        "Wrong Connection ❌",
                        "Incorrect wiring detected!\n\n"
                        "● Green wires = correct connection ✅\n"
                        "● Red wires   = wrong connection  ❌\n\n"
                        "Fix the red wires and press Reset to try again."
                    )
        except Exception as e:
            print("Admin check error:", e)

    def resetPressed(self):
        self.freeze_wires   = False
        self.admin_approved = False
        self.wires.reset()
        self.stopMotor()

    def sendToServer(self):
        try:
            payload = {
                "groups": [list(g) for g in self.wires.raw_groups],
                "connections": [list(e) for e in self.wires.edges],
            }

            print("📡 Sending to server:", payload)

            requests.post(
                CLOUD_URL + "/update",
                json=payload,
                timeout=5
            )

        except Exception as e:
            print("Send error:", e)

    def openSerial(self):
        try:
            self.serial = serial.Serial(SERIAL_PORT, BAUDRATE, timeout=0)
        except Exception as e:
            print("Serial error:", e)

    def readSerial(self):
        if not self.serial or self.freeze_wires:
            return
        try:
            # Read raw bytes and buffer them ourselves. With timeout=0
            # (non-blocking) PySerial's readline() can return a PARTIAL
            # line if it's called before the Arduino has finished sending
            # one -- that partial JSON is what was causing "Unterminated
            # string" / "Expecting ',' delimiter" errors on random nodes.
            # Buffering across calls and only parsing complete lines
            # (terminated by \n) fixes this regardless of which nodes
            # are wired.
            chunk = self.serial.read(self.serial.in_waiting)
            self.serial_buffer += chunk.decode(errors="ignore")

            while "\n" in self.serial_buffer:
                line, self.serial_buffer = self.serial_buffer.split("\n", 1)
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    # Incomplete/corrupted line slipped through -- skip
                    # it instead of crashing; the next line will be fine.
                    continue
                connections = data.get("connections", [])
                order       = data.get("order", {})
                groups      = data.get("groups", [])
                self.wires.update(connections, order, groups)
        except Exception as e:
            print("Serial read error:", e)


if __name__ == "__main__":
    app = QApplication(sys.argv)
    w   = MainWindow()
    w.showMaximized()
    sys.exit(app.exec())