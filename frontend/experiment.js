// ======================================
// EduNexus Experiment Trainer
// Mouse Innovations
// Training Mode (No Marks)
//
// Supports two ways to do the Power Converter wiring lab:
//   1) Manual Simulation — click sockets in the browser to place wires.
//   2) Live Hardware Kit  — connect the real trainer board over USB
//      (Web Serial) and wires are drawn automatically as the student
//      plugs jumpers in.
//
// The hardware protocol matches the Arduino firmware in
// hardware/sketch_jul02a.ino, which continuously scans the 34-node
// board and streams one JSON line per loop:
//   {"connections":[[a,b],...],"groups":[[n1,n2,...],...]}
// This is the exact same protocol previously read by the standalone
// desktop app hardware/trial3_desktop_twin.py (PySide6 + pyserial) —
// here it is read directly in the browser instead, so no desktop app
// install is required for students.
//
// The socket layout and "which sockets should be grouped together"
// answer key are NOT duplicated here — they are the same
// PC_SOCKETS / PC_GROUPS / pcIsGroupCorrect / pcAllGroupsPresent /
// pcWiresToGroups / pcGroupToEdges / PC_MOTOR / PC_BOARD_IMAGE /
// PC_BOARD_VIEWBOX already defined in assessment.js (loaded before
// this file), so both the graded Assessment and this ungraded
// practice Experiment always agree on what "correct" wiring means.
// ======================================


// =====================
// STATE
// =====================

let expState = {
  mode:"manual",              // "manual" | "hardware"
  wires:[],                   // manual mode: [ [nodeA, nodeB], ... ]
  rawGroups:[],                // hardware mode: [ Set(["1","2",...]), ... ] as reported live by the board
  selected:null,
  pendingNode:null,
  selectedWire:null,
  zoom:1,
  evaluated:false,
  serialPort:null,
  serialReader:null,
  serialConnected:false
};
window.expState = expState;

window.expRunning=false;


// reuse the exact same socket layout used by the graded assessment
const EXP_SOCKETS = PC_SOCKETS;




// =====================
// LOAD EXPERIMENT
// =====================

function loadPowerExperiment(){

expState = {
mode:"manual",
wires:[],
rawGroups:[],
selected:null,
pendingNode:null,
selectedWire:null,
zoom:1,
evaluated:false,
serialPort:null,
serialReader:null,
serialConnected:false
};
window.expState = expState;

let page =
document.getElementById(
"page-experiments"
);


const serialSupported = ("serial" in navigator);


page.innerHTML = `
  <div class="exp-header-banner">
    <div class="exp-title-group">
      <div class="exp-icon-gem" style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(239, 68, 68, 0.25)); border-color: rgba(245, 158, 11, 0.4); color: #f59e0b;">
        <i class="ti ti-bolt"></i>
      </div>
      <div>
        <div class="exp-badge">Virtual Laboratory · Interactive Digital Twin</div>
        <h1 class="exp-heading">Power Converter Training Kit</h1>
      </div>
    </div>
    <button class="btn btn-danger btn-sm" onclick="closeExperiment()">
      <i class="ti ti-x"></i> Close Experiment
    </button>
  </div>

  <div class="card exp-hero-card" style="min-height:80vh;">
    <div class="exp-desc-box">
      <p>
        Select experiment and practice the wiring. Use the real trainer kit over USB, or practice with the manual click-to-wire simulation — verified against the live nodal solver and answer key before graded assessment.
      </p>
    </div>

    <div class="exp-action-row" style="display:flex; gap:16px; align-items:center; flex-wrap:wrap; margin-bottom:20px;">
      <div id="expHwStatus" class="exp-hw-status-pill">
        <span class="hw-status-dot ${serialSupported ? 'hw-ready' : 'hw-warn'}"></span>
        <span class="hw-status-text">
          ${serialSupported
            ? "Hardware Kit: Not connected"
            : "Web Serial not supported — use Chrome or Edge"}
        </span>
      </div>

      <div class="exp-btn-group" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <button id="expHwConnectBtn" class="btn btn-primary" ${serialSupported ? "" : "disabled"} onclick="expConnectHardware()">
          <i class="ti ti-plug"></i> Connect Hardware Kit
        </button>
        <button id="expHwDisconnectBtn" class="btn btn-danger" style="display:none;" onclick="expDisconnectHardware()">
          <i class="ti ti-plug-off"></i> Disconnect Kit
        </button>
        <button class="btn" onclick="expUseManualMode()">
          <i class="ti ti-hand-click"></i> Use Manual Simulation
        </button>
        <div style="display:inline-flex; align-items:center; gap:8px;">
          <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">Circuit:</label>
          <select id="expSelect" class="form-input" style="width:230px; font-size:13px; padding:7px 12px;">
            <option>Half Wave Rectifier</option>
            <option>Full Wave Rectifier</option>
            <option>Bridge Rectifier</option>
            <option>Buck Converter</option>
            <option>Boost Converter</option>
            <option>Inverter</option>
          </select>
        </div>
      </div>
    </div>

    <div id="exp-full-area" class="board-viewport-container" style="position:relative; margin-top:15px;">
      <div id="exp-board-wrap" style="width:100%; height:540px; background:#080b14; border:1px solid var(--border-glass-bright); border-radius:18px; overflow:hidden; display:flex; justify-content:center; align-items:center; box-shadow: inset 0 2px 20px rgba(0,0,0,0.8);">
        <svg id="exp-svg" viewBox="${PC_BOARD_VIEWBOX}" style="width:100%; display:block; flex-shrink:0;">
          <image href="${PC_BOARD_IMAGE}" x="0" y="0" width="842" height="838"></image>
          <defs>
            <clipPath id="exp-motor-clip">
              <circle cx="${PC_MOTOR.cx}" cy="${PC_MOTOR.cy}" r="${PC_MOTOR.r}"/>
            </clipPath>
          </defs>
          <g clip-path="url(#exp-motor-clip)">
            <image id="exp-motor-spin" href="${PC_BOARD_IMAGE}" x="0" y="0" width="842" height="838" transform="rotate(0,${PC_MOTOR.cx},${PC_MOTOR.cy})"/>
          </g>
          <g id="exp-motor-direction" style="display:none" pointer-events="none">
            <circle cx="${PC_MOTOR.cx}" cy="${PC_MOTOR.cy}" r="${PC_MOTOR.r * 0.62}" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-dasharray="${2 * Math.PI * PC_MOTOR.r * 0.62 * 0.72} ${2 * Math.PI * PC_MOTOR.r * 0.62}" transform="rotate(-90,${PC_MOTOR.cx},${PC_MOTOR.cy})"/>
            <polygon fill="#ffffff" points="${PC_MOTOR.cx + PC_MOTOR.r * 0.62},${PC_MOTOR.cy - 9} ${PC_MOTOR.cx + PC_MOTOR.r * 0.62 + 11},${PC_MOTOR.cy} ${PC_MOTOR.cx + PC_MOTOR.r * 0.62},${PC_MOTOR.cy + 9}"/>
          </g>
          <g id="exp-wires"></g>
          <g id="exp-sockets"></g>
        </svg>
      </div>

      <div id="expBoardHint" style="font-size:11px; color:var(--text-tertiary); margin-top:8px; text-align:center;">
        <i class="ti ti-info-circle"></i> Click a socket, then click another socket to draw a wire. Click the same pair again to remove.
      </div>

      <!-- FLOATING CAELESTIA MANUAL TOOLS DOCK -->
      <div id="expManualTools" class="caelestia-dock" style="display:none; position:absolute; right:20px; top:20px; z-index:15;">
        <div class="dock-header"><i class="ti ti-grip-vertical"></i> <i class="ti ti-tools"></i> Tools</div>
        <button class="dock-action-btn" onclick="expUndoWire()" title="Undo last wire">
          <i class="ti ti-arrow-back-up"></i>
          <span>Undo</span>
        </button>
        <button class="dock-action-btn danger" onclick="expDeleteWire()" title="Delete selected wire">
          <i class="ti ti-trash"></i>
          <span>Delete</span>
        </button>
        <button class="dock-action-btn" onclick="expClearWiring()" title="Clear all wires">
          <i class="ti ti-clear-all"></i>
          <span>Clear</span>
        </button>
        <div class="dock-divider"></div>
        <button class="dock-action-btn icon-only" onclick="expZoomOut()" title="Zoom out">
          <i class="ti ti-minus"></i>
        </button>
        <button class="dock-action-btn icon-only" onclick="expZoomReset()" title="Reset zoom">
          <span style="font-size:10px; font-weight:700;">100%</span>
        </button>
        <button class="dock-action-btn icon-only" onclick="expZoomIn()" title="Zoom in">
          <i class="ti ti-plus"></i>
        </button>
        <div class="dock-divider"></div>
        <button class="dock-action-btn icon-only" onclick="expFullScreen()" title="Toggle Fullscreen">
          <i class="ti ti-maximize"></i>
        </button>
      </div>
    </div>

    <div id="expWireStatus" style="margin-top:16px;">
      <p class="empty-state">No connections yet. Click sockets to wire, or connect the hardware kit.</p>
    </div>

    <div id="diode-toolbox-root"></div>

    <div style="margin-top:20px; display:flex; align-items:center; gap:16px;">
      <button class="btn btn-success" onclick="runExperiment()" style="padding:10px 24px; font-size:14px; font-weight:700; box-shadow:0 0 20px rgba(16, 185, 129, 0.35);">
        <i class="ti ti-player-play"></i> Run Experiment
      </button>
    </div>

    <div id="expResult" style="margin-top:20px; font-weight:600;"></div>
  </div>
`;



window.expRunning=true;

window.expKitOpen=true;



drawExpSockets();

renderExpWires();

updateExpWireStatus();

expInitWheelZoom();

if(typeof initDiodePlacementSystem === "function"){
initDiodePlacementSystem("exp-board-wrap", "diode-toolbox-root", expState);
}

if (window.LiveCircuitSync) {
  window.LiveCircuitSync.startSession({
    kit_id: "power_converter",
    assignment_id: "practice_power_converter",
    assignment_title: "Power Converter Kit (Practice)",
    wires: [],
    mode: "manual",
  });
}
}




