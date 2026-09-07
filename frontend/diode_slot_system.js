// ======================================================================
// Diode Drag-and-Drop Placement System
// Mouse Innovations — Digital Twin Power Converter
//
// Adds a "Full Bridge Rectifier" board overlay and a toolbox with TWO
// diode orientation images (vertical A-top/K-bottom, and horizontal
// A-left/K-right) that the student drags into place ANYWHERE on the
// board (free placement — no fixed/pre-marked slot positions). Once
// placed, each diode can be rotated in 90° steps with its own rotate
// button. The student positions + orients each diode wherever they
// judge correct; the resulting layout is then submitted for staff
// review/approval.
//
// This file is fully self-contained (namespaced with a "dps" / "DPS"
// prefix) and only ADDS behaviour — it does not read from or modify any
// existing wiring/socket/hardware logic in experiment.js, assessment.js
// or app.js. The only external hooks it uses are:
//   - a state object passed in to initDiodePlacementSystem() (this module
//     adds a new `.diodePlacements` property to whatever object you pass —
//     `expState` on the practice Experiment page, `pcState` on the graded
//     Assessment page — so each page's diode placement stays independent)
//   - the existing `showExpToast(msg)` helper for on-screen feedback
// Nothing else in the project is touched.
// ======================================================================

(function () {

  // ---- the four diode components the student must place ------------------
  const DPS_DIODE_IDS = ["D1", "D2", "D3", "D4"];

  // ---- the two selectable orientation images (toolbox lets the student
  // pick whichever starting orientation matches what they intend to wire).
  // Path is relative to index.html, matching how every other board/asset
  // image is already referenced in this project (see assets/*.png).
  const DPS_ORIENTATIONS = {
    vertical:   { image: "assets/diode_component_vertical.png",   label: "Diode (A top / K bottom)" },
    horizontal: { image: "assets/diode_component_horizontal.png", label: "Diode (A left / K right)" },
  };

  // Keep placed diodes a little inside the board edge so they never end
  // up half-hidden behind the container's rounded corners/border.
  const DPS_EDGE_MARGIN_PCT = 4;

  let dpsBoardEl = null;
  let dpsToolboxItemsEl = null;
  let dpsStatusEl = null;
  let dpsMoveMode = false;
  let dpsDragCtx = null; // {diodeId, wasPlaced, orientation, rotation, sourceEl, ghost}
  let dpsState = null;   // the experiment-state object we attach diodePlacements to

  function dpsDiodeIconSVG(orientation) {
    const o = DPS_ORIENTATIONS[orientation] || DPS_ORIENTATIONS.vertical;
    return `<img src="${o.image}" alt="Diode component" draggable="false">`;
  }

  function dpsClamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  // ---- state -----------------------------------------------------------
  function dpsInitState() {
    dpsState.diodePlacements = {};
    DPS_DIODE_IDS.forEach((id) => {
      dpsState.diodePlacements[id] = { placed: false, x: null, y: null, orientation: null, rotation: 0 };
    });
  }

  // ---- entry point -------------------------------------------------------
  // containerId : id of the board-wrap element to overlay the drop area on
  //               (e.g. "exp-board-wrap" / "pc-board-wrap" — the existing
  //               element that already shows PC_BOARD_IMAGE). This module
  //               positions an absolutely-positioned overlay over it; it
  //               never touches the existing SVG/board markup inside.
  // toolboxId   : id of an empty <div> (placed anywhere in the page) that
  //               will hold the diode toolbox + status readout.
  // stateObj    : the experiment-state object to store diodePlacements on.
  //               Defaults to window.expState (practice Experiment page).
  //               Pass window.pcState when mounting on the graded
  //               Assessment page, so each page keeps its own diode state.
  window.initDiodePlacementSystem = function (containerId, toolboxId, stateObj) {
    const boardWrap = document.getElementById(containerId);
    const toolboxRoot = document.getElementById(toolboxId);
    if (!boardWrap || !toolboxRoot) return;

    dpsState = stateObj || window.expState;
    if (!dpsState) return; // no valid state object available yet

    dpsMoveMode = false;
    dpsDragCtx = null;
    dpsInitState();

    // Overlay sits directly on top of the existing board image/SVG,
    // matching its size exactly, without altering any of its markup.
    if (getComputedStyle(boardWrap).position === "static") {
      boardWrap.style.position = "relative";
    }
    let overlay = boardWrap.querySelector(":scope > #dps-board");
    if (overlay) overlay.remove();
    overlay = document.createElement("div");
    overlay.id = "dps-board";
    overlay.className = "dps-board-overlay";
    boardWrap.appendChild(overlay);
    dpsBoardEl = overlay;

    toolboxRoot.innerHTML = `
      <div class="dps-wrap">
        <div class="dps-title">🧩 Diode Placement</div>
        <div class="dps-subtitle">Drag either diode orientation anywhere onto the board, then use ⟳ to rotate it in place. Your layout will be submitted for staff review.</div>
        <div class="dps-toolbar">
          <button class="dps-btn" id="dps-move-btn-${containerId}" type="button">🔓 Move Mode: OFF</button>
          <button class="dps-btn dps-reset" id="dps-reset-btn-${containerId}" type="button">↺ Reset Placement</button>
        </div>
        <div class="dps-toolbox">
          <div class="dps-toolbox-title">Diode Toolbox</div>
          <div class="dps-toolbox-items" id="dps-toolbox-items-${containerId}"></div>
          <div class="dps-status" id="dps-status-${containerId}"></div>
        </div>
      </div>
    `;
    dpsToolboxItemsEl = document.getElementById(`dps-toolbox-items-${containerId}`);
    dpsStatusEl = document.getElementById(`dps-status-${containerId}`);

    DPS_DIODE_IDS.forEach((id) => {
      dpsCreateToolboxDiode(id, "vertical");
      dpsCreateToolboxDiode(id, "horizontal");
    });

    document.getElementById(`dps-move-btn-${containerId}`).onclick = () =>
      dpsToggleMoveMode(containerId);
    document.getElementById(`dps-reset-btn-${containerId}`).onclick = () =>
      window.initDiodePlacementSystem(containerId, toolboxId, dpsState);

    dpsUpdateStatus();
  };

  // ---- toolbox item (one per diodeId + orientation combo) ----------------
  // Once EITHER orientation of a given diodeId is placed, both of its
  // toolbox items are removed (a diode is only placed once).
  function dpsCreateToolboxDiode(diodeId, orientation) {
    const item = document.createElement("div");
    item.className = "dps-diode";
    item.dataset.diodeId = diodeId;
    item.dataset.orientation = orientation;
    item.title = DPS_ORIENTATIONS[orientation].label + " — " + diodeId;
    item.innerHTML = dpsDiodeIconSVG(orientation);
    item.addEventListener("pointerdown", (e) => dpsStartDrag(e, item, false, orientation, 0));
    dpsToolboxItemsEl.appendChild(item);
  }

  function dpsRemoveToolboxItemsFor(diodeId) {
    dpsToolboxItemsEl
      .querySelectorAll(`.dps-diode[data-diode-id="${diodeId}"]`)
      .forEach((el) => el.remove());
  }

  // ---- placed diode on the board (free position + rotation, no slot) -----
  function dpsCreatePlacedDiode(diodeId, xPct, yPct, orientation, rotation) {
    const el = document.createElement("div");
    el.className = "dps-diode dps-placed" + (dpsMoveMode ? " dps-movable" : "");
    el.dataset.diodeId = diodeId;
    el.dataset.orientation = orientation;
    el.dataset.rotation = rotation || 0;
    el.innerHTML = `
      ${dpsDiodeIconSVG(orientation)}
      <button class="dps-rotate-btn" type="button" title="Rotate 90°">⟳</button>
    `;
    dpsBoardEl.appendChild(el);
    dpsPositionDiode(el, xPct, yPct, orientation, rotation || 0);
    el.querySelector("img").addEventListener("pointerdown", (e) =>
      dpsStartDrag(e, el, true, el.dataset.orientation, Number(el.dataset.rotation))
    );
    el.querySelector(".dps-rotate-btn").addEventListener("pointerdown", (e) => e.stopPropagation());
    el.querySelector(".dps-rotate-btn").addEventListener("click", () => dpsRotateDiode(el));
    dpsUpdateDiodeTitle(el);
    return el;
  }

  function dpsUpdateDiodeTitle(el) {
    const o = DPS_ORIENTATIONS[el.dataset.orientation];
    el.title = o.label + " — " + el.dataset.diodeId + " — rotated " + el.dataset.rotation + "°" +
      (dpsMoveMode ? " (drag to reposition)" : "");
  }

  // ---- rotate a placed diode in fixed 90° steps ---------------------------
  function dpsRotateDiode(el) {
    const next = (Number(el.dataset.rotation) + 90) % 360;
    el.dataset.rotation = next;
    dpsApplyTransform(el);
    dpsUpdateDiodeTitle(el);
    const placement = dpsState.diodePlacements[el.dataset.diodeId];
    if (placement) placement.rotation = next;
    if (typeof showExpToast === "function") showExpToast(`⟳ Diode ${el.dataset.diodeId} rotated to ${next}°`);
  }

  function dpsApplyTransform(el) {
    el.style.transform = `translate(-50%, -50%) rotate(${el.dataset.rotation}deg)`;
  }

  // ---- place a diode element at an exact free x/y (percent of board) -----
  function dpsPositionDiode(el, xPct, yPct, orientation, rotation) {
    const x = dpsClamp(xPct, DPS_EDGE_MARGIN_PCT, 100 - DPS_EDGE_MARGIN_PCT);
    const y = dpsClamp(yPct, DPS_EDGE_MARGIN_PCT, 100 - DPS_EDGE_MARGIN_PCT);
    el.style.left = x + "%";
    el.style.top = y + "%";
    el.dataset.x = x;
    el.dataset.y = y;
    if (orientation) el.dataset.orientation = orientation;
    if (rotation !== undefined) el.dataset.rotation = rotation;
    dpsApplyTransform(el);
    dpsState.diodePlacements[el.dataset.diodeId] = {
      placed: true, x, y,
      orientation: el.dataset.orientation,
      rotation: Number(el.dataset.rotation),
    };
  }

  // ---- move mode toggle ---------------------------------------------------
  function dpsToggleMoveMode(containerId) {
    dpsMoveMode = !dpsMoveMode;
    const btn = document.getElementById(`dps-move-btn-${containerId}`);
    btn.textContent = dpsMoveMode ? "🔒 Move Mode: ON" : "🔓 Move Mode: OFF";
    btn.classList.toggle("dps-active", dpsMoveMode);
    dpsBoardEl.querySelectorAll(".dps-diode.dps-placed").forEach((el) => {
      el.classList.toggle("dps-movable", dpsMoveMode);
      dpsUpdateDiodeTitle(el);
    });
    if (typeof showExpToast === "function") {
      showExpToast(
        dpsMoveMode
          ? "🔓 Move Mode enabled — placed diodes can now be dragged anywhere on the board."
          : "🔒 Move Mode disabled — placements are locked."
      );
    }
  }

  // ---- drag lifecycle (pointer events = mouse + touch + pen) -------------
  function dpsStartDrag(e, el, wasPlaced, orientation, rotation) {
    if (wasPlaced && !dpsMoveMode) return; // placed diodes are locked outside Move Mode
    e.preventDefault();

    const diodeId = el.dataset.diodeId;
    const rect = el.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    const ghost = document.createElement("div");
    ghost.className = "dps-diode dps-ghost";
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    ghost.style.transform = `rotate(${rotation}deg)`;
    ghost.innerHTML = dpsDiodeIconSVG(orientation);
    document.body.appendChild(ghost);

    function moveGhost(clientX, clientY) {
      ghost.style.left = clientX - offsetX + "px";
      ghost.style.top = clientY - offsetY + "px";
    }
    moveGhost(e.clientX, e.clientY);

    el.classList.add("dps-dragging");
    el.style.opacity = "0.25";

    dpsDragCtx = { diodeId, wasPlaced, orientation, rotation, sourceEl: el, ghost };

    function onMove(ev) {
      moveGhost(ev.clientX, ev.clientY);
      dpsHighlightBoardUnder(ev.clientX, ev.clientY);
    }
    function onUp(ev) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dpsFinishDrag(ev.clientX, ev.clientY);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // ---- is a client point inside the board's drop area? -------------------
  function dpsPointToBoardPct(x, y) {
    const rect = dpsBoardEl.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    return {
      xPct: ((x - rect.left) / rect.width) * 100,
      yPct: ((y - rect.top) / rect.height) * 100,
    };
  }

  function dpsHighlightBoardUnder(x, y) {
    const inside = !!dpsPointToBoardPct(x, y);
    dpsBoardEl.classList.toggle("dps-board-over", inside);
    dpsBoardEl.classList.toggle("dps-board-reject", !inside);
  }

  function dpsClearBoardHighlight() {
    dpsBoardEl.classList.remove("dps-board-over", "dps-board-reject");
  }

  function dpsFinishDrag(x, y) {
    const ctx = dpsDragCtx;
    if (!ctx) return;
    dpsClearBoardHighlight();
    ctx.sourceEl.classList.remove("dps-dragging");
    ctx.sourceEl.style.opacity = "";
    ctx.ghost.remove();

    const pct = dpsPointToBoardPct(x, y);

    if (pct) {
      // Dropped anywhere on the board — free placement, no slot to match.
      if (ctx.wasPlaced) {
        // Repositioning an already-placed diode (Move Mode only). Keeps its
        // current orientation + rotation.
        dpsPositionDiode(ctx.sourceEl, pct.xPct, pct.yPct, ctx.orientation, ctx.rotation);
        if (typeof showExpToast === "function") showExpToast(`✅ Diode ${ctx.diodeId} moved`);
      } else {
        // Placing a new diode dragged from the toolbox (chosen orientation, 0° rotation).
        ctx.sourceEl.remove();
        dpsRemoveToolboxItemsFor(ctx.diodeId);
        dpsCreatePlacedDiode(ctx.diodeId, pct.xPct, pct.yPct, ctx.orientation, 0);
        if (typeof showExpToast === "function") showExpToast(`✅ Diode ${ctx.diodeId} placed on the board`);
      }
    } else if (ctx.wasPlaced) {
      // Dropped outside the board while in Move Mode -> unplace, back to toolbox
      // (both orientation choices reappear so the student can re-pick).
      dpsState.diodePlacements[ctx.diodeId] = { placed: false, x: null, y: null, orientation: null, rotation: 0 };
      ctx.sourceEl.remove();
      dpsCreateToolboxDiode(ctx.diodeId, "vertical");
      dpsCreateToolboxDiode(ctx.diodeId, "horizontal");
      if (typeof showExpToast === "function") showExpToast(`↩ Diode ${ctx.diodeId} returned to the toolbox`);
    }
    // else: dragged from toolbox and dropped outside the board -> item just
    // reappears in the toolbox (opacity was already restored above).

    dpsDragCtx = null;
    dpsUpdateStatus();
  }

  function dpsUpdateStatus() {
    const filled = Object.values(dpsState.diodePlacements).filter((s) => s.placed).length;
    dpsStatusEl.innerHTML =
      `Placed: <b>${filled}/4</b>` + (filled === 4 ? " — ✅ All diodes placed! Submit when ready." : "");
  }
})();
