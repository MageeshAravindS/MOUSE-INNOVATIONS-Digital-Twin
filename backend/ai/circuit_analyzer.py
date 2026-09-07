"""
Group-based Circuit Analyzer

Compares the wire groups reported by the hardware trainer (via Arduino)
against the expected connection groups for an experiment, and reports
which groups are correct, missing, or wrong.

Backward compatibility notes
-----------------------------
- The function name `analyze_connections` is unchanged.
- The original positional parameters `(student_groups, correct_groups)`
  are unchanged, so every existing call site keeps working exactly as
  before with no code changes required.
- The original return keys `correct_groups`, `missing_groups`,
  `wrong_groups`, and `summary` are unchanged in both name and meaning.
- A new OPTIONAL third parameter `group_metadata` has been added with a
  default of `None`. When the caller passes the `group_metadata` block
  from bridge_rectifier.json, the returned dict gains one new key,
  `group_details`, containing rich per-group information (component
  name, purpose, description, effect if missing/wrong, next step).
  If `group_metadata` is not supplied, `group_details` is simply an
  empty dict and every other field behaves exactly as before.
- A new OPTIONAL fourth parameter `node_map` has been added with a
  default of `None`. When the caller passes the `node_map` block from
  bridge_rectifier.json, each entry in `group_details` additionally
  gains `expected_nodes_named` / `matched_nodes_named`: the same node
  numbers, but written as "12 (Transformer Secondary Terminal A ...)"
  instead of bare numbers. If `node_map` is not supplied, these fields
  simply fall back to the bare node-number lists, so nothing breaks for
  existing callers.
"""

from typing import Any, Dict, List, Optional


def _set_equal(a, b) -> bool:
    """Return True if two node lists contain exactly the same nodes."""
    return set(a) == set(b)


def _find_matching_variant(
    student_groups: List[List[str]],
    variants: List[List[str]],
) -> Optional[List[str]]:
    """
    Return the specific variant (list of nodes) that matched a student
    group, or None if no variant was found among the student's groups.
    """
    for variant in variants:
        for student in student_groups:
            if _set_equal(student, variant):
                return variant
    return None


def _name_nodes(nodes: Optional[List[str]], node_map: Dict[str, Any]) -> Optional[List[str]]:
    """
    Translate a list of raw node ids into human-readable strings using
    node_map, e.g. "12" -> "12 (Transformer Secondary Terminal A ...)".
    Falls back to the bare node id if node_map has no entry for it, and
    returns None unchanged if `nodes` itself is None (e.g. an
    unmatched/missing group has no matched_nodes yet).
    """
    if nodes is None:
        return None
    if not node_map:
        return list(nodes)

    named = []
    for node_id in nodes:
        entry = node_map.get(str(node_id))
        if entry and entry.get("name"):
            named.append(f"{node_id} ({entry['name']})")
        else:
            named.append(str(node_id))
    return named