// =====================
// HARDWARE MODE  (Web Serial — reads the same JSON stream the Arduino
// kit firmware in hardware/sketch_jul02a.ino emits, one line per scan)
// =====================


async function expConnectHardware(){


if(!("serial" in navigator)){


showExpToast(
"❌ Use Chrome / Edge"
);


return;

}



try{


await releaseRelayPort();

let port =
await navigator.serial.requestPort();


await port.open({

baudRate:115200

});


expState.serialPort = port;
expState.serialConnected = true;
expState.mode = "hardware";
expState.evaluated = false;


let statusEl = document.getElementById("expHwStatus");
if(statusEl) statusEl.textContent = "🟢 Hardware Kit: Connected — live wiring data streaming from board";

let connectBtn = document.getElementById("expHwConnectBtn");
if(connectBtn) connectBtn.style.display = "none";

let disconnectBtn = document.getElementById("expHwDisconnectBtn");
if(disconnectBtn) disconnectBtn.style.display = "";

let hint = document.getElementById("expBoardHint");
if(hint) hint.textContent = "Live hardware mode — wires appear automatically as you plug jumpers into the board.";

document.getElementById("expManualTools").style.display = "none";


showExpToast(
"🟢 Hardware Kit Connected"
);


expReadSerialLoop(port);


}

catch(e){


showExpToast(
"⚠️ Hardware not selected"
);


}


}


async function expReadSerialLoop(port){

const dec = new TextDecoderStream();
// Keep a handle on the pipe's teardown promise — expDisconnectHardware()
// must await this before calling port.close(), otherwise close() can
// throw (port.readable still locked) and get silently swallowed, leaving
// the browser-level port stuck "open" for the next connect attempt.
expState.readableClosed = port.readable.pipeTo(dec.writable).catch(() => {});
const reader = dec.readable.getReader();
expState.serialReader = reader;

let buf = "";

try{

while(expState.serialConnected){

const { value, done } = await reader.read();
if(done) break;

buf += value;

let nl;
while((nl = buf.indexOf("\n")) >= 0){

const line = buf.slice(0, nl).trim();
buf = buf.slice(nl + 1);

if(line.startsWith("{")){
try{
const d = JSON.parse(line);
expOnHardwareGroups(d.groups || []);
} catch(e){
// partial/corrupted line from the serial buffer — skip it,
// the next complete line will be fine
}
}

}

}

} catch(e){

if(expState.serialConnected){
showExpToast("⚠️ Serial error: " + e.message);
}

} finally {
try{ reader.releaseLock(); } catch(e){}
}

}


function expOnHardwareGroups(groups){

if(expState.evaluated) return;

expState.rawGroups = groups.map(g => new Set(g.map(String)));

renderExpWires();
updateExpWireStatus();

}


async function expDisconnectHardware(){

expState.serialConnected = false;

try{ if(expState.serialReader) await expState.serialReader.cancel(); } catch(e){}
try{ if(expState.readableClosed) await expState.readableClosed; } catch(e){}
try{ if(expState.serialPort) await expState.serialPort.close(); } catch(e){}

expState.serialPort = null;
expState.serialReader = null;
expState.readableClosed = null;

let statusEl = document.getElementById("expHwStatus");
if(statusEl) statusEl.textContent = "🔌 Hardware Kit: Not connected";

let connectBtn = document.getElementById("expHwConnectBtn");
if(connectBtn) connectBtn.style.display = "";

let disconnectBtn = document.getElementById("expHwDisconnectBtn");
if(disconnectBtn) disconnectBtn.style.display = "none";

showExpToast("🔌 Hardware Kit Disconnected");

}




// =====================
// MANUAL MODE
// =====================


function expUseManualMode(){


expDisconnectHardware();

expState.mode="manual";



document
.getElementById(
"expManualTools"
)
.style.display="flex";
makeElementDraggable(document.getElementById("expManualTools"));


let hint = document.getElementById("expBoardHint");
if(hint) hint.textContent = "Click a socket, then click another socket to draw a wire. Click the same pair again to remove.";


showExpToast(
"🖱️ Manual Simulation Activated"
);


}





// =====================
// SOCKET DRAW
// =====================


function drawExpSockets(){


let g =
document.getElementById(
"exp-sockets"
);



if(!g)return;



g.innerHTML =
Object.entries(EXP_SOCKETS)
.map(([id,p])=>`


<g class="exp-socket" data-node="${id}" onclick="expSocketClick('${id}')"
style="cursor:pointer">


<circle
cx="${p[0]}"
cy="${p[1]}"
r="13"
fill="black"
stroke="red"
stroke-width="3">
</circle>



<text
x="${p[0]+15}"
y="${p[1]-10}"
fill="#39ff6a"
font-size="12">

${id}

</text>



</g>


`).join("");



}




// =====================
// CURRENT WIRING (as connection groups)
// =====================

function expCurrentGroups(){
return expState.mode === "hardware" ? expState.rawGroups : pcWiresToGroups(expState.wires);
}


// =====================
// WIRE CREATE (manual mode only)
// =====================


