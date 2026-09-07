// ============================================================================
// EduNexus — Smart Laboratory Assessment Center  (Enhanced v2)
// ============================================================================

// ---------- Cloud URL ----------
const PC_CLOUD_URL = "https://power-electronics-admin2-ijvp.onrender.com";

// ---------- Socket positions — recalibrated to native board image pixels (842x838) ----------
const PC_SOCKETS = {
  "1": [78.3,413.8],  "2": [79.9,266.0],  "3": [421.6,108.4], "4": [683.0,350.6], "5": [422.5,618.2],
  "6": [153.7,352.2], "7": [615.0,145.3], "8": [651.1,188.9], "9": [648.6,538.6], "10":[614.2,579.6],
  "11":[231.5,582.9], "12":[195.5,538.6], "13":[193.0,190.5], "14":[231.5,149.5], "15":[697.8,145.3],
  "16":[748.6,145.3], "17":[386.4,663.3], "18":[452.0,663.3], "19":[243.0,745.4], "20":[293.0,747.1],
  "21":[542.1,746.2], "22":[596.2,743.0], "23":[71.7,675.7],  "24":[147.1,675.7], "25":[71.7,739.7],
  "26":[150.4,738.9], "27":[709.3,642.0], "28":[707.6,588.6], "29":[710.9,539.4], "30":[366.7,310.3],
  "31":[474.9,309.5], "32":[366.7,421.2], "33":[473.3,422.8]
};
const PC_BOARD_IMAGE = 'assets/power_converter_board.png';
const PC_BOARD_VIEWBOX = '0 0 842 838';
const PC_HUB_NODES = new Set(["3","4","5","6","15","16"]);
window.PC_SOCKETS = PC_SOCKETS;
window.PC_BOARD_IMAGE = PC_BOARD_IMAGE;
window.PC_BOARD_VIEWBOX = PC_BOARD_VIEWBOX;

// ---------- Motor (blue gear) overlay — calibrated to the SAME 842x838 board-image
// space as PC_SOCKETS above, derived directly from the blue gear's pixel position on
// assets/power_converter_board.png (centroid of the blue pixels, scaled by the same
// 0.66826 image-fit factor used to place every other socket on this board). ----------
const PC_MOTOR = { cx: 418, cy: 739, r: 64 };

const PC_BASE_CHAINS = [
  ["23","2","3"], ["25","2","3"], ["24","1","5"], ["26","1","5"],
  ["6","17","19"], ["4","18","22"],
  ["15","30"], ["15","31"], ["15","30","31"],
  ["16","32"], ["16","33"], ["16","32","33"],
];

function pcGroupToEdges(group) {
  const nodes = [...group];
  if (nodes.length < 2) return [];
  const nodeSet = group;
  if (nodeSet.size === 2 && nodeSet.has('23') && nodeSet.has('24')) return [['23','24']];
  if (nodeSet.size === 2 && nodeSet.has('25') && nodeSet.has('26')) return [['25','26']];
  for (const chain of PC_BASE_CHAINS) {
    if (chain.length === nodeSet.size && chain.every(n => nodeSet.has(n))) {
      const edges = [];
      for (let i = 0; i < chain.length - 1; i++) edges.push([chain[i], chain[i+1]]);
      return edges;
    }
  }
  for (const chain of PC_BASE_CHAINS) {
    if (chain.every(n => nodeSet.has(n))) {
      const edges = [];
      for (let i = 0; i < chain.length - 1; i++) edges.push([chain[i], chain[i+1]]);
      const hub = chain.find(n => PC_HUB_NODES.has(n));
      nodes.forEach(n => { if (!chain.includes(n)) edges.push([hub, n]); });
      return edges;
    }
  }
  const hubIdx = nodes.findIndex(n => PC_HUB_NODES.has(n));
  const edges = [];
  if (hubIdx === -1) {
    for (let i = 0; i < nodes.length - 1; i++) edges.push([nodes[i], nodes[i+1]]);
    return edges;
  }
  for (let i = 0; i < hubIdx; i++) edges.push([nodes[i], nodes[i+1]]);
  const hub = nodes[hubIdx];
  for (let i = hubIdx + 1; i < nodes.length; i++) edges.push([hub, nodes[i]]);
  return edges;
}

const PC_VOLTAGE_9V  = new Set(["23","24"]);
const PC_VOLTAGE_12V = new Set(["25","26"]);

function pcSetEq(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
function pcGetVoltageLabel(group) {
  if (pcSetEq(group, PC_VOLTAGE_9V))  return '9V';
  if (pcSetEq(group, PC_VOLTAGE_12V)) return '12V';
  return null;
}

const PC_GROUPS = {
  g1: [["12","13","17","20","6"],["12","13","17","19","6"]],
  g2: [["18","21","4","8","9"], ["18","22","4","8","9"]],
  g3: [["14","2","23","3","7"], ["14","2","25","3","7"]],
  g4: [["1","10","11","24","5"],["1","10","11","26","5"]],
  g5: [["15","30"],["15","31"],["15","30","31"]],
  g6: [["16","32"],["16","33"],["16","32","33"]],
  g7: [["16","30"],["16","31"]],
  g8: [["15","32"],["15","33"]],
};
function toSets(arr) { return arr.map(a => new Set(a)); }
const PC_ALL_VARIANTS = [
  ...toSets(PC_GROUPS.g1), ...toSets(PC_GROUPS.g2),
  ...toSets(PC_GROUPS.g3), ...toSets(PC_GROUPS.g4),
  ...toSets(PC_GROUPS.g5), ...toSets(PC_GROUPS.g6),
  ...toSets(PC_GROUPS.g7), ...toSets(PC_GROUPS.g8),
  PC_VOLTAGE_9V, PC_VOLTAGE_12V,
];

// ---------- Full Wave Rectifier correct node groups (six exact groups) ----------
// Unlike PC_GROUPS (Bridge Rectifier), each Full Wave Rectifier group has a
// single exact variant -- no redundant-terminal alternates -- so a detected
// group must match the complete node set exactly (extra or missing nodes
// disqualify it), consistent with the existing pcSetEq comparison below.
// Nodes 30/31/32/33 are four electrically-redundant measurement terminal
// blocks on this trainer. In practice students wire node 15 (output +)
// and node 16 (output -) to any 1 or 2 of these four terminals, in any
// combination -- observed submissions have used every possible split.
// So g5 (node 15) and g6 (node 16) each accept every 1- or 2-node
// combination from {30,31,32,33}, mirroring the flexible redundant-
// terminal pattern already used by Bridge Rectifier's g5-g8.
const FW_MEAS_TERMINALS = ["30", "31", "32", "33"];
function fwMeasVariants(anchorNode) {
  const variants = [];
  FW_MEAS_TERMINALS.forEach(a => variants.push([anchorNode, a]));
  for (let i = 0; i < FW_MEAS_TERMINALS.length; i++) {
    for (let j = i + 1; j < FW_MEAS_TERMINALS.length; j++) {
      variants.push([anchorNode, FW_MEAS_TERMINALS[i], FW_MEAS_TERMINALS[j]]);
    }
  }
  return variants;
}
const FW_GROUPS = {
  g1: [["1","5","10","11","26"]],
  g2: [["2","3","7","14","25"]],
  g3: [["6","12","13","17","19"]],
  g4: [["4","8","9","18","22"]],
  g5: fwMeasVariants("15"),
  g6: fwMeasVariants("16"),
};
const FW_ALL_VARIANTS = [
  ...toSets(FW_GROUPS.g1), ...toSets(FW_GROUPS.g2),
  ...toSets(FW_GROUPS.g3), ...toSets(FW_GROUPS.g4),
  ...toSets(FW_GROUPS.g5), ...toSets(FW_GROUPS.g6),
];

// Returns the correct-groups answer key for whichever experiment is
// currently selected in #expSelect. Defaults to the original Bridge
// Rectifier key (PC_GROUPS / PC_ALL_VARIANTS) for every selection other
// than "Full Wave Rectifier", so existing behavior is unchanged.
function pcActiveAnswerKey() {
  const expSelect = document.getElementById("expSelect");
  if (expSelect && expSelect.value === "Full Wave Rectifier") {
    return { groups: FW_GROUPS, allVariants: FW_ALL_VARIANTS };
  }
  return { groups: PC_GROUPS, allVariants: PC_ALL_VARIANTS };
}

function pcIsGroupCorrect(group) {
  const { allVariants } = pcActiveAnswerKey();
  return allVariants.some(v => pcSetEq(v, group));
}
function pcAnyVariantPresent(rawGroups, variants) {
  return toSets(variants).some(v => rawGroups.some(rg => pcSetEq(rg, v)));
}
function pcAllGroupsPresent(rawGroups) {
  const { groups } = pcActiveAnswerKey();
  const has1 = pcAnyVariantPresent(rawGroups, groups.g1);
  const has2 = pcAnyVariantPresent(rawGroups, groups.g2);
  const has3 = pcAnyVariantPresent(rawGroups, groups.g3);
  const has4 = pcAnyVariantPresent(rawGroups, groups.g4);
  if (!(has1 && has2 && has3 && has4)) return false;

  if (groups.g7 && groups.g8) {
    // Bridge Rectifier: g5-g8 give two alternate ways to satisfy the
    // output-measurement requirement (multimeter pair OR CRO pair).
    const hubPresent = pcAnyVariantPresent(rawGroups, [
      ...groups.g5, ...groups.g6, ...groups.g7, ...groups.g8
    ]);
    if (hubPresent) {
      const scenarioA = pcAnyVariantPresent(rawGroups, groups.g5) && pcAnyVariantPresent(rawGroups, groups.g6);
      const scenarioB = pcAnyVariantPresent(rawGroups, groups.g7) && pcAnyVariantPresent(rawGroups, groups.g8);
      if (!(scenarioA || scenarioB)) return false;
    }
  } else {
    // Full Wave Rectifier (and any other future kit without g7/g8):
    // require g5 and g6 directly -- all six groups must be present.
    const has5 = pcAnyVariantPresent(rawGroups, groups.g5);
    const has6 = pcAnyVariantPresent(rawGroups, groups.g6);
    if (!(has5 && has6)) return false;
  }
  return true;
}

class UnionFind {
  constructor() { this.parent = {}; }
  find(x) {
    if (!(x in this.parent)) this.parent[x] = x;
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent[ra] = rb; }
}
function pcWiresToGroups(wires) {
  const uf = new UnionFind(), nodes = new Set();
  wires.forEach(([a,b]) => { uf.union(a,b); nodes.add(a); nodes.add(b); });
  const buckets = {};
  nodes.forEach(n => { const r = uf.find(n); (buckets[r] = buckets[r]||[]).push(n); });
  return Object.values(buckets).filter(a => a.length >= 2).map(a => new Set(a));
}

// Resistance Bank — Smart Laboratory Assessment (added alongside Power
// Converter above). Board has 15 fixed through-hole resistors; each
// resistor's two leads are one "socket pair" (RB_PAIRS below, with ohms).
//
// Grading model: the student wires ANY jumper network they like across the
// board (series, parallel, series-parallel, bridges...), picks two
// measurement terminals (Node A / Node B), and types in the equivalent
// resistance (Rth) they calculated by hand. This is checked against the
// EXACT value from a real nodal-circuit solve — Union-Find to collapse
// jumper-tied sockets into electrical nodes, then Gaussian elimination on
// the Laplacian (conductance) matrix — ported 1:1 from the reference
// desktop twin script (style.py: build_electrical_nodes / 
// build_resistor_graph_full / effective_resistance / gaussian_solve /
// parse_resistance_input). This is NOT a series/parallel heuristic — it
// handles any topology correctly, same as the original.
// ============================================================================
const RB_BOARD_IMAGE = 'assets/resistance_bank_board.png';
const RB_BOARD_VIEWBOX = '0 0 1438 1094';

// ============================================================================
// Automatic wiring image capture — Resistance Bank board only.
// Captures ONLY the board <svg> (background board image + resistor sockets +
// jumper wires), never the surrounding page/app UI. Used to snapshot the
// student's wiring at the moment they click Submit, for Level 1 and Level 2.
// Does not touch any calculation logic and does not alter any GUI element —
// it purely reads the existing #rb-svg / #l2-svg DOM and rasterizes it.
// ============================================================================
function _rbCaptureSvgElementAsPng(svgId) {
  return new Promise((resolve) => {
    try {
      const svgEl = document.getElementById(svgId);
      if (!svgEl) { resolve(null); return; }

      // Parse target pixel size from the viewBox so the capture is always
      // full-resolution and independent of the student's current zoom/scroll.
      const viewBox = (svgEl.getAttribute('viewBox') || RB_BOARD_VIEWBOX).split(/\s+/).map(Number);
      const width = viewBox[2] || 1438;
      const height = viewBox[3] || 1094;

      // Clone so we never touch the live DOM, and resolve the board <image>
      // href to an absolute URL (relative paths don't resolve once the SVG
      // is serialized into a standalone blob).
      const clone = svgEl.cloneNode(true);
      clone.setAttribute('width', String(width));
      clone.setAttribute('height', String(height));
      clone.removeAttribute('style');
      // Resolve against document.baseURI (the app's actual base), NOT
      // window.location.href — the latter reflects whatever route/hash the
      // student is currently on, so a relative asset path like
      // 'assets/resistance_bank_board.png' can resolve to the wrong URL
      // depending on navigation state, silently loading the wrong image
      // with no error surfaced (the outer <svg> still "loads" fine even if
      // the inner <image> href is bad).
      clone.querySelectorAll('image').forEach(img => {
        const href = img.getAttribute('href') || img.getAttribute('xlink:href');
        if (href) {
          const abs = new URL(href, document.baseURI).href;
          img.setAttribute('href', abs);
          img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', abs);
        }
      });

      const xml = new XMLSerializer().serializeToString(clone);
      const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          console.warn('Wiring image capture (draw) failed:', e.message);
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };
      img.onerror = () => {
        console.warn('Wiring image capture (load) failed.');
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    } catch (e) {
      console.warn('Wiring image capture failed:', e.message);
      resolve(null);
    }
  });
}

// Level 1 (Resistance Bank) board capture → level1_connection.png
function rbCaptureWiringImage() {
  return _rbCaptureSvgElementAsPng('rb-svg');
}

// Level 2 (Target Resistance Challenge) board capture → level2_connection.png
function l2CaptureWiringImage() {
  return _rbCaptureSvgElementAsPng('l2-svg');
}

// Native pixel positions from socket_positions_resistance_bank.json (1438x1094)
const RB_SOCKETS = {
  "1":[84,210],   "2":[87,381],   "3":[84,555],   "4":[298,735],  "5":[84,731],
  "6":[84,898],   "7":[300,210],  "8":[511,206],  "9":[303,557],  "10":[512,384],
  "11":[512,555], "12":[715,737], "13":[300,905], "14":[511,899], "15":[719,210],
  "16":[929,209], "17":[717,555], "18":[928,382], "19":[717,903], "20":[928,905],
  "21":[1148,210],"22":[1355,210],"23":[1145,499],"24":[1355,325],"25":[903,566],
  "26":[1102,758],"27":[1353,564],"28":[1355,732],"29":[1143,905],"30":[1352,905]
};
window.RB_SOCKETS = RB_SOCKETS;
window.RB_BOARD_IMAGE = "assets/resistance_bank_board.png";
window.RB_BOARD_VIEWBOX = "0 0 1438 1094";

// Fixed board resistors — socket pair, silkscreen label, ohms. Matches
// RESISTOR_TABLE in style.py exactly.
const RB_PAIRS = [
  ["1","2","1K",1000],   ["7","8","47R",47],    ["15","16","4K7",4700], ["21","22","3K3",3300],
  ["9","10","6K7",6700], ["17","18","70R",70],  ["23","24","68K",68000],["3","4","22R",22],
  ["11","12","680R",680],["25","26","100R",100],["27","28","33K",33000],["5","6","470R",470],
  ["13","14","2K2",2200],["19","20","680R",680],["29","30","100R",100],
];

function rbGetPairLabel(group) {
  // Informational only (labels a wire chip with the resistor it belongs
  // to, if any) — no longer used for correctness.
  const found = RB_PAIRS.find(([a,b]) => pcSetEq(new Set([a,b]), group));
  return found ? found[2] : null;
}
function rbGroupToEdges(group) {
  const nodes = [...group];
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) edges.push([nodes[i], nodes[i+1]]);
  return edges;
}

// ---------- Rth solver: Union-Find (jumper wires collapse sockets into
// electrical nodes) + full board resistor graph + exact nodal analysis ----------
function rbUfFind(parent, x) {
  if (!(x in parent)) parent[x] = x;
  while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
  return x;
}
function rbUfUnion(parent, a, b) {
  const ra = rbUfFind(parent, a), rb = rbUfFind(parent, b);
  if (ra !== rb) parent[ra] = rb;
}
function rbBuildElectricalNodes(wires) {
  const parent = {};
  wires.forEach(([a, b]) => { rbUfFind(parent, a); rbUfFind(parent, b); rbUfUnion(parent, a, b); });
  return parent;
}
function rbRootOf(parent, n) { return rbUfFind(parent, n); }
function rbBuildResistorGraphFull(parent) {
  // Every physical board resistor, mapped through the jumper Union-Find —
  // a valid measurement can rely on an un-jumpered resistor too.
  return RB_PAIRS.map(([a, b, , ohms]) => [rbRootOf(parent, a), rbRootOf(parent, b), ohms]);
}
function rbGaussianSolve(A, b) {
  // Pure Gaussian elimination with partial pivoting: A x = b.
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) continue;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r !== col && Math.abs(M[r][col]) > 1e-15) {
        const factor = M[r][col];
        for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
      }
    }
  }
  return M.map(row => row[n]);
}
function rbEffectiveResistance(edges, nodeA, nodeB) {
  // Exact two-terminal equivalent resistance: inject 1A at nodeA, ground
  // nodeB, solve for node voltages via the Laplacian (conductance) matrix.
  // Returns 0 (shorted), null (open circuit / no path), or ohms.
  if (nodeA === nodeB) return 0.0;
  const adj = {};
  edges.forEach(([u, v, ohms]) => {
    if (u === v || ohms <= 0) return;
    const g = 1.0 / ohms;
    adj[u] = adj[u] || {}; adj[u][v] = (adj[u][v] || 0) + g;
    adj[v] = adj[v] || {}; adj[v][u] = (adj[v][u] || 0) + g;
  });
  if (!(nodeA in adj) || !(nodeB in adj)) return null;
  const visited = new Set([nodeA]);
  const stack = [nodeA];
  while (stack.length) {
    const n = stack.pop();
    Object.keys(adj[n] || {}).forEach(nb => { if (!visited.has(nb)) { visited.add(nb); stack.push(nb); } });
  }
  if (!visited.has(nodeB)) return null;
  const nodeList = [...visited].sort();
  const index = {}; nodeList.forEach((n, i) => index[n] = i);
  const n = nodeList.length;
  const L = Array.from({ length: n }, () => Array(n).fill(0));
  nodeList.forEach(u => {
    Object.entries(adj[u] || {}).forEach(([v, g]) => {
      if (!(v in index)) return;
      const i = index[u], j = index[v];
      L[i][j] -= g; L[i][i] += g;
    });
  });
  const ia = index[nodeA], ib = index[nodeB];
  const keep = [...Array(n).keys()].filter(i => i !== ib);
  const size = keep.length;
  const Amat = keep.map(r => keep.map(c => L[r][c]));
  const bvec = Array(size).fill(0);
  const iaR = keep.indexOf(ia);
  bvec[iaR] = 1.0;
  const x = rbGaussianSolve(Amat, bvec);
  return x[iaR];
}
function rbComputeRth(wires, nodeASocket, nodeBSocket) {
  const parent = rbBuildElectricalNodes(wires);
  const edges = rbBuildResistorGraphFull(parent);
  const nodeA = rbRootOf(parent, nodeASocket);
  const nodeB = rbRootOf(parent, nodeBSocket);
  return rbEffectiveResistance(edges, nodeA, nodeB);
}

// ---------- Flexible resistance-input parser (ports parse_resistance_input) ----------
const RB_UNIT_MULT = {
  "": 1, "r": 1, "ohm": 1, "ohms": 1, "ω": 1,
  "k": 1e3, "kohm": 1e3, "kohms": 1e3, "kω": 1e3, "kilo": 1e3, "kiloohm": 1e3, "kiloohms": 1e3,
  "m": 1e6, "mohm": 1e6, "mohms": 1e6, "mω": 1e6, "mega": 1e6, "megaohm": 1e6, "megaohms": 1e6,
};
function rbParseResistanceInput(text) {
  if (text == null) return null;
  let s = String(text).trim();
  if (!s) return null;
  s = s.replace(/×/g, 'x').replace(/✕/g, 'x').replace(/∗/g, '*');
  s = s.replace(/,/g, '');
  s = s.replace(/\s+/g, ' ').trim();

  let m = s.match(/^([-+]?\d*\.?\d+)\s*[x\*]\s*10\s*\^\s*([-+]?\d+)\s*(ohms?|ohm|Ω)?$/i);
  if (m) {
    const mantissa = parseFloat(m[1]), exponent = parseInt(m[2], 10);
    if (isNaN(mantissa) || isNaN(exponent)) return null;
    return mantissa * Math.pow(10, exponent);
  }
  m = s.match(/^([-+]?\d*\.?\d+[eE][-+]?\d+)\s*(ohms?|ohm|Ω)?$/i);
  if (m) { const v = parseFloat(m[1]); return isNaN(v) ? null : v; }
  m = s.match(/^([-+]?\d*\.?\d+)\s*(kΩ|mΩ|kilo\s*ohms?|mega\s*ohms?|kohms?|mohms?|ohms?|Ω|k|m)?$/i);
  if (m) {
    const number = parseFloat(m[1]);
    const unit = (m[2] || '').toLowerCase().replace(/\s+/g, '');
    if (!(unit in RB_UNIT_MULT) || isNaN(number)) return null;
    return number * RB_UNIT_MULT[unit];
  }
  return null;
}
function rbFormatOhms(ohms) {
  if (ohms >= 1000) return (ohms / 1000).toString().replace(/\.0$/, '') + 'K';
  return ohms.toString().replace(/\.0$/, '') + 'R';
}