def _build_group_detail(
    group_name: str,
    status: str,
    group_metadata: Dict[str, Any],
    matched_nodes: Optional[List[str]] = None,
    node_map: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Build an enriched detail entry for a single group using the
    knowledge-base metadata, if available for that group.
    """
    meta = group_metadata.get(group_name, {}) if group_metadata else {}
    node_map = node_map or {}
    expected_nodes = meta.get("expected_nodes", [])

    return {
        "status": status,
        "component_name": meta.get("component_name", "Unknown component"),
        "purpose": meta.get("purpose", ""),
        "description": meta.get("description", ""),
        "expected_nodes": expected_nodes,
        "expected_nodes_named": _name_nodes(expected_nodes, node_map),
        "matched_nodes": matched_nodes,
        "matched_nodes_named": _name_nodes(matched_nodes, node_map),
        "effect_if_missing": meta.get("effect_if_missing", ""),
        "effect_if_wrong": meta.get("effect_if_wrong", ""),
        "next_step": meta.get("next_step", ""),
    }


RB_BOARD_RESISTORS = [
    ("1", "2", "1K", 1000), ("7", "8", "47R", 47), ("15", "16", "4K7", 4700),
    ("21", "22", "3K3", 3300), ("9", "10", "6K7", 6700), ("17", "18", "70R", 70),
    ("23", "24", "68K", 68000), ("3", "4", "22R", 22), ("11", "12", "680R", 680),
    ("25", "26", "100R", 100), ("27", "28", "33K", 33000), ("5", "6", "470R", 470),
    ("13", "14", "2K2", 2200), ("19", "20", "680R", 680), ("29", "30", "100R", 100),
]


def _rb_uf_find(parent: Dict[str, str], x: str) -> str:
    parent.setdefault(x, x)
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def _rb_uf_union(parent: Dict[str, str], a: str, b: str) -> None:
    ra = _rb_uf_find(parent, a)
    rb = _rb_uf_find(parent, b)
    if ra != rb:
        parent[ra] = rb


def _rb_gaussian_solve(A: List[List[float]], b: List[float]) -> List[float]:
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for col in range(n):
        pivot = col
        for r in range(col + 1, n):
            if abs(M[r][col]) > abs(M[pivot][col]):
                pivot = r
        if abs(M[pivot][col]) < 1e-12:
            continue
        M[col], M[pivot] = M[pivot], M[col]
        pv = M[col][col]
        for c in range(col, n + 1):
            M[col][c] /= pv
        for r in range(n):
            if r != col and abs(M[r][col]) > 1e-15:
                factor = M[r][col]
                for c in range(col, n + 1):
                    M[r][c] -= factor * M[col][c]
    return [row[n] for row in M]


def _rb_effective_resistance(edges: List[tuple], node_a: str, node_b: str) -> Optional[float]:
    if node_a == node_b:
        return 0.0
    adj: Dict[str, Dict[str, float]] = {}
    for u, v, ohms in edges:
        if u == v or ohms <= 0:
            continue
        g = 1.0 / ohms
        adj.setdefault(u, {})[v] = adj.setdefault(u, {}).get(v, 0.0) + g
        adj.setdefault(v, {})[u] = adj.setdefault(v, {}).get(u, 0.0) + g

    if node_a not in adj or node_b not in adj:
        return None

    visited = {node_a}
    stack = [node_a]
    while stack:
        n = stack.pop()
        for nb in adj.get(n, {}):
            if nb not in visited:
                visited.add(nb)
                stack.append(nb)

    if node_b not in visited:
        return None

    node_list = sorted(list(visited))
    idx = {n: i for i, n in enumerate(node_list)}
    n = len(node_list)
    L = [[0.0] * n for _ in range(n)]
    for u in node_list:
        for v, g in adj.get(u, {}).items():
            if v in idx:
                i, j = idx[u], idx[v]
                L[i][j] -= g
                L[i][i] += g

    ia, ib = idx[node_a], idx[node_b]
    keep = [i for i in range(n) if i != ib]
    size = len(keep)
    Amat = [[L[r][c] for c in keep] for r in keep]
    bvec = [0.0] * size
    iaR = keep.index(ia)
    bvec[iaR] = 1.0

    x = _rb_gaussian_solve(Amat, bvec)
    return x[iaR]


def find_rb_resistor_combination(target_ohms: float) -> Optional[Dict[str, Any]]:
    """
    Finds the exact or closest series/parallel resistor combination on the Resistance Bank
    trainer board to achieve a student's desired target resistance value.
    Considers single, 2-series, 2-parallel, and 3-series configurations.
    """
    import itertools
    best = None
    best_diff = float("inf")

    # 1. Single resistor
    for a, b, lbl, ohms in RB_BOARD_RESISTORS:
        diff = abs(ohms - target_ohms)
        if diff < best_diff:
            best_diff = diff
            best = {
                "achieved_ohms": ohms,
                "diff": diff,
                "topology": "single",
                "description": f"Use single resistor {lbl} across Sockets {a} and {b}.",
                "jumpers": [],
                "terminals": [str(a), str(b)],
                "formula": f"Rth = {ohms} Ω",
            }

    # 2. Two resistors in series
    for (a1, b1, lbl1, r1), (a2, b2, lbl2, r2) in itertools.combinations(RB_BOARD_RESISTORS, 2):
        s = r1 + r2
        diff = abs(s - target_ohms)
        if diff < best_diff:
            best_diff = diff
            best = {
                "achieved_ohms": s,
                "diff": diff,
                "topology": "series",
                "description": f"Connect {lbl1} (Sockets {a1}-{b1}) in series with {lbl2} (Sockets {a2}-{b2}).",
                "jumpers": [f"{b1}-{a2}"],
                "terminals": [str(a1), str(b2)],
                "formula": f"{r1} Ω + {r2} Ω = {s} Ω",
            }

    # 3. Two resistors in parallel
    for (a1, b1, lbl1, r1), (a2, b2, lbl2, r2) in itertools.combinations(RB_BOARD_RESISTORS, 2):
        p = round((r1 * r2) / (r1 + r2), 1)
        diff = abs(p - target_ohms)
        if diff < best_diff:
            best_diff = diff
            best = {
                "achieved_ohms": p,
                "diff": diff,
                "topology": "parallel",
                "description": f"Connect {lbl1} (Sockets {a1}-{b1}) in parallel with {lbl2} (Sockets {a2}-{b2}).",
                "jumpers": [f"{a1}-{a2}", f"{b1}-{b2}"],
                "terminals": [str(a1), str(b1)],
                "formula": f"({r1} Ω · {r2} Ω) / ({r1} Ω + {r2} Ω) = {p} Ω",
            }

    # 4. Three resistors in series (e.g. 4.7K + 3.3K + 470R = 8,470 Ω for 8.5k target)
    for (a1, b1, lbl1, r1), (a2, b2, lbl2, r2), (a3, b3, lbl3, r3) in itertools.combinations(RB_BOARD_RESISTORS, 3):
        s = r1 + r2 + r3
        diff = abs(s - target_ohms)
        if diff < best_diff:
            best_diff = diff
            best = {
                "achieved_ohms": s,
                "diff": diff,
                "topology": "series (3 resistors)",
                "description": f"Connect {lbl1} (Sockets {a1}-{b1}), {lbl2} (Sockets {a2}-{b2}), and {lbl3} (Sockets {a3}-{b3}) in series.",
                "jumpers": [f"{b1}-{a2}", f"{b2}-{a3}"],
                "terminals": [str(a1), str(b3)],
                "formula": f"{r1} Ω + {r2} Ω + {r3} Ω = {s} Ω",
            }

    return best


def diagnose_rb_mistake(
    analysis: Dict[str, Any],
    student_question: str,
    target_ohms: Optional[float] = None,
) -> str:
    """
    Pinpoints mistakes on the Resistance Bank board and teaches the student WHY their circuit
    yields an unexpected value and HOW to fix it.
    """
    actual_rth = analysis.get("equivalent_resistance_ohms")
    active_r = analysis.get("active_resistors", [])
    topology = analysis.get("topology", "none")
    term_a = analysis.get("terminal_a")
    term_b = analysis.get("terminal_b")
    student_groups = analysis.get("detected_connection_groups", [])

    def fmt(ohms):
        if ohms is None:
            return "Open Circuit (∞ Ω)"
        if ohms >= 1000:
            val_k = ohms / 1000.0
            return f"{val_k:.3g} kΩ ({ohms:,.1f} Ω)".replace(".0 Ω", " Ω")
        return f"{ohms:,.1f} Ω".replace(".0 Ω", " Ω")

    reasons = []
    culprit_sockets = set()

    if target_ohms is not None:
        target_str = fmt(target_ohms)
        actual_str = fmt(actual_rth)

        if actual_rth is not None:
            # 1. Resistors that blow past target
            overshoot = [r for r in active_r if r["ohms"] > target_ohms]
            if overshoot:
                for r in overshoot:
                    culprit_sockets.update(r["sockets"])
                    ratio = r["ohms"] / max(target_ohms, 1)
                    reasons.append(
                        f"**Resistor Too Large**: You connected jumper(s) to **{r['label']} ({fmt(r['ohms'])})** at sockets {r['sockets'][0]}-{r['sockets'][1]}. "
                        f"That single resistor alone is already **{ratio:.1f}× larger** than your desired {target_str} target!"
                    )

            # 2. Too many resistors in series
            if len(active_r) >= 3 and topology == "series":
                chain_calc = " + ".join(f"{r['label']} ({r['ohms']}Ω)" for r in active_r)
                reasons.append(
                    f"**Series Chain Accumulation**: You wired {len(active_r)} resistors in series: {chain_calc} = **{actual_str}**. "
                    f"In series, each resistor directly adds to the total ($R_{{total}} = R_1 + R_2 + ...$), causing the combined resistance to build up far higher than you intended."
                )

            # 3. Parallel instead of series
            if actual_rth < (target_ohms * 0.5) and topology == "parallel":
                reasons.append(
                    f"**Parallel Branch Reduction**: Your resistors are wired in parallel, which divides current and *reduces* resistance below the smallest branch. "
                    f"To attain {target_str}, resistors need to be linked in series so their values add together."
                )

        # 4. Short circuits
        short_circuits = analysis.get("short_circuits", [])
        if short_circuits:
            reasons.append(
                f"**Accidental Short Circuit**: Jumper wires are shorting out {', '.join(short_circuits)}. "
                f"Current bypasses shorted resistors entirely, yielding 0 Ω across those sections."
            )

        # 5. Open circuits
        if actual_rth is None or topology == "open":
            reasons.append(
                "**Open Circuit**: Your jumpers do not form a complete, continuous path between the test terminals. "
                "Ensure every resistor in the network is linked end-to-end without dangling or disconnected sockets."
            )

        # Generate solution and fix
        best_sol = find_rb_resistor_combination(target_ohms)
        fix_section = ""
        if best_sol:
            bad_jumpers = []
            for g in student_groups:
                if any(s in culprit_sockets for s in g):
                    bad_jumpers.append("-".join(g))

            jumper_str = f"jumper **Socket {', '.join(best_sol['jumpers'])}**" if best_sol['jumpers'] else "no jumpers (use the single resistor directly)"
            r_desc = best_sol['description']

            fix_section = (
                f"\n\n### 🔧 How to Fix Your Circuit to Get {target_str}:\n"
                f"1. **Disconnect problematic jumpers**: "
                f"{('Remove jumper(s) **' + ', '.join(bad_jumpers) + '** to disconnect the oversized resistor(s).') if bad_jumpers else 'Remove the extra jumpers from the board.'}\n"
                f"2. **Connect the right combination**: {r_desc} ({best_sol['formula']})\n"
                f"3. **Jumper required**: Connect {jumper_str}.\n"
                f"4. **Measurement Terminals**: In the Practical Evaluation card, set **Terminal A = Socket {best_sol['terminals'][0]}** and **Terminal B = Socket {best_sol['terminals'][1]}** (gives **{fmt(best_sol['achieved_ohms'])}**)."
            )

        header = f"### ⚠️ Why you are getting {actual_str} instead of {target_str}:\n\n"
        if not reasons:
            reasons.append(f"Your circuit currently measures {actual_str} across Sockets {term_a}-{term_b}, which differs from your target of {target_str}.")

        return header + "\n\n".join(f"• {r}" for r in reasons) + fix_section

    else:
        actual_str = fmt(actual_rth)
        short_circuits = analysis.get("short_circuits", [])
        res_text = []
        if short_circuits:
            res_text.append(f"• **Short Circuit Detected**: You have placed jumpers directly across both leads of {', '.join(short_circuits)}. Remove those bypass jumpers.")
        if actual_rth is None or topology == "open":
            res_text.append("• **Open Circuit**: There is no complete continuous link between your test terminals. Connect jumper patch cords end-to-end between sockets.")
        if len(active_r) > 4:
            res_text.append(f"• **Excessive Series Chain**: You currently have {len(active_r)} resistors connected in series ({actual_str}), making total resistance very high.")

        if not res_text:
            res_text.append(f"• Your current circuit consists of {len(active_r)} active resistor(s) in a {topology} topology with an equivalent resistance of **{actual_str}** between Sockets {term_a} and {term_b}.")

        return "### 🔍 Circuit Diagnostics & Mistake Check:\n\n" + "\n\n".join(res_text)


def explain_rb_circuit(analysis: Dict[str, Any]) -> str:
    """
    Produces a thorough, pedagogical explanation of how the current circuit configuration
    physically and mathematically produces the equivalent resistance (Rth).
    Teaches the student:
    1. Active components and physical jumper connections.
    2. Physical current flow path (unbranched loop for series, common node division for parallel).
    3. Step-by-step mathematical derivation (KVL / Ohm's Law / KCL).
    4. Measurement terminals & multimeter test loop.
    """
    actual_rth = analysis.get("equivalent_resistance_ohms")
    active_r = analysis.get("active_resistors", [])
    topology = analysis.get("topology", "none")
    term_a = analysis.get("terminal_a")
    term_b = analysis.get("terminal_b")
    student_groups = analysis.get("detected_connection_groups", [])
    short_circuits = analysis.get("short_circuits", [])

    def fmt(ohms):
        if ohms is None:
            return "Open Circuit (∞ Ω)"
        if ohms >= 1000:
            val_k = ohms / 1000.0
            return f"{val_k:.3g} kΩ ({ohms:,.1f} Ω)".replace(".0 Ω", " Ω")
        return f"{ohms:,.1f} Ω".replace(".0 Ω", " Ω")

    if not active_r and not student_groups:
        return (
            "### 🔍 Circuit Explanation\n\n"
            "**No active connections detected yet on the Resistance Bank board.**\n\n"
            "To build a circuit and see how equivalent resistance is produced, connect jumper wires between resistor terminals "
            "(for example, connect Socket 1 to Socket 7 to wire the 1K and 47R resistors in series)."
        )

    if short_circuits and len(short_circuits) == len(active_r):
        return (
            f"### ⚠️ Circuit Explanation: Direct Short Circuit\n\n"
            f"**1. Configuration**: Jumper wire(s) directly bridge both terminals of {', '.join(short_circuits)}.\n\n"
            f"**2. Physical Current Path**: Current always takes the path of least electrical impedance. "
            f"The copper jumper wire has virtually zero resistance ($R_{{\\text{{wire}}}} \\approx 0\\ \\Omega$), "
            f"so 100% of the test current bypasses the resistive element completely.\n\n"
            f"**3. Mathematical Result**: Because the resistor material is bypassed, the voltage drop across it is $V = 0\\text{ V}$. "
            f"By Ohm's Law ($R = V / I$), the measured equivalent resistance collapses to **0.0 Ω**."
        )

    rth_str = fmt(actual_rth)
    jumper_str = ", ".join("-".join(str(x) for x in g) for g in student_groups) if student_groups else "None"

    # Series combination
    if topology == "series" or (len(active_r) >= 2 and topology not in ["parallel", "short_circuit"]):
        r_list_str = ", ".join(f"**{r['label']}** ({fmt(r['ohms'])}, Sockets {r['sockets'][0]}–{r['sockets'][1]})" for r in active_r)
        
        path_steps = []
        if term_a and term_b:
            path_steps.append(f"Socket {term_a} (Terminal A)")
            for r in active_r:
                path_steps.append(f"{r['label']} ({fmt(r['ohms'])})")
            path_steps.append(f"Socket {term_b} (Terminal B)")
            path_display = " ⟶ ".join(path_steps)
        else:
            path_display = " ⟶ ".join(f"{r['label']} ({fmt(r['ohms'])})" for r in active_r)

        formula_parts = " + ".join(f"R_{{{i+1}}}" for i in range(len(active_r)))
        formula_nums = " + ".join(f"{r['ohms']:g}\\ \\Omega" for r in active_r)

        return (
            f"### ⚡ How the Current Circuit Produces {rth_str}\n\n"
            f"**1. Circuit Configuration & Wiring:**\n"
            f"• **Active Components**: {r_list_str}\n"
            f"• **Jumper Interconnection**: Connected via patch cord(s) **({jumper_str})**, linking the resistors into a continuous chain.\n"
            f"• **Measurement Endpoints**: Socket **{term_a}** (Terminal A) and Socket **{term_b}** (Terminal B) form the outer test terminals.\n\n"
            f"**2. Physical Current Path & Conservation of Charge:**\n"
            f"Current flowing through this circuit follows **one single, unbranched path**:\n"
            f"$$\\text{{{path_display}}}$$\n"
            f"Because there are no alternative branch paths or junctions where charge can divide, every electron entering Terminal A must pass sequentially "
            f"through every active resistor before exiting Terminal B. Therefore, by conservation of charge, the **current ($I$) through each resistor is identical**:\n"
            f"$$I_1 = I_2 = \\dots = I$$\n\n"
            f"**3. Mathematical Derivation (Kirchhoff's Voltage Law & Ohm's Law):**\n"
            f"According to KVL, the total voltage drop across the series chain is the sum of the individual voltage drops across each resistor:\n"
            f"$$V_{{\\text{{total}}}} = V_1 + V_2 + \\dots = (I \\cdot R_1) + (I \\cdot R_2) + \\dots = I \\cdot (R_1 + R_2 + \\dots)$$\n"
            f"Dividing total voltage by current $I$ gives the equivalent Thevenin resistance ($R_{{th}}$):\n"
            f"$$R_{{th}} = \\frac{{V_{{\\text{{total}}}}}}{{I}} = {formula_parts} = {formula_nums} = \\mathbf{{{actual_rth:,.1f}\\ \\Omega}}$$\n\n"
            f"**4. Multimeter Measurement Principle:**\n"
            f"When the meter (or evaluation panel) applies a known test current between Socket {term_a} and Socket {term_b}, it detects the combined opposition "
            f"of all series elements. Because resistances in series add directly, the measured result is exactly **{rth_str}**."
        )

    # Parallel combination
    if topology == "parallel":
        r_list_str = ", ".join(f"**{r['label']}** ({fmt(r['ohms'])})" for r in active_r)
        formula_parts = " + ".join(f"\\frac{{1}}{{R_{{{i+1}}}}}" for i in range(len(active_r)))
        formula_nums = " + ".join(f"\\frac{{1}}{{{r['ohms']:g}}}" for r in active_r)
        
        two_r_calc = ""
        if len(active_r) == 2:
            r1, r2 = active_r[0]["ohms"], active_r[1]["ohms"]
            two_r_calc = (
                f"\nFor two parallel resistors, this simplifies to the product-over-sum formula:\n"
                f"$$R_{{th}} = \\frac{{R_1 \\cdot R_2}}{{R_1 + R_2}} = \\frac{{{r1:g} \\times {r2:g}}}{{{r1:g} + {r2:g}}} = \\mathbf{{{actual_rth:,.1f}\\ \\Omega}}$$\n"
            )

        return (
            f"### ⚡ How the Current Circuit Produces {rth_str}\n\n"
            f"**1. Circuit Configuration & Wiring:**\n"
            f"• **Active Components**: {r_list_str}\n"
            f"• **Jumper Interconnection**: Jumpers **({jumper_str})** link both pairs of resistor leads together into two common electrical nodes.\n"
            f"• **Measurement Endpoints**: Measured across Socket **{term_a}** and Socket **{term_b}**.\n\n"
            f"**2. Physical Current Path & Voltage Equality:**\n"
            f"Because both resistors share the exact same two electrical nodes, the **voltage drop ($V$) across each parallel branch is identical** ($V_1 = V_2 = V$).\n"
            f"Electric current entering the input node **splits into parallel branch currents** inversely proportional to each branch's resistance ($I_k = V / R_k$). "
            f"These branch currents recombine at the exit node before leaving the circuit.\n\n"
            f"**3. Mathematical Derivation (Kirchhoff's Current Law):**\n"
            f"By KCL, total current is the sum of all branch currents:\n"
            f"$$I_{{\\text{{total}}}} = \\sum I_k = V \\cdot \\left({formula_parts}\\right)$$\n"
            f"Therefore, the reciprocal of the equivalent resistance equals the sum of reciprocals:\n"
            f"$$\\frac{{1}}{{R_{{th}}}} = {formula_parts} = {formula_nums}$$\n"
            f"{two_r_calc}\n"
            f"**4. Multimeter Measurement Principle:**\n"
            f"Adding parallel paths provides more channels for electron flow, reducing overall electrical resistance. "
            f"The meter measures this reduced opposition across Sockets {term_a} and {term_b}, yielding **{rth_str}**."
        )

    # Single resistor
    if topology == "single" or len(active_r) == 1:
        r = active_r[0]
        return (
            f"### ⚡ How the Current Circuit Produces {rth_str}\n\n"
            f"**1. Circuit Configuration:** Only one active component, **{r['label']}** ({fmt(r['ohms'])}), is placed between Sockets {r['sockets'][0]} and {r['sockets'][1]}.\n"
            f"**2. Current Path:** Current passes directly through the resistive material between Socket {term_a} and Socket {term_b} without any branching or series elements.\n"
            f"**3. Derivation:** $R_{{th}} = R_1 = \\mathbf{{{actual_rth:,.1f}\\ \\Omega}}$.\n"
            f"**4. Result:** The test meter directly measures the resistance of {r['label']}, which equals **{rth_str}**."
        )

    # Generic or complex
    return (
        f"### ⚡ How the Current Circuit Produces {rth_str}\n\n"
        f"**1. Configuration**: {len(active_r)} resistors connected in a {topology} network via jumpers ({jumper_str}).\n"
        f"**2. Nodal Analysis**: The test current enters Socket {term_a} and exits Socket {term_b}. "
        f"The equivalent resistance is determined by solving the circuit's conductance matrix (Kirchhoff's Current Law at each node).\n"
        f"**3. Theoretical Result**: The calculated Thevenin equivalent resistance between Sockets {term_a} and {term_b} is **{rth_str}**."
    )


def analyze_resistance_bank(
    student_groups: List[List[str]],
    node_map: Optional[Dict[str, Any]] = None,
    extra_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Dedicated analyzer for Resistance Bank trainer networks.
    Computes exact equivalent resistance (Rth) via Nodal Laplacian matrix,
    identifies series/parallel/complex topologies, active resistors, and next steps.
    """
    extra_context = extra_context or {}
    node_map = node_map or {}

    parent: Dict[str, str] = {}
    for grp in student_groups:
        for i in range(len(grp) - 1):
            _rb_uf_union(parent, str(grp[i]), str(grp[i + 1]))

    jumpered_sockets = {str(s) for grp in student_groups for s in grp}

    short_circuits = []
    for a, b, lbl, ohms in RB_BOARD_RESISTORS:
        if str(a) in parent and str(b) in parent and _rb_uf_find(parent, str(a)) == _rb_uf_find(parent, str(b)):
            short_circuits.append(f"{lbl} (Sockets {a}-{b})")

    active_resistors = []
    for a, b, lbl, ohms in RB_BOARD_RESISTORS:
        if str(a) in jumpered_sockets or str(b) in jumpered_sockets:
            active_resistors.append({
                "sockets": [str(a), str(b)],
                "label": lbl,
                "ohms": ohms,
                "shorted": _rb_uf_find(parent, str(a)) == _rb_uf_find(parent, str(b)),
            })

    if not student_groups:
        empty_res = {
            "is_resistance_bank": True,
            "status": "empty",
            "detected_connection_groups": [],
            "active_resistors": [],
            "topology": "none",
            "short_circuits": [],
            "terminal_a": None,
            "terminal_b": None,
            "equivalent_resistance_ohms": None,
            "network_summary": "No jumpers are connected yet on the Resistance Bank board.",
            "next_step": "Select two or more resistors and connect jumper wires between their terminal sockets (e.g. connect socket 1 to socket 7 to wire 1K in series with 47R). Then pick two measurement terminals (Terminal A and B) to calculate Rth.",
            "circuit_explanation": "No jumpers connected yet. Connect jumper patch cords to form a circuit network.",
            "correct_groups": [],
            "missing_groups": [],
            "wrong_groups": [],
            "group_details": {},
            "summary": {"expected": 1, "correct": 0, "missing": 1, "wrong": 0},
        }
        return empty_res

    root_pins: Dict[str, List[str]] = {}
    for r in active_resistors:
        if not r["shorted"]:
            ra = _rb_uf_find(parent, r["sockets"][0])
            rb = _rb_uf_find(parent, r["sockets"][1])
            root_pins.setdefault(ra, []).append(r["sockets"][0])
            root_pins.setdefault(rb, []).append(r["sockets"][1])

    open_roots = [rt for rt, p_list in root_pins.items() if len(p_list) == 1]
    
    cand_a = extra_context.get("terminal_a")
    cand_b = extra_context.get("terminal_b")

    if cand_a and str(cand_a) in parent:
        terminal_a = str(cand_a)
    elif open_roots:
        terminal_a = root_pins[open_roots[0]][0]
    elif active_resistors:
        terminal_a = active_resistors[0]["sockets"][0]
    else:
        terminal_a = None

    if cand_b and str(cand_b) in parent:
        terminal_b = str(cand_b)
    elif len(open_roots) >= 2:
        terminal_b = root_pins[open_roots[-1]][0]
    elif active_resistors and len(active_resistors[0]["sockets"]) > 1:
        terminal_b = active_resistors[-1]["sockets"][1]
    else:
        terminal_b = None

    if short_circuits and len(short_circuits) == len(active_resistors):
        topology = "short_circuit"
    elif len(active_resistors) == 1:
        topology = "single"
    elif len(set(root_pins.keys())) == 2 and len(open_roots) == 0:
        topology = "parallel"
    elif all(len(p_list) <= 2 for p_list in root_pins.values()) and len(open_roots) == 2:
        topology = "series"
    elif len(set(root_pins.keys())) == 2:
        topology = "parallel"
    else:
        topology = "series_parallel"

    edges = [(_rb_uf_find(parent, str(a)), _rb_uf_find(parent, str(b)), ohms) for a, b, lbl, ohms in RB_BOARD_RESISTORS]
    rth = None
    if terminal_a and terminal_b:
        rth = _rb_effective_resistance(edges, _rb_uf_find(parent, terminal_a), _rb_uf_find(parent, terminal_b))

    active_labels = [r["label"] for r in active_resistors]
    jumper_str = ", ".join("-".join(str(x) for x in g) for g in student_groups)
    rth_rounded = round(rth, 2) if rth is not None else None

    if topology == "series":
        r_sum_str = " + ".join(f"{r['ohms']:g}Ω" for r in active_resistors)
        desc = f"Series combination of {len(active_resistors)} resistors ({', '.join(active_labels)}) via jumpers ({jumper_str}): Rth = {r_sum_str} = {rth_rounded} Ω."
    elif topology == "parallel":
        desc = f"Parallel combination of {len(active_resistors)} resistors ({', '.join(active_labels)}) via jumpers ({jumper_str}): Rth = {rth_rounded} Ω."
    else:
        desc = f"Resistor network of {len(active_resistors)} resistors ({', '.join(active_labels)}) wired via jumpers ({jumper_str}): Rth = {rth_rounded} Ω."

    if short_circuits:
        desc += f" ⚠️ Warning: Short circuit detected across {', '.join(short_circuits)}!"

    if rth is not None:
        next_step = f"Equivalent resistance across Sockets {terminal_a} & {terminal_b} is {rth_rounded} Ω. Enter this in the Practical Evaluation panel (Terminal A: {terminal_a}, Terminal B: {terminal_b}, Rth: {rth_rounded} Ω) to verify."
    else:
        next_step = "Designate two measurement terminals across the connected network to calculate Rth."

    partial_res = {
        "is_resistance_bank": True,
        "status": "active",
        "detected_connection_groups": student_groups,
        "active_resistors": active_resistors,
        "topology": topology,
        "short_circuits": short_circuits,
        "terminal_a": terminal_a,
        "terminal_b": terminal_b,
        "equivalent_resistance_ohms": round(rth, 4) if rth is not None else None,
        "network_summary": desc,
        "next_step": next_step,
        "correct_groups": [f"RB_{r['label']}" for r in active_resistors],
        "missing_groups": [],
        "wrong_groups": [],
        "group_details": {
            f"RB_{r['label']}": {
                "status": "correct",
                "component_name": f"{r['label']} Resistor ({r['ohms']}Ω)",
                "purpose": f"Forms part of the {topology} network between sockets {r['sockets'][0]} and {r['sockets'][1]}",
                "matched_nodes": r["sockets"],
                "next_step": next_step,
            } for r in active_resistors
        },
        "summary": {
            "expected": len(active_resistors),
            "correct": len(active_resistors),
            "missing": 0,
            "wrong": len(short_circuits),
        }
    }
    partial_res["circuit_explanation"] = explain_rb_circuit(partial_res)
    return partial_res


def analyze_connections(
    student_groups: List[List[str]],
    correct_groups: Dict[str, List[List[str]]],
    group_metadata: Optional[Dict[str, Any]] = None,
    node_map: Optional[Dict[str, Any]] = None,
    experiment_name: Optional[str] = None,
    extra_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Compare student connection groups with expected groups or evaluate Resistance Bank networks.
    """
    # If Resistance Bank experiment or no pre-defined correct groups
    if (experiment_name and "resistance" in experiment_name.lower()) or (not correct_groups and (not group_metadata or "resistance" in str(group_metadata).lower())):
        return analyze_resistance_bank(
            student_groups=student_groups,
            node_map=node_map,
            extra_context=extra_context,
        )

    group_metadata = group_metadata or {}
    node_map = node_map or {}

    matched_groups: List[str] = []
    missing_groups: List[str] = []
    wrong_groups: List[List[str]] = []
    group_details: Dict[str, Any] = {}

    for group_name, variants in correct_groups.items():

        matched_variant = _find_matching_variant(student_groups, variants)

        if matched_variant is not None:
            matched_groups.append(group_name)
            group_details[group_name] = _build_group_detail(
                group_name,
                status="correct",
                group_metadata=group_metadata,
                matched_nodes=matched_variant,
                node_map=node_map,
            )
        else:
            missing_groups.append(group_name)
            group_details[group_name] = _build_group_detail(
                group_name,
                status="missing",
                group_metadata=group_metadata,
                matched_nodes=None,
                node_map=node_map,
            )

    # Detect extra/unrecognized groups reported by the student's wiring
    for student in student_groups:

        ok = False

        for variants in correct_groups.values():
            for variant in variants:
                if _set_equal(student, variant):
                    ok = True
                    break
            if ok:
                break

        if not ok:
            wrong_groups.append(student)

    total = len(correct_groups)

    return {
        "is_resistance_bank": False,
        "detected_connection_groups": student_groups,
        "correct_groups": matched_groups,
        "missing_groups": missing_groups,
        "wrong_groups": wrong_groups,
        "group_details": group_details,
        "summary": {
            "expected": total,
            "correct": len(matched_groups),
            "missing": len(missing_groups),
            "wrong": len(wrong_groups),
        },
    }