function expSocketClick(id){


if(expState.mode !== "manual"){
showExpToast("Switch to manual simulation first.");
return;
}

if(expState.evaluated) return;


if(expState.pendingNode===null){


expState.pendingNode=id;
expHighlightSocket(id,true);

return;


}



if(expState.pendingNode===id){


expHighlightSocket(id,false);
expState.pendingNode=null;

return;


}


let a = expState.pendingNode, b = id;

let idx = expState.wires.findIndex(([x,y]) => (x===a&&y===b)||(x===b&&y===a));

if(idx>=0){
expState.wires.splice(idx,1);
} else {
expState.wires.push([a,b]);
}


expHighlightSocket(a,false);
expState.pendingNode=null;


renderExpWires();
updateExpWireStatus();


}


function expHighlightSocket(nodeId, on){
let el = document.querySelector(`.exp-socket[data-node="${nodeId}"] circle`);
if(el) el.setAttribute("stroke", on ? "#39FF6A" : "red");
}








function renderExpWires(){


let g =
document.getElementById(
"exp-wires"
);


if(!g)return;


const groups = expCurrentGroups();
const groupCorrect = expState.evaluated ? groups.map(pcIsGroupCorrect) : null;

const edges = [];
groups.forEach((grp, gi) => {
pcGroupToEdges(grp).forEach(e => edges.push({ e, gi }));
});


g.innerHTML =
edges.map(({e:[a,b], gi}, i)=>{


if(!EXP_SOCKETS[a] || !EXP_SOCKETS[b]) return "";

let sa = EXP_SOCKETS[a];
let sb = EXP_SOCKETS[b];

let cx = (sa[0]+sb[0])/2;

const color = groupCorrect ? (groupCorrect[gi] ? "#1fbf5c" : "#ff2d2d") : "#ff2d2d";


return `

<path

onclick="expSelectWire(${i})"

d="M${sa[0]},${sa[1]} C${cx},${sa[1]} ${cx},${sb[1]} ${sb[0]},${sb[1]}"

stroke="${color}"

stroke-width="8"

fill="none"

stroke-linecap="round"

style="
cursor:pointer;
pointer-events:stroke;
"

/>

`;


}).join("");

if(typeof window.triggerDebouncedCircuitGuidance === "function"){
  window.triggerDebouncedCircuitGuidance();
}

window.expState = expState;
if (window.LiveCircuitSync) {
  window.LiveCircuitSync.updateCircuit({
    kit_id: "power_converter",
    assignment_id: "practice_power_converter",
    assignment_title: "Power Converter Kit (Practice)",
    wires: expState ? (expState.wires || []) : [],
    mode: (expState && expState.mode) || "manual",
  });
}
}


function updateExpWireStatus(){

const el = document.getElementById("expWireStatus");
if(!el) return;

const groups = expCurrentGroups();

if(groups.length === 0){
el.innerHTML = `<p class="empty-state">${expState.mode === "hardware" ? "Waiting for hardware…" : "No connections yet. Click sockets to wire."}</p>`;
return;
}

el.innerHTML = `
<div style="font-size:11px;color:#64748b;margin-bottom:8px">${groups.length} connection group(s) detected</div>
${groups.map(g => {
const nodes = [...g].sort((a,b) => Number(a)-Number(b));
const vlabel = pcGetVoltageLabel(g);
const correct = expState.evaluated ? pcIsGroupCorrect(g) : null;
const cls = expState.evaluated ? (correct ? "pc-grp-ok" : "pc-grp-bad") : "pc-grp-pending";
return `<div class="pc-group-chip ${cls}">
${nodes.join(" – ")}
${vlabel ? `<span class="pc-volt-badge">${vlabel}</span>` : ""}
</div>`;
}).join("")}`;

}




// =====================
// SELECT DELETE UNDO CLEAR  (manual mode only)
// =====================


function expSelectWire(i){

if(expState.mode !== "manual") return;

expState.selectedWire=i;

showExpToast(
"🔴 Wire Selected"
);


}




function expDeleteWire(){



if(expState.selectedWire===null){


showExpToast(
"Select wire first"
);


return;

}


// selectedWire indexes into the flattened edge list, which is derived
// from expState.wires; simplest safe behaviour is to drop the manual
// wire pair that produced that edge. Since edges are rebuilt from
// wires every render, just remove by matching index into wires when
// counts line up 1:1 (true for the simple pair case used here).
if(expState.wires[expState.selectedWire] !== undefined){
expState.wires.splice(expState.selectedWire, 1);
}


expState.selectedWire=null;



renderExpWires();
updateExpWireStatus();



}





function expUndoWire(){



expState.wires.pop();



renderExpWires();
updateExpWireStatus();



}


function expClearWiring(){

expState.wires = [];
expState.rawGroups = [];
expState.selectedWire = null;
expState.pendingNode = null;
expState.evaluated = false;

expStopMotor();

renderExpWires();
updateExpWireStatus();

let resultEl = document.getElementById("expResult");
if(resultEl) resultEl.innerHTML = "";

}







// =====================
// ZOOM
// =====================


function expZoomIn(){

expState.zoom =
Math.min(
3,
expState.zoom+0.25
);

updateExpZoom();

}



function expZoomOut(){

expState.zoom =
Math.max(
0.5,
expState.zoom-0.25
);

updateExpZoom();

}



function expZoomReset(){


expState.zoom=1;


updateExpZoom();


}




function updateExpZoom(){


let svg =
document.getElementById(
"exp-svg"
);


let wrap =
document.getElementById(
"exp-board-wrap"
);


if(!svg || !wrap){

return;

}

// Keep width AND height scaling together (using the board's real
// aspect ratio from its viewBox) so zooming never distorts into a
// wide/short box that only needs left-right scrolling — this was the
// bug in fullscreen, where only width was resized.
let vb =
(svg.getAttribute("viewBox") || PC_BOARD_VIEWBOX)
.split(/\s+/)
.map(Number);

let aspect = vb[3] / vb[2];

let w = wrap.clientWidth * expState.zoom;

svg.style.width = w + "px";
svg.style.height = (w * aspect) + "px";

}


// Mouse-wheel zoom: scroll over the board to zoom in/out, zooming
// toward the cursor position instead of the top-left corner. Works
// in both the embedded card and the fullscreen view since the wrap
// element (and this listener) simply moves between the two.
function expInitWheelZoom(){

let wrap = document.getElementById("exp-board-wrap");
if(!wrap || wrap.dataset.wheelZoomBound) return;
wrap.dataset.wheelZoomBound = "1";

wrap.addEventListener("wheel", function(e){

e.preventDefault();

let rect = wrap.getBoundingClientRect();
let pointerX = e.clientX - rect.left + wrap.scrollLeft;
let pointerY = e.clientY - rect.top + wrap.scrollTop;

let oldZoom = expState.zoom;
let step = e.deltaY < 0 ? 0.1 : -0.1;
let newZoom = Math.min(3, Math.max(0.5, oldZoom + step));

if(newZoom === oldZoom) return;

expState.zoom = newZoom;
updateExpZoom();

let ratio = newZoom / oldZoom;
wrap.scrollLeft = pointerX * ratio - (e.clientX - rect.left);
wrap.scrollTop = pointerY * ratio - (e.clientY - rect.top);

}, { passive:false });

}

// =====================
// FULL SCREEN
// =====================