// Precise display formatting for the faculty review card — rounds to 6
// significant figures (kills nodal-solve floating-point noise like
// 68100.00000000172) and adds thousands separators, without ever needing
// more than a few decimal places, so the value fits its box on one line.
function rbDisplayOhms(v) {
  if (v == null || isNaN(v)) return null;
  const rounded = parseFloat(Number(v).toPrecision(6));
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

const RB_EXPERIMENT = {
  id: 'resistance_bank',
  name: 'Resistance Bank — Equivalent Resistance (Rth) Assessment',
  difficulty: 'Beginner',
  duration: '15–20 min',
  objective: 'Wire jumpers across the Resistance Bank board to build a resistor network, pick two measurement terminals (Node A / Node B), calculate the equivalent resistance (Rth) between them by hand, and enter your answer for auto-grading.',
  safety: [
    'This board is for continuity/measurement only — do not apply external voltage while jumpering.',
    'Do not force connectors into sockets; align them gently.',
    'Keep liquids away from the board and work in a dry, well-lit area.',
    'Handle jumper leads by the plug body, not the exposed metal tip.',
  ],
};

// ============================================================================
// Global modal — mounted on body, never inside page containers
// ============================================================================
function pcEnsureModal() {
  if (document.getElementById('pc-wiring-modal-overlay')) return;
  const div = document.createElement('div');
  div.id = 'pc-wiring-modal-overlay';
  div.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;overflow-y:auto;padding:30px 16px;box-sizing:border-box';
  div.addEventListener('click', e => {
    if (e.target === div) pcCloseModal();
  });
  div.innerHTML = `
    <div id="pc-wiring-modal" style="background:#fff;border-radius:14px;max-width:1100px;margin:0 auto;overflow:hidden;position:relative;box-shadow:0 25px 60px rgba(0,0,0,.35)">
      <div id="pc-wiring-modal-inner"></div>
    </div>`;
  document.body.appendChild(div);
}

function pcCloseModal() {
  const overlay = document.getElementById('pc-wiring-modal-overlay');
  if (overlay) overlay.style.display = 'none';
}

function pcOpenModal() {
  pcEnsureModal();
  document.getElementById('pc-wiring-modal-overlay').style.display = 'block';
}

// ============================================================================
// State
// ============================================================================
let pcState = null;

function pcResetState() {
  pcState = {
    wires: [],
    pendingNode: null,
    selectedWire: null,
    evaluated: false,
    groupResults: [], startedAt: Date.now(), timerHandle: null,
    elapsedSec: 0, mode: 'hardware', rawGroups: [],
    serialPort: null, serialReader: null, serialConnected: false,
    pendingGroups: null, pendingGroupFlags: null,
    pendingResult: null, adminPollHandle: null,
  };
  window.pcState = pcState;
}

const PC_EXPERIMENT = {
  id: 'power_converter',
  name: 'Power Converter Kit Assessment',
  difficulty: 'Intermediate',
  duration: '25–35 min',
  objective: 'Identify the correct socket groupings on the Power Converter trainer board and wire each rectifier bridge arm, the switching-pulse hubs, and the selected voltage source.',
  safety: [
    'Ensure the board is powered OFF before making or changing any connections.',
    'Double-check polarity before connecting the 9V / 12V source.',
    'Do not force connectors into sockets; align them gently.',
    'Keep liquids away from the board and work in a dry, well-lit area.',
    'If using real hardware, disconnect mains AC supply before touching the board.',
  ],
};

// ============================================================================
// Assessment Catalog Dashboard
// ============================================================================
const ASSESSMENT_CATALOG = [
  { category: 'Smart Lab Assessments', items: [
    { id: 'hw_verify',     name: 'Hardware Verification',          difficulty: 'Intermediate', duration: '15 min' },
    { id: 'digital_twin', name: 'Digital Twin Evaluation',         difficulty: 'Intermediate', duration: '20 min' },
    { id: 'rt_monitor',   name: 'Real-Time Monitoring Assessment',  difficulty: 'Advanced',     duration: '20 min' },
  ]},
];

async function renderAssessmentDashboard() {
  const root = document.getElementById('page-assessment');
  if (!root) return;
  const isStaff = currentUser && currentUser.role === 'staff';

  root.innerHTML = `
    <div style="background:linear-gradient(135deg,#0B2545,#0E7C7B);border-radius:14px;padding:26px 28px;margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:6px">Smart Laboratory Assessment Center</div>
          <div style="font-size:13px;color:rgba(255,255,255,.85);max-width:680px">Perform real-time practical assessments, digital twin experiments, and hardware-integrated evaluations.</div>
        </div>
        ${isStaff ? `
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button class="btn btn-sm" id="open-live-classroom-btn"
              style="background:linear-gradient(135deg,rgba(239,68,68,.3),rgba(245,158,11,.3));color:#fff;border:1px solid rgba(239,68,68,.5);font-weight:700;"
              onclick="goto('live-classroom');renderLiveClassroom()">
              🔴 Live Classroom Monitor
            </button>
            <button class="btn btn-sm" id="open-review-dash-btn"
              style="background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.35);font-weight:600"
              onclick="renderAdminReviewDashboard()">
              📋 Assessment Review Dashboard
            </button>
          </div>` : ''}
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Total completed</div><div class="stat-val" id="aa-total">—</div></div>
      <div class="stat-card"><div class="stat-label">Average score</div><div class="stat-val" id="aa-avg">—</div></div>
      <div class="stat-card"><div class="stat-label">Best score</div><div class="stat-val" id="aa-best">—</div></div>
      <div class="stat-card"><div class="stat-label">Pending review</div><div class="stat-val" id="aa-pending" style="color:#F59E0B">—</div></div>
    </div>

    <div class="card-title" style="margin:18px 0 10px;font-weight:700;font-size:14px;color:#0B2545">Power Electronics Lab</div>
    <div class="proj-grid">
      <div class="proj-card" style="border-left:4px solid #0E7C7B">
        <div class="proj-head">
          <div class="proj-ico" style="background:#E6FAF8">⚡</div>
          <div>
            <div class="proj-title">Power Converter Kit Assessment</div>
            <div class="proj-co">Intermediate · 25–35 min</div>
          </div>
        </div>
        <div class="proj-desc">Real-time wiring verification and hardware-integrated practical evaluation of a Power Converter trainer board.</div>
        <div class="proj-footer">
          <span class="diff diff-intermediate">Intermediate</span>
          <button class="btn btn-primary btn-sm" onclick="pcOpenCard()">Open</button>
        </div>
      </div>
      <div class="proj-card" style="border-left:4px solid #B45309">
        <div class="proj-head">
          <div class="proj-ico" style="background:#FFF7ED">🔶</div>
          <div>
            <div class="proj-title">Resistance Bank Assessment</div>
            <div class="proj-co">Beginner · 15–20 min</div>
          </div>
        </div>
        <div class="proj-desc">Identify all 15 resistors on the Resistance Bank trainer board and verify continuity by jumpering each resistor's terminal sockets.</div>
        <div class="proj-footer">
          <span class="diff diff-easy">Beginner</span>
          <button class="btn btn-primary btn-sm" onclick="renderRBOverview()">Open</button>
        </div>
      </div>
    </div>

    ${ASSESSMENT_CATALOG.map(cat => `
      <div class="card-title" style="margin:18px 0 10px;font-weight:700;font-size:14px;color:#0B2545">${cat.category}</div>
      <div class="proj-grid">
        ${cat.items.map(item => `
          <div class="proj-card" style="border-left:4px solid #CBD5E1">
            <div class="proj-head">
              <div class="proj-ico" style="background:#F1F5F9">🧪</div>
              <div>
                <div class="proj-title">${escapeHtml(item.name)}</div>
                <div class="proj-co">${item.difficulty} · ${item.duration}</div>
              </div>
            </div>
            <div class="proj-desc">Coming soon to the Smart Laboratory Assessment Center.</div>
            <div class="proj-footer">
              <span class="diff diff-${item.difficulty.toLowerCase()}">${item.difficulty}</span>
              <button class="btn btn-sm" disabled style="opacity:.5">Coming soon</button>
            </div>
          </div>`).join('')}
      </div>`).join('')}

    <div id="assess-recent-wrap" style="margin-top:22px"></div>
  `;

 loadAssessmentAnalytics();
  
  // ====== AI VISIBILITY CONTROL ======
  updateAIVisibility();
}

async function loadAssessmentAnalytics() {
  try {
    const a = await api('/assessments/analytics');
    const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    setEl('aa-total', a.total_completed);
    setEl('aa-avg',   a.average_score + '%');
    setEl('aa-best',  a.best_score + '%');
    const pending = a.recent.filter(r => r.faculty_approved === 'pending').length;
    setEl('aa-pending', pending || '0');

    const isStaff = currentUser && currentUser.role === 'staff';
    const wrap = document.getElementById('assess-recent-wrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="card">
        <div class="card-title">Recent Assessments</div>
        ${a.recent.length === 0 ? '<p class="empty-state">No assessments yet. Start one above!</p>' : `
        <div style="overflow-x:auto">
        <table class="students-table">
          <thead><tr><th>Student</th><th>Experiment</th><th>Score</th><th>Status</th><th>Attempt</th><th>Date</th><th>Faculty</th></tr></thead>
          <tbody>
            ${a.recent.map(r => `<tr>
              <td>${escapeHtml(r.student_name)}</td>
              <td style="font-size:11px">${escapeHtml(r.experiment_name)}</td>
              <td><b>${r.score}%</b></td>
              <td><span class="diff ${r.status==='PASS'?'diff-easy':'diff-advanced'}">${r.status}</span></td>
              <td>#${r.attempt_number}</td>
              <td style="color:#64748b;font-size:11px">${escapeHtml(r.date)}</td>
              <td>
                ${r.faculty_approved === 'approved'
                  ? '<span style="color:#22c55e;font-weight:600">✅ Approved</span>'
                  : r.faculty_approved === 'rejected'
                    ? '<span style="color:#ef4444;font-weight:600">❌ Rejected</span>'
                    : isStaff
                      ? `<button class="btn btn-sm btn-primary" style="font-size:11px" onclick="pcOpenReviewModal(${r.id})">🔍 Review</button>`
                      : '<span style="color:#F59E0B">⏳ Awaiting review</span>'
                }
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
        </div>`}
      </div>`;
  } catch (e) { /* non-fatal */ }
}

// ============================================================================
// Admin Review Dashboard — full page view
// ============================================================================
async function renderAdminReviewDashboard() {
  const root = document.getElementById('page-assessment');
  if (!root) return;

  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px">
      <div>
        <div style="font-size:18px;font-weight:700;color:#0B2545">📋 Assessment Review Dashboard</div>
        <div style="font-size:12px;color:#64748b;margin-top:3px">Review submitted wiring connections — Approve or Reject before result is released to student</div>
      </div>
      <button class="btn btn-sm" onclick="renderAssessmentDashboard()">← Back</button>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap" id="review-tabs">
      <button class="btn btn-primary btn-sm" id="rtab-pending"  onclick="loadReviewTab('pending')">⏳ Pending</button>
      <button class="btn btn-sm"             id="rtab-approved" onclick="loadReviewTab('approved')">✅ Approved</button>
      <button class="btn btn-sm"             id="rtab-rejected" onclick="loadReviewTab('rejected')">❌ Rejected</button>
      <button class="btn btn-sm"             id="rtab-all"      onclick="loadReviewTab('all')">📄 All</button>
      <button class="btn btn-sm"             id="rtab-audit"    onclick="loadAuditTrail()">🔍 Audit Trail</button>
      <button class="btn btn-sm"             id="rtab-live"     style="color:#ef4444;border-color:rgba(239,68,68,.4);" onclick="goto('live-classroom');renderLiveClassroom()">🔴 Live Lab Monitor</button>
    </div>

    <div id="review-content"><div class="empty-state">Loading…</div></div>
  `;

  loadReviewTab('pending');
}

async function loadReviewTab(filter) {
  // Highlight active tab
  ['pending','approved','rejected','all','audit'].forEach(t => {
    const el = document.getElementById('rtab-' + t);
    if (el) el.className = t === filter ? 'btn btn-primary btn-sm' : 'btn btn-sm';
  });

  const content = document.getElementById('review-content');
  if (!content) return;
  content.innerHTML = '<div class="empty-state">Loading…</div>';

  try {
    let rows;
    if (filter === 'all') {
      rows = await api('/assessments/all');
    } else if (filter === 'pending') {
      rows = await api('/assessments/pending');
    } else {
      const all = await api('/assessments/all');
      rows = all.filter(r => r.faculty_approved === filter);
    }
    rows = rows.map(r => ({ ...r, _kind: 'l1' }));

    // Pull Level 2 (Target Resistance Challenge) submissions into the SAME
    // review table/tabs so staff review everything in one place.
    let l2rows = [];
    try {
      if (filter === 'all') {
        l2rows = await api('/level2/results/all');
      } else if (filter === 'pending') {
        l2rows = await api('/level2/results/pending');
      } else {
        const l2all = await api('/level2/results/all');
        l2rows = l2all.filter(r => r.faculty_approved === filter);
      }
    } catch (e) { /* level2 optional */ }
    l2rows = l2rows.map(r => ({
      ...r, _kind: 'l2',
      experiment_name: 'Resistance Bank — Level 2 (Target Resistance)',
      score: r.result === 'PASS' ? 100 : 0,
      status: r.result,
      groups_correct: r.result === 'PASS' ? 1 : 0,
      groups_total: 1,
    }));

    rows = rows.concat(l2rows).sort((a, b) =>
      new Date(b.submission_time || 0) - new Date(a.submission_time || 0));

    if (rows.length === 0) {
      content.innerHTML = `<div class="card"><p class="empty-state">No ${filter} assessments.</p></div>`;
      return;
    }

    content.innerHTML = `
      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
        <table class="students-table" style="font-size:12px">
          <thead><tr>
            <th>Student</th><th>Experiment</th><th>Submitted</th>
            <th>Connection Method</th>
            <th>Score</th><th>Result</th><th>Groups</th>
            <th>Wiring</th><th>Reviewer</th><th>Action</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td><b>${escapeHtml(r.student_name)}</b></td>
              <td style="font-size:11px">${escapeHtml(r.experiment_name)}</td>
              <td style="color:#64748b;white-space:nowrap;font-size:11px">
                ${r.submission_time ? new Date(r.submission_time).toLocaleString() : r.date}
              </td>
              <td style="white-space:nowrap">
                <span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;${r.connection_method === 'Hardware Kit' ? 'background:#dbeafe;color:#1d4ed8' : 'background:#f1f5f9;color:#475569'}">
                  ${r.connection_method === 'Hardware Kit' ? '🔌 Hardware Kit' : '🖐️ Manual Connection'}
                </span>
              </td>
              <td><b>${r.score}%</b></td>
              <td><span class="diff ${r.status==='PASS'?'diff-easy':'diff-advanced'}">${r.status}</span></td>
              <td style="color:#64748b">${r.groups_correct}/${r.groups_total}</td>
              <td>
                <button class="btn btn-sm" onclick="${r._kind === 'l2' ? `l2OpenReviewModal(${r.id})` : `pcOpenReviewModal(${r.id})`}"
                  style="font-size:11px;white-space:nowrap">
                  🔍 View Wiring
                </button>
              </td>
              <td style="color:#64748b;font-size:11px">
                ${r.reviewer_name
                  ? `${escapeHtml(r.reviewer_name)}<br><span style="font-size:10px">${r.review_timestamp ? new Date(r.review_timestamp).toLocaleString() : ''}</span>`
                  : '—'}
              </td>
              <td>
                ${r.faculty_approved === 'pending'
                  ? `<div style="display:flex;gap:4px">
                      <button class="btn btn-sm" style="background:#22c55e;color:#fff;font-size:11px;padding:4px 8px" onclick="${r._kind === 'l2' ? `l2QuickAction(${r.id},'approved','${filter}')` : `pcQuickAction(${r.id},'approved','${filter}')`}">✅</button>
                      <button class="btn btn-sm" style="background:#ef4444;color:#fff;font-size:11px;padding:4px 8px" onclick="${r._kind === 'l2' ? `l2QuickAction(${r.id},'rejected','${filter}')` : `pcQuickAction(${r.id},'rejected','${filter}')`}">❌</button>
                    </div>`
                  : `<span style="color:${r.faculty_approved==='approved'?'#22c55e':'#ef4444'};font-weight:700;font-size:11px">
                      ${r.faculty_approved==='approved'?'✅ Approved':'❌ Rejected'}
                    </span>`
                }
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
        </div>
      </div>`;
  } catch (e) {
    content.innerHTML = `<div class="card"><p class="empty-state" style="color:#ef4444">Error: ${escapeHtml(e.message)}</p></div>`;
  }
}

async function l2QuickAction(resultId, action, currentFilter) {
  try {
    await api(`/level2/results/${resultId}/review`, { method: 'PUT', body: { action } });
    toast(action === 'approved' ? '✅ Level 2 approved — student will see result.' : '❌ Level 2 rejected.');
    loadReviewTab(currentFilter || 'pending');
  } catch (e) { toast('Error: ' + e.message); }
}

async function pcQuickAction(assessmentId, action, currentFilter) {
  try {
    await api(`/assessments/${assessmentId}/review`, { method: 'PUT', body: { action } });
    toast(action === 'approved' ? '✅ Assessment approved — student will see result.' : '❌ Assessment rejected.');
    // Open cloud URL in background after approval so staff can see
    if (action === 'approved') {
      pcOpenCloudDashboard();
    }
    loadReviewTab(currentFilter || 'pending');
  } catch (e) { toast('Error: ' + e.message); }
}

function pcOpenCloudDashboard() {
  try { window.open(PC_CLOUD_URL, '_blank', 'noopener'); } catch (e) {}
}

async function loadAuditTrail() {
  ['pending','approved','rejected','all','audit'].forEach(t => {
    const el = document.getElementById('rtab-' + t);
    if (el) el.className = t === 'audit' ? 'btn btn-primary btn-sm' : 'btn btn-sm';
  });
  const content = document.getElementById('review-content');
  if (!content) return;
  content.innerHTML = '<div class="empty-state">Loading audit trail…</div>';
  try {
    const logs = await api('/assessments/audit/all');
    if (logs.length === 0) {
      content.innerHTML = '<div class="card"><p class="empty-state">No audit records yet.</p></div>';
      return;
    }
    content.innerHTML = `
      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:14px 16px;font-weight:700;font-size:13px;border-bottom:1px solid #e2e8f0;color:#0B2545">🔍 Audit Trail — All Review Actions</div>
        <div style="overflow-x:auto">
        <table class="students-table" style="font-size:12px">
          <thead><tr><th>Student</th><th>Assessment</th><th>Reviewer</th><th>Action</th><th>Score</th><th>Timestamp</th><th>Comments</th></tr></thead>
          <tbody>
            ${logs.map(l => `<tr>
              <td><b>${escapeHtml(l.student_name)}</b></td>
              <td style="font-size:11px">${escapeHtml(l.assessment_name)}</td>
              <td>${escapeHtml(l.staff_reviewer)}</td>
              <td><span style="color:${l.approval_status==='approved'?'#22c55e':'#ef4444'};font-weight:700">
                ${l.approval_status==='approved'?'✅ Approved':'❌ Rejected'}
              </span></td>
              <td>${l.score}%</td>
              <td style="color:#64748b;font-size:11px;white-space:nowrap">
                ${l.approval_timestamp ? new Date(l.approval_timestamp).toLocaleString() : '—'}
              </td>
              <td style="color:#64748b;font-size:11px">${escapeHtml(l.comments || '—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        </div>
      </div>`;
  } catch (e) {
    content.innerHTML = `<div class="card"><p class="empty-state" style="color:#ef4444">Error: ${escapeHtml(e.message)}</p></div>`;
  }
}

// ============================================================================
// Wiring Review Modal — mounted on BODY (never inside page containers)
// ============================================================================
async function pcOpenReviewModal(assessmentId) {
  pcOpenModal(); // ensure overlay exists and show it
  const inner = document.getElementById('pc-wiring-modal-inner');
  inner.innerHTML = `
    <div style="padding:48px;text-align:center;color:#64748b">
      <div style="font-size:28px;margin-bottom:12px">⏳</div>
      <div>Loading assessment wiring…</div>
    </div>`;

  try {
    const r = await api(`/assessments/${assessmentId}`);
    const isRB = r.kit_id === 'resistance_bank';
    const BOARD_IMAGE = isRB ? RB_BOARD_IMAGE : PC_BOARD_IMAGE;
    const BOARD_VIEWBOX = isRB ? RB_BOARD_VIEWBOX : PC_BOARD_VIEWBOX;
    const SOCKETS = isRB ? RB_SOCKETS : PC_SOCKETS;

    const groups = (r.groups_data || []).map(g => new Set(g.map(String)));
    const groupFlags = r.group_correct_flags || [];
    const isStaff = currentUser && currentUser.role === 'staff';
    const isPending = r.faculty_approved === 'pending';

    // Build SVG wire overlays — RB has no grouped-edge concept the way PC
    // does (single Node A/Node B measurement), so only build group edges
    // for PC rows. RB shows the captured wiring photo instead (below).
    const allEdges = [];
    if (!isRB) {
      groups.forEach((grp, gi) => {
        pcGroupToEdges(grp).forEach(([a, b]) => {
          allEdges.push({ a, b, correct: groupFlags[gi], gi, isPending });
        });
      });
    } else {
      // RB wiring is a flat list of jumper pairs (no grouping concept), and
      // correctness is a single pass/fail for the whole circuit rather than
      // per-group, so color every wire by the overall result.
      let rbWiringData = [];
      if (Array.isArray(r.wiring_data)) {
        rbWiringData = r.wiring_data;
      } else if (typeof r.wiring_data === 'string') {
        try { rbWiringData = JSON.parse(r.wiring_data || '[]'); } catch (e) { rbWiringData = []; }
      }
      const rbCorrect = isPending ? false : !!r.is_correct_client;
      rbWiringData.forEach(([a, b]) => {
        allEdges.push({ a: String(a), b: String(b), correct: rbCorrect, gi: 0, isPending });
      });
    }

    const wiresHtml = allEdges.map(({ a, b, correct, isPending: pend }) => {
      if (!SOCKETS[a] || !SOCKETS[b]) return '';
      const [x1,y1] = SOCKETS[a], [x2,y2] = SOCKETS[b];
      const color = pend ? '#F59E0B' : correct ? '#22c55e' : '#ef4444';
      const cx = (x1+x2)/2;
      return `<path d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}"
        stroke="${color}" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.9"/>`;
    }).join('');

    const socketsHtml = Object.entries(SOCKETS).map(([id,[x,y]]) => `
      <g>
        <circle cx="${x}" cy="${y}" r="13" fill="#111" stroke="#ff3333" stroke-width="3"/>
        <text x="${Number(x)+15}" y="${Number(y)-9}" fill="#39FF6A" font-size="11" font-weight="bold" font-family="monospace" paint-order="stroke" stroke="#000" stroke-width="2">${id}</text>
      </g>`).join('');

    // Connection group summary cards (PC only — RB shows its own info card below)
    const groupCardsHtml = isRB ? '' : (groups.length === 0
      ? `<div style="color:#94a3b8;font-size:12px;text-align:center;padding:16px">No connections submitted.</div>`
      : groups.map((grp, gi) => {
          const nodes = [...grp].sort((a,b) => Number(a)-Number(b));
          const vlabel = pcGetVoltageLabel(grp);
          const ok = groupFlags[gi];
          const color = isPending ? '#F59E0B' : ok ? '#22c55e' : '#ef4444';
          const icon  = isPending ? '⏳' : ok ? '✅' : '❌';
          const label = isPending ? 'Pending' : ok ? 'Correct' : 'Incorrect';
          return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid ${color};border-radius:8px;padding:9px 12px;margin-bottom:6px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <div style="font-size:11px;font-weight:600;color:#0B2545;line-height:1.6">
                Group ${gi+1}: ${nodes.map(n=>`<span style="background:#e2e8f0;padding:1px 5px;border-radius:4px;font-size:10px;font-family:monospace">${n}</span>`).join(' ')}
                ${vlabel ? `<span style="background:#0B2545;color:#fff;padding:1px 6px;border-radius:4px;font-size:10px;margin-left:4px">${vlabel}</span>` : ''}
              </div>
              <span style="color:${color};font-size:11px;font-weight:600;white-space:nowrap">${icon} ${label}</span>
            </div>
          </div>`;
        }).join(''));

    // RB summary card — Node A/B, student answer, system value, error%
    const rbCardHtml = !isRB ? '' : `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid ${isPending ? '#F59E0B' : r.is_correct_client ? '#22c55e' : '#ef4444'};border-radius:8px;padding:9px 12px;margin-bottom:6px;font-size:11px;line-height:1.7">
        <div><b>Nodes:</b> ${escapeHtml(r.node_a || '')} → ${escapeHtml(r.node_b || '')}</div>
        <div><b>Student answer:</b> ${r.student_answer != null ? r.student_answer : '—'} Ω</div>
        <div><b>System-calculated (Rth):</b> ${r.correct_value != null ? r.correct_value.toFixed(2) : '—'} Ω</div>
        <div><b>Error:</b> ${r.error_percent != null ? r.error_percent.toFixed(2) + '%' : '—'} (tolerance ±${r.tolerance_percent}%)</div>
      </div>`;

    // Captured wiring photo — RB rows store an actual photo of the board
    // (level1_connection.png) rather than only a schematic reconstruction.
    const wiringImageHtml = (isRB && r.wiring_image_path) ? `
      <div style="margin-top:10px">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px">Captured Wiring Photo</div>
        <img src="${API_BASE}/${r.wiring_image_path}" style="width:100%;border-radius:8px;border:1px solid #e2e8f0">
      </div>` : '';

    inner.innerHTML = `
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#0B2545,#0E7C7B);padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div>
          <div style="font-size:15px;font-weight:700;color:#fff">🔍 Wiring Review — ${escapeHtml(r.student_name)}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.8);margin-top:3px">
            ${escapeHtml(r.experiment_name)} &nbsp;·&nbsp; Attempt #${r.attempt_number} &nbsp;·&nbsp;
            ${r.submission_time ? new Date(r.submission_time).toLocaleString() : r.date}
          </div>
        </div>
        <button onclick="pcCloseModal()"
          style="background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);color:#fff;font-size:20px;cursor:pointer;border-radius:50%;width:34px;height:34px;line-height:1;flex-shrink:0">
          ×
        </button>
      </div>

      <!-- Body — two columns -->
      <div style="display:flex;height:82vh;overflow:hidden">

        <!-- Left: Board visualization -->
        <div style="flex:1;min-height:0;padding:14px;overflow:auto;background:#f0f4f8;border-right:1px solid #e2e8f0">
          <!-- Legend -->
          <div style="display:flex;gap:14px;font-size:11px;align-items:center;padding:6px 10px;background:#fff;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:10px;flex-wrap:wrap">
            <b style="color:#0B2545;font-size:11px">Wire Legend:</b>
            <span><span style="display:inline-block;width:20px;height:4px;background:#F59E0B;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Pending Review</span>
            <span><span style="display:inline-block;width:20px;height:4px;background:#22c55e;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Correct</span>
            <span><span style="display:inline-block;width:20px;height:4px;background:#ef4444;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Incorrect</span>
          </div>
          <!-- Board zoom controls -->
          <div style="display:flex;gap:5px;align-items:center;margin-bottom:6px">
            <span style="font-size:11px;color:#64748b;flex:1">Submitted Wiring</span>
            <button onclick="reviewZoomOut()" style="width:26px;height:26px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:14px;color:#334155">−</button>
            <span id="review-zoom-label" style="font-size:10px;font-weight:600;color:#334155;min-width:34px;text-align:center">100%</span>
            <button onclick="reviewZoomIn()" style="width:26px;height:26px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:14px;color:#334155">+</button>
            <button onclick="reviewZoomReset()" style="height:26px;padding:0 7px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:10px;color:#334155">Reset</button>
          </div>
          <!-- Board SVG -->
          <div id="review-board-wrap" style="border:1px solid #cbd5e1;border-radius:10px;overflow:auto;background:#111;max-height:60vh">
            <svg id="review-board-svg" viewBox="${BOARD_VIEWBOX}" xmlns="http://www.w3.org/2000/svg"
                 style="width:100%;display:block;min-width:300px;transition:width .15s">
              <image href="${BOARD_IMAGE}" x="0" y="0" width="${isRB ? 1438 : 842}" height="${isRB ? 1094 : 838}" preserveAspectRatio="xMidYMid meet"/>
              <g>${wiresHtml}</g>
              <g>${socketsHtml}</g>
            </svg>
          </div>
          ${wiringImageHtml}
          <div style="font-size:10px;color:#94a3b8;text-align:center;margin-top:4px">Use + / − to zoom · Wires shown as submitted</div>
          <script>
            (function() {
              var reviewZoom = 1.0;
              window.reviewZoomIn = function() { reviewZoom = Math.min(3, reviewZoom + 0.25); applyRZ(); };
              window.reviewZoomOut = function() { reviewZoom = Math.max(0.5, reviewZoom - 0.25); applyRZ(); };
              window.reviewZoomReset = function() { reviewZoom = 1.0; applyRZ(); };
              function applyRZ() {
                var wrap = document.getElementById('review-board-wrap');
                var svg = document.getElementById('review-board-svg');
                if (!svg || !wrap) return;
                svg.style.width = Math.round(wrap.clientWidth * reviewZoom) + 'px';
                var lbl = document.getElementById('review-zoom-label');
                if (lbl) lbl.textContent = Math.round(reviewZoom * 100) + '%';
              }
            })();
          </script>
        </div>

        <!-- Right: Info + groups + action -->
        <div style="flex:0 0 300px;min-height:0;display:flex;flex-direction:column">

          <!-- Scrollable content -->
          <div style="flex:1;min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px">

            <!-- Assessment info -->
            <div style="background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden">
              <div style="background:#0B2545;color:#fff;font-size:11px;font-weight:700;padding:7px 12px;letter-spacing:.5px">ASSESSMENT INFO</div>
              <div style="padding:10px 12px;font-size:12px;display:grid;gap:5px">
                ${[
                  ['Student', escapeHtml(r.student_name)],
                  ['Connection Method', r.connection_method === 'Hardware Kit' ? '🔌 <b>Hardware Kit</b>' : '🖐️ <b>Manual Connection</b>'],
                  ['Score', `<b>${r.score}%</b>`],
                  ['Result', `<b style="color:${r.status==='PASS'?'#22c55e':'#ef4444'}">${r.status}</b>`],
                  ...(isRB ? [] : [['Groups', `${r.groups_correct}/${r.groups_total} correct`], ['Voltage', r.voltage_selected || '—']]),
                  ['Status', `<b style="color:${isPending?'#F59E0B':r.faculty_approved==='approved'?'#22c55e':'#ef4444'}">${isPending?'⏳ Pending review':r.faculty_approved==='approved'?'✅ Approved':'❌ Rejected'}</b>`],
                  ...(r.reviewer_name ? [['Reviewer', escapeHtml(r.reviewer_name)]] : []),
                ].map(([k,v]) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #f1f5f9">
                  <span style="color:#64748b">${k}</span><span>${v}</span>
                </div>`).join('')}
              </div>
            </div>

            <!-- Connection groups / RB summary -->
            <div>
              <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">${isRB ? 'Submission Details' : `Submitted Connections (${groups.length} groups)`}</div>
              ${isRB ? rbCardHtml : groupCardsHtml}
            </div>

            ${!isRB ? `
            <!-- Cloud link (Power Converter only) -->
            <button onclick="window.open('${PC_CLOUD_URL}','_blank','noopener')"
              style="width:100%;padding:8px;background:#0B2545;color:#fff;border:none;border-radius:8px;font-size:12px;cursor:pointer;font-weight:600">
              🌐 Open Cloud Dashboard
            </button>` : ''}

            ${r.review_comments ? `
            <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:10px 12px">
              <div style="font-size:11px;font-weight:600;color:#92400e;margin-bottom:4px">Review Comments</div>
              <div style="font-size:11px;color:#78350f">${escapeHtml(r.review_comments)}</div>
            </div>` : ''}
          </div>

          <!-- Staff action panel — pinned to bottom, always visible regardless of scroll position -->
          ${isStaff && isPending ? `
          <div style="flex-shrink:0;padding:12px 14px;background:#f0fdf4;border-top:1px solid #86efac;box-shadow:0 -6px 14px rgba(0,0,0,.06)">
            <div style="font-size:11px;font-weight:700;color:#166534;margin-bottom:6px">⚠️ Staff Review Required</div>
            <div style="font-size:11px;color:#64748b;margin-bottom:8px">Review the board wiring above, then approve or reject. The student will be notified immediately.</div>
            <textarea id="review-modal-comments" placeholder="Optional comments for student…"
              style="width:100%;box-sizing:border-box;border:1px solid #e2e8f0;border-radius:6px;padding:8px;font-size:11px;resize:vertical;min-height:48px;font-family:inherit;margin-bottom:8px"></textarea>
            <div style="display:flex;gap:8px">
              <button onclick="pcSubmitModalReview(${assessmentId},'approved')"
                style="flex:1;padding:10px;background:#22c55e;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">
                ✅ Approve
              </button>
              <button onclick="pcSubmitModalReview(${assessmentId},'rejected')"
                style="flex:1;padding:10px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">
                ❌ Reject
              </button>
            </div>
          </div>` : ''}
        </div>
      </div>`;
  } catch (e) {
    const inner2 = document.getElementById('pc-wiring-modal-inner');
    if (inner2) inner2.innerHTML = `
      <div style="padding:48px;text-align:center;color:#ef4444">
        <div style="font-size:28px;margin-bottom:12px">⚠️</div>
        <div>Failed to load: ${escapeHtml(e.message)}</div>
        <button onclick="pcCloseModal()" style="margin-top:16px;padding:8px 20px;background:#0B2545;color:#fff;border:none;border-radius:8px;cursor:pointer">Close</button>
      </div>`;
  }
}

async function pcSubmitModalReview(assessmentId, action) {
  const comments = document.getElementById('review-modal-comments')?.value || '';
  const approveBtn = document.querySelector(`button[onclick*="pcSubmitModalReview(${assessmentId},'approved')"]`);
  const rejectBtn  = document.querySelector(`button[onclick*="pcSubmitModalReview(${assessmentId},'rejected')"]`);
  if (approveBtn) { approveBtn.disabled = true; approveBtn.textContent = 'Saving…'; }
  if (rejectBtn)  { rejectBtn.disabled  = true; }

  try {
    await api(`/assessments/${assessmentId}/review`, { method: 'PUT', body: { action, comments } });
    // Signal cloud server about the decision
    try {
      await fetch(PC_CLOUD_URL + '/admin_action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_id: assessmentId, action }),
      });
    } catch (cloudErr) { /* cloud optional */ }

    toast(action === 'approved'
      ? '✅ Approved — student will see their result now.'
      : '❌ Rejected — student will be notified.');
    pcCloseModal();

    // Refresh whichever page is visible
    const reviewContent = document.getElementById('review-content');
    if (reviewContent) {
      loadReviewTab('pending');
    } else {
      loadAssessmentAnalytics();
    }
    // Refresh pending badge
    loadPendingAssessmentBadge();
  } catch (e) {
    toast('Error: ' + e.message);
    if (approveBtn) { approveBtn.disabled = false; approveBtn.textContent = '✅ Approve'; }
    if (rejectBtn)  { rejectBtn.disabled = false;  rejectBtn.textContent  = '❌ Reject'; }
  }
}

// ============================================================================
// Student Assessment — intro → safety → launch
// ============================================================================
function pcOpenCard() {
  const root = document.getElementById('page-assessment');
  if (!root) return;
  root.innerHTML = `
    <div class="card" style="max-width:680px;margin:0 auto">
      <div class="card-title">${escapeHtml(PC_EXPERIMENT.name)} — Objective</div>
      <p style="color:var(--color-text-secondary);font-size:13px;line-height:1.6">${escapeHtml(PC_EXPERIMENT.objective)}</p>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        <span class="skill-pill">Difficulty: ${PC_EXPERIMENT.difficulty}</span>
        <span class="skill-pill">Duration: ${PC_EXPERIMENT.duration}</span>
      </div>
      <div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn" onclick="renderAssessmentDashboard()">Cancel</button>
        <button class="btn btn-primary" onclick="pcShowSafety()">Next: Safety instructions →</button>
      </div>
    </div>`;
}

function pcShowSafety() {
  const root = document.getElementById('page-assessment');
  root.innerHTML = `
    <div class="card" style="max-width:680px;margin:0 auto">
      <div class="card-title">⚠️ Safety Instructions</div>
      <ul style="color:var(--color-text-secondary);font-size:13px;line-height:1.8;padding-left:18px">
        ${PC_EXPERIMENT.safety.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
      </ul>
      <div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn" onclick="pcOpenCard()">← Back</button>
        <button class="btn btn-primary" onclick="pcLaunchAssessment()">Launch Assessment →</button>
      </div>
    </div>`;
}

// ============================================================================
// Digital Twin Assessment Screen
// ============================================================================
function pcLaunchAssessment() {

  window.assessmentRunning = true;

  pcResetState();
  if (window.LiveCircuitSync) {
    window.LiveCircuitSync.startSession({
      kit_id: 'power_converter',
      assignment_id: 'power_converter_assessment',
      assignment_title: 'Power Converter Kit Assessment',
      wires: [],
      mode: 'manual',
    });
  }
  const root = document.getElementById('page-assessment');
  const name = (currentUser && (currentUser.name || currentUser.email)) || 'Student';
  const serialSupported = ('serial' in navigator);

  root.innerHTML = `
    <div class="card" style="margin-bottom:12px;padding:12px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:13px;color:#0B2545" id="pc-hw-title">
            ${serialSupported ? '🔌 Hardware Kit: Not connected' : '⚠️ Web Serial not supported'}
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:3px" id="pc-hw-sub">
            ${serialSupported
              ? 'Plug in the Power Converter trainer kit via USB, then click Connect.'
              : 'Use Chrome/Edge on desktop for hardware mode. Using manual simulation instead.'}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <label for="expSelect" style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.02em">EXPERIMENT TYPE</label>
          <select
            id="expSelect"
            class="form-input"
            style="width:200px;font-size:12px;padding:6px 8px"
            onchange="pcOnExperimentTypeChange()">
            <option>Half Wave Rectifier</option>
            <option>Full Wave Rectifier</option>
            <option selected>Bridge Rectifier</option>
            <option>Buck Converter</option>
            <option>Boost Converter</option>
            <option>Inverter</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${serialSupported
            ? `<button class="btn btn-primary btn-sm" id="pc-hw-connect-btn" onclick="pcConnectHardware()">⚡ Connect Hardware Kit</button>
               <button class="btn btn-sm" id="pc-hw-disconnect-btn" style="display:none" onclick="pcDisconnectHardware()">Disconnect</button>`
            : ''}
          <button class="btn btn-sm" onclick="pcUseManualMode()">Use manual simulation</button>
        </div>
      </div>
    </div>

    <div class="pc-layout">
      <!-- Board -->
      <div class="pc-board-panel card">
        <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">
          Digital Twin Board
          <span id="pc-mode-badge" class="pc-mode-badge pc-mode-hw">LIVE HARDWARE</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
          <span style="font-size:11px;color:#64748b;flex:1">Digital Twin Board</span>
          <div style="display:flex;gap:4px">
            <button onclick="pcZoomOut()" title="Zoom Out" style="width:28px;height:28px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;color:#334155">−</button>
            <button onclick="pcZoomReset()" title="Reset Zoom" style="height:28px;padding:0 8px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:10px;color:#334155;font-weight:600" id="pc-zoom-label">100%</button>
          <button onclick="pcZoomIn()" title="Zoom In" style="width:28px;height:28px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;color:#334155">+</button>


<button 
onclick="pcFullscreenBoard()"
style="
height:28px;
padding:0 10px;
border-radius:6px;
border:1px solid #e2e8f0;
background:#2563eb;
color:white;
cursor:pointer;
font-size:11px;
font-weight:600;
">

⛶ Full

</button>
          </div>
        </div>
        <div class="pc-board-wrap" id="pc-board-wrap" style="overflow:auto;max-height:520px;border-radius:10px;background:#111;border:1px solid #333;">
          <svg id="pc-svg" viewBox="${PC_BOARD_VIEWBOX}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;min-width:300px;transition:width .15s">
            <image href="${PC_BOARD_IMAGE}" x="0" y="0" width="842" height="838" preserveAspectRatio="xMidYMid meet"/>
            <defs>
              <clipPath id="pc-motor-clip">
                <circle cx="${PC_MOTOR.cx}" cy="${PC_MOTOR.cy}" r="${PC_MOTOR.r}"/>
              </clipPath>
            </defs>
            <g clip-path="url(#pc-motor-clip)">
              <!--
                pc-motor-spin is rotated purely via an explicit SVG
                "rotate(angle, cx, cy)" transform attribute set from JS
                (pcMotorTick), NOT via CSS fill-box/transform-origin.
                fill-box on a nested <svg> is unreliable across browsers and
                was causing the gear to flip instead of spinning smoothly.
                Rotating the FULL board image around the motor's exact
                center point, then clipping to the small circle, guarantees
                the visible patch spins in place with no jump/flip.
              -->
              <image id="pc-motor-spin" href="${PC_BOARD_IMAGE}" x="0" y="0" width="842" height="838"
                     preserveAspectRatio="xMidYMid meet"
                     transform="rotate(0,${PC_MOTOR.cx},${PC_MOTOR.cy})"/>
            </g>
            <!--
              Direction indicator — a FIXED (non-rotating) arc + arrowhead
              drawn on top of the spinning gear to show which way it's
              turning. This stays still while the gear texture spins
              underneath it, so the arrow always reads clearly as
              "clockwise". Hidden until the motor starts via pcStartMotor/
              pcStopMotor toggling display on #pc-motor-direction.
            -->
            <g id="pc-motor-direction" style="display:none" pointer-events="none">
              <circle cx="${PC_MOTOR.cx}" cy="${PC_MOTOR.cy}" r="${PC_MOTOR.r * 0.62}"
                      fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"
                      stroke-dasharray="${2 * Math.PI * PC_MOTOR.r * 0.62 * 0.72} ${2 * Math.PI * PC_MOTOR.r * 0.62}"
                      transform="rotate(-90,${PC_MOTOR.cx},${PC_MOTOR.cy})"/>
              <polygon fill="#ffffff"
                points="
                  ${PC_MOTOR.cx + PC_MOTOR.r * 0.62},${PC_MOTOR.cy - 9}
                  ${PC_MOTOR.cx + PC_MOTOR.r * 0.62 + 11},${PC_MOTOR.cy}
                  ${PC_MOTOR.cx + PC_MOTOR.r * 0.62},${PC_MOTOR.cy + 9}
                "/>
            </g>
            <g id="pc-wires"></g>
            <g id="pc-sockets"></g>
          </svg>
        </div>
        <div style="font-size:10px;color:#94a3b8;margin-top:4px;text-align:center" id="pc-board-hint">
          Click a socket, then click another socket to draw a wire. Click the same pair again to remove.
        </div>
        <div id="diode-toolbox-root-assessment"></div>
      </div>

      <!-- Status -->
      <div class="pc-center-panel card">
        <div class="card-title">Live Wiring Status</div>
        <div id="pc-wire-status" class="pc-wire-list">
          <p class="empty-state">Awaiting connections…</p>
        </div>
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="pc-clear-btn" onclick="pcClearWiring()" style="display:none">Clear all wires</button>
          <button class="btn btn-primary" onclick="pcEvaluate()">Evaluate & Submit</button>
        </div>
        <div id="pc-circuit-status" class="pc-circuit-status">
          Circuit status: <b>NOT EVALUATED</b>
        </div>
      </div>

      <!-- Info -->
      <div class="pc-info-panel card">
        <div class="card-title">Assessment Info</div>
        <div class="pc-info-row"><span>Student</span><b>${escapeHtml(name)}</b></div>
        <div class="pc-info-row"><span>Experiment</span><b style="font-size:11px" id="pc-exp-name-label">${escapeHtml(PC_EXPERIMENT.name)}</b></div>
        <div class="pc-info-row"><span>Timer</span><b id="pc-timer">00:00</b></div>
        <div class="pc-info-row"><span>Attempt</span><b id="pc-attempt">In progress</b></div>
        <div class="pc-info-row"><span>Circuit Status</span><b id="pc-status-mini" style="color:#64748b">Not evaluated</b></div>
        <div style="margin-top:14px">
          <button class="btn" style="width:100%" onclick="pcExitAssessment()">Exit to Dashboard</button>
        </div>
      </div>
    </div>
  `;

pcOnExperimentTypeChange(true); // sync label with dropdown default, no toast/clear
  pcDrawSockets();
  pcRenderWires();
  pcUpdateWireStatus();
  if (typeof initDiodePlacementSystem === "function") {
    initDiodePlacementSystem("pc-board-wrap", "diode-toolbox-root-assessment", pcState);
  }
  pcState.timerHandle = setInterval(pcTickTimer, 1000);
  if (!serialSupported) pcUseManualMode();
  
  // ====== AI VISIBILITY CONTROL ======
  updateAIVisibility();
}

function pcExitAssessment() {
  if (window.LiveCircuitSync) {
    window.LiveCircuitSync.leaveSession();
  }
  pcDisconnectHardware();
  if (pcState?.timerHandle)      clearInterval(pcState.timerHandle);
  if (pcState?.adminPollHandle)  clearInterval(pcState.adminPollHandle);
window.assessmentRunning = false;  
renderAssessmentDashboard();
  
  // ====== AI VISIBILITY CONTROL ======
  updateAIVisibility();
}

function pcUseManualMode() {
  if (!pcState) return;
  pcState.mode = 'manual';
  const badge = document.getElementById('pc-mode-badge');
  if (badge) { badge.textContent = 'MANUAL SIMULATION'; badge.className = 'pc-mode-badge pc-mode-manual'; }
  const hint = document.getElementById('pc-board-hint');
  if (hint) hint.textContent = 'Click a socket, then click another socket to draw a wire. Click the same pair again to remove.';
  const clearBtn = document.getElementById('pc-clear-btn');
  if (clearBtn) clearBtn.style.display = '';
  pcUpdateWireStatus();
let u=document.getElementById("pc-undo-btn");
let d=document.getElementById("pc-delete-btn");

if(u) u.style.display="";
if(d) d.style.display="";
}

// ---------- Web Serial ----------
async function pcConnectHardware() {
  if (!('serial' in navigator)) { toast('Web Serial needs Chrome or Edge on desktop.'); return; }
  // Ask the backend to give up the COM port first, in case it's still
  // holding it open from a previous staff approval/rejection cycle.
  await releaseRelayPort();
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    pcState.serialPort = port;
    pcState.serialConnected = true;
    pcState.mode = 'hardware';
    const t = document.getElementById('pc-hw-title');
    const s = document.getElementById('pc-hw-sub');
    if (t) t.textContent = '🟢 Hardware Kit: Connected (live)';
    if (s) s.textContent = 'Live wiring data streaming from board.';
    document.getElementById('pc-hw-connect-btn')    && (document.getElementById('pc-hw-connect-btn').style.display = 'none');
    document.getElementById('pc-hw-disconnect-btn') && (document.getElementById('pc-hw-disconnect-btn').style.display = '');
    const badge = document.getElementById('pc-mode-badge');
    if (badge) { badge.textContent = 'LIVE HARDWARE'; badge.className = 'pc-mode-badge pc-mode-hw'; }
    pcReadSerialLoop(port);
    toast('Hardware kit connected.');
  } catch (e) { toast('Could not connect: ' + e.message); }
}

async function pcReadSerialLoop(port) {
  const dec = new TextDecoderStream();
  // Store the pipe teardown promise so pcDisconnectHardware() can await it
  // before calling port.close(). Without this, close() can throw because
  // port.readable is still locked by the in-flight pipeTo() — that error
  // was being silently swallowed, leaving the browser-level port stuck
  // "open" so the next connect attempt failed with
  // "Failed to execute 'open' on 'SerialPort': The port is already open."
  pcState.readableClosed = port.readable.pipeTo(dec.writable).catch(() => {});
  const reader = dec.readable.getReader();
  pcState.serialReader = reader;
  let buf = '';
  try {
    while (pcState.serialConnected) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith('{')) {
          try { const d = JSON.parse(line); pcOnHardwareGroups(d.groups || []); } catch (e) {}
        }
      }
    }
  } catch (e) { if (pcState?.serialConnected) toast('Serial error: ' + e.message); }
  finally { try { reader.releaseLock(); } catch (e) {} }
}

function pcOnHardwareGroups(groups) {
  if (!pcState || pcState.evaluated) return;
  pcState.rawGroups = groups.map(g => new Set(g.map(String)));
  pcRenderWires();
  pcUpdateWireStatus();
}

async function pcDisconnectHardware() {
  if (!pcState) return;
  pcState.serialConnected = false;
  try { if (pcState.serialReader) await pcState.serialReader.cancel(); } catch (e) {}
  try { if (pcState.readableClosed) await pcState.readableClosed; } catch (e) {}
  try { if (pcState.serialPort)   await pcState.serialPort.close(); }   catch (e) {}
  pcState.serialPort = null;
  pcState.serialReader = null;
  pcState.readableClosed = null;
  const t = document.getElementById('pc-hw-title');
  if (t) t.textContent = '🔌 Hardware Kit: Not connected';
  document.getElementById('pc-hw-connect-btn')    && (document.getElementById('pc-hw-connect-btn').style.display = '');
  document.getElementById('pc-hw-disconnect-btn') && (document.getElementById('pc-hw-disconnect-btn').style.display = 'none');
}

function pcTickTimer() {
  if (!pcState) return;
  pcState.elapsedSec = Math.floor((Date.now() - pcState.startedAt) / 1000);
  const m = String(Math.floor(pcState.elapsedSec / 60)).padStart(2,'0');
  const s = String(pcState.elapsedSec % 60).padStart(2,'0');
  const el = document.getElementById('pc-timer');
  if (el) el.textContent = `${m}:${s}`;
}


// ============================================================================
// Zoom Controls
// ============================================================================
let pcZoomLevel = 1.0;
const PC_ZOOM_MIN = 0.5, PC_ZOOM_MAX = 3.0, PC_ZOOM_STEP = 0.25;

function pcGetBoardNaturalWidth() {
  const wrap = document.getElementById('pc-board-wrap');
  return wrap ? wrap.clientWidth : 500;
}

function pcApplyZoom() {
  const svg = document.getElementById('pc-svg');
  if (!svg) return;
  const wrap = document.getElementById('pc-board-wrap');
  const baseW = wrap ? wrap.clientWidth : 500;
  const newW = Math.round(baseW * pcZoomLevel);
  svg.style.width = newW + 'px';
  const label = document.getElementById('pc-zoom-label');
  if (label) label.textContent = Math.round(pcZoomLevel * 100) + '%';
}

function pcZoomIn() {
  pcZoomLevel = Math.min(PC_ZOOM_MAX, pcZoomLevel + PC_ZOOM_STEP);
  pcApplyZoom();
}

function pcZoomOut() {
  pcZoomLevel = Math.max(PC_ZOOM_MIN, pcZoomLevel - PC_ZOOM_STEP);
  pcApplyZoom();
}

function pcZoomReset() {
  pcZoomLevel = 1.0;
  pcApplyZoom();
}

// ============================================================================
// Motor (blue gear) spin — only the clipped circle over the gear rotates,
// driven by an explicit SVG rotate(angle,cx,cy) transform attribute updated
// every frame (clockwise). This avoids CSS fill-box quirks that caused the
// gear to flip instead of spinning smoothly.
// ============================================================================
let pcMotorAngle = 0;
let pcMotorRAF = null;

function pcMotorTick(ts) {
  if (!pcMotorRAF) return; // stopped
  const el = document.getElementById('pc-motor-spin');
  if (el) {
    pcMotorAngle = (pcMotorAngle + 3) % 360; // clockwise increment per frame
    el.setAttribute('transform', `rotate(${pcMotorAngle},${PC_MOTOR.cx},${PC_MOTOR.cy})`);
  }
  pcMotorRAF = requestAnimationFrame(pcMotorTick);
}

function pcStartMotor() {
  if (pcMotorRAF) return; // already spinning
  pcMotorRAF = requestAnimationFrame(pcMotorTick);
  const dir = document.getElementById('pc-motor-direction');
  if (dir) dir.style.display = '';
}

function pcStopMotor() {
  if (pcMotorRAF) {
    cancelAnimationFrame(pcMotorRAF);
    pcMotorRAF = null;
  }
  pcMotorAngle = 0;
  const el = document.getElementById('pc-motor-spin');
  if (el) el.setAttribute('transform', `rotate(0,${PC_MOTOR.cx},${PC_MOTOR.cy})`);
  const dir = document.getElementById('pc-motor-direction');
  if (dir) dir.style.display = 'none';
}

function pcDrawSockets() {
  const g = document.getElementById('pc-sockets');
  if (!g) return;
  g.innerHTML = Object.entries(PC_SOCKETS).map(([id,[x,y]]) => `
    <g class="pc-socket" data-node="${id}" onclick="pcOnSocketClick('${id}')" style="cursor:pointer" title="Node ${id}">
      <circle cx="${x}" cy="${y}" r="13" fill="black" stroke="red" stroke-width="3"/>
      <text x="${x+14}" y="${y-10}" fill="#39FF6A" font-size="11" font-weight="bold" font-family="monospace">${id}</text>
    </g>`).join('');
}

function pcCurrentGroups() {
  if (!pcState) return [];
  return pcState.mode === 'hardware' ? pcState.rawGroups : pcWiresToGroups(pcState.wires);
}

function pcOnSocketClick(nodeId) {
  if (!pcState || pcState.mode !== 'manual') { toast('Switch to manual simulation first.'); return; }
  if (pcState.evaluated) return;
  if (pcState.pendingNode === null) {
    pcState.pendingNode = nodeId;
    pcHighlightSocket(nodeId, true);
    return;
  }
  if (pcState.pendingNode === nodeId) {
    pcHighlightSocket(nodeId, false);
    pcState.pendingNode = null;
    return;
  }
  const a = pcState.pendingNode, b = nodeId;
  const idx = pcState.wires.findIndex(([x,y]) => (x===a&&y===b)||(x===b&&y===a));
  if (idx >= 0) pcState.wires.splice(idx, 1);
  else pcState.wires.push([a, b]);
  pcHighlightSocket(a, false);
  pcState.pendingNode = null;
  pcRenderWires();
  pcUpdateWireStatus();
}

function pcHighlightSocket(nodeId, on) {
  const el = document.querySelector(`.pc-socket[data-node="${nodeId}"] circle`);
  if (el) el.setAttribute('stroke', on ? '#39FF6A' : 'red');
}

function pcRenderWires() {
  const g = document.getElementById('pc-wires');
  if (!g) return;
  const groups = pcCurrentGroups();
  const groupCorrect = pcState?.evaluated ? groups.map(pcIsGroupCorrect) : null;
  const edges = [];
  groups.forEach((grp, gi) => {
    pcGroupToEdges(grp).forEach(e => edges.push({ e, gi }));
  });
  g.innerHTML = edges.map(({ e:[a,b], gi }) => {
    if (!PC_SOCKETS[a] || !PC_SOCKETS[b]) return '';
    const [x1,y1] = PC_SOCKETS[a], [x2,y2] = PC_SOCKETS[b];
    const color = groupCorrect ? (groupCorrect[gi] ? '#1fbf5c' : '#ff2d2d') : '#ff2d2d';
    const cx = (x1+x2)/2;
    return `<path d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}"
      stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  }).join('');

  window.pcState = pcState;
  if (window.LiveCircuitSync && pcState) {
    window.LiveCircuitSync.updateCircuit({
      kit_id: 'power_converter',
      assignment_id: 'power_converter_assessment',
      assignment_title: 'Power Converter Kit Assessment',
      wires: pcState.wires || [],
      diodes: pcState.diodePlacements || [],
      mode: pcState.mode || 'manual',
    });
  }
}

function pcUpdateWireStatus() {
  const el = document.getElementById('pc-wire-status');
  if (!el) return;
  const groups = pcCurrentGroups();
  if (groups.length === 0) {
    el.innerHTML = `<p class="empty-state">${pcState?.mode === 'hardware' ? 'Waiting for hardware…' : 'No connections yet. Click sockets to wire.'}</p>`;
    return;
  }
  el.innerHTML = `
    <div style="font-size:11px;color:#64748b;margin-bottom:8px">${groups.length} connection group(s) detected</div>
    ${groups.map(g => {
      const nodes = [...g].sort((a,b) => Number(a)-Number(b));
      const vlabel = pcGetVoltageLabel(g);
      const correct = pcState?.evaluated ? pcIsGroupCorrect(g) : null;
      const cls = pcState?.evaluated ? (correct ? 'pc-grp-ok' : 'pc-grp-bad') : 'pc-grp-pending';
      return `<div class="pc-group-chip ${cls}">
        ${nodes.join(' – ')}
        ${vlabel ? `<span class="pc-volt-badge">${vlabel}</span>` : ''}
      </div>`;
    }).join('')}`;
}
function pcSelectWire(i){

if(!pcState)return;

if(pcState.mode!=="manual")return;

pcState.selectedWire=i;

toast("🔴 Wire selected");

}



function pcDeleteWire(){

if(!pcState)return;


if(pcState.selectedWire===null){

toast("Select wire first");

return;

}


pcState.wires.splice(
pcState.selectedWire,
1
);


pcState.selectedWire=null;


pcRenderWires();

pcUpdateWireStatus();

}



function pcUndoWire(){

if(!pcState)return;


pcState.wires.pop();


pcRenderWires();

pcUpdateWireStatus();


}

// Fired when the student/faculty picks a different circuit from the
// "Experiment Type" dropdown on the live assessment screen. This is the
// same #expSelect element the grading logic in pcActiveAnswerKey() already
// looks for, so switching it here immediately switches which answer key
// (Bridge Rectifier / Full Wave Rectifier / etc.) the board is graded
// against -- turning this one assessment screen into the same kit-select
// experience as the Experiment tab, for every circuit on this trainer.
function pcOnExperimentTypeChange(opts) {
  const silent = opts === true;
  const sel = document.getElementById('expSelect');
  const chosen = (sel && sel.value) || 'Bridge Rectifier';

  PC_EXPERIMENT.name = `${chosen} Assessment`;
  const label = document.getElementById('pc-exp-name-label');
  if (label) label.textContent = PC_EXPERIMENT.name;

  // Existing wiring was drawn against the previous circuit's answer key --
  // clear it so the student starts the new circuit from a blank board
  // instead of being graded against the wrong key.
  if (pcState && pcState.wires && pcState.wires.length) {
    pcClearWiring();
    if (!silent) toast(`Switched to ${chosen}. Board wiring cleared — please rewire for this circuit.`);
  } else if (!silent) {
    toast(`Experiment set to ${chosen}.`);
  }
}

function pcClearWiring() {
  if (!pcState) return;
  pcState.wires = [];
  pcState.rawGroups = [];
  pcState.pendingNode = null;
  pcState.evaluated = false;
  if (pcState.adminPollHandle) { clearInterval(pcState.adminPollHandle); pcState.adminPollHandle = null; }
  pcStopMotor();
  pcRenderWires();
  pcUpdateWireStatus();
  const cs = document.getElementById('pc-circuit-status');
  if (cs) cs.innerHTML = 'Circuit status: <b>NOT EVALUATED</b>';
  const mini = document.getElementById('pc-status-mini');
  if (mini) { mini.textContent = 'Not evaluated'; mini.style.color = '#64748b'; }
}

// ============================================================================
// Evaluate → Upload → Poll for admin decision → Show student result
// ============================================================================
async function pcEvaluate() {
  if (!pcState) return;
  const groups = pcCurrentGroups();
  if (groups.length === 0) { toast('No connections detected. Wire the board first.'); return; }

  const groupCorrectFlags = groups.map(pcIsGroupCorrect);
  pcState.pendingGroups    = groups;
  pcState.pendingGroupFlags = groupCorrectFlags;

  // Update UI immediately to "sent for review"
  const cs = document.getElementById('pc-circuit-status');
  if (cs) cs.innerHTML = 'Circuit status: <b style="color:#F59E0B;animation:pcPulse 1.4s infinite">⏳ Submitted — awaiting faculty review…</b>';
  const mini = document.getElementById('pc-status-mini');
  if (mini) { mini.textContent = 'Awaiting approval'; mini.style.color = '#F59E0B'; }

  toast('Wiring submitted to admin panel. Waiting for faculty review…');

  // Upload to cloud
  pcSendToCloud(groups);

  // Submit to backend (wiring stored, status pending)
  await pcSubmitToBackend(groups, groupCorrectFlags);

  // Start polling backend every 3 seconds for admin decision
  if (pcState.adminPollHandle) clearInterval(pcState.adminPollHandle);
  pcState.adminPollHandle = setInterval(pcPollForDecision, 3000);
}

async function pcSendToCloud(groups) {
  try {
    await fetch(PC_CLOUD_URL + '/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups: groups.map(g => [...g]) }),
    });
  } catch (e) { /* cloud optional — don't block student */ }
}

async function pcSubmitToBackend(groups, groupCorrectFlags) {
  // Derive wiring pairs for storage
  const wiringData = pcState.mode === 'manual'
    ? pcState.wires
    : groups.flatMap(g => pcGroupToEdges(g));

  const correctCount = groupCorrectFlags.filter(Boolean).length;
  const totalCount   = groups.length;
  const noWrong      = groupCorrectFlags.every(Boolean);
  const allPresent   = pcAllGroupsPresent(groups);
  const pass         = noWrong && allPresent;
  const finalScore   = pass ? 100 : (totalCount ? Math.round((correctCount/totalCount)*100) : 0);

  let voltageSelected = '';
  groups.forEach(g => { const v = pcGetVoltageLabel(g); if (v) voltageSelected = v; });

  try {
    pcState.pendingResult = await api('/assessments/submit', {
      method: 'POST',
      body: {
        kit_id: PC_EXPERIMENT.id,
        experiment_name: PC_EXPERIMENT.name,
        score: finalScore,
        status: pass ? 'PASS' : 'FAIL',
        time_taken_seconds: pcState.elapsedSec,
        groups_correct: correctCount,
        groups_total: totalCount,
        voltage_selected: voltageSelected,
        wiring_data: wiringData,
        groups_data: groups.map(g => [...g]),
        group_correct_flags: groupCorrectFlags,
        connection_method: pcState.mode === 'hardware' ? 'Hardware Kit' : 'Manual Connection',
      },
    });
    console.log('Assessment submitted, ID:', pcState.pendingResult?.id);
    // Release the Web Serial connection now that the final wiring
    // snapshot has been submitted — frees the COM port so the backend
    // can open it for UNLOCK/HEARTBEAT once staff approves.
    if (pcState.mode === 'hardware' && pcState.serialConnected) {
      pcDisconnectHardware();
    }
  } catch (e) {
    console.warn('Backend submit error:', e.message);
    toast('Warning: Could not save to server. ' + e.message);
  }
}

// Poll backend for faculty_approved status
async function pcPollForDecision() {
  if (!pcState || !pcState.pendingResult) return;
  try {
    const result = await api(`/assessments/${pcState.pendingResult.id}`);
    const status = result.faculty_approved;

    if (status === 'approved' || status === 'rejected') {
      clearInterval(pcState.adminPollHandle);
      pcState.adminPollHandle = null;
      pcFinalizeResult(result);
    }
  } catch (e) {
    // Network error — keep polling
    console.warn('Poll error:', e.message);
  }
}

function pcFinalizeResult(result) {
  if (!pcState) return;
  pcState.evaluated = true;

  const approved = result.faculty_approved === 'approved';
  const rejected = result.faculty_approved === 'rejected';
  const pass     = result.status === 'PASS';

  if (approved && pass) pcStartMotor();
  else pcStopMotor();

  // Update wires with correct/incorrect colouring
  pcState.pendingGroups = (result.groups_data || []).map(g => new Set(g.map(String)));
  pcRenderWires();
  pcUpdateWireStatus();

  // Update circuit status bar
  const cs = document.getElementById('pc-circuit-status');
  if (cs) {
    if (rejected) {
      cs.innerHTML = `Circuit status: <b style="color:#ef4444">❌ Rejected by faculty — ${result.review_comments || 'Please redo the assessment.'}</b>`;
    } else if (approved && pass) {
      cs.innerHTML = `Circuit status: <b style="color:#22c55e">✅ Approved by faculty — PASS! All connections correct.</b>`;
    } else if (approved && !pass) {
      cs.innerHTML = `Circuit status: <b style="color:#ef4444">✅ Reviewed by faculty — FAIL. ${result.groups_correct}/${result.groups_total} groups correct.</b>`;
    }
  }

  const mini = document.getElementById('pc-status-mini');
  if (mini) {
    mini.textContent = rejected ? 'Rejected' : pass ? 'PASS' : 'FAIL';
    mini.style.color = (approved && pass) ? '#22c55e' : '#ef4444';
  }

  const attemptEl = document.getElementById('pc-attempt');
  if (attemptEl) attemptEl.textContent = `#${result.attempt_number}`;

// Show result banner in status panel
const wireStatus = document.getElementById('pc-wire-status');
if (wireStatus) {
  const banner = document.createElement('div');
  banner.className = `pc-result-banner ${pass && approved ? 'pc-result-pass' : 'pc-result-fail'}`;
  const m = String(Math.floor(result.time_taken_seconds/60)).padStart(2,'0');
  const s = String(result.time_taken_seconds%60).padStart(2,'0');

  banner.innerHTML = `
    <div style="font-weight:700;font-size:15px">
      ${rejected ? '❌ Rejected by Faculty' : pass ? '✅ PASS — Well done!' : '⚠️ FAIL — Try again'}
    </div>

    <div style="font-size:12px;opacity:.9;margin-top:3px">
      Score: ${result.score}% · Time: ${m}:${s} · Attempt #${result.attempt_number}
    </div>

    ${result.review_comments 
      ? `<div style="font-size:11px;margin-top:4px;opacity:.85">
          Faculty note: ${escapeHtml(result.review_comments)}
        </div>` 
      : ''
    }

    <div style="font-size:11px;margin-top:6px;opacity:.75">
      Reviewer: ${result.reviewer_name || 'Faculty'}
    </div>

    <br>

    ${
      approved
      ? `
      <button 
        class="btn btn-primary"
        onclick="generateReport()">

        📄 Download Lab Report

      </button>
      `
      : ''
    }
  `;

  wireStatus.prepend(banner);
}
  // Toast
  toast(rejected
    ? '❌ Faculty rejected your submission. Review feedback and retry.'
    : pass
      ? '🎉 PASS! Faculty approved your assessment.'
      : `Score: ${result.score}% — FAIL. Faculty has reviewed.`);
}
// ===============================
// Assessment Board Full Screen
// ===============================

function pcFullscreenBoard(){


let board =
document.getElementById("pc-board-wrap");


if(!board) return;


let box =
document.createElement("div");


box.id="pc-fullscreen";


box.innerHTML = `

<div style="
position:fixed;
inset:0;
background:#222;
z-index:999999;
display:flex;
flex-direction:column;
">


<div style="
height:45px;
background:#111;
display:flex;
justify-content:flex-end;
gap:10px;
padding:8px;
">

<button onclick="pcUndoWire()">
↩ Undo
</button>

<button onclick="pcDeleteWire()">
🗑 Delete
</button>
<button onclick="pcZoomOut()">−</button>

<button onclick="pcZoomReset()">
100%
</button>

<button onclick="pcZoomIn()">+</button>


<button onclick="pcCloseFullscreen()">

Exit Fullscreen

</button>


</div>


<div id="pc-full-area"
style="
flex:1;
overflow:auto;
display:flex;
align-items:center;
justify-content:center;
">

</div>


</div>

`;


document.body.appendChild(box);


document
.getElementById("pc-full-area")
.appendChild(board);


}



function pcCloseFullscreen(){


let normal =
document.querySelector(".pc-board-panel");


let board =
document.getElementById("pc-board-wrap");


if(normal && board){

normal.appendChild(board);

}


document
.getElementById("pc-fullscreen")
.remove();


}


// ============================================================================
// RESISTANCE BANK — Student Assessment — intro → safety → launch →
// Practical Evaluation (Node A/B + typed Rth answer, graded instantly via
// rbComputeRth's exact nodal-analysis solve). See the RB_PAIRS/rbComputeRth
// block near the top of this file for the solver itself.
// ============================================================================
let rbState = null;

function rbResetState() {
  rbState = {
    wires: [], pendingNode: null, selectedWire: null, mode: 'manual',
    rawGroups: [], serialPort: null, serialReader: null, serialConnected: false,
    // ---- Practical Evaluation session (mirrors style.py's evaluation panel) ----
    totalAttempts: 3, attemptsRemaining: 3,
    totalResets: 3, resetsRemaining: 3,
    timeRemainingSeconds: 20 * 60,
    timerHandle: null,
    experimentFinished: false,
    finalIsCorrect: null,
    lastEval: null, // { node_a, node_b, student_answer, correct_value, tolerance_percent, error_percent }
  };
}

// ============================================================================
// Resistance Bank Assessment — Overview Page
// ----------------------------------------------------------------------------
// New navigation hub: Assessment → Resistance Bank Assessment → Overview,
// which hosts Level 1 and Level 2 as two cards instead of Level 2 living as
// its own top-level sidebar entry. Does not change any Level 1 or Level 2
// wiring/evaluation logic — it only reads existing results to compute a
// status label and decides which existing screen a button should open.
// ============================================================================

const RB_STATUS_META = {
  not_started: { label: 'Not Started',              color: '#64748b', bg: '#f1f5f9' },
  locked:      { label: 'Locked',                    color: '#94a3b8', bg: '#f1f5f9' },
  available:   { label: 'Available',                 color: '#2563eb', bg: '#eff6ff' },
  in_progress: { label: 'In Progress',                color: '#B45309', bg: '#FFF7ED' },
  pending:     { label: 'Pending Faculty Approval',   color: '#854d0e', bg: '#fef9c3' },
  approved:    { label: 'Approved',                   color: '#166534', bg: '#dcfce7' },
};

async function renderRBOverview() {
  const root = document.getElementById('page-assessment');
  if (!root) return;
  root.innerHTML = `<div class="empty-state">Loading assessment overview…</div>`;

  // ---------- Level 1 status (from existing /assessments/me records) ----------
  let level1Records = [];
  try {
    const mine = await api('/assessments/me');
    level1Records = mine
      .filter(r => r.kit_id === 'resistance_bank')
      .sort((a, b) => (b.id || 0) - (a.id || 0));
  } catch (e) { /* non-fatal */ }
  const level1Latest = level1Records[0] || null;

  let level1Status = 'not_started';
  if (level1Latest) {
    if (level1Latest.faculty_approved === 'approved') level1Status = 'approved';
    else if (level1Latest.faculty_approved === 'pending') level1Status = 'pending';
    else level1Status = 'in_progress'; // rejected — student can retry
  }
  const level1Approved = level1Status === 'approved';

  // ---------- Level 2 status (locked until Level 1 is approved) ----------
  let l2Assessment = null;
  if (level1Approved) {
    try { l2Assessment = await api('/level2/assessments/active'); } catch (e) { /* non-fatal */ }
  }
  let l2Records = [];
  if (l2Assessment) {
    try {
      const all = await api('/level2/results/me');
      l2Records = all
        .filter(r => r.assessment_id === l2Assessment.id)
        .sort((a, b) => (b.id || 0) - (a.id || 0));
    } catch (e) { /* non-fatal */ }
  }
  const l2Latest = l2Records[0] || null;
  const l2AttemptsLeft = l2Assessment ? (l2Assessment.max_attempts - l2Records.length) : null;

  let level2Status = 'locked';
  if (level1Approved) {
    if (l2Latest && l2Latest.faculty_approved === 'approved') level2Status = 'approved';
    else if (l2Latest && l2Latest.faculty_approved === 'pending') level2Status = 'pending';
    else if (l2Latest && l2Latest.faculty_approved === 'rejected' && l2AttemptsLeft > 0) level2Status = 'in_progress';
    else level2Status = 'available';
  }
  const level2Approved = level2Status === 'approved';
  const bothApproved = level1Approved && level2Approved;

  const l1Meta = RB_STATUS_META[level1Status];
  const l2Meta = RB_STATUS_META[level2Status];

  const l1ButtonHtml = level1Status === 'not_started'
    ? `<button class="btn btn-primary btn-sm" style="width:100%" onclick="rbOpenCard()">Start Level 1</button>`
    : level1Status === 'in_progress'
      ? `<button class="btn btn-primary btn-sm" style="width:100%" onclick="rbOpenCard()">Continue</button>`
      : `<button class="btn btn-sm" style="width:100%" onclick="rbShowSubmissionSummary(${JSON.stringify(level1Latest).replace(/"/g, '&quot;')}, false)">View Submission</button>`;

  const l2ButtonHtml = level2Status === 'locked'
    ? `<button class="btn btn-sm" style="width:100%" disabled title="Complete Level 1 and wait for faculty approval to unlock Level 2">🔒 Locked</button>`
    : level2Status === 'available'
      ? `<button class="btn btn-primary btn-sm" style="width:100%" onclick="goto('level2');renderLevel2Page()">Start Level 2</button>`
      : level2Status === 'in_progress'
        ? `<button class="btn btn-primary btn-sm" style="width:100%" onclick="goto('level2');renderLevel2Page()">Continue</button>`
        : `<button class="btn btn-sm" style="width:100%" onclick="rbShowSubmissionSummary(${JSON.stringify(l2Latest).replace(/"/g, '&quot;')}, true)">View Submission</button>`;

  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn btn-sm" onclick="goto('assessment');renderAssessmentDashboard()">← Back</button>
      <div>
        <div style="font-weight:700;font-size:16px;color:#0B2545">🔶 Resistance Bank Assessment</div>
        <div style="font-size:12px;color:#64748b">Complete Level 1 and get it faculty-approved to unlock Level 2.</div>
      </div>
      ${currentUser?.role === 'staff' ? `
      <button class="btn btn-sm" style="margin-left:auto" onclick="goto('level2');l2RenderConfigPage()">⚙️ Level 2 Configuration</button>` : ''}
      ${currentUser?.role !== 'staff' && level1Status !== 'not_started' ? `
      <button class="btn btn-sm" style="margin-left:auto;color:#991b1b;border-color:#fecaca" onclick="rbConfirmReset()">🔄 Reset Assessment</button>` : ''}
    </div>

    <div class="proj-grid">
      <div class="proj-card" style="border-left:4px solid ${l1Meta.color}">
        <div class="proj-head">
          <div class="proj-ico" style="background:${l1Meta.bg}">1️⃣</div>
          <div>
            <div class="proj-title">Equivalent Resistance</div>
            <div class="proj-co">Level 1</div>
          </div>
        </div>
        <div class="proj-desc">Complete the existing resistance wiring and equivalent resistance assessment.</div>
        <div style="margin:10px 0">
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;color:${l1Meta.color};background:${l1Meta.bg}">${l1Meta.label}</span>
        </div>
        <div class="proj-footer" style="display:block">${l1ButtonHtml}</div>
      </div>

      <div class="proj-card" style="border-left:4px solid ${l2Meta.color};${level2Status === 'locked' ? 'opacity:.75' : ''}">
        <div class="proj-head">
          <div class="proj-ico" style="background:${l2Meta.bg}">2️⃣</div>
          <div>
            <div class="proj-title">Target Resistance Challenge</div>
            <div class="proj-co">Level 2</div>
          </div>
        </div>
        <div class="proj-desc">Create a resistor network that matches the target resistance within the specified tolerance.</div>
        <div style="margin:10px 0">
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;color:${l2Meta.color};background:${l2Meta.bg}">${l2Meta.label}</span>
        </div>
        <div class="proj-footer" style="display:block">${l2ButtonHtml}</div>
      </div>
    </div>

    ${bothApproved ? `
    <div class="card" style="max-width:680px;margin-top:18px;text-align:center;background:linear-gradient(135deg,#0B2545,#0E7C7B)">
      <div style="color:#fff;font-weight:700;font-size:15px;margin-bottom:4px">🎉 Both levels approved!</div>
      <div style="color:rgba(255,255,255,.85);font-size:12px;margin-bottom:14px">Your combined Level 1 + Level 2 Final Practical Report is ready.</div>
      <button class="btn btn-primary" id="rb-final-report-btn" onclick="rbDownloadFinalReport()">📄 Download Final Practical Report</button>
    </div>` : ''}

    <div id="rb-submission-summary-wrap" style="margin-top:16px"></div>
  `;

  updateAIVisibility();
}

// Read-only submission summary for a Level 1 or Level 2 record. Does not
// touch any existing evaluation UI — purely displays already-stored fields.
function rbShowSubmissionSummary(record, isLevel2) {
  const wrap = document.getElementById('rb-submission-summary-wrap');
  if (!wrap || !record) return;

  const fa = record.faculty_approved || 'pending';
  const statusColor = fa === 'approved' ? '#166534' : fa === 'rejected' ? '#991b1b' : '#854d0e';
  const statusBg    = fa === 'approved' ? '#dcfce7' : fa === 'rejected' ? '#fee2e2' : '#fef9c3';
  const statusLabel = fa === 'approved' ? '✅ Approved' : fa === 'rejected' ? '❌ Rejected' : '⏳ Pending Faculty Approval';
  const resultLabel = record.status || record.result || '—';
  const dateLabel = record.date || (record.submission_time ? new Date(record.submission_time).toLocaleDateString() : '—');

  wrap.innerHTML = `
    <div class="card" style="max-width:560px">
      <div class="card-title">${isLevel2 ? '🎯 Level 2' : '🔶 Level 1'} — Your Submission</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0">
        <span style="padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;color:${statusColor};background:${statusBg}">${statusLabel}</span>
        <span style="font-size:12px;color:#64748b">Attempt #${record.attempt_number ?? '—'}</span>
        <span style="font-size:12px;color:#64748b">${escapeHtml(String(dateLabel))}</span>
      </div>
      <div style="font-size:12px;color:#334155;line-height:1.9">
        <div><b>Result:</b> ${escapeHtml(String(resultLabel))}</div>
        ${record.reviewer_name ? `<div><b>Reviewer:</b> ${escapeHtml(record.reviewer_name)}</div>` : ''}
        ${record.review_comments ? `<div><b>Faculty comments:</b> ${escapeHtml(record.review_comments)}</div>` : ''}
      </div>
      <div style="margin-top:12px;text-align:right">
        <button class="btn btn-sm" onclick="document.getElementById('rb-submission-summary-wrap').innerHTML=''">Close</button>
      </div>
    </div>`;
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Downloads the combined Level 1 + Level 2 PDF from the existing, already
// gated backend endpoint (/assessments/resistance-bank-report/{user_id}).
// This endpoint already refuses to generate the file unless both levels
// are faculty-approved, so no new gating logic is introduced here.
async function rbDownloadFinalReport() {
  const btn = document.getElementById('rb-final-report-btn');
  const userId = currentUser?.id;
  if (!userId) { toast('Could not identify your account — please re-login.'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  try {
    const res = await fetch(`${API_BASE}/assessments/resistance-bank-report/${userId}`, {
      headers: window.token ? { 'Authorization': `Bearer ${window.token}` } : {},
    });
    if (!res.ok) {
      let msg = 'Report is not ready yet.';
      try { const j = await res.json(); if (j.detail) msg = j.detail; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resistance_bank_practical_report.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast(e.message || 'Could not download the final report.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📄 Download Final Practical Report'; }
  }
}

// ----------------------------------------------------------------------------
// Reset Assessment — wipes this student's entire Resistance Bank progress
// (Level 1 + Level 2: submissions, faculty approval/comments, calculated
// answers, jumper/wiring data, stored board images, and any generated
// Final Practical Report) via DELETE /assessments/resistance-bank/reset,
// then clears the local Digital Twin board state so the student experiences
// the assessment exactly as if it had never been attempted. Does not touch
// the resistance calculation/solver or hardware integration.
// ----------------------------------------------------------------------------
function rbEnsureResetModal() {
  if (document.getElementById('rb-reset-modal-overlay')) return;
  const div = document.createElement('div');
  div.id = 'rb-reset-modal-overlay';
  div.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  div.addEventListener('click', e => { if (e.target === div) rbCloseResetModal(); });
  div.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:24px;box-shadow:0 25px 60px rgba(0,0,0,.35)">
      <div style="font-weight:700;font-size:16px;color:#0B2545;margin-bottom:8px">Are you sure you want to reset this assessment?</div>
      <div style="font-size:13px;color:#64748b;line-height:1.6;margin-bottom:20px">This will remove all submissions and approvals. Level 1 and Level 2 will return to Not Started / Locked, and the Digital Twin board will be cleared. This cannot be undone.</div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-sm" id="rb-reset-cancel-btn" onclick="rbCloseResetModal()">Cancel</button>
        <button class="btn btn-sm btn-primary" id="rb-reset-confirm-btn" style="background:#991b1b;border-color:#991b1b" onclick="rbPerformReset()">Reset</button>
      </div>
    </div>`;
  document.body.appendChild(div);
}

function rbConfirmReset() {
  rbEnsureResetModal();
  document.getElementById('rb-reset-modal-overlay').style.display = 'flex';
}

function rbCloseResetModal() {
  const overlay = document.getElementById('rb-reset-modal-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function rbPerformReset() {
  const btn = document.getElementById('rb-reset-confirm-btn');
  const cancelBtn = document.getElementById('rb-reset-cancel-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Resetting…'; }
  if (cancelBtn) cancelBtn.disabled = true;
  try {
    await api('/assessments/resistance-bank/reset', { method: 'DELETE' });

    // Stop any running timers before discarding state, so a stale interval
    // can't keep firing against a reset session.
    if (rbState?.timerHandle) clearInterval(rbState.timerHandle);
    if (l2State?.timerHandle) clearInterval(l2State.timerHandle);

    // Return the live Digital Twin board(s) to a blank state — no jumper
    // wires, no groups, no calculated Rth, timer/attempts back to default.
    rbResetState();
    l2State = null;

    rbCloseResetModal();
    toast('Assessment reset. You can start fresh.');
    renderRBOverview();
  } catch (e) {
    toast(e.message || 'Could not reset the assessment.');
    if (btn) { btn.disabled = false; btn.textContent = 'Reset'; }
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

function rbOpenCard() {
  const root = document.getElementById('page-assessment');
  if (!root) return;
  root.innerHTML = `
    <div class="card" style="max-width:680px;margin:0 auto">
      <div class="card-title">${escapeHtml(RB_EXPERIMENT.name)} — Objective</div>
      <p style="color:var(--color-text-secondary);font-size:13px;line-height:1.6">${escapeHtml(RB_EXPERIMENT.objective)}</p>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        <span class="skill-pill">Difficulty: ${RB_EXPERIMENT.difficulty}</span>
        <span class="skill-pill">Duration: ${RB_EXPERIMENT.duration}</span>
      </div>
      <div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn" onclick="renderRBOverview()">Cancel</button>
        <button class="btn btn-primary" onclick="rbShowSafety()">Next: Safety instructions →</button>
      </div>
    </div>`;
}

function rbShowSafety() {
  const root = document.getElementById('page-assessment');
  root.innerHTML = `
    <div class="card" style="max-width:680px;margin:0 auto">
      <div class="card-title">⚠️ Safety Instructions</div>
      <ul style="color:var(--color-text-secondary);font-size:13px;line-height:1.8;padding-left:18px">
        ${RB_EXPERIMENT.safety.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
      </ul>
      <div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn" onclick="rbOpenCard()">← Back</button>
        <button class="btn btn-primary" onclick="rbLaunchAssessment()">Launch Assessment →</button>
      </div>
    </div>`;
}

function rbLaunchAssessment() {
  window.assessmentRunning = true;
  rbResetState();
  if (window.LiveCircuitSync) {
    window.LiveCircuitSync.startSession({
      kit_id: 'resistance_bank',
      assignment_id: 'resistance_bank_level1',
      assignment_title: 'Resistance Bank Assessment',
      wires: [],
      mode: 'manual',
    });
  }
  const root = document.getElementById('page-assessment');
  const name = (currentUser && (currentUser.name || currentUser.email)) || 'Student';
  const serialSupported = ('serial' in navigator);

  root.innerHTML = `
    <div class="card" style="margin-bottom:12px;padding:12px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:13px;color:#0B2545" id="rb-hw-title">
            ${serialSupported ? '🔌 Hardware Kit: Not connected' : '⚠️ Web Serial not supported'}
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:3px" id="rb-hw-sub">
            ${serialSupported
              ? 'Plug in the Resistance Bank trainer kit via USB, then click Connect.'
              : 'Use Chrome/Edge on desktop for hardware mode. Using manual simulation instead.'}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${serialSupported
            ? `<button class="btn btn-primary btn-sm" id="rb-hw-connect-btn" onclick="rbConnectHardware()">⚡ Connect Hardware Kit</button>
               <button class="btn btn-sm" id="rb-hw-disconnect-btn" style="display:none" onclick="rbDisconnectHardware()">Disconnect</button>`
            : ''}
          <button class="btn btn-sm" onclick="rbUseManualMode()">Use manual simulation</button>
        </div>
      </div>
    </div>

    <div class="pc-layout">
      <!-- Board -->
      <div class="pc-board-panel card">
        <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">
          Resistance Bank Board
          <span id="rb-mode-badge" class="pc-mode-badge pc-mode-manual">MANUAL SIMULATION</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
          <span style="font-size:11px;color:#64748b;flex:1">Resistance Bank Board</span>
          <div style="display:flex;gap:4px">
            <button onclick="rbZoomOut()" title="Zoom Out" style="width:28px;height:28px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:14px;color:#334155">−</button>
            <button onclick="rbZoomReset()" title="Reset Zoom" style="height:28px;padding:0 8px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:10px;color:#334155;font-weight:600" id="rb-zoom-label">100%</button>
            <button onclick="rbZoomIn()" title="Zoom In" style="width:28px;height:28px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:14px;color:#334155">+</button>
            <button onclick="rbFullscreenBoard()" style="height:28px;padding:0 10px;border-radius:6px;border:1px solid #e2e8f0;background:#2563eb;color:white;cursor:pointer;font-size:11px;font-weight:600">⛶ Full</button>
          </div>
        </div>
        <div class="pc-board-wrap" id="rb-board-wrap" style="overflow:auto;max-height:520px;border-radius:10px;background:#111;border:1px solid #333;">
          <svg id="rb-svg" viewBox="${RB_BOARD_VIEWBOX}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;min-width:300px;transition:width .15s">
            <image href="${RB_BOARD_IMAGE}" x="0" y="0" width="1438" height="1094" preserveAspectRatio="xMidYMid meet"/>
            <g id="rb-wires"></g>
            <g id="rb-sockets"></g>
          </svg>
        </div>
        <div style="font-size:10px;color:#94a3b8;margin-top:4px;text-align:center" id="rb-board-hint">
          Click a socket, then click another socket to draw a jumper. Click the same pair again to remove.
        </div>
      </div>

      <!-- Practical Evaluation -->
      <div class="pc-center-panel card">
        <div class="card-title">Practical Evaluation</div>
        <div style="font-size:11px;color:#64748b;margin-bottom:10px">Experiment: Resistance Bank — wire any network, pick two terminals, calculate Rth by hand.</div>

        <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;margin-bottom:4px">MEASUREMENT TERMINALS</div>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
          <label style="font-size:12px;color:#334155">Node A
            <input id="rb-node-a" type="text" placeholder="e.g. 9" oninput="if(window.rbRenderWires)rbRenderWires()" style="width:60px;margin-left:6px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;text-align:center">
          </label>
          <label style="font-size:12px;color:#334155">Node B
            <input id="rb-node-b" type="text" placeholder="e.g. 17" oninput="if(window.rbRenderWires)rbRenderWires()" style="width:60px;margin-left:6px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;text-align:center">
          </label>
        </div>

        <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;margin-bottom:4px">YOUR ANSWER</div>
        <input id="rb-student-answer" type="text" placeholder="e.g. 104.5k, 1.045e5, 104500 Ω, 1.045 × 10^5"
          oninput="if(window.rbRenderWires)rbRenderWires()"
          style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="font-size:12px;color:#64748b">Tolerance</span>
          <select id="rb-tolerance" style="padding:5px;border:1px solid #e2e8f0;border-radius:6px">
            <option value="1">±1%</option>
            <option value="2">±2%</option>
            <option value="5" selected>±5%</option>
            <option value="10">±10%</option>
          </select>
        </div>
        <button id="rb-submit-answer-btn" class="btn btn-primary" style="width:100%" onclick="rbSubmitAnswer()">Submit Answer</button>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:14px 0">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:9px;color:#94a3b8;font-weight:700;letter-spacing:.5px">ATTEMPTS</div>
            <div id="rb-attempts-label" style="font-size:14px;font-weight:700;color:#0B2545">3 / 3</div>
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:9px;color:#94a3b8;font-weight:700;letter-spacing:.5px">TIME LEFT</div>
            <div id="rb-time-label" style="font-size:14px;font-weight:700;color:#0B2545">20:00</div>
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:9px;color:#94a3b8;font-weight:700;letter-spacing:.5px">RESETS LEFT</div>
            <div id="rb-resets-label" style="font-size:14px;font-weight:700;color:#0B2545">3 / 3</div>
          </div>
        </div>
        <button id="rb-reset-attempts-btn" class="btn" style="width:100%;margin-bottom:12px" onclick="rbResetAttempts()">Reset Attempts</button>

        <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;margin-bottom:4px">HOW WE READ YOUR ANSWER</div>
        <div style="font-size:11px;color:#475569;margin-bottom:2px">Student input: <span id="rb-echo-input">—</span></div>
        <div style="font-size:11px;color:#475569;margin-bottom:10px">Interpreted as: <span id="rb-echo-interp">—</span></div>

        <div id="rb-status-banner" style="text-align:center;padding:10px;border-radius:8px;border:1px solid #e2e8f0;background:#f1f5f9;color:#475569;font-weight:700;font-size:13px">Not Submitted</div>

        <div class="card-title" style="margin-top:16px">Live Wiring Status</div>
        <div id="rb-wire-status" class="pc-wire-list">
          <p class="empty-state">No jumpers yet. Click two sockets to add one.</p>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="rb-undo-btn" onclick="rbUndoWire()">↩ Undo</button>
          <button class="btn" id="rb-delete-btn" onclick="rbDeleteWire()">🗑 Delete selected</button>
          <button class="btn" id="rb-clear-btn" onclick="rbClearWiring()">Clear all wires</button>
        </div>
      </div>

      <!-- Info -->
      <div class="pc-info-panel card">
        <div class="card-title">Assessment Info</div>
        <div class="pc-info-row"><span>Student</span><b>${escapeHtml(name)}</b></div>
        <div class="pc-info-row"><span>Experiment</span><b style="font-size:11px">${escapeHtml(RB_EXPERIMENT.name)}</b></div>
        <div style="margin-top:14px">
          <button class="btn" style="width:100%" onclick="rbExitAssessment()">Exit to Dashboard</button>
        </div>
      </div>
    </div>
  `;

  rbDrawSockets();
  rbRenderWires();
  rbUpdateWireStatus();
  rbRefreshAttemptsLabel();
  rbRefreshResetsLabel();
  rbRefreshTimeLabel();
  rbState.timerHandle = setInterval(rbTickTimer, 1000);

  updateAIVisibility();
}

function rbExitAssessment() {
  if (window.LiveCircuitSync) {
    window.LiveCircuitSync.leaveSession();
  }
  rbDisconnectHardware();
  if (rbState?.timerHandle) clearInterval(rbState.timerHandle);
  if (rbState?.pollHandle) clearInterval(rbState.pollHandle);
  window.assessmentRunning = false;
  renderRBOverview();
  updateAIVisibility();
}

function rbUseManualMode() {
  if (!rbState) return;
  rbState.mode = 'manual';
  const badge = document.getElementById('rb-mode-badge');
  if (badge) { badge.textContent = 'MANUAL SIMULATION'; badge.className = 'pc-mode-badge pc-mode-manual'; }
  const hint = document.getElementById('rb-board-hint');
  if (hint) hint.textContent = 'Click a socket, then click another socket to draw a jumper. Click the same pair again to remove.';
  rbUpdateWireStatus();
}

// ============================================================================
// SHARED Web Serial hardware integration — reads {"connections":[[a,b],...]}
// lines, matching the Arduino Mega firmware (hardware/sketch_jul02a.ino) and
// the reference desktop twin script's protocol for the Resistance Bank board.
//
// This is the ONLY Web Serial connection implementation for the Resistance
// Bank board in this app. Both Level 1 (rbState / "rb-*" DOM ids) and Level 2
// (l2State / "l2-*" DOM ids) call these SAME three functions — the state
// object, DOM id prefix, and a small per-level callback are passed in as
// arguments instead of the logic being copy-pasted per level. Do not fork
// this into a second implementation for Level 2 or any future level; add a
// new (state, idPrefix, onConnections) call site instead.
// ============================================================================
async function rbSharedConnectHardware(state, idPrefix, onConnections) {
  if (!('serial' in navigator)) { toast('Web Serial needs Chrome or Edge on desktop.'); return; }
  // Ask the backend to give up the COM port first, in case it's still
  // holding it open from a previous staff approval/rejection cycle (see
  // releaseRelayPort() in app.js). Harmless no-op if nothing was open.
  await releaseRelayPort();
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    state.serialPort = port;
    state.serialConnected = true;
    state.mode = 'hardware';
    const t = document.getElementById(`${idPrefix}-hw-title`);
    const s = document.getElementById(`${idPrefix}-hw-sub`);
    if (t) t.textContent = '🟢 Hardware Kit: Connected (live)';
    if (s) s.textContent = 'Live jumper data streaming from board.';
    const connectBtn = document.getElementById(`${idPrefix}-hw-connect-btn`);
    const disconnectBtn = document.getElementById(`${idPrefix}-hw-disconnect-btn`);
    if (connectBtn) connectBtn.style.display = 'none';
    if (disconnectBtn) disconnectBtn.style.display = '';
    const badge = document.getElementById(`${idPrefix}-mode-badge`);
    if (badge) { badge.textContent = 'LIVE HARDWARE'; badge.className = 'pc-mode-badge pc-mode-hw'; }
    rbSharedReadSerialLoop(state, port, onConnections);
    toast('Hardware kit connected.');
  } catch (e) { toast('Could not connect: ' + e.message); }
}

async function rbSharedReadSerialLoop(state, port, onConnections) {
  const dec = new TextDecoderStream();
  // Store the pipe teardown promise so rbSharedDisconnectHardware() can
  // await it before calling port.close() (see pcReadSerialLoop for why).
  state.readableClosed = port.readable.pipeTo(dec.writable).catch(() => {});
  const reader = dec.readable.getReader();
  state.serialReader = reader;
  let buf = '';
  try {
    while (state.serialConnected) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith('{')) {
          try {
            const d = JSON.parse(line);
            const pairs = (d.connections || []).map(([a,b]) => [String(a), String(b)]);
            onConnections(pairs);
          } catch (e) {}
        }
      }
    }
  } catch (e) { if (state?.serialConnected) toast('Serial error: ' + e.message); }
  finally { try { reader.releaseLock(); } catch (e) {} }
}

async function rbSharedDisconnectHardware(state, idPrefix) {
  if (!state) return;
  state.serialConnected = false;
  try { if (state.serialReader) await state.serialReader.cancel(); } catch (e) {}
  try { if (state.readableClosed) await state.readableClosed; } catch (e) {}
  try { if (state.serialPort)   await state.serialPort.close(); }   catch (e) {}
  state.serialPort = null;
  state.serialReader = null;
  state.readableClosed = null;
  const t = document.getElementById(`${idPrefix}-hw-title`);
  if (t) t.textContent = '🔌 Hardware Kit: Not connected';
  const connectBtn = document.getElementById(`${idPrefix}-hw-connect-btn`);
  const disconnectBtn = document.getElementById(`${idPrefix}-hw-disconnect-btn`);
  if (connectBtn) connectBtn.style.display = '';
  if (disconnectBtn) disconnectBtn.style.display = 'none';
}

// ---------- Level 1 call sites for the shared hardware integration above ----------
function rbConnectHardware() {
  return rbSharedConnectHardware(rbState, 'rb', rbOnHardwareConnections);
}

function rbOnHardwareConnections(pairs) {
  if (!rbState || rbState.experimentFinished) return;
  // rbComputeRth() (Union-Find + full resistor graph + Laplacian solve)
  // reads rbState.wires, NOT rawGroups — rawGroups is only used for the
  // on-screen wire-status/grouping display. Without this line, hardware
  // mode left rbState.wires empty (or stale from a prior manual session),
  // so every Rth calculation ran with zero jumpers unioned — sockets
  // stayed electrically isolated no matter how the board was actually
  // wired, producing wrong Rth / spurious "Open Circuit" / "Outside
  // Tolerance" results even for correct physical wiring.
  rbState.wires = pairs;
  rbState.rawGroups = pcWiresToGroups(pairs);
  rbRenderWires();
  rbUpdateWireStatus();
}

function rbDisconnectHardware() {
  return rbSharedDisconnectHardware(rbState, 'rb');
}

// ---------- Countdown timer (20:00, mirrors style.py's eval_timer) ----------
function rbTickTimer() {
  if (!rbState || rbState.experimentFinished) return;
  rbState.timeRemainingSeconds = Math.max(0, rbState.timeRemainingSeconds - 1);
  rbRefreshTimeLabel();
  if (rbState.timeRemainingSeconds <= 0) {
    rbFinishExperiment('Time Expired');
  }
}
function rbRefreshTimeLabel() {
  const el = document.getElementById('rb-time-label');
  if (!el || !rbState) return;
  const m = String(Math.floor(rbState.timeRemainingSeconds / 60)).padStart(2, '0');
  const s = String(rbState.timeRemainingSeconds % 60).padStart(2, '0');
  el.textContent = `${m}:${s}`;
}
function rbRefreshAttemptsLabel() {
  const el = document.getElementById('rb-attempts-label');
  if (el && rbState) el.textContent = `${rbState.attemptsRemaining} / ${rbState.totalAttempts}`;
}
function rbRefreshResetsLabel() {
  const el = document.getElementById('rb-resets-label');
  if (el && rbState) el.textContent = `${rbState.resetsRemaining} / ${rbState.totalResets}`;
}

// ---------- Zoom ----------
let rbZoomLevel = 1.0;
function rbApplyZoom() {
  const svg = document.getElementById('rb-svg');
  const wrap = document.getElementById('rb-board-wrap');
  if (!svg || !wrap) return;
  svg.style.width = Math.round(wrap.clientWidth * rbZoomLevel) + 'px';
  const label = document.getElementById('rb-zoom-label');
  if (label) label.textContent = Math.round(rbZoomLevel * 100) + '%';
}
function rbZoomIn()    { rbZoomLevel = Math.min(3, rbZoomLevel + 0.25); rbApplyZoom(); }
function rbZoomOut()   { rbZoomLevel = Math.max(0.5, rbZoomLevel - 0.25); rbApplyZoom(); }
function rbZoomReset() { rbZoomLevel = 1.0; rbApplyZoom(); }

// ---------- Sockets / wiring (manual mode) ----------
function rbDrawSockets() {
  const g = document.getElementById('rb-sockets');
  if (!g) return;
  g.innerHTML = Object.entries(RB_SOCKETS).map(([id,[x,y]]) => `
    <g class="rb-socket" data-node="${id}" onclick="rbOnSocketClick('${id}')" style="cursor:pointer" title="Node ${id}">
      <circle cx="${x}" cy="${y}" r="13" fill="black" stroke="red" stroke-width="3"/>
      <text x="${x+14}" y="${y-10}" fill="#39FF6A" font-size="11" font-weight="bold" font-family="monospace">${id}</text>
    </g>`).join('');
}

function rbCurrentGroups() {
  if (!rbState) return [];
  return rbState.mode === 'hardware' ? rbState.rawGroups : pcWiresToGroups(rbState.wires);
}

function rbOnSocketClick(nodeId) {
  if (!rbState || rbState.mode !== 'manual') { toast('Switch to manual simulation first.'); return; }
  if (rbState.experimentFinished) return;
  if (rbState.pendingNode === null) {
    rbState.pendingNode = nodeId;
    rbHighlightSocket(nodeId, true);
    return;
  }
  if (rbState.pendingNode === nodeId) {
    rbHighlightSocket(nodeId, false);
    rbState.pendingNode = null;
    return;
  }
  const a = rbState.pendingNode, b = nodeId;
  const idx = rbState.wires.findIndex(([x,y]) => (x===a&&y===b)||(x===b&&y===a));
  if (idx >= 0) rbState.wires.splice(idx, 1);
  else rbState.wires.push([a, b]);
  rbHighlightSocket(a, false);
  rbState.pendingNode = null;
  rbRenderWires();
  rbUpdateWireStatus();
}

function rbHighlightSocket(nodeId, on) {
  const el = document.querySelector(`.rb-socket[data-node="${nodeId}"] circle`);
  if (el) el.setAttribute('stroke', on ? '#39FF6A' : 'red');
}

function rbRenderWires() {
  const g = document.getElementById('rb-wires');
  if (!g) return;
  const groups = rbCurrentGroups();
  const edges = [];
  groups.forEach((grp, gi) => { rbGroupToEdges(grp).forEach(e => edges.push({ e, gi })); });
  // Jumper wires are just the network the student is building — there's no
  // per-wire "correct/incorrect" anymore (correctness is the Rth answer),
  // so every jumper renders the same neutral blue.
  g.innerHTML = edges.map(({ e:[a,b] }) => {
    if (!RB_SOCKETS[a] || !RB_SOCKETS[b]) return '';
    const [x1,y1] = RB_SOCKETS[a], [x2,y2] = RB_SOCKETS[b];
    const cx = (x1+x2)/2;
    return `<path d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}"
      stroke="#3b82f6" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  }).join('');
  if (typeof window.triggerDebouncedCircuitGuidance === 'function') {
    window.triggerDebouncedCircuitGuidance();
  }
  window.rbState = rbState;
  if (window.LiveCircuitSync && rbState) {
    window.LiveCircuitSync.updateCircuit({
      kit_id: 'resistance_bank',
      assignment_id: 'resistance_bank_level1',
      assignment_title: 'Resistance Bank Assessment',
      wires: rbState.wires || [],
      node_a: document.getElementById('rb-node-a')?.value || '',
      node_b: document.getElementById('rb-node-b')?.value || '',
      student_answer: document.getElementById('rb-student-answer')?.value || '',
      mode: rbState.mode || 'manual',
    });
  }
}

function rbUpdateWireStatus() {
  const el = document.getElementById('rb-wire-status');
  if (!el) return;
  const groups = rbCurrentGroups();
  if (groups.length === 0) {
    el.innerHTML = `<p class="empty-state">${rbState?.mode === 'hardware' ? 'Waiting for hardware…' : 'No jumpers yet. Click two sockets to add one.'}</p>`;
    return;
  }
  el.innerHTML = `
    <div style="font-size:11px;color:#64748b;margin-bottom:8px">${groups.length} jumper group(s) on the board</div>
    ${groups.map(g => {
      const nodes = [...g].sort((a,b) => Number(a)-Number(b));
      const label = rbGetPairLabel(g);
      return `<div class="pc-group-chip pc-grp-pending">
        ${nodes.join(' – ')}
        ${label ? `<span class="pc-volt-badge">${label}</span>` : ''}
      </div>`;
    }).join('')}`;
}

function rbSelectWire(i) {
  if (!rbState || rbState.mode !== 'manual') return;
  rbState.selectedWire = i;
  toast('🔴 Wire selected');
}
function rbDeleteWire() {
  if (!rbState) return;
  if (rbState.selectedWire === null || rbState.selectedWire === undefined) { toast('Select wire first'); return; }
  rbState.wires.splice(rbState.selectedWire, 1);
  rbState.selectedWire = null;
  rbRenderWires();
  rbUpdateWireStatus();
}
function rbUndoWire() {
  if (!rbState) return;
  rbState.wires.pop();
  rbRenderWires();
  rbUpdateWireStatus();
}
function rbClearWiring() {
  if (!rbState) return;
  rbState.wires = [];
  rbState.rawGroups = [];
  rbState.pendingNode = null;
  rbRenderWires();
  rbUpdateWireStatus();
}

// ============================================================================
// PRACTICAL EVALUATION — Node A / Node B + typed Rth answer, graded
// instantly against the exact nodal-analysis solve (rbComputeRth above).
// Mirrors style.py's submit_answer()/on_manual_rth_ready() exactly:
// 3 attempts, 3 resets, a 20-minute countdown, and a tolerance the
// student picks (±1/2/5/10%, default ±5%). The correct value itself is
// never shown to the student — only Correct/Incorrect.
// ============================================================================
function rbSetStatus(text, state) {
  const el = document.getElementById('rb-status-banner');
  if (!el) return;
  el.textContent = text;
  const colors = {
    correct:   { bg: '#dcfce7', fg: '#166534', bd: '#86efac' },
    incorrect: { bg: '#fee2e2', fg: '#991b1b', bd: '#fca5a5' },
    pending:   { bg: '#fef9c3', fg: '#854d0e', bd: '#fde68a' },
    locked:    { bg: '#e2e8f0', fg: '#334155', bd: '#cbd5e1' },
    neutral:   { bg: '#f1f5f9', fg: '#475569', bd: '#e2e8f0' },
  };
  const c = colors[state] || colors.neutral;
  el.style.background = c.bg; el.style.color = c.fg; el.style.borderColor = c.bd;
}

function rbSubmitAnswer() {
  if (!rbState || rbState.experimentFinished) return;

  const aText = (document.getElementById('rb-node-a')?.value || '').trim();
  const bText = (document.getElementById('rb-node-b')?.value || '').trim();
  const ansText = (document.getElementById('rb-student-answer')?.value || '').trim();
  const tolerancePercent = parseFloat(document.getElementById('rb-tolerance')?.value || '5');

  if (!aText || !bText || !ansText) { rbSetStatus('Enter Node A, Node B, and your answer.', 'neutral'); return; }
  if (!/^\d+$/.test(aText) || !/^\d+$/.test(bText)) { rbSetStatus('Node A and Node B must be whole socket numbers.', 'neutral'); return; }
  if (!RB_SOCKETS[aText] || !RB_SOCKETS[bText]) { rbSetStatus('Socket numbers must be between 1 and 30.', 'neutral'); return; }
  if (aText === bText) { rbSetStatus(`Node A and Node B are the same socket (${aText}).`, 'neutral'); return; }

  const studentAnswer = rbParseResistanceInput(ansText);
  const echoInput = document.getElementById('rb-echo-input');
  const echoInterp = document.getElementById('rb-echo-interp');
  if (echoInput) echoInput.textContent = ansText;

  if (studentAnswer === null) {
    if (echoInterp) echoInterp.textContent = '—';
    rbSetStatus('Invalid resistance format. Use Ω, kΩ, MΩ, or scientific notation (e.g. 104.5k, 1.045e5).', 'incorrect');
    return;
  }
  if (studentAnswer < 0) {
    if (echoInterp) echoInterp.textContent = '—';
    rbSetStatus('Your answer cannot be negative.', 'neutral');
    return;
  }
  if (echoInterp) echoInterp.textContent = `${studentAnswer.toLocaleString(undefined,{maximumFractionDigits:6})} Ω`;

  rbSetStatus('Evaluating…', 'pending');

  // Exact solve — Union-Find (jumper wires) + full resistor graph + nodal analysis
  const correctValue = rbComputeRth(rbState.wires, aText, bText);

  let isCorrect;
  if (correctValue === null) {
    isCorrect = false; // open circuit — no finite answer can be "correct"
  } else if (correctValue === 0.0) {
    isCorrect = studentAnswer === 0;
  } else {
    const errorPercent = Math.abs(studentAnswer - correctValue) / correctValue * 100.0;
    isCorrect = errorPercent <= tolerancePercent;
  }

  const errorPercent = (correctValue === null) ? null
    : (correctValue === 0.0 ? (studentAnswer === 0 ? 0 : null) : Math.abs(studentAnswer - correctValue) / correctValue * 100.0);

  rbState.lastEval = {
    node_a: aText, node_b: bText, student_answer: studentAnswer,
    correct_value: correctValue, tolerance_percent: tolerancePercent,
    error_percent: errorPercent, is_correct_client: isCorrect,
  };

  // Every submission — correct or incorrect, any attempt — now goes to
  // faculty for review before the student can proceed. The JS-computed
  // isCorrect is sent along as a hint, but does not itself finish the
  // experiment; only rbShowStaffDecision (after faculty approves/rejects)
  // does that.
  if (!isCorrect) {
    rbState.attemptsRemaining -= 1;
    rbRefreshAttemptsLabel();
  }

  const noRetriesLeft = !isCorrect && rbState.attemptsRemaining <= 0 && rbState.resetsRemaining <= 0;
  rbSubmitForReview(isCorrect, noRetriesLeft);
}

function rbResetAttempts() {
  if (!rbState) return;
  if (rbState.resetsRemaining <= 0) { rbSetStatus('No attempt resets remaining.', 'locked'); return; }
  if (rbState.timeRemainingSeconds <= 0) { rbSetStatus('Time Expired — resets unavailable.', 'locked'); return; }

  rbState.resetsRemaining -= 1;
  rbRefreshResetsLabel();
  rbState.attemptsRemaining = rbState.totalAttempts;
  rbRefreshAttemptsLabel();
  rbState.experimentFinished = false;

  const submitBtn = document.getElementById('rb-submit-answer-btn');
  if (submitBtn) submitBtn.disabled = false;
  ['rb-node-a','rb-node-b','rb-student-answer','rb-tolerance'].forEach(id => {
    const el = document.getElementById(id); if (el) el.disabled = false;
  });
  const resetBtn = document.getElementById('rb-reset-attempts-btn');
  if (resetBtn && rbState.resetsRemaining <= 0) resetBtn.disabled = true;

  rbSetStatus(`Attempts Reset — ${rbState.resetsRemaining} reset(s) left`, 'neutral');
}

// Every submit now locks the form and sends node_a/node_b, wires,
// student_answer, correct_value, error_percent, tolerance, and the
// JS-computed is_correct to the backend, then polls until faculty
// approves or rejects. The correct_value is sent for faculty's eyes only —
// rbSetStatus/the student-facing banner never display it.
function rbSubmitForReview(isCorrect, noRetriesLeft) {
  if (!rbState) return;
  rbState.experimentFinished = true;

  const submitBtn = document.getElementById('rb-submit-answer-btn');
  if (submitBtn) submitBtn.disabled = true;
  ['rb-node-a','rb-node-b','rb-student-answer','rb-tolerance'].forEach(id => {
    const el = document.getElementById(id); if (el) el.disabled = true;
  });

  rbSetStatus('Pending Staff Approval', 'pending');
  rbSendSubmissionToBackend(isCorrect, noRetriesLeft);
}

async function rbSendSubmissionToBackend(isCorrect, noRetriesLeft) {
  const ev = rbState.lastEval;
  const timeTaken = (20 * 60) - rbState.timeRemainingSeconds;
  const groups = rbCurrentGroups();

  let evalMeta = '';
  if (ev) {
    evalMeta = JSON.stringify({
      node_a: ev.node_a, node_b: ev.node_b, student_answer: ev.student_answer,
      correct_value: ev.correct_value, tolerance_percent: ev.tolerance_percent,
      error_percent: ev.error_percent,
      attempts_used: rbState.totalAttempts - rbState.attemptsRemaining, total_attempts: rbState.totalAttempts,
      resets_used: rbState.totalResets - rbState.resetsRemaining, total_resets: rbState.totalResets,
      needs_staff_review: true,
    });
  }

  // Automatic wiring capture — Resistance Bank board only (board image +
  // resistor sockets + jumper wires), taken at the moment of Submit.
  // Saved server-side as level1_connection.png with this assessment record.
  const wiringImage = await rbCaptureWiringImage();

  let result = null;
  try {
    result = await api('/assessments/submit', {
      method: 'POST',
      body: {
        kit_id: RB_EXPERIMENT.id,
        experiment_name: RB_EXPERIMENT.name,
        score: isCorrect ? 100 : 0,
        status: isCorrect ? 'PASS' : 'FAIL',
        time_taken_seconds: timeTaken,
        groups_correct: isCorrect ? 1 : 0,
        groups_total: 1,
        voltage_selected: evalMeta,
        wiring_data: rbState.wires,
        groups_data: groups.map(g => [...g]),
        group_correct_flags: [],
        node_a: ev?.node_a ?? null,
        node_b: ev?.node_b ?? null,
        student_answer: ev?.student_answer ?? null,
        correct_value: ev?.correct_value ?? null,
        error_percent: ev?.error_percent ?? null,
        tolerance_percent: ev?.tolerance_percent ?? null,
        is_correct_client: ev?.is_correct_client ?? isCorrect,
        wiring_image: wiringImage,
        connection_method: rbState.mode === 'hardware' ? 'Hardware Kit' : 'Manual Connection',
      },
    });
  } catch (e) {
    console.warn('Backend submit error:', e.message);
    rbSetStatus('Could not reach server — please retry submit.', 'incorrect');
    // Re-enable the form so the student can retry the submit itself.
    rbState.experimentFinished = false;
    const submitBtn = document.getElementById('rb-submit-answer-btn');
    if (submitBtn) submitBtn.disabled = false;
    ['rb-node-a','rb-node-b','rb-student-answer','rb-tolerance'].forEach(id => {
      const el = document.getElementById(id); if (el) el.disabled = false;
    });
    return;
  }

  rbState.pendingResultId = result?.id || null;
  if (rbState.pollHandle) clearInterval(rbState.pollHandle);
  if (rbState.pendingResultId) rbState.pollHandle = setInterval(rbPollForStaffDecision, 4000);

  // Release the Web Serial connection now that the final wiring snapshot
  // has been submitted — frees the COM port so the backend can open it
  // for UNLOCK/HEARTBEAT once staff approves this submission.
  if (rbState.mode === 'hardware' && rbState.serialConnected) {
    rbDisconnectHardware();
  }

  const wireStatus = document.getElementById('rb-wire-status');
  if (wireStatus) {
    const banner = document.createElement('div');
    banner.id = 'rb-staff-review-banner';
    banner.className = 'pc-result-banner';
    banner.style.cssText = 'background:#fef9c3;color:#854d0e;border:1px solid #fde68a;padding:14px;border-radius:10px;margin-bottom:10px';
    const m = String(Math.floor(timeTaken/60)).padStart(2,'0');
    const s = String(timeTaken%60).padStart(2,'0');
    banner.innerHTML = `
      <div style="font-weight:700;font-size:15px">⏳ Submitted — sent for faculty review</div>
      <div style="font-size:12px;opacity:.9;margin-top:3px">
        Time: ${m}:${s} · Attempts used: ${rbState.totalAttempts - rbState.attemptsRemaining}/${rbState.totalAttempts}
        ${result?.attempt_number ? ` · Attempt #${result.attempt_number}` : ''}
      </div>
      <div style="font-size:11px;margin-top:6px;opacity:.85">
        Your answer (${escapeHtml(String(ev?.student_answer ?? ''))} Ω) and Node A/B have been sent to a staff
        member for review. You'll see the final PASS/FAIL result here once they decide.
      </div>
    `;
    wireStatus.prepend(banner);
  }

  toast('⏳ Sent to faculty for review.');
}

function rbFinishExperiment(reason, isCorrect) {
  if (!rbState) return;
  rbState.experimentFinished = true;
  rbState.finalIsCorrect = !!isCorrect;
  if (rbState.timerHandle) { clearInterval(rbState.timerHandle); rbState.timerHandle = null; }

  const submitBtn = document.getElementById('rb-submit-answer-btn');
  if (submitBtn) submitBtn.disabled = true;
  ['rb-node-a','rb-node-b','rb-student-answer','rb-tolerance'].forEach(id => {
    const el = document.getElementById(id); if (el) el.disabled = true;
  });

  // Once BOTH attempts and resets are exhausted, this is no longer an
  // instant auto-fail — it goes to a staff member to review the student's
  // last answer and decide, same as the Power Converter's approval flow.
  const noRetriesLeft = !isCorrect && rbState.attemptsRemaining <= 0 && rbState.resetsRemaining <= 0;

  if (isCorrect) {
    // already set by rbSetStatus('✓ Correct Answer', 'correct') in rbSubmitAnswer
  } else if (noRetriesLeft) {
    rbSetStatus('Attempts & resets exhausted — Pending Staff Approval', 'pending');
  } else {
    rbSetStatus(reason, 'locked');
  }

  rbConcludeAssessment(isCorrect, reason, noRetriesLeft);
}

// NOTE: as of the faculty-review-for-every-submission change, this path is
// only reached via rbFinishExperiment('Time Expired') when the countdown
// hits zero — every graded Submit click now goes through
// rbSubmitForReview/rbSendSubmissionToBackend instead, which always defers
// to faculty regardless of attempts/resets remaining. Kept here to log a
// "Time Expired" record for students who never submitted an answer at all.
async function rbConcludeAssessment(isCorrect, reason, noRetriesLeft) {
  const ev = rbState.lastEval;
  const score = isCorrect ? 100 : 0;
  const timeTaken = (20 * 60) - rbState.timeRemainingSeconds;
  const groups = rbCurrentGroups();

  let evalMeta = '';
  if (ev) {
    evalMeta = JSON.stringify({
      node_a: ev.node_a, node_b: ev.node_b, student_answer: ev.student_answer,
      correct_value: ev.correct_value, tolerance_percent: ev.tolerance_percent,
      attempts_used: rbState.totalAttempts - rbState.attemptsRemaining, total_attempts: rbState.totalAttempts,
      resets_used: rbState.totalResets - rbState.resetsRemaining, total_resets: rbState.totalResets,
      needs_staff_review: !!noRetriesLeft,
    });
  }

  let result = null;
  try {
    result = await api('/assessments/submit', {
      method: 'POST',
      body: {
        kit_id: RB_EXPERIMENT.id,
        experiment_name: RB_EXPERIMENT.name,
        score,
        status: isCorrect ? 'PASS' : 'FAIL',
        time_taken_seconds: timeTaken,
        groups_correct: isCorrect ? 1 : 0,
        groups_total: 1,
        voltage_selected: evalMeta,
        wiring_data: rbState.wires,
        groups_data: groups.map(g => [...g]),
        group_correct_flags: [],
        connection_method: rbState.mode === 'hardware' ? 'Hardware Kit' : 'Manual Connection',
      },
    });
  } catch (e) {
    console.warn('Backend submit error:', e.message);
  }

  if (noRetriesLeft) {
    rbState.pendingResultId = result?.id || null;
    if (rbState.pollHandle) clearInterval(rbState.pollHandle);
    if (rbState.pendingResultId) rbState.pollHandle = setInterval(rbPollForStaffDecision, 4000);
  }

  const wireStatus = document.getElementById('rb-wire-status');
  if (wireStatus) {
    const banner = document.createElement('div');
    banner.id = noRetriesLeft ? 'rb-staff-review-banner' : null;
    banner.className = `pc-result-banner ${isCorrect ? 'pc-result-pass' : noRetriesLeft ? '' : 'pc-result-fail'}`;
    if (noRetriesLeft) banner.style.cssText = 'background:#fef9c3;color:#854d0e;border:1px solid #fde68a;padding:14px;border-radius:10px;margin-bottom:10px';
    const m = String(Math.floor(timeTaken/60)).padStart(2,'0');
    const s = String(timeTaken%60).padStart(2,'0');

    if (noRetriesLeft) {
      banner.innerHTML = `
        <div style="font-weight:700;font-size:15px">⏳ Out of attempts & resets — sent for faculty review</div>
        <div style="font-size:12px;opacity:.9;margin-top:3px">
          Time: ${m}:${s} · Attempts used: ${rbState.totalAttempts}/${rbState.totalAttempts} · Resets used: ${rbState.totalResets}/${rbState.totalResets}
        </div>
        <div style="font-size:11px;margin-top:6px;opacity:.85">
          Your last answer, Node A/B, and the correct Rth have been sent to a staff member.
          You'll see the final PASS/FAIL result here once they review it.
        </div>
      `;
    } else {
      banner.innerHTML = `
        <div style="font-weight:700;font-size:15px">${isCorrect ? '✅ PASS — Correct Answer!' : `⚠️ FAIL — ${escapeHtml(reason)}`}</div>
        <div style="font-size:12px;opacity:.9;margin-top:3px">
          Time: ${m}:${s} · Attempts used: ${rbState.totalAttempts - rbState.attemptsRemaining}/${rbState.totalAttempts}
          ${result?.attempt_number ? ` · Attempt #${result.attempt_number}` : ''}
        </div>
        <br>
        ${isCorrect ? `<div style="font-size:11px;color:#64748b;margin-top:4px">✅ Level 1 passed. Complete Level 2 to unlock your official Final Practical Report from the dashboard.</div>` : ''}
      `;
    }
    wireStatus.prepend(banner);
  }

  toast(isCorrect ? '🎉 Correct! Well done.' : noRetriesLeft ? '⏳ Sent to faculty for review.' : `Assessment finished — ${reason}`);
}

// Once out of attempts/resets, poll for the staff decision, same pattern
// as the Power Converter's faculty-review flow.
async function rbPollForStaffDecision() {
  if (!rbState || !rbState.pendingResultId) return;
  try {
    const result = await api(`/assessments/${rbState.pendingResultId}`);
    if (result.faculty_approved === 'approved' || result.faculty_approved === 'rejected') {
      clearInterval(rbState.pollHandle);
      rbState.pollHandle = null;
      rbShowStaffDecision(result);
    }
  } catch (e) { console.warn('Poll error:', e.message); }
}

function rbShowStaffDecision(result) {
  const approved = result.faculty_approved === 'approved';
  const oldBanner = document.getElementById('rb-staff-review-banner');
  if (oldBanner) oldBanner.remove();

  rbSetStatus(approved ? '✓ Level 1 Approved' : '✗ Rejected by Staff', approved ? 'correct' : 'incorrect');

  const wireStatus = document.getElementById('rb-wire-status');
  if (wireStatus) {
    const banner = document.createElement('div');
    banner.className = `pc-result-banner ${approved ? 'pc-result-pass' : 'pc-result-fail'}`;
    banner.innerHTML = `
      <div style="font-weight:700;font-size:15px">${approved ? '✅ Level 1 Approved' : '❌ FAIL — Rejected by Staff'}</div>
      ${result.review_comments ? `<div style="font-size:11px;margin-top:4px;opacity:.85">Faculty comments: ${escapeHtml(result.review_comments)}</div>` : ''}
      <div style="font-size:11px;margin-top:6px;opacity:.75">Reviewer: ${escapeHtml(result.reviewer_name || 'Staff')}</div>
      <br>
      ${approved ? `<div style="font-size:11px;color:#64748b;margin-top:4px;margin-bottom:8px">✅ Level 1 approved. Complete Level 2 to unlock your official Final Practical Report from the dashboard.</div> <button class="btn" onclick="goto('level2');renderLevel2Page()">➡️ Continue to Level 2</button>` : ''}
    `;
    wireStatus.prepend(banner);
  }
  toast(approved ? '🎉 Level 1 Approved — you can now access Level 2.' : '❌ Staff rejected your submission.');
}

// ---------- Fullscreen ----------
function rbFullscreenBoard() {
  let board = document.getElementById('rb-board-wrap');
  if (!board) return;
  let box = document.createElement('div');
  box.id = 'rb-fullscreen';
  box.innerHTML = `
    <div style="position:fixed;inset:0;background:#222;z-index:999999;display:flex;flex-direction:column;">
      <div style="height:45px;background:#111;display:flex;justify-content:flex-end;gap:10px;padding:8px;">
        <button onclick="rbUndoWire()">↩ Undo</button>
        <button onclick="rbDeleteWire()">🗑 Delete</button>
        <button onclick="rbZoomOut()">−</button>
        <button onclick="rbZoomReset()">100%</button>
        <button onclick="rbZoomIn()">+</button>
        <button onclick="rbCloseFullscreen()">Exit Fullscreen</button>
      </div>
      <div id="rb-full-area" style="flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;"></div>
    </div>`;
  document.body.appendChild(box);
  document.getElementById('rb-full-area').appendChild(board);
}

function rbCloseFullscreen() {
  let normal = document.querySelector('.pc-board-panel');
  let board = document.getElementById('rb-board-wrap');
  if (normal && board) normal.appendChild(board);
  const fs = document.getElementById('rb-fullscreen');
  if (fs) fs.remove();
}

// ============================================================================
// LEVEL 2 — TARGET RESISTANCE CHALLENGE
// ============================================================================
// Entirely independent of Level 1: separate state (l2State), separate DOM ids
// (l2-*), separate backend tables/routes (/level2/*). No staff approval, no
// PDF. Reuses the READ-ONLY Level 1 solver helpers (rbComputeRth, RB_SOCKETS,
// RB_BOARD_IMAGE, RB_BOARD_VIEWBOX, pcWiresToGroups, rbGroupToEdges,
// rbGetPairLabel, rbParseResistanceInput, rbDisplayOhms) without modifying
// any of them, and without touching Level 1's own rbState/page.
// ============================================================================

let l2State = null;

function l2ResetState(assessment) {
  l2State = {
    assessment,
    wires: [], pendingNode: null, selectedWire: null,
    zoom: 1.0,
    attemptsUsed: 0,
    timeRemainingSeconds: assessment.time_limit_seconds,
    timerHandle: null,
    finished: false,
  };
}

async function renderLevel2Page() {
  const root = document.getElementById('page-level2');
  if (!root) return;
  const role = currentUser?.role;

  if (role === 'staff') {
    return l2RenderStaffPage();
  }
  return l2RenderStudentEntry();
}

// ---------- STAFF: create + list Level 2 assessments ----------
async function l2RenderStaffPage() {
  const root = document.getElementById('page-level2');
  root.innerHTML = `<div class="empty-state">Loading…</div>`;
  let assessments = [];
  try { assessments = await api('/level2/assessments'); } catch (e) {}

  root.innerHTML = `
    <div class="card" style="max-width:640px;margin-bottom:16px">
      <div class="card-title">🎯 Level 2 — Target Resistance Challenge</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:14px">
        Create and manage the Target Resistance Challenge from the Level 2 Configuration page.
      </div>
      <button class="btn btn-primary" style="width:100%" onclick="goto('level2');l2RenderConfigPage()">⚙️ Open Level 2 Configuration</button>
    </div>

    <div class="card" style="max-width:640px">
      <div class="card-title">Existing Level 2 Assessments</div>
      ${assessments.length === 0 ? '<p class="empty-state">No Level 2 assessments created yet.</p>' : `
      <table class="students-table" style="font-size:12px">
        <thead><tr><th>Experiment</th><th>Target Range (per-student)</th><th>Tolerance</th><th>Time Limit</th><th>Attempts</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>
          ${assessments.map(a => `<tr>
            <td>${escapeHtml(a.experiment_name || a.title)}</td>
            <td><b>${rbDisplayOhms(a.target_min_ohms)} – ${rbDisplayOhms(a.target_max_ohms)} Ω</b><div style="font-size:10px;color:#94a3b8;font-weight:400">each student gets their own value in this range</div></td>
            <td>±${a.tolerance_percent}%</td>
            <td>${Math.round(a.time_limit_seconds / 60)} min</td>
            <td>${a.max_attempts}</td>
            <td>${a.status === 'draft'
                  ? '<span style="color:#B45309;font-weight:700">📝 Draft</span>'
                  : a.is_active ? '<span style="color:#22c55e;font-weight:700">● Published (Active)</span>' : '<span style="color:#94a3b8">Published (Inactive)</span>'}</td>
            <td style="color:#64748b">${a.created_at ? new Date(a.created_at).toLocaleString() : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>`}
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">✅ Level 2 — Staff Approval</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:10px">
        Approving or rejecting Level 2 submissions now happens only in the
        Assessment Review Dashboard, together with Level 1, so nothing gets
        reviewed twice or in two different places.
      </div>
      <button class="btn btn-primary" style="width:100%" onclick="goto('assessment');renderAdminReviewDashboard()">📋 Open Assessment Review Dashboard</button>
    </div>`;
}

// ============================================================================
// STAFF — Level 2 Configuration page
// Assessment → Resistance Bank Assessment → Level 2 Configuration
// Creates/publishes the Target Resistance Challenge that students later read
// via the existing, unmodified /level2/assessments/active + student page.
// ============================================================================

const RB_NODE_IDS = Object.keys(RB_SOCKETS).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

function l2NodeOptionsHtml(selected) {
  return RB_NODE_IDS.map(n =>
    `<option value="${n}"${String(selected) === n ? ' selected' : ''}>Node ${n}</option>`
  ).join('');
}

async function l2RenderConfigPage() {
  const root = document.getElementById('page-level2');
  if (!root) return;
  root.innerHTML = `<div class="empty-state">Loading…</div>`;

  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn btn-sm" onclick="goto('level2');l2RenderStaffPage()">← Back</button>
      <div>
        <div style="font-weight:700;font-size:16px;color:#0B2545">⚙️ Level 2 Configuration</div>
        <div style="font-size:12px;color:#64748b">Create the Target Resistance Challenge. Only Published assessments become visible to students.</div>
      </div>
    </div>

    <div class="card" style="max-width:680px">
      <div class="card-title">Target Resistance Challenge — New Assessment</div>

      <div class="form-group">
        <label class="form-label">Experiment Name</label>
        <input class="form-input" id="l2c-experiment-name" type="text" value="Resistance Bank" placeholder="Resistance Bank">
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Target Range — Min</label>
          <input class="form-input" id="l2c-target-min" type="number" step="any" placeholder="e.g. 500">
        </div>
        <div class="form-group">
          <label class="form-label">Target Range — Max</label>
          <input class="form-input" id="l2c-target-max" type="number" step="any" placeholder="e.g. 5000">
        </div>
        <div class="form-group">
          <label class="form-label">Resistance Unit</label>
          <select class="form-input" id="l2c-unit">
            <option value="Ω">Ω</option>
            <option value="kΩ">kΩ</option>
            <option value="MΩ">MΩ</option>
          </select>
        </div>
      </div>
      <div style="font-size:11px;color:#64748b;margin:-8px 0 12px 2px">
        Each student is assigned their own random, board-achievable target inside this range — so no two students see the same question.
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Measurement Terminal A</label>
          <select class="form-input" id="l2c-node-a">${l2NodeOptionsHtml('1')}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Measurement Terminal B</label>
          <select class="form-input" id="l2c-node-b">${l2NodeOptionsHtml('2')}</select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Tolerance</label>
          <select class="form-input" id="l2c-tolerance">
            <option value="1">±1%</option>
            <option value="2">±2%</option>
            <option value="5" selected>±5%</option>
            <option value="10">±10%</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Time Limit (minutes)</label>
          <input class="form-input" id="l2c-time" type="number" step="1" value="20" placeholder="e.g. 20">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Maximum Attempts</label>
        <input class="form-input" id="l2c-attempts" type="number" step="1" value="3" placeholder="e.g. 3">
      </div>

      <div class="form-group">
        <label class="form-label">Instructions</label>
        <textarea class="form-input" id="l2c-instructions" rows="4" placeholder="Create a resistor network that produces the target resistance using any combination of resistors."></textarea>
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap">
        <button class="btn" onclick="goto('level2');l2RenderStaffPage()">Cancel</button>
        <button class="btn" id="l2c-draft-btn" onclick="l2SubmitConfig('draft')">Save Draft</button>
        <button class="btn btn-primary" id="l2c-publish-btn" onclick="l2SubmitConfig('published')">Publish Assessment</button>
      </div>
    </div>`;

  updateAIVisibility();
}

function l2UnitToOhmsMultiplier(unit) {
  if (unit === 'kΩ') return 1000;
  if (unit === 'MΩ') return 1000000;
  return 1;
}

async function l2SubmitConfig(status) {
  const experimentName = document.getElementById('l2c-experiment-name')?.value.trim() || 'Resistance Bank';
  const targetMinRaw = document.getElementById('l2c-target-min')?.value;
  const targetMaxRaw = document.getElementById('l2c-target-max')?.value;
  const unit = document.getElementById('l2c-unit')?.value || 'Ω';
  const nodeA = document.getElementById('l2c-node-a')?.value;
  const nodeB = document.getElementById('l2c-node-b')?.value;
  const tolerance = parseFloat(document.getElementById('l2c-tolerance')?.value || '5');
  const minutes = parseFloat(document.getElementById('l2c-time')?.value || '20');
  const attempts = parseInt(document.getElementById('l2c-attempts')?.value || '3', 10);
  const instructions = document.getElementById('l2c-instructions')?.value.trim() || '';

  const targetMin = parseFloat(targetMinRaw);
  const targetMax = parseFloat(targetMaxRaw);
  if (targetMinRaw === '' || targetMinRaw == null || isNaN(targetMin) || targetMin <= 0) {
    toast('Enter a valid minimum target resistance (e.g. 500).'); return;
  }
  if (targetMaxRaw === '' || targetMaxRaw == null || isNaN(targetMax) || targetMax <= 0) {
    toast('Enter a valid maximum target resistance (e.g. 5000).'); return;
  }
  if (targetMin > targetMax) { toast('Target min must be less than or equal to target max.'); return; }
  if (nodeA && nodeB && nodeA === nodeB) { toast('Measurement Terminal A and B must be different nodes.'); return; }
  if (!tolerance || tolerance <= 0) { toast('Select a tolerance.'); return; }
  if (!minutes || minutes <= 0) { toast('Enter a valid time limit.'); return; }
  if (!attempts || attempts <= 0) { toast('Enter a valid number of attempts.'); return; }

  const draftBtn = document.getElementById('l2c-draft-btn');
  const publishBtn = document.getElementById('l2c-publish-btn');
  if (draftBtn) draftBtn.disabled = true;
  if (publishBtn) publishBtn.disabled = true;

  try {
    await api('/level2/assessments', {
      method: 'POST',
      body: {
        title: experimentName,
        experiment_name: experimentName,
        target_min_ohms: targetMin * l2UnitToOhmsMultiplier(unit),
        target_max_ohms: targetMax * l2UnitToOhmsMultiplier(unit),
        resistance_unit: unit,
        node_a: nodeA ? `Node ${nodeA}` : '',
        node_b: nodeB ? `Node ${nodeB}` : '',
        tolerance_percent: tolerance,
        time_limit_seconds: Math.round(minutes * 60),
        max_attempts: attempts,
        instructions,
        status,
      },
    });
    toast(status === 'draft' ? '📝 Saved as Draft.' : '✅ Level 2 assessment published.');
    goto('level2');
    l2RenderStaffPage();
  } catch (e) {
    toast('Error: ' + e.message);
    if (draftBtn) draftBtn.disabled = false;
    if (publishBtn) publishBtn.disabled = false;
  }
}

async function l2LoadReviewTab(filter) {
  ['pending','approved','rejected','all'].forEach(t => {
    const el = document.getElementById('l2rtab-' + t);
    if (el) el.className = t === filter ? 'btn btn-primary btn-sm' : 'btn btn-sm';
  });
  const content = document.getElementById('l2-review-content');
  if (!content) return;
  content.innerHTML = '<div class="empty-state">Loading…</div>';

  try {
    let rows;
    if (filter === 'all') {
      rows = await api('/level2/results/all');
    } else if (filter === 'pending') {
      rows = await api('/level2/results/pending');
    } else {
      const all = await api('/level2/results/all');
      rows = all.filter(r => r.faculty_approved === filter);
    }

    if (rows.length === 0) {
      content.innerHTML = `<div class="card"><p class="empty-state">No ${filter} Level 2 submissions.</p></div>`;
      return;
    }

    content.innerHTML = `
      <div style="overflow-x:auto">
      <table class="students-table" style="font-size:12px">
        <thead><tr>
          <th>Student</th><th>Register No.</th><th>Target</th><th>Student Answer</th>
          <th>System Answer</th><th>Error %</th><th>Tolerance</th><th>Result</th>
          <th>Submitted</th><th>Reviewer</th><th>Action</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td><b>${escapeHtml(r.student_name)}</b></td>
            <td style="color:#64748b">${escapeHtml(r.register_number || '—')}</td>
            <td>${r.target_resistance_ohms != null ? rbDisplayOhms(r.target_resistance_ohms) : '—'} Ω</td>
            <td>${r.student_answer != null ? rbDisplayOhms(r.student_answer) : '—'} Ω</td>
            <td>${r.system_calculated_resistance != null ? rbDisplayOhms(r.system_calculated_resistance) : 'Open circuit'} Ω</td>
            <td style="color:${r.result==='PASS'?'#22c55e':'#ef4444'}">${r.error_percent != null ? Number(r.error_percent).toFixed(3)+'%' : '—'}</td>
            <td>±${r.tolerance_percent ?? '—'}%</td>
            <td><span class="diff ${r.result==='PASS'?'diff-easy':'diff-advanced'}">${r.result}</span></td>
            <td style="color:#64748b;white-space:nowrap;font-size:11px">${r.submission_time ? new Date(r.submission_time).toLocaleString() : '—'}</td>
            <td style="color:#64748b;font-size:11px">
              ${r.reviewer_name
                ? `${escapeHtml(r.reviewer_name)}<br><span style="font-size:10px">${r.review_timestamp ? new Date(r.review_timestamp).toLocaleString() : ''}</span>`
                : '—'}
            </td>
            <td>${r.faculty_approved === 'pending'
              ? `<button class="btn btn-sm" onclick="l2OpenReviewModal(${r.id})" style="font-size:11px;white-space:nowrap">🔍 Review</button>`
              : `<span style="color:${r.faculty_approved==='approved'?'#22c55e':'#ef4444'};font-weight:700;font-size:11px">
                  ${r.faculty_approved==='approved'?'✅ Approved':'❌ Rejected'}
                </span>`}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>`;
  } catch (e) {
    content.innerHTML = `<div class="card"><p class="empty-state" style="color:#ef4444">Error: ${escapeHtml(e.message)}</p></div>`;
  }
}

function l2EnsureModal() {
  if (document.getElementById('l2-review-modal-overlay')) return;
  const div = document.createElement('div');
  div.id = 'l2-review-modal-overlay';
  div.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;overflow-y:auto;padding:30px 16px;box-sizing:border-box';
  div.addEventListener('click', e => { if (e.target === div) l2CloseModal(); });
  div.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:1100px;margin:0 auto;overflow:hidden;position:relative;box-shadow:0 25px 60px rgba(0,0,0,.35)">
      <div id="l2-review-modal-inner"></div>
    </div>`;
  document.body.appendChild(div);
}
function l2OpenModal() { l2EnsureModal(); document.getElementById('l2-review-modal-overlay').style.display = 'block'; }
function l2CloseModal() { const o = document.getElementById('l2-review-modal-overlay'); if (o) o.style.display = 'none'; }

async function l2OpenReviewModal(resultId) {
  l2EnsureModal();
  l2OpenModal();
  const inner = document.getElementById('l2-review-modal-inner');
  inner.innerHTML = '<div style="padding:48px;text-align:center" class="empty-state">Loading…</div>';
  try {
    const rows = await api('/level2/results/all');
    const r = rows.find(x => x.id === resultId);
    if (!r) throw new Error('Submission not found');
    const isPending = r.faculty_approved === 'pending';
    const isStaff = currentUser && currentUser.role === 'staff';

    // Level 2 wiring is stored as raw wire pairs (unlike Level 1's grouped
    // format), so it can be drawn directly against the same Resistance Bank
    // board/socket layout used everywhere else — no correctness color-coding
    // per wire since Level 2 is graded as one whole-circuit PASS/FAIL.
    const wirePairs = Array.isArray(r.wiring_data) ? r.wiring_data : [];
    const wiresHtml = wirePairs.map(pair => {
      const [a, b] = pair;
      if (!RB_SOCKETS[a] || !RB_SOCKETS[b]) return '';
      const [x1, y1] = RB_SOCKETS[a], [x2, y2] = RB_SOCKETS[b];
      const cx = (x1 + x2) / 2;
      return `<path d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}"
        stroke="#3b82f6" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.9"/>`;
    }).join('');
    const socketsHtml = Object.entries(RB_SOCKETS).map(([id, [x, y]]) => `
      <g>
        <circle cx="${x}" cy="${y}" r="13" fill="#111" stroke="#ff3333" stroke-width="3"/>
        <text x="${Number(x)+15}" y="${Number(y)-9}" fill="#39FF6A" font-size="11" font-weight="bold" font-family="monospace" paint-order="stroke" stroke="#000" stroke-width="2">${id}</text>
      </g>`).join('');

    inner.innerHTML = `
      <div style="background:linear-gradient(135deg,#0B2545,#0E7C7B);padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div>
          <div style="font-size:15px;font-weight:700;color:#fff">🔍 Level 2 Submission Review — ${escapeHtml(r.student_name)}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.8);margin-top:3px">
            Target Resistance Challenge &nbsp;·&nbsp; Attempt #${r.attempt_number ?? '—'} &nbsp;·&nbsp;
            ${r.submission_time ? new Date(r.submission_time).toLocaleString() : '—'}
          </div>
        </div>
        <button onclick="l2CloseModal()"
          style="background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);color:#fff;font-size:20px;cursor:pointer;border-radius:50%;width:34px;height:34px;line-height:1;flex-shrink:0">
          ×
        </button>
      </div>

      <div style="display:flex;height:82vh;overflow:hidden">

        <!-- Left: Board visualization -->
        <div style="flex:1;min-height:0;padding:14px;overflow:auto;background:#f0f4f8;border-right:1px solid #e2e8f0">
          <div style="display:flex;gap:5px;align-items:center;margin-bottom:6px">
            <span style="font-size:11px;color:#64748b;flex:1">Submitted Wiring</span>
            <button onclick="l2ReviewZoomOut()" style="width:26px;height:26px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:14px;color:#334155">−</button>
            <span id="l2-review-zoom-label" style="font-size:10px;font-weight:600;color:#334155;min-width:34px;text-align:center">100%</span>
            <button onclick="l2ReviewZoomIn()" style="width:26px;height:26px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:14px;color:#334155">+</button>
            <button onclick="l2ReviewZoomReset()" style="height:26px;padding:0 7px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:10px;color:#334155">Reset</button>
          </div>
          <div id="l2-review-board-wrap" style="border:1px solid #cbd5e1;border-radius:10px;overflow:auto;background:#111;max-height:60vh">
            <svg id="l2-review-board-svg" viewBox="${RB_BOARD_VIEWBOX}" xmlns="http://www.w3.org/2000/svg"
                 style="width:100%;display:block;min-width:300px;transition:width .15s">
              <image href="${RB_BOARD_IMAGE}" x="0" y="0" width="1438" height="1094" preserveAspectRatio="xMidYMid meet"/>
              <g>${wiresHtml}</g>
              <g>${socketsHtml}</g>
            </svg>
          </div>
          <div style="font-size:10px;color:#94a3b8;text-align:center;margin-top:4px">Use + / − to zoom · Wires shown as submitted</div>
          ${wirePairs.length === 0 ? `<div style="color:#94a3b8;font-size:12px;text-align:center;padding:16px">No wiring data captured for this submission.</div>` : ''}
          <script>
            (function() {
              var l2rZoom = 1.0;
              window.l2ReviewZoomIn = function() { l2rZoom = Math.min(3, l2rZoom + 0.25); applyL2RZ(); };
              window.l2ReviewZoomOut = function() { l2rZoom = Math.max(0.5, l2rZoom - 0.25); applyL2RZ(); };
              window.l2ReviewZoomReset = function() { l2rZoom = 1.0; applyL2RZ(); };
              function applyL2RZ() {
                var wrap = document.getElementById('l2-review-board-wrap');
                var svg = document.getElementById('l2-review-board-svg');
                if (!svg || !wrap) return;
                svg.style.width = Math.round(wrap.clientWidth * l2rZoom) + 'px';
                var lbl = document.getElementById('l2-review-zoom-label');
                if (lbl) lbl.textContent = Math.round(l2rZoom * 100) + '%';
              }
            })();
          </script>
        </div>

        <!-- Right: Info + action -->
        <div style="flex:0 0 300px;min-height:0;display:flex;flex-direction:column">
          <div style="flex:1;min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px">
            <div style="background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden">
              <div style="background:#0B2545;color:#fff;font-size:11px;font-weight:700;padding:7px 12px;letter-spacing:.5px">SUBMISSION INFO</div>
              <div style="padding:10px 12px;font-size:12px;display:grid;gap:5px">
                ${[
                  ['Student', escapeHtml(r.student_name)],
                  ['Register No.', escapeHtml(r.register_number || '—')],
                  ['Connection Method', r.connection_method === 'Hardware Kit' ? '🔌 <b>Hardware Kit</b>' : '🖐️ <b>Manual Connection</b>'],
                  ['Submission Time', r.submission_time ? new Date(r.submission_time).toLocaleString() : '—'],
                  ['Target Resistance', `<b>${r.target_resistance_ohms != null ? rbDisplayOhms(r.target_resistance_ohms) : '—'} Ω</b>`],
                  ['Student Answer', `<b>${r.student_answer != null ? rbDisplayOhms(r.student_answer) : '—'} Ω</b>`],
                  ['System Answer', `<b>${r.system_calculated_resistance != null ? rbDisplayOhms(r.system_calculated_resistance) : 'Open circuit'} Ω</b>`],
                  ['Error %', `<b style="color:${r.result==='PASS'?'#22c55e':'#ef4444'}">${r.error_percent != null ? Number(r.error_percent).toFixed(4)+'%' : '—'}</b>`],
                  ['Tolerance', `±${r.tolerance_percent ?? '—'}%`],
                  ['Result', `<b style="color:${r.result==='PASS'?'#22c55e':'#ef4444'}">${r.result}</b>`],
                  ['Status', `<b style="color:${isPending?'#F59E0B':r.faculty_approved==='approved'?'#22c55e':'#ef4444'}">${isPending?'⏳ Pending Staff Approval':r.faculty_approved==='approved'?'✅ Level 2 Approved':'❌ Rejected'}</b>`],
                  ...(r.reviewer_name ? [['Reviewer', escapeHtml(r.reviewer_name)]] : []),
                ].map(([k,v]) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #f1f5f9">
                  <span style="color:#64748b">${k}</span><span>${v}</span>
                </div>`).join('')}
              </div>
            </div>
            ${r.review_comments ? `
            <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:10px 12px">
              <div style="font-size:11px;font-weight:600;color:#92400e;margin-bottom:4px">Faculty Comments</div>
              <div style="font-size:11px;color:#78350f">${escapeHtml(r.review_comments)}</div>
            </div>` : ''}
          </div>

          ${isStaff && isPending ? `
          <div style="flex-shrink:0;padding:12px 14px;background:#f0fdf4;border-top:1px solid #86efac;box-shadow:0 -6px 14px rgba(0,0,0,.06)">
            <div style="font-size:11px;font-weight:700;color:#166534;margin-bottom:6px">⚠️ Staff Review Required</div>
            <div style="font-size:11px;color:#64748b;margin-bottom:8px">Review the board wiring above, then approve or reject. The student will be notified immediately.</div>
            <label style="font-size:10px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:4px">Faculty Comments</label>
            <textarea id="l2-review-comments" placeholder="Faculty comments for student (optional)…"
              style="width:100%;box-sizing:border-box;border:1px solid #e2e8f0;border-radius:6px;padding:8px;font-size:11px;resize:vertical;min-height:48px;font-family:inherit;margin-bottom:8px"></textarea>
            <div style="display:flex;gap:8px">
              <button onclick="l2SubmitReview(${r.id},'approved')" style="flex:1;padding:10px;background:#22c55e;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">✅ Approve</button>
              <button onclick="l2SubmitReview(${r.id},'rejected')" style="flex:1;padding:10px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">❌ Reject</button>
            </div>
          </div>` : ''}
        </div>
      </div>
    `;
  } catch (e) {
    inner.innerHTML = `<div style="padding:48px;text-align:center;color:#ef4444">Failed to load: ${escapeHtml(e.message)}</div>`;
  }
}

async function l2SubmitReview(resultId, action) {
  const comments = document.getElementById('l2-review-comments')?.value || '';
  try {
    await api(`/level2/results/${resultId}/review`, { method: 'PUT', body: { action, comments } });
    toast(action === 'approved' ? '✅ Level 2 Approved — student will see the result now.' : '❌ Rejected — student will be notified.');
    l2CloseModal();
    l2LoadReviewTab('pending');
    loadPendingAssessmentBadge();
  } catch (e) {
    toast('Error: ' + e.message);
  }
}

// ---------- STUDENT: entry screen (gated on Level 1 approval) ----------
async function l2RenderStudentEntry() {
  const root = document.getElementById('page-level2');
  root.innerHTML = `<div class="empty-state">Loading…</div>`;

  // Gate: Level 2 only opens once Level 1 (Resistance Bank) is staff-approved.
  let level1Approved = false;
  try {
    const mine = await api('/assessments/me');
    level1Approved = mine.some(r => r.kit_id === 'resistance_bank' && r.faculty_approved === 'approved');
  } catch (e) {}

  if (!level1Approved) {
    root.innerHTML = `
      <div class="card" style="max-width:520px;margin:40px auto;text-align:center">
        <div style="font-size:32px;margin-bottom:10px">🔒</div>
        <div class="card-title" style="justify-content:center">Level 2 Locked</div>
        <p style="color:#64748b;font-size:13px">
          Complete Level 1 (Resistance Bank) and wait for <b>Level 1 Approved</b> status
          from staff before Level 2 unlocks.
        </p>
        <button class="btn btn-primary" style="margin-top:8px" onclick="goto('assessment');renderRBOverview()">Go to Level 1 Assessment</button>
      </div>`;
    return;
  }

  let assessment = null;
  try { assessment = await api('/level2/assessments/active'); } catch (e) {}

  if (!assessment) {
    root.innerHTML = `
      <div class="card" style="max-width:520px;margin:40px auto;text-align:center">
        <div style="font-size:32px;margin-bottom:10px">⏳</div>
        <div class="card-title" style="justify-content:center">No Level 2 Assessment Yet</div>
        <p style="color:#64748b;font-size:13px">Staff hasn't published a Target Resistance Challenge yet. Check back soon.</p>
      </div>`;
    return;
  }

  let myAttempts = [];
  try {
    const all = await api('/level2/results/me');
    myAttempts = all.filter(r => r.assessment_id === assessment.id);
  } catch (e) {}
  const attemptsUsed = myAttempts.length;
  const attemptsLeft = assessment.max_attempts - attemptsUsed;
  const approvedAttempt = myAttempts.find(r => r.faculty_approved === 'approved');
  const pendingAttempt = myAttempts.find(r => r.faculty_approved === 'pending');
  const alreadyPassed = !!approvedAttempt;

  root.innerHTML = `
    <div class="card" style="max-width:560px;margin:0 auto">
      <div class="card-title">🎯 Level 2 — Target Resistance Challenge</div>
      <div style="display:flex;gap:10px;margin:14px 0">
        <div style="flex:1;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:10px;color:#1e40af;font-weight:700;letter-spacing:.4px">TARGET RESISTANCE</div>
          <div style="font-size:20px;font-weight:800;color:#1e3a8a;margin-top:4px">${rbDisplayOhms(assessment.target_resistance_ohms)} Ω</div>
        </div>
        <div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:10px;color:#166534;font-weight:700;letter-spacing:.4px">TOLERANCE</div>
          <div style="font-size:20px;font-weight:800;color:#14532d;margin-top:4px">±${assessment.tolerance_percent}%</div>
        </div>
      </div>
      <p style="font-size:12px;color:#64748b;line-height:1.6">
        Select resistors and connect jumper wires on the Resistance Bank board to build a
        network whose equivalent resistance lands within tolerance of the target. Calculate
        your answer by hand, enter it, then Submit — the system will compute the actual
        equivalent resistance of your wiring and compare it to the target automatically.
      </p>
      <div style="font-size:12px;color:#334155;margin:10px 0"><b>Attempts left:</b> ${Math.max(0, attemptsLeft)} / ${assessment.max_attempts}</div>
      ${alreadyPassed
        ? `<div style="padding:10px;border-radius:8px;background:#dcfce7;color:#166534;font-weight:700;text-align:center">✅ Level 2 Approved</div>`
        : pendingAttempt
          ? `<div style="padding:10px;border-radius:8px;background:#fef9c3;color:#854d0e;font-weight:700;text-align:center">⏳ Pending Staff Approval</div>`
          : attemptsLeft <= 0
            ? `<div style="padding:10px;border-radius:8px;background:#fee2e2;color:#991b1b;font-weight:700;text-align:center">❌ No attempts remaining.</div>`
            : `<button class="btn btn-primary" style="width:100%" onclick="l2LaunchAttempt(${JSON.stringify(assessment).replace(/"/g,'&quot;')})">Start Challenge →</button>`}
    </div>`;
}

// ---------- STUDENT: live wiring attempt ----------
function l2LaunchAttempt(assessment) {
  window.assessmentRunning = true;
  l2ResetState(assessment);
  const root = document.getElementById('page-level2');
  const serialSupported = ('serial' in navigator);

  // Measurement nodes come from the staff-published assessment (e.g. "21 ↔ 22")
  // — same idea as Level 1's terminals, just fixed by staff instead of chosen
  // freely by the student. Fall back to editable blanks only if staff didn't
  // set them on an older record.
  const nodesLocked = !!(assessment.node_a && assessment.node_b);
  const nodeAVal = nodesLocked ? String(assessment.node_a).replace(/\D/g, '') : '';
  const nodeBVal = nodesLocked ? String(assessment.node_b).replace(/\D/g, '') : '';

  root.innerHTML = `
    <div class="card" style="margin-bottom:12px;padding:12px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:13px;color:#0B2545" id="l2-hw-title">
            ${serialSupported ? '🔌 Hardware Kit: Not connected' : '⚠️ Web Serial not supported'}
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:3px" id="l2-hw-sub">
            ${serialSupported
              ? 'Plug in the Resistance Bank trainer kit via USB, then click Connect.'
              : 'Use Chrome/Edge on desktop for hardware mode. Using manual simulation instead.'}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${serialSupported
            ? `<button class="btn btn-primary btn-sm" id="l2-hw-connect-btn" onclick="l2ConnectHardware()">⚡ Connect Hardware Kit</button>
               <button class="btn btn-sm" id="l2-hw-disconnect-btn" style="display:none" onclick="l2DisconnectHardware()">Disconnect</button>`
            : ''}
          <button class="btn btn-sm" onclick="l2UseManualMode()">Use manual simulation</button>
        </div>
      </div>
    </div>

    <div class="pc-layout">
      <!-- Board -->
      <div class="pc-board-panel card">
        <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">
          Resistance Bank Board
          <span id="l2-mode-badge" class="pc-mode-badge pc-mode-manual">MANUAL SIMULATION</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
          <span style="font-size:11px;color:#64748b;flex:1">Build your network</span>
          <div style="display:flex;gap:4px">
            <button onclick="l2ZoomOut()" style="width:28px;height:28px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:14px;color:#334155">−</button>
            <button onclick="l2ZoomReset()" style="height:28px;padding:0 8px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:10px;color:#334155;font-weight:600" id="l2-zoom-label">100%</button>
            <button onclick="l2ZoomIn()" style="width:28px;height:28px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:14px;color:#334155">+</button>
          </div>
        </div>
        <div class="pc-board-wrap" id="l2-board-wrap" style="overflow:auto;max-height:520px;border-radius:10px;background:#111;border:1px solid #333;">
          <svg id="l2-svg" viewBox="${RB_BOARD_VIEWBOX}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;min-width:300px;transition:width .15s">
            <image href="${RB_BOARD_IMAGE}" x="0" y="0" width="1438" height="1094" preserveAspectRatio="xMidYMid meet"/>
            <g id="l2-wires"></g>
            <g id="l2-sockets"></g>
          </svg>
        </div>
        <div style="font-size:10px;color:#94a3b8;margin-top:4px;text-align:center" id="l2-board-hint">
          Click a socket, then click another socket to draw a jumper. Click the same pair again to remove.
        </div>
      </div>

      <!-- Evaluation -->
      <div class="pc-center-panel card">
        <div class="card-title">Target Resistance Challenge</div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <div style="flex:1;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:9px;color:#1e40af;font-weight:700">TARGET</div>
            <div style="font-size:14px;font-weight:800;color:#1e3a8a">${rbDisplayOhms(assessment.target_resistance_ohms)} Ω</div>
          </div>
          <div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:9px;color:#166534;font-weight:700">TOLERANCE</div>
            <div style="font-size:14px;font-weight:800;color:#14532d">±${assessment.tolerance_percent}%</div>
          </div>
        </div>

        <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;margin-bottom:4px">MEASUREMENT TERMINALS</div>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
          <label style="font-size:12px;color:#334155">Node A
            <input id="l2-node-a" type="text" value="${escapeHtml(nodeAVal)}" placeholder="e.g. 9" ${nodesLocked ? 'readonly' : ''} style="width:60px;margin-left:6px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;text-align:center;${nodesLocked ? 'background:#f1f5f9;font-weight:700' : ''}">
          </label>
          <label style="font-size:12px;color:#334155">Node B
            <input id="l2-node-b" type="text" value="${escapeHtml(nodeBVal)}" placeholder="e.g. 17" ${nodesLocked ? 'readonly' : ''} style="width:60px;margin-left:6px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;text-align:center;${nodesLocked ? 'background:#f1f5f9;font-weight:700' : ''}">
          </label>
        </div>

        <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;margin-bottom:4px">YOUR CALCULATED ANSWER</div>
        <input id="l2-student-answer" type="text" placeholder="e.g. 80k, 8e4, 80000 Ω"
          style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:10px">
        <button id="l2-submit-btn" class="btn btn-primary" style="width:100%" onclick="l2SubmitAnswer()">Submit</button>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:9px;color:#94a3b8;font-weight:700;letter-spacing:.5px">ATTEMPTS LEFT</div>
            <div id="l2-attempts-label" style="font-size:14px;font-weight:700;color:#0B2545">${assessment.max_attempts} / ${assessment.max_attempts}</div>
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:9px;color:#94a3b8;font-weight:700;letter-spacing:.5px">TIME LEFT</div>
            <div id="l2-time-label" style="font-size:14px;font-weight:700;color:#0B2545">--:--</div>
          </div>
        </div>

        <div id="l2-status-banner" style="text-align:center;padding:10px;border-radius:8px;border:1px solid #e2e8f0;background:#f1f5f9;color:#475569;font-weight:700;font-size:13px">Not Submitted</div>

        <div class="card-title" style="margin-top:16px">Live Wiring Status</div>
        <div id="l2-wire-status" class="pc-wire-list">
          <p class="empty-state">No jumpers yet. Click two sockets to add one.</p>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" onclick="l2UndoWire()">↩ Undo</button>
          <button class="btn" onclick="l2ClearWiring()">Clear all wires</button>
        </div>
      </div>

      <!-- Info -->
      <div class="pc-info-panel card">
        <div class="card-title">Assessment Info</div>
        <div class="pc-info-row"><span>Student</span><b>${escapeHtml((currentUser && (currentUser.name || currentUser.email)) || 'Student')}</b></div>
        <div class="pc-info-row"><span>Challenge</span><b style="font-size:11px">${escapeHtml(assessment.title)}</b></div>
        <div style="margin-top:14px">
          <button class="btn" style="width:100%" onclick="l2ExitAttempt()">Exit to Level 2 Home</button>
        </div>
      </div>
    </div>`;

  l2DrawSockets();
  l2RenderWires();
  l2UpdateWireStatus();
  l2RefreshTimeLabel();
  l2State.timerHandle = setInterval(l2TickTimer, 1000);
  updateAIVisibility();
}

function l2ExitAttempt() {
  if (l2State?.timerHandle) clearInterval(l2State.timerHandle);
  if (l2State?.pollHandle) clearInterval(l2State.pollHandle);
  if (l2State?.serialConnected) l2DisconnectHardware();
  window.assessmentRunning = false;
  renderLevel2Page();
}

function l2TickTimer() {
  if (!l2State || l2State.finished) return;
  l2State.timeRemainingSeconds--;
  l2RefreshTimeLabel();
  if (l2State.timeRemainingSeconds <= 0) {
    l2State.timeRemainingSeconds = 0;
    l2RefreshTimeLabel();
    l2ForceSubmitOnTimeout();
  }
}
function l2RefreshTimeLabel() {
  const el = document.getElementById('l2-time-label');
  if (!el || !l2State) return;
  const m = String(Math.floor(l2State.timeRemainingSeconds / 60)).padStart(2, '0');
  const s = String(l2State.timeRemainingSeconds % 60).padStart(2, '0');
  el.textContent = `${m}:${s}`;
}
function l2RefreshAttemptsLabel(attemptsLeft, total) {
  const el = document.getElementById('l2-attempts-label');
  if (el) el.textContent = `${Math.max(0, attemptsLeft)} / ${total}`;
}

// ---------- Zoom ----------
function l2ApplyZoom() {
  const svg = document.getElementById('l2-svg');
  const wrap = document.getElementById('l2-board-wrap');
  if (!svg || !wrap) return;
  svg.style.width = Math.round(wrap.clientWidth * l2State.zoom) + 'px';
  const label = document.getElementById('l2-zoom-label');
  if (label) label.textContent = Math.round(l2State.zoom * 100) + '%';
}
function l2ZoomIn()    { l2State.zoom = Math.min(3, l2State.zoom + 0.25); l2ApplyZoom(); }
function l2ZoomOut()   { l2State.zoom = Math.max(0.5, l2State.zoom - 0.25); l2ApplyZoom(); }
function l2ZoomReset() { l2State.zoom = 1.0; l2ApplyZoom(); }

// ---------- Sockets / wiring ----------
function l2DrawSockets() {
  const g = document.getElementById('l2-sockets');
  if (!g) return;
  g.innerHTML = Object.entries(RB_SOCKETS).map(([id,[x,y]]) => `
    <g class="l2-socket" data-node="${id}" onclick="l2OnSocketClick('${id}')" style="cursor:pointer" title="Node ${id}">
      <circle cx="${x}" cy="${y}" r="13" fill="black" stroke="red" stroke-width="3"/>
      <text x="${x+14}" y="${y-10}" fill="#39FF6A" font-size="11" font-weight="bold" font-family="monospace">${id}</text>
    </g>`).join('');
}
function l2CurrentGroups() {
  if (!l2State) return [];
  return pcWiresToGroups(l2State.wires);
}
function l2OnSocketClick(nodeId) {
  if (!l2State || l2State.finished) return;
  if (l2State.pendingNode === null) {
    l2State.pendingNode = nodeId;
    l2HighlightSocket(nodeId, true);
    return;
  }
  if (l2State.pendingNode === nodeId) {
    l2HighlightSocket(nodeId, false);
    l2State.pendingNode = null;
    return;
  }
  const a = l2State.pendingNode, b = nodeId;
  const idx = l2State.wires.findIndex(([x,y]) => (x===a&&y===b)||(x===b&&y===a));
  if (idx >= 0) l2State.wires.splice(idx, 1);
  else l2State.wires.push([a, b]);
  l2HighlightSocket(a, false);
  l2State.pendingNode = null;
  l2RenderWires();
  l2UpdateWireStatus();
}
function l2HighlightSocket(nodeId, on) {
  const el = document.querySelector(`.l2-socket[data-node="${nodeId}"] circle`);
  if (el) el.setAttribute('stroke', on ? '#39FF6A' : 'red');
}
function l2RenderWires() {
  const g = document.getElementById('l2-wires');
  if (!g) return;
  const groups = l2CurrentGroups();
  const edges = [];
  groups.forEach(grp => { rbGroupToEdges(grp).forEach(e => edges.push(e)); });
  g.innerHTML = edges.map(([a,b]) => {
    if (!RB_SOCKETS[a] || !RB_SOCKETS[b]) return '';
    const [x1,y1] = RB_SOCKETS[a], [x2,y2] = RB_SOCKETS[b];
    const cx = (x1+x2)/2;
    return `<path d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}"
      stroke="#3b82f6" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  }).join('');
  if (typeof window.triggerDebouncedCircuitGuidance === 'function') {
    window.triggerDebouncedCircuitGuidance();
  }
}
function l2UpdateWireStatus() {
  const el = document.getElementById('l2-wire-status');
  if (!el) return;
  const groups = l2CurrentGroups();
  if (groups.length === 0) {
    el.innerHTML = `<p class="empty-state">No jumpers yet. Click two sockets to add one.</p>`;
    return;
  }
  el.innerHTML = `
    <div style="font-size:11px;color:#64748b;margin-bottom:8px">${groups.length} jumper group(s) on the board</div>
    ${groups.map(g => {
      const nodes = [...g].sort((a,b) => Number(a)-Number(b));
      const label = rbGetPairLabel(g);
      return `<div class="pc-group-chip pc-grp-pending">
        ${nodes.join(' – ')}
        ${label ? `<span class="pc-volt-badge">${label}</span>` : ''}
      </div>`;
    }).join('')}`;
}
function l2UndoWire() {
  if (!l2State) return;
  l2State.wires.pop();
  l2RenderWires();
  l2UpdateWireStatus();
}
function l2ClearWiring() {
  if (!l2State) return;
  l2State.wires = [];
  l2State.pendingNode = null;
  l2RenderWires();
  l2UpdateWireStatus();
}

// ---------- Hardware kit (reuses the SHARED rbSharedConnectHardware /
// rbSharedReadSerialLoop / rbSharedDisconnectHardware defined above for
// Level 1 — same Arduino protocol, same board, same connection code) ----------
function l2ConnectHardware() {
  return rbSharedConnectHardware(l2State, 'l2', l2OnHardwareConnections);
}

function l2OnHardwareConnections(pairs) {
  if (!l2State || l2State.finished) return;
  // Same reasoning as rbOnHardwareConnections: rbComputeRth() reads
  // l2State.wires directly, so the live jumper stream from the Arduino has
  // to land there for the solver (and the live target check below) to see it.
  l2State.wires = pairs;
  l2RenderWires();
  l2UpdateWireStatus();
}

function l2DisconnectHardware() {
  return rbSharedDisconnectHardware(l2State, 'l2');
}

function l2UseManualMode() {
  if (!l2State) return;
  l2State.mode = 'manual';
  const badge = document.getElementById('l2-mode-badge');
  if (badge) { badge.textContent = 'MANUAL SIMULATION'; badge.className = 'pc-mode-badge pc-mode-manual'; }
  const hint = document.getElementById('l2-board-hint');
  if (hint) hint.textContent = 'Click a socket, then click another socket to draw a jumper. Click the same pair again to remove.';
  l2UpdateWireStatus();
}

// ---------- Submit + auto-evaluate (Target vs System-Calculated) ----------
function l2SetStatus(text, color) {
  const el = document.getElementById('l2-status-banner');
  if (!el) return;
  el.textContent = text;
  el.style.background = color === 'pass' ? '#dcfce7' : color === 'fail' ? '#fee2e2' : '#fef9c3';
  el.style.color = color === 'pass' ? '#166534' : color === 'fail' ? '#991b1b' : '#854d0e';
}

async function l2SubmitAnswer() {
  if (!l2State || l2State.finished) return;
  const aText = (document.getElementById('l2-node-a')?.value || '').trim();
  const bText = (document.getElementById('l2-node-b')?.value || '').trim();
  const ansText = (document.getElementById('l2-student-answer')?.value || '').trim();

  if (!aText || !bText || !ansText) { l2SetStatus('Enter Node A, Node B, and your calculated answer.', 'neutral'); return; }
  if (!/^\d+$/.test(aText) || !/^\d+$/.test(bText)) { l2SetStatus('Node A and Node B must be whole socket numbers.', 'neutral'); return; }
  if (!RB_SOCKETS[aText] || !RB_SOCKETS[bText]) { l2SetStatus('Socket numbers must be between 1 and 30.', 'neutral'); return; }
  if (aText === bText) { l2SetStatus(`Node A and Node B are the same socket (${aText}).`, 'neutral'); return; }

  const studentAnswer = rbParseResistanceInput(ansText);
  if (studentAnswer === null) { l2SetStatus('Invalid resistance format. Use Ω, kΩ, MΩ, or scientific notation.', 'fail'); return; }

  l2SetStatus('Evaluating…', 'neutral');

  // System-calculated Rth for the actual wiring — same solver used in Level 1.
  const systemValue = rbComputeRth(l2State.wires, aText, bText);
  const timeTaken = l2State.assessment.time_limit_seconds - l2State.timeRemainingSeconds;

  const btn = document.getElementById('l2-submit-btn');
  if (btn) btn.disabled = true;

  // Automatic wiring capture — Resistance Bank board only (board image +
  // resistor sockets + jumper wires), taken at the moment of Submit.
  // Saved server-side as level2_connection.png with this assessment record.
  const wiringImage = await l2CaptureWiringImage();

  try {
    const result = await api('/level2/submit', {
      method: 'POST',
      body: {
        assessment_id: l2State.assessment.id,
        node_a: aText, node_b: bText,
        student_answer: studentAnswer,
        system_calculated_resistance: systemValue,
        time_taken_seconds: timeTaken,
        wiring_data: l2State.wires,
        wiring_image: wiringImage,
        connection_method: l2State.mode === 'hardware' ? 'Hardware Kit' : 'Manual Connection',
      },
    });

    l2RefreshAttemptsLabel(result.attempts_remaining, l2State.assessment.max_attempts);

    // Release the Web Serial connection now that the final wiring
    // snapshot has been submitted — frees the COM port so the backend
    // can open it for UNLOCK/HEARTBEAT once staff approves.
    if (l2State.mode === 'hardware' && l2State.serialConnected) {
      l2DisconnectHardware();
    }

    // System PASS/FAIL calculation is unchanged and stored server-side, but
    // deliberately NOT returned to the student here — the submit response
    // only contains id/attempt bookkeeping. The student sees the actual
    // result (target, error %, PASS/FAIL) only after staff approval, via
    // l2PollForStaffDecision -> l2ShowStaffDecision below.
    l2State.finished = true;
    if (l2State.timerHandle) clearInterval(l2State.timerHandle);
    ['l2-node-a','l2-node-b','l2-student-answer'].forEach(id => {
      const el = document.getElementById(id); if (el) el.disabled = true;
    });
    l2SetStatus('Pending Staff Approval', 'neutral');
    toast('⏳ Submitted — Pending Staff Approval.');

    const wireStatus = document.getElementById('l2-wire-status');
    if (wireStatus) {
      const banner = document.createElement('div');
      banner.id = 'l2-staff-review-banner';
      banner.className = `pc-result-banner`;
      banner.style.cssText = 'background:#fef9c3;color:#854d0e;border:1px solid #fde68a;padding:14px;border-radius:10px;margin-bottom:10px';
      banner.innerHTML = `
        <div style="font-weight:700;font-size:14px">⏳ Pending Staff Approval</div>
        <div style="font-size:12px;margin-top:4px">Node A: <b>${escapeHtml(aText)}</b> &nbsp;|&nbsp; Node B: <b>${escapeHtml(bText)}</b></div>
        <div style="font-size:12px">Your answer: <b>${escapeHtml(ansText)}</b></div>
        <div style="font-size:11px;margin-top:6px;opacity:.85">A staff member will review this submission. Your result, target, and error will appear here once reviewed and approved.</div>
      `;
      wireStatus.prepend(banner);
    }

    l2State.pendingResultId = result.id;
    if (l2State.pollHandle) clearInterval(l2State.pollHandle);
    l2State.pollHandle = setInterval(l2PollForStaffDecision, 4000);
  } catch (e) {
    l2SetStatus('Submission error — try again.', 'fail');
    toast('Error: ' + e.message);
    if (btn) btn.disabled = false;
  }
}

// Poll for the staff decision on a Level 2 submission — mirrors Level 1's
// rbPollForStaffDecision pattern. Does not touch the calculation itself.
async function l2PollForStaffDecision() {
  if (!l2State || !l2State.pendingResultId) return;
  try {
    const rows = await api('/level2/results/me');
    const row = rows.find(r => r.id === l2State.pendingResultId);
    if (row && (row.faculty_approved === 'approved' || row.faculty_approved === 'rejected')) {
      clearInterval(l2State.pollHandle);
      l2State.pollHandle = null;
      l2ShowStaffDecision(row);
    }
  } catch (e) { console.warn('L2 poll error:', e.message); }
}

function l2ShowStaffDecision(row) {
  const approved = row.faculty_approved === 'approved';
  const oldBanner = document.getElementById('l2-staff-review-banner');
  if (oldBanner) oldBanner.remove();

  l2SetStatus(approved ? '✓ Level 2 Approved' : '✗ Rejected by Staff', approved ? 'pass' : 'fail');

  const wireStatus = document.getElementById('l2-wire-status');
  if (wireStatus) {
    const banner = document.createElement('div');
    banner.className = `pc-result-banner ${approved ? 'pc-result-pass' : 'pc-result-fail'}`;
    banner.innerHTML = `
      <div style="font-weight:700;font-size:15px">${approved ? '✅ Level 2 Approved' : '❌ Rejected by Staff'}</div>
      <div style="font-size:12px;margin-top:4px">System-calculated: <b>${row.system_calculated_resistance != null ? rbDisplayOhms(row.system_calculated_resistance) : 'Open circuit'} Ω</b></div>
      <div style="font-size:12px">Target: <b>${rbDisplayOhms(row.target_resistance_ohms)} Ω</b> (±${row.tolerance_percent}%)</div>
      ${row.review_comments ? `<div style="font-size:11px;margin-top:6px;opacity:.85">Faculty comments: ${escapeHtml(row.review_comments)}</div>` : ''}
      <div style="font-size:11px;margin-top:6px;opacity:.75">Reviewer: ${escapeHtml(row.reviewer_name || 'Staff')}</div>
    `;
    wireStatus.prepend(banner);
  }
  toast(approved ? '🎉 Level 2 Approved.' : '❌ Staff rejected your Level 2 submission.');
}

function l2ForceSubmitOnTimeout() {
  if (!l2State || l2State.finished) return;
  l2State.finished = true;
  if (l2State.timerHandle) clearInterval(l2State.timerHandle);
  const btn = document.getElementById('l2-submit-btn');
  if (btn) btn.disabled = true;
  l2SetStatus('⏰ Time Expired', 'fail');
  toast('Time expired for this Level 2 attempt.');
}