function expFullScreen(){


let board =
document.getElementById("exp-board-wrap");


if(!board)return;

let box =
document.createElement("div");


box.id="exp-fullscreen";


box.innerHTML=`

<div style="
position:fixed;
inset:0;
background:#111;
z-index:999999;
display:flex;
flex-direction:column;
">


<div style="
height:55px;
background:#0b0b0b;
display:flex;
justify-content:center;
align-items:center;
gap:12px;
padding:8px;
">

<button 
style="
color:white;
background:#111;
border:1px solid white;
padding:10px 20px;
border-radius:8px;
"
onclick="expUndoWire()">

↩ Undo Wire

</button>


<button
style="
color:white;
background:#111;
border:1px solid white;
padding:10px 20px;
border-radius:8px;
"
onclick="expDeleteWire()">

🗑 Delete Selected

</button>


<button
style="
color:white;
background:#111;
border:1px solid white;
padding:10px 20px;
border-radius:8px;
"
onclick="expZoomOut()">

-

</button>


<button
style="
color:white;
background:#111;
border:1px solid white;
padding:10px 20px;
border-radius:8px;
"
onclick="expZoomReset()">

100%

</button>


<button
style="
color:white;
background:#111;
border:1px solid white;
padding:10px 20px;
border-radius:8px;
"
onclick="expZoomIn()">

+

</button>

<button class="btn btn-primary" onclick="expCloseFullscreen()">
Exit Fullscreen
</button>


</div>


<div id="exp-real-full"
style="
flex:1;
display:flex;
justify-content:center;
align-items:center;
overflow:auto;
background:#111;
">

</div>


</div>

`;


document.body.appendChild(box);


document
.getElementById("exp-real-full")
.appendChild(board);


// Let the board wrap fill the fullscreen viewport (instead of staying
// pinned to the small embedded-card height), then size the SVG off of
// that using the normal zoom logic so width/height always scale
// together — this is what makes the +/- buttons (and the wheel) zoom
// properly instead of only stretching sideways.
board.style.height = "100%";
board.style.width = "100%";

updateExpZoom();

expInitWheelZoom();


}





function expCloseFullscreen(){


let normal =
document.getElementById("exp-full-area");


let board =
document.getElementById("exp-board-wrap");


if(normal && board){

normal.prepend(board);

board.style.height = "520px";
board.style.width = "100%";

}


let svg =
document.getElementById("exp-svg");


svg.style.height="";

svg.style.width="100%";

expState.zoom = 1;

updateExpZoom();


document
.getElementById("exp-fullscreen")
.remove();


}




// =====================
// MOTOR SPIN — same clipped-rotation technique as the Assessment
// digital twin board, driven purely by an SVG rotate() transform.
// =====================

let expMotorAngle = 0;
let expMotorRAF = null;

function expMotorTick(){
if(!expMotorRAF) return;
const el = document.getElementById("exp-motor-spin");
if(el){
expMotorAngle = (expMotorAngle + 3) % 360;
el.setAttribute("transform", `rotate(${expMotorAngle},${PC_MOTOR.cx},${PC_MOTOR.cy})`);
}
expMotorRAF = requestAnimationFrame(expMotorTick);
}

function expStartMotor(){
if(expMotorRAF) return;
expMotorRAF = requestAnimationFrame(expMotorTick);
const dir = document.getElementById("exp-motor-direction");
if(dir) dir.style.display = "";
}

function expStopMotor(){
if(expMotorRAF){
cancelAnimationFrame(expMotorRAF);
expMotorRAF = null;
}
expMotorAngle = 0;
const el = document.getElementById("exp-motor-spin");
if(el) el.setAttribute("transform", `rotate(0,${PC_MOTOR.cx},${PC_MOTOR.cy})`);
const dir = document.getElementById("exp-motor-direction");
if(dir) dir.style.display = "none";
}




// =====================
// RUN SIMULATION — checked instantly against the same answer key used
// ============================================================================
// DRAGGABLE TOOLBOX UTILITY
// ============================================================================

function makeElementDraggable(el, handleSelector = ".dock-header") {
  if (!el || el._isDraggableInitialized) return;
  el._isDraggableInitialized = true;

  const handle = handleSelector ? (el.querySelector(handleSelector) || el) : el;
  handle.style.cursor = "grab";
  handle.style.userSelect = "none";
  handle.title = "Click and drag to move toolbox";

  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;
  let isDragging = false;

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest("button") || e.target.closest("input")) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = el.getBoundingClientRect();
    const parentRect = (el.offsetParent || document.body).getBoundingClientRect();

    initialLeft = rect.left - parentRect.left + (el.offsetParent ? el.offsetParent.scrollLeft : 0);
    initialTop = rect.top - parentRect.top + (el.offsetParent ? el.offsetParent.scrollTop : 0);

    el.style.left = initialLeft + "px";
    el.style.top = initialTop + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";

    handle.style.cursor = "grabbing";
    el.classList.add("is-dragging");

    if (handle.setPointerCapture) {
      try { handle.setPointerCapture(e.pointerId); } catch(err) {}
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    e.preventDefault();

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;

    const parent = el.offsetParent || document.body;
    const maxLeft = parent.clientWidth - el.offsetWidth;
    const maxTop = parent.clientHeight - el.offsetHeight;

    newLeft = Math.max(8, Math.min(maxLeft - 8, newLeft));
    newTop = Math.max(8, Math.min(maxTop - 8, newTop));

    el.style.left = newLeft + "px";
    el.style.top = newTop + "px";
  }

  function onPointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    handle.style.cursor = "grab";
    el.classList.remove("is-dragging");

    if (handle.releasePointerCapture && e.pointerId) {
      try { handle.releasePointerCapture(e.pointerId); } catch(err) {}
    }

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  }

  handle.addEventListener("pointerdown", onPointerDown);
}

// Global state variablesd Assessment (PC_GROUPS / pcIsGroupCorrect /
// pcAllGroupsPresent). This is a self-check for practice: no faculty
// approval step, no score recorded — matches "Training Mode (No Marks)".
// =====================


async function runExperiment(){


let exp =
document.getElementById("expSelect").value;


const groups = expCurrentGroups();


let feedback="";


if(groups.length===0){


feedback = `

❌ No connection detected.<br><br>

AI Teacher:<br>

You have not connected any wires.

Steps:<br>

1️⃣ Identify input supply terminals<br>
2️⃣ Connect correct rectifier circuit<br>
3️⃣ Connect output/load side<br>
4️⃣ Verify polarity before running

`;

expState.evaluated = false;
expStopMotor();


}



else{


const groupCorrectFlags = groups.map(pcIsGroupCorrect);
const noWrong = groupCorrectFlags.every(Boolean);
const allPresent = pcAllGroupsPresent(groups);
const pass = noWrong && allPresent;
const correctCount = groupCorrectFlags.filter(Boolean).length;

expState.evaluated = true;


if(pass){

expStartMotor();

// Level 1 complete — if the physical board is connected (hardware mode),
// release the serial port automatically so the same board can be
// re-connected fresh for Level 2. Manual mode is untouched; if the
// student already disconnected it themself before this point, this is a no-op.
if(expState.mode === "hardware" && expState.serialConnected){
expDisconnectHardware();
showExpToast("✅ Level 1 complete — Hardware Kit auto-disconnected. Connect it again on Level 2.");
}

feedback = `

✅ Simulation Completed — Circuit Correct!<br><br>

Experiment: ${exp}

<br><br>

🤖 AI Teacher Feedback:

All ${groups.length} connection group(s) are wired correctly — motor is running.

Check points:

✔ Correct input connection<br>
✔ Proper device connection<br>
✔ Output waveform verification<br>

`;

} else {

expStopMotor();

feedback = `

⚠️ Simulation Run — Wiring Needs Correction<br><br>

Experiment: ${exp}

<br><br>

🤖 AI Teacher Feedback:

${correctCount}/${groups.length} connection group(s) are correct.
Green wires are correct ✅, red wires are wrong ❌.

Steps:<br>

1️⃣ Recheck the red-highlighted connections<br>
2️⃣ Make sure every rectifier bridge arm is wired to the right hub<br>
3️⃣ Re-run the experiment once fixed

`;

}


}



renderExpWires();
updateExpWireStatus();

if (window.LiveCircuitSync && window.expState) {
    window.LiveCircuitSync.updateCircuit({
      kit_id: "power_converter",
      assignment_id: "practice_power_converter",
      assignment_title: "Power Converter Kit (Practice)",
      wires: expState.wires || [],
      mode: expState.mode || "manual",
    });
}


document.getElementById("expResult").innerHTML = feedback;


// =====================
// AI Teacher Backend
// =====================

let aiResult = null;

try {

    const API_BASE = window.EDUNEXUS_API_BASE || "http://127.0.0.1:8123";

    // Each detected group is sent whole, as an array of node-id strings --
    // this matches what circuit_analyzer.py's analyze_connections expects
    // (one full group per entry, set-compared against the expected
    // variants), rather than splitting it into individual node pairs.
    const detectedConnections = groups.map(group => [...group].map(String));

    // Full AI Teacher pipeline: load_experiment -> analyze_connections ->
    // select mode -> build prompt -> Groq. This is the same backend path
    // as the chat panel, so wiring feedback and chat are one AI system,
    // both grounded in the experiment's knowledge base.
    const response = await fetch(API_BASE + "/api/ai-teacher", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            experiment_name: "bridge_rectifier",
            student_connections: detectedConnections,
            student_question: "Evaluate my current wiring and explain any mistakes.",
            mode: "experiment"
        })
    });

  aiResult = await response.json();

console.log("AI Result:", aiResult);

if (aiResult.status === "success" && aiResult.analysis) {

const summary = aiResult.analysis.summary || {};

document.getElementById("expResult").innerHTML += `

<hr>

<h3>🤖 AI Teacher Analysis</h3>

<b>Correct Connections:</b> ${summary.correct}<br>

<b>Missing Connections:</b> ${summary.missing}<br>

<b>Wrong Connections:</b> ${summary.wrong}<br>

`;

} else {

console.error("AI Teacher error:", aiResult.message || aiResult);

}

} catch (err) {

    console.error("AI Error:", err);

}

// SEND THE REAL AI TEACHER NARRATIVE TO THE CHAT PANEL TOO
// (falls back to the locally-computed `feedback` text if the backend
// call above failed)


let ai =
document.getElementById("aiMessages");


if(ai){


ai.innerHTML += `
<div class="ai-analysis-feedback-card">
<b>Experiment Analysis</b>
${
(aiResult && aiResult.status === "success" && aiResult.answer)
? aiResult.answer.replace(/\n/g, "<br>")
: feedback
}
</div>
`;


}



}


// =====================
// CLOSE
// =====================


function closeExperiment(){
  if (window.LiveCircuitSync) window.LiveCircuitSync.leaveSession();
  try { expDisconnectHardware(); } catch(e){}
  try { expStopMotor(); } catch(e){}
  window.expRunning = false;
  window.expKitOpen = false;
  window.rbExpRunning = false;

  let pop = document.getElementById("experimentExitPopup");
  if (pop) pop.remove();

  if (typeof renderExperimentHub === "function") {
    renderExperimentHub();
  }
  if (typeof goto === "function") {
    goto("experiments");
  }
  if (typeof updateAIVisibility === "function") {
    updateAIVisibility();
  }
}






// =====================
// TOAST
// =====================


function showExpToast(msg){



let old =
document.getElementById(
"expToast"
);



if(old){

old.remove();

}



let box =
document.createElement(
"div"
);



box.id="expToast";



box.innerHTML=msg;



box.style=`

position:fixed;

top:25px;

left:50%;

transform:translateX(-50%);

background:linear-gradient(135deg,#0B2545,#0E7C7B);

color:white;

padding:14px 30px;

border-radius:15px;

font-weight:700;

z-index:999999;

box-shadow:0 10px 30px #0005;

`;



document.body.appendChild(box);



setTimeout(()=>{


box.remove();


},2500);



}

// ============================================================================
// RESISTANCE BANK — Ungraded practice experiment (Training Mode, No Marks)
// Mirrors the Power Converter practice flow above, but checks wiring against
// RB_SOCKETS / RB_PAIRS / rbComputeRth / rbParseResistanceInput (defined in
// assessment.js, loaded before this file) — same exact nodal-analysis
// solver used in the graded Assessment, just ungraded/unlimited here.
// ============================================================================

let rbExpState = {
  mode: "manual", wires: [], rawGroups: [], selectedWire: null,
  zoom: 1, evaluated: false,
  serialPort: null, serialReader: null, serialConnected: false,
};
window.rbExpState = rbExpState;

window.rbExpRunning = false;

function loadResistanceBankExperiment() {

  rbExpState = {
    mode: "manual", wires: [], rawGroups: [], selectedWire: null,
    zoom: 1, evaluated: false,
    serialPort: null, serialReader: null, serialConnected: false,
  };
  window.rbExpState = rbExpState;

  let page = document.getElementById("page-experiments");
  const serialSupported = ("serial" in navigator);

  page.innerHTML = `
    <div class="exp-header-banner">
      <div class="exp-title-group">
        <div class="exp-icon-gem">
          <i class="ti ti-circuit-resistor"></i>
        </div>
        <div>
          <div class="exp-badge">Virtual Laboratory · Interactive Digital Twin</div>
          <h1 class="exp-heading">Resistance Bank Training Kit</h1>
        </div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="closeRbExperiment()">
        <i class="ti ti-x"></i> Close Experiment
      </button>
    </div>

    <div class="card exp-hero-card" style="min-height:80vh;">
      <div class="exp-desc-box">
        <p>
          Wire up any jumper network on the board (series, parallel, series-parallel — whatever you like), pick two measurement terminals, calculate the equivalent resistance (<strong>R<sub>th</sub></strong>) between them by hand, and check your answer instantly. Powered by an exact nodal Laplacian solver.
        </p>
      </div>

      <div class="exp-action-row">
        <div id="rbExpHwStatus" class="exp-hw-status-pill">
          <span class="hw-status-dot ${serialSupported ? 'hw-ready' : 'hw-warn'}"></span>
          <span class="hw-status-text">
            ${serialSupported
              ? "Hardware Kit: Not connected"
              : "Web Serial not supported — use Chrome or Edge"}
          </span>
        </div>

        <div class="exp-btn-group">
          <button id="rbExpHwConnectBtn" class="btn btn-primary" ${serialSupported ? "" : "disabled"} onclick="rbExpConnectHardware()">
            <i class="ti ti-plug"></i> Connect Hardware Kit
          </button>
          <button id="rbExpHwDisconnectBtn" class="btn btn-danger" style="display:none;" onclick="rbExpDisconnectHardware()">
            <i class="ti ti-plug-off"></i> Disconnect Kit
          </button>
          <button class="btn" onclick="rbExpUseManualMode()">
            <i class="ti ti-hand-click"></i> Use Manual Simulation
          </button>
        </div>
      </div>

      <div id="rb-exp-full-area" class="exp-board-bezel">
        <div id="rb-exp-board-wrap" style="width:100%;height:520px;background:#080c14;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:auto;display:flex;justify-content:center;align-items:center;box-shadow:inset 0 2px 20px rgba(0,0,0,0.8);">
          <svg id="rb-exp-svg" viewBox="${RB_BOARD_VIEWBOX}" style="width:100%;display:block;flex-shrink:0;">
            <image href="${RB_BOARD_IMAGE}" x="0" y="0" width="1438" height="1094"></image>
            <g id="rb-exp-wires"></g>
            <g id="rb-exp-sockets"></g>
          </svg>
        </div>

        <div id="rbExpBoardHint" style="font-size:11px;color:#94a3b8;margin-top:8px;text-align:center;">
          <i class="ti ti-info-circle"></i> Click a socket, then click another socket to draw a jumper. Click the same pair again to remove.
        </div>
      </div>

      <div id="rbExpManualTools" class="caelestia-dock" style="display:none;position:absolute;right:24px;top:120px;width:180px;z-index:10;">
        <div class="dock-header"><i class="ti ti-grip-vertical"></i> <i class="ti ti-tools"></i> Tools</div>
        <button class="btn dock-action-btn" onclick="rbExpUndoWire()"><i class="ti ti-arrow-back-up"></i> Undo Wire</button>
        <button class="btn btn-danger dock-action-btn" onclick="rbExpDeleteWire()"><i class="ti ti-trash"></i> Delete Selected</button>
        <button class="btn dock-action-btn" onclick="rbExpClearWiring()"><i class="ti ti-square-x"></i> Clear All</button>
        <div class="dock-divider"></div>
        <div style="display:flex;gap:4px;justify-content:center;">
          <button class="btn btn-sm" onclick="rbExpZoomOut()" title="Zoom Out"><i class="ti ti-minus"></i></button>
          <button class="btn btn-sm" onclick="rbExpZoomReset()" title="Reset Zoom">100%</button>
          <button class="btn btn-sm" onclick="rbExpZoomIn()" title="Zoom In"><i class="ti ti-plus"></i></button>
        </div>
        <button class="btn btn-primary dock-action-btn" style="margin-top:6px;" onclick="rbExpFullScreen()"><i class="ti ti-maximize"></i> Fullscreen</button>
      </div>

      <div id="rbExpWireStatus" style="margin-top:16px;">
        <p class="empty-state">No jumpers yet. Click sockets to wire, or connect the hardware kit.</p>
      </div>

      <div class="card exp-eval-card" style="margin-top:20px;">
        <div class="eval-card-header">
          <div class="eval-title-badge"><i class="ti ti-calculator"></i> Practical Evaluation</div>
          <div class="eval-mode-tag">Practice Mode · No Marks Recorded</div>
        </div>

        <div class="eval-grid">
          <div class="eval-field">
            <label class="eval-label">Measurement Terminal A</label>
            <div class="eval-input-wrap">
              <span class="eval-pin-dot pin-a">A</span>
              <input id="rbExpNodeA" type="text" placeholder="e.g. 9" class="form-input eval-node-input" oninput="if(window.renderRbExpWires)renderRbExpWires()">
            </div>
          </div>
          <div class="eval-field">
            <label class="eval-label">Measurement Terminal B</label>
            <div class="eval-input-wrap">
              <span class="eval-pin-dot pin-b">B</span>
              <input id="rbExpNodeB" type="text" placeholder="e.g. 17" class="form-input eval-node-input" oninput="if(window.renderRbExpWires)renderRbExpWires()">
            </div>
          </div>
          <div class="eval-field">
            <label class="eval-label">Allowed Tolerance</label>
            <select id="rbExpTolerance" class="form-input">
              <option value="1">±1% (Precision)</option>
              <option value="2">±2% (Standard)</option>
              <option value="5" selected>±5% (Normal)</option>
              <option value="10">±10% (Relaxed)</option>
            </select>
          </div>
        </div>

        <div class="eval-rth-row" style="margin-top:14px;">
          <label class="eval-label">Your Hand-Calculated Equivalent Resistance (R<sub>th</sub>)</label>
          <div style="display:flex;gap:12px;margin-top:6px;flex-wrap:wrap;">
            <input id="rbExpAnswer" type="text" placeholder="e.g. 104.5k, 1.045e5, 104500 Ω" class="form-input" style="flex:1;min-width:240px;" oninput="if(window.renderRbExpWires)renderRbExpWires()">
            <button class="btn btn-green" style="padding:10px 22px;" onclick="runRbExperiment()">
              <i class="ti ti-check"></i> Check Answer
            </button>
          </div>
        </div>

        <div id="rbExpResult" class="eval-result-wrap" style="margin-top:16px;"></div>
      </div>
    </div>
  `;

  window.rbExpRunning = true;
  window.rbExpKitOpen = true;

  drawRbExpSockets();
  renderRbExpWires();
  updateRbExpWireStatus();
  rbExpInitWheelZoom();
  makeElementDraggable(document.getElementById("rbExpManualTools"));

  if (window.LiveCircuitSync) {
    window.LiveCircuitSync.startSession({
      kit_id: "resistance_bank",
      assignment_id: "practice_resistance_bank",
      assignment_title: "Resistance Bank Trainer (Practice)",
      wires: [],
      mode: "manual",
    });
  }
}

// ---------- Hardware — reads {"connections":[[a,b],...]} lines ----------
async function rbExpConnectHardware() {
  if (!("serial" in navigator)) { showExpToast("❌ Use Chrome / Edge"); return; }
  try {
    await releaseRelayPort();
    let port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });

    rbExpState.serialPort = port;
    rbExpState.serialConnected = true;
    rbExpState.mode = "hardware";
    rbExpState.evaluated = false;

    let statusEl = document.getElementById("rbExpHwStatus");
    if (statusEl) statusEl.textContent = "🟢 Hardware Kit: Connected — live jumper data streaming from board";
    let connectBtn = document.getElementById("rbExpHwConnectBtn");
    if (connectBtn) connectBtn.style.display = "none";
    let disconnectBtn = document.getElementById("rbExpHwDisconnectBtn");
    if (disconnectBtn) disconnectBtn.style.display = "";
    let hint = document.getElementById("rbExpBoardHint");
    if (hint) hint.textContent = "Live hardware mode — wires appear automatically as you plug jumpers into the board.";
    document.getElementById("rbExpManualTools").style.display = "none";

    showExpToast("🟢 Hardware Kit Connected");
    rbExpReadSerialLoop(port);
  } catch (e) {
    showExpToast("⚠️ Hardware not selected");
  }
}

async function rbExpReadSerialLoop(port) {
  const dec = new TextDecoderStream();
  // Store the pipe teardown promise so rbExpDisconnectHardware() can await
  // it before closing the port (see expReadSerialLoop for why).
  rbExpState.readableClosed = port.readable.pipeTo(dec.writable).catch(() => {});
  const reader = dec.readable.getReader();
  rbExpState.serialReader = reader;
  let buf = "";
  try {
    while (rbExpState.serialConnected) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith("{")) {
          try {
            const d = JSON.parse(line);
            const pairs = (d.connections || []).map(([a,b]) => [String(a), String(b)]);
            rbExpOnHardwareConnections(pairs);
          } catch (e) {}
        }
      }
    }
  } catch (e) {
    if (rbExpState.serialConnected) showExpToast("⚠️ Serial error: " + e.message);
  } finally {
    try { reader.releaseLock(); } catch (e) {}
  }
}

function rbExpOnHardwareConnections(pairs) {
  if (rbExpState.evaluated) return;
  // rbComputeRth() reads rbExpState.wires (raw jumper pairs), not
  // rawGroups (which is only used for display grouping). This was never
  // set in hardware mode, so the solver always ran with zero jumpers
  // unioned regardless of the actual board wiring — see matching fix in
  // assessment.js:rbOnHardwareConnections for the full explanation.
  rbExpState.wires = pairs;
  rbExpState.rawGroups = pcWiresToGroups(pairs);
  renderRbExpWires();
  updateRbExpWireStatus();
}

async function rbExpDisconnectHardware() {
  rbExpState.serialConnected = false;
  try { if (rbExpState.serialReader) await rbExpState.serialReader.cancel(); } catch (e) {}
  try { if (rbExpState.readableClosed) await rbExpState.readableClosed; } catch (e) {}
  try { if (rbExpState.serialPort) await rbExpState.serialPort.close(); } catch (e) {}
  rbExpState.serialPort = null;
  rbExpState.serialReader = null;
  rbExpState.readableClosed = null;

  let statusEl = document.getElementById("rbExpHwStatus");
  if (statusEl) statusEl.textContent = "🔌 Hardware Kit: Not connected";
  let connectBtn = document.getElementById("rbExpHwConnectBtn");
  if (connectBtn) connectBtn.style.display = "";
  let disconnectBtn = document.getElementById("rbExpHwDisconnectBtn");
  if (disconnectBtn) disconnectBtn.style.display = "none";

  showExpToast("🔌 Hardware Kit Disconnected");
}

// ---------- Manual mode ----------
function rbExpUseManualMode() {
  rbExpDisconnectHardware();
  rbExpState.mode = "manual";
  document.getElementById("rbExpManualTools").style.display = "flex";
  makeElementDraggable(document.getElementById("rbExpManualTools"));
  let hint = document.getElementById("rbExpBoardHint");
  if (hint) hint.textContent = "Click a socket, then click another socket to draw a jumper. Click the same pair again to remove.";
  showExpToast("🖱️ Manual Simulation Activated");
}

function drawRbExpSockets() {
  let g = document.getElementById("rb-exp-sockets");
  if (!g) return;
  g.innerHTML = Object.entries(RB_SOCKETS).map(([id,p]) => `
    <g class="rb-exp-socket" data-node="${id}" onclick="rbExpSocketClick('${id}')" style="cursor:pointer">
      <circle cx="${p[0]}" cy="${p[1]}" r="13" fill="black" stroke="red" stroke-width="3"></circle>
      <text x="${p[0]+15}" y="${p[1]-10}" fill="#39ff6a" font-size="12">${id}</text>
    </g>`).join("");
}

function rbExpCurrentGroups() {
  return rbExpState.mode === "hardware" ? rbExpState.rawGroups : pcWiresToGroups(rbExpState.wires);
}

function rbExpSocketClick(id) {
  if (rbExpState.mode !== "manual") { showExpToast("Switch to manual simulation first."); return; }
  if (rbExpState.evaluated) return;

  if (rbExpState.pendingNode == null) {
    rbExpState.pendingNode = id;
    rbExpHighlightSocket(id, true);
    return;
  }
  if (rbExpState.pendingNode === id) {
    rbExpHighlightSocket(id, false);
    rbExpState.pendingNode = null;
    return;
  }

  let a = rbExpState.pendingNode, b = id;
  let idx = rbExpState.wires.findIndex(([x,y]) => (x===a&&y===b)||(x===b&&y===a));
  if (idx >= 0) rbExpState.wires.splice(idx, 1);
  else rbExpState.wires.push([a, b]);

  rbExpHighlightSocket(a, false);
  rbExpState.pendingNode = null;

  renderRbExpWires();
  updateRbExpWireStatus();
}

function rbExpHighlightSocket(nodeId, on) {
  let el = document.querySelector(`.rb-exp-socket[data-node="${nodeId}"] circle`);
  if (el) el.setAttribute("stroke", on ? "#39FF6A" : "red");
}

function renderRbExpWires() {
  let g = document.getElementById("rb-exp-wires");
  if (!g) return;
  const groups = rbExpCurrentGroups();
  const edges = [];
  groups.forEach((grp, gi) => { rbGroupToEdges(grp).forEach(e => edges.push({ e, gi })); });
  g.innerHTML = edges.map(({ e:[a,b] }) => {
    if (!RB_SOCKETS[a] || !RB_SOCKETS[b]) return "";
    const [x1,y1] = RB_SOCKETS[a], [x2,y2] = RB_SOCKETS[b];
    const cx = (x1+x2)/2;
    return `<path d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}" stroke="#3b82f6" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  }).join("");
  if (typeof window.triggerDebouncedCircuitGuidance === "function") {
    window.triggerDebouncedCircuitGuidance();
  }
  window.rbExpState = rbExpState;
  if (window.LiveCircuitSync) {
    window.LiveCircuitSync.updateCircuit({
      kit_id: "resistance_bank",
      assignment_id: "practice_resistance_bank",
      assignment_title: "Resistance Bank Trainer (Practice)",
      wires: (rbExpState && rbExpState.wires) ? rbExpState.wires : [],
      node_a: document.getElementById("rbExpNodeA")?.value || "",
      node_b: document.getElementById("rbExpNodeB")?.value || "",
      student_answer: document.getElementById("rbExpAnswer")?.value || "",
      mode: (rbExpState && rbExpState.mode) || "manual",
    });
  }
}

function updateRbExpWireStatus() {
  let el = document.getElementById("rbExpWireStatus");
  if (!el) return;
  const groups = rbExpCurrentGroups();
  if (groups.length === 0) {
    el.innerHTML = `<p class="empty-state">${rbExpState.mode === "hardware" ? "Waiting for hardware…" : "No jumpers yet. Click sockets to wire, or connect the hardware kit."}</p>`;
    return;
  }
  el.innerHTML = `
    <div style="font-size:11px;color:#64748b;margin-bottom:8px">${groups.length} jumper group(s) on the board</div>
    ${groups.map(g => {
      const nodes = [...g].sort((a,b) => Number(a)-Number(b));
      const label = rbGetPairLabel(g);
      return `<div class="pc-group-chip pc-grp-pending">${nodes.join(" – ")} ${label ? `<span class="pc-volt-badge">${label}</span>` : ""}</div>`;
    }).join("")}`;
}

function rbExpSelectWire(i) {
  if (rbExpState.mode !== "manual") return;
  rbExpState.selectedWire = i;
  showExpToast("🔴 Wire selected");
}
function rbExpDeleteWire() {
  if (rbExpState.selectedWire == null) { showExpToast("Select wire first"); return; }
  rbExpState.wires.splice(rbExpState.selectedWire, 1);
  rbExpState.selectedWire = null;
  renderRbExpWires();
  updateRbExpWireStatus();
}
function rbExpUndoWire() {
  rbExpState.wires.pop();
  renderRbExpWires();
  updateRbExpWireStatus();
}
function rbExpClearWiring() {
  rbExpState.wires = [];
  rbExpState.rawGroups = [];
  rbExpState.pendingNode = null;
  rbExpState.evaluated = false;
  renderRbExpWires();
  updateRbExpWireStatus();
  const result = document.getElementById("rbExpResult");
  if (result) result.innerHTML = "";
}

// ---------- Zoom ----------
function rbExpZoomIn() { rbExpState.zoom = Math.min(3, rbExpState.zoom + 0.25); updateRbExpZoom(); }
function rbExpZoomOut() { rbExpState.zoom = Math.max(0.5, rbExpState.zoom - 0.25); updateRbExpZoom(); }
function rbExpZoomReset() { rbExpState.zoom = 1; updateRbExpZoom(); }
function updateRbExpZoom() {
  let svg = document.getElementById("rb-exp-svg");
  let wrap = document.getElementById("rb-exp-board-wrap");
  if (!svg || !wrap) return;
  // Scale width AND height together (using the real board aspect ratio)
  // so zooming stays proportional instead of only growing sideways.
  let vb = (svg.getAttribute("viewBox") || RB_BOARD_VIEWBOX).split(/\s+/).map(Number);
  let aspect = vb[3] / vb[2];
  let w = wrap.clientWidth * rbExpState.zoom;
  svg.style.width = w + "px";
  svg.style.height = (w * aspect) + "px";
}

// Mouse-wheel zoom: scroll over the board to zoom in/out, zooming
// toward the cursor position. Bound once — keeps working after the
// wrap element is moved into the fullscreen view.
function rbExpInitWheelZoom() {
  let wrap = document.getElementById("rb-exp-board-wrap");
  if (!wrap || wrap.dataset.wheelZoomBound) return;
  wrap.dataset.wheelZoomBound = "1";

  wrap.addEventListener("wheel", function (e) {
    e.preventDefault();

    let rect = wrap.getBoundingClientRect();
    let pointerX = e.clientX - rect.left + wrap.scrollLeft;
    let pointerY = e.clientY - rect.top + wrap.scrollTop;

    let oldZoom = rbExpState.zoom;
    let step = e.deltaY < 0 ? 0.1 : -0.1;
    let newZoom = Math.min(3, Math.max(0.5, oldZoom + step));

    if (newZoom === oldZoom) return;

    rbExpState.zoom = newZoom;
    updateRbExpZoom();

    let ratio = newZoom / oldZoom;
    wrap.scrollLeft = pointerX * ratio - (e.clientX - rect.left);
    wrap.scrollTop = pointerY * ratio - (e.clientY - rect.top);
  }, { passive: false });
}

// ---------- Fullscreen ----------
function rbExpFullScreen() {
  let board = document.getElementById("rb-exp-board-wrap");
  if (!board) return;
  let box = document.createElement("div");
  box.id = "rb-exp-fullscreen";
  box.innerHTML = `
    <div style="position:fixed;inset:0;background:#111;z-index:999999;display:flex;flex-direction:column;">
      <div style="height:55px;background:#0b0b0b;display:flex;justify-content:center;align-items:center;gap:12px;padding:8px;">
        <button style="color:white;background:#111;border:1px solid white;padding:10px 20px;border-radius:8px;" onclick="rbExpUndoWire()">↩ Undo Wire</button>
        <button style="color:white;background:#111;border:1px solid white;padding:10px 20px;border-radius:8px;" onclick="rbExpDeleteWire()">🗑 Delete Selected</button>
        <button style="color:white;background:#111;border:1px solid white;padding:10px 20px;border-radius:8px;" onclick="rbExpZoomOut()">-</button>
        <button style="color:white;background:#111;border:1px solid white;padding:10px 20px;border-radius:8px;" onclick="rbExpZoomReset()">100%</button>
        <button style="color:white;background:#111;border:1px solid white;padding:10px 20px;border-radius:8px;" onclick="rbExpZoomIn()">+</button>
        <button class="btn btn-primary" onclick="rbExpCloseFullscreen()">Exit Fullscreen</button>
      </div>
      <div id="rb-exp-real-full" style="flex:1;display:flex;justify-content:center;align-items:center;overflow:auto;background:#111;"></div>
    </div>`;
  document.body.appendChild(box);
  document.getElementById("rb-exp-real-full").appendChild(board);

  // Let the board wrap fill the fullscreen viewport, then size the SVG
  // through the normal zoom logic so width/height scale together —
  // this is what makes +/- (and the mouse wheel) actually zoom instead
  // of only stretching/scrolling sideways.
  board.style.height = "100%";
  board.style.width = "100%";

  updateRbExpZoom();
  rbExpInitWheelZoom();
}

function rbExpCloseFullscreen() {
  let normal = document.getElementById("rb-exp-full-area");
  let board = document.getElementById("rb-exp-board-wrap");
  if (normal && board) {
    normal.prepend(board);
    board.style.height = "520px";
    board.style.width = "100%";
  }
  let svg = document.getElementById("rb-exp-svg");
  if (svg) { svg.style.height = ""; svg.style.width = "100%"; }
  rbExpState.zoom = 1;
  updateRbExpZoom();
  const fs = document.getElementById("rb-exp-fullscreen");
  if (fs) fs.remove();
}

// ---------- Check Answer (self-check, unlimited tries, no marks) ----------
function runRbExperiment() {
  const aText = (document.getElementById("rbExpNodeA")?.value || "").trim();
  const bText = (document.getElementById("rbExpNodeB")?.value || "").trim();
  const ansText = (document.getElementById("rbExpAnswer")?.value || "").trim();
  const tolerancePercent = parseFloat(document.getElementById("rbExpTolerance")?.value || "5");
  let feedback = "";

  if (!aText || !bText || !ansText) {
    feedback = `❌ Enter Node A, Node B, and your calculated answer first.`;
  } else if (!/^\d+$/.test(aText) || !/^\d+$/.test(bText) || !RB_SOCKETS[aText] || !RB_SOCKETS[bText]) {
    feedback = `❌ Node A and Node B must be socket numbers between 1 and 30.`;
  } else if (aText === bText) {
    feedback = `❌ Node A and Node B are the same socket (${escapeHtml(aText)}).`;
  } else {
    const studentAnswer = rbParseResistanceInput(ansText);
    if (studentAnswer === null || studentAnswer < 0) {
      feedback = `❌ Invalid resistance format. Try something like 104.5k, 1.045e5, or 104500 Ω.`;
    } else {
      const correctValue = rbComputeRth(rbExpState.wires, aText, bText);
      let isCorrect;
      if (correctValue === null) isCorrect = false;
      else if (correctValue === 0.0) isCorrect = studentAnswer === 0;
      else isCorrect = Math.abs(studentAnswer - correctValue) / correctValue * 100.0 <= tolerancePercent;

      rbExpState.evaluated = true;

      if (isCorrect) {
        // Level 2 complete — auto-release the board's serial port if it
        // was connected in hardware mode, same as Level 1, so it's free
        // for the next level/session without needing a manual disconnect.
        if (rbExpState.mode === "hardware" && rbExpState.serialConnected) {
          rbExpDisconnectHardware();
          showExpToast("✅ Level 2 complete — Hardware Kit auto-disconnected.");
        }
        feedback = `
✅ Correct Answer!<br><br>
🤖 AI Teacher Feedback:<br>
Your calculated Rth between Node ${escapeHtml(aText)} and Node ${escapeHtml(bText)} is within ±${tolerancePercent}% of the exact value.<br>
Check points:<br>
✔ Series resistors add directly<br>
✔ Parallel resistors combine via 1/Rth = Σ(1/Ri)<br>
✔ Series-parallel networks reduce step by step from the outermost branches inward<br>
`;
      } else {
        feedback = `
⚠️ Not quite — try again.<br><br>
🤖 AI Teacher Feedback:<br>
Your answer is outside ±${tolerancePercent}% of the correct Rth between Node ${escapeHtml(aText)} and Node ${escapeHtml(bText)}.<br>
Steps:<br>
1️⃣ Re-trace which resistors actually sit between your two chosen nodes once the jumpers are considered<br>
2️⃣ Reduce parallel branches first, then add series segments<br>
3️⃣ Watch for jumpers that short a resistor's own leads (that branch becomes 0Ω)<br>
4️⃣ Recalculate and try again — this practice mode has unlimited attempts<br>
`;
      }
    }
  }

  renderRbExpWires();
  updateRbExpWireStatus();
  document.getElementById("rbExpResult").innerHTML = feedback;

  let ai = document.getElementById("aiMessages");
  if (ai) {
    ai.innerHTML += `<div class="ai-analysis-feedback-card"><b>Experiment Analysis</b>${feedback}</div>`;
  }
}

function closeRbExperiment() {
  if (window.LiveCircuitSync) window.LiveCircuitSync.leaveSession();
  try { rbExpDisconnectHardware(); } catch(e){}
  window.expRunning = false;
  window.expKitOpen = false;
  window.rbExpRunning = false;

  let pop = document.getElementById("experimentExitPopup");
  if (pop) pop.remove();

  if (typeof renderExperimentHub === "function") {
    renderExperimentHub();
  }
  if (typeof goto === "function") {
    goto("experiments");
  }
  if (typeof updateAIVisibility === "function") {
    updateAIVisibility();
  }
}