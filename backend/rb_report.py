"""
Resistance Bank — Final Practical Report generator.

Generates a professional engineering laboratory report PDF for a student's
Resistance Bank experiment, combining:
  - Level 1 (Equivalent Resistance / Rth assessment)
  - Level 2 (Target Resistance Challenge)

STRICT GATE: the report is only generated if BOTH Level 1 AND Level 2 are
faculty-approved for that student. If either is missing, pending, or
rejected, generation is refused with a clear reason — no PDF is produced.

This module does not alter any existing calculation, grading, or approval
logic. It only reads already-stored records (including the automatically
captured wiring images level1_connection.png / level2_connection.png) and
renders them into a PDF.
"""

import os
import sys
import io
from datetime import datetime
from typing import Optional

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage,
    HRFlowable, PageBreak, KeepTogether,
)

from models import AssessmentResult, Level2Result, User
from rb_wiring_render import render_wiring_image_bytes

REPORTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", "reports")
os.makedirs(REPORTS_DIR, exist_ok=True)

BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))


class ReportNotReady(Exception):
    """Raised when Level 1 and/or Level 2 are not both approved yet."""
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


class ReportGenerationFailed(Exception):
    """Raised when the PDF itself could not be built (e.g. an unrecoverable
    layout error). Distinct from ReportNotReady, which means the student
    simply isn't eligible yet — this means eligibility was fine but PDF
    generation broke, so the caller should surface it as a server error,
    not a 'not ready' state."""
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def _fmt_ohms(value: Optional[float]) -> str:
    if value is None:
        return "Open circuit / —"
    v = float(value)
    if v >= 1_000_000:
        return f"{v/1_000_000:.4f} M-ohm"
    if v >= 1_000:
        return f"{v/1_000:.4f} k-ohm"
    return f"{v:.4f} ohm"


def _fmt_percent(value: Optional[float]) -> str:
    if value is None:
        return "—"
    return f"{float(value):.3f}%"


def _fmt_dt(dt) -> str:
    if not dt:
        return "—"
    try:
        return dt.strftime("%d %b %Y, %I:%M %p")
    except Exception:
        return str(dt)


def get_latest_approved_level1(db, user_id: int) -> Optional[AssessmentResult]:
    return (
        db.query(AssessmentResult)
        .filter(
            AssessmentResult.user_id == user_id,
            AssessmentResult.kit_id == "resistance_bank",
            AssessmentResult.faculty_approved == "approved",
        )
        .order_by(AssessmentResult.review_timestamp.desc().nullslast(), AssessmentResult.created_at.desc())
        .first()
    )


def get_latest_approved_level2(db, user_id: int) -> Optional[Level2Result]:
    return (
        db.query(Level2Result)
        .filter(
            Level2Result.user_id == user_id,
            Level2Result.faculty_approved == "approved",
        )
        .order_by(Level2Result.review_timestamp.desc().nullslast(), Level2Result.submission_time.desc())
        .first()
    )


def check_report_eligibility(db, user_id: int):
    """Returns (level1_row, level2_row) if BOTH are approved.
    Raises ReportNotReady otherwise with a precise reason."""
    level1 = get_latest_approved_level1(db, user_id)
    level2 = get_latest_approved_level2(db, user_id)

    if level1 is None and level2 is None:
        raise ReportNotReady(
            "Report cannot be generated: neither Level 1 nor Level 2 has been "
            "approved by faculty yet."
        )
    if level1 is None:
        raise ReportNotReady(
            "Report cannot be generated: Level 1 has not been approved by "
            "faculty yet."
        )
    if level2 is None:
        raise ReportNotReady(
            "Report cannot be generated: Level 2 has not been approved by "
            "faculty yet."
        )
    return level1, level2


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle(name="RBTitle", fontName="Helvetica-Bold", fontSize=20,
                           alignment=TA_CENTER, textColor=colors.HexColor("#0B2545"),
                           leading=24, spaceAfter=6))
    ss.add(ParagraphStyle(name="RBSubtitle", fontName="Helvetica", fontSize=11,
                           alignment=TA_CENTER, textColor=colors.HexColor("#475569"),
                           leading=14, spaceAfter=10))
    ss.add(ParagraphStyle(name="RBSection", fontName="Helvetica-Bold", fontSize=13,
                           textColor=colors.white, spaceBefore=0, spaceAfter=0,
                           leftIndent=6, leading=18))
    ss.add(ParagraphStyle(name="RBLabel", fontName="Helvetica-Bold", fontSize=9,
                           textColor=colors.HexColor("#64748B")))
    ss.add(ParagraphStyle(name="RBValue", fontName="Helvetica", fontSize=10.5,
                           textColor=colors.HexColor("#0B2545")))
    ss.add(ParagraphStyle(name="RBValueBold", fontName="Helvetica-Bold", fontSize=11,
                           textColor=colors.HexColor("#0B2545")))
    ss.add(ParagraphStyle(name="RBSmall", fontName="Helvetica", fontSize=8.5,
                           textColor=colors.HexColor("#64748B")))
    ss.add(ParagraphStyle(name="RBComments", fontName="Helvetica-Oblique", fontSize=10,
                           textColor=colors.HexColor("#334155"), leading=13))
    return ss


def _section_header(text: str, styles, bg="#0B2545"):
    tbl = Table([[Paragraph(text, styles["RBSection"])]], colWidths=[170 * mm], rowHeights=[22])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    return tbl


def _kv_row(label, value, styles, value_style="RBValue"):
    return [Paragraph(label, styles["RBLabel"]), Paragraph(str(value), styles[value_style])]


def _approval_badge(status: str, styles):
    approved = (status or "").lower() == "approved"
    color = "#166534" if approved else ("#991b1b" if (status or "").lower() == "rejected" else "#854d0e")
    bg = "#dcfce7" if approved else ("#fee2e2" if (status or "").lower() == "rejected" else "#fef9c3")
    label = "✓ APPROVED" if approved else ("✗ REJECTED" if (status or "").lower() == "rejected" else "PENDING")
    tbl = Table([[Paragraph(f"<b>{label}</b>", ParagraphStyle(
        name="badge", fontName="Helvetica-Bold", fontSize=10, textColor=colors.HexColor(color),
        alignment=TA_CENTER))]], colWidths=[45 * mm], rowHeights=[16])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg)),
        ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor(color)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return tbl


def _pil_image_to_flowable(pil_img, max_w, max_h):
    """Shared helper: normalize a PIL image to RGB PNG bytes and wrap it as
    a bordered, size-capped reportlab flowable."""
    if pil_img.mode in ("RGBA", "LA", "P"):
        background = pil_img_module.new("RGB", pil_img.size, (255, 255, 255))
        rgba = pil_img.convert("RGBA")
        background.paste(rgba, mask=rgba.split()[-1])
        pil_img = background
    elif pil_img.mode != "RGB":
        pil_img = pil_img.convert("RGB")

    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    buf.seek(0)

    img = RLImage(buf)
    iw, ih = img.wrap(0, 0)
    scale = min(max_w / iw, max_h / ih, 1.0)
    img.drawWidth = iw * scale
    img.drawHeight = ih * scale
    wrapper = Table([[img]], colWidths=[max_w])
    wrapper.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#cbd5e1")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return wrapper


def _wiring_image_flowable(relative_path: str, caption: str, styles, max_w=150 * mm, max_h=95 * mm,
                            wiring_data_json: Optional[str] = None,
                            node_a: Optional[str] = None, node_b: Optional[str] = None):
    """Primary path: redraw the wiring diagram server-side from the reliably
    stored wiring_data (board image + jumper lines + node highlights, using
    socket_positions.json). This does not depend on the client-side canvas
    capture and cannot come back missing/404/corrupted for a submitted
    assessment. Falls back to the legacy captured PNG (relative_path) only
    if wiring_data is unavailable or fails to render, for backward
    compatibility with pre-existing behavior."""
    from PIL import Image as PILImage
    global pil_img_module
    pil_img_module = PILImage

    try:
        rendered_bytes = render_wiring_image_bytes(wiring_data_json, node_a, node_b)
    except Exception:
        rendered_bytes = None

    if rendered_bytes:
        try:
            pil_img = PILImage.open(io.BytesIO(rendered_bytes))
            pil_img.load()
            return _pil_image_to_flowable(pil_img, max_w, max_h)
        except Exception:
            pass  # fall through to legacy path

    # ---- Legacy fallback: previously captured client-side PNG ----
    if not relative_path:
        return Paragraph(f"<i>No wiring image available for {caption}.</i>", styles["RBSmall"])
    abs_path = os.path.join(BACKEND_ROOT, relative_path)

    if not os.path.isfile(abs_path):
        return Paragraph(f"<i>Wiring image file not found for {caption}.</i>", styles["RBSmall"])
    try:
        # Fully decode and normalize the PNG ourselves, right here, instead of
        # handing the raw file to reportlab's Image flowable. reportlab only
        # *lazily* decodes images — the real pixel decode happens later,
        # inside doc.build(), which is outside this try/except. That meant a
        # captured wiring PNG in an unusual mode (RGBA/palette/etc.) could
        # blow up the entire report build with an unhandled error instead of
        # falling back to this "could not embed" message. Decoding + flattening
        # to RGB here guarantees any bad image is caught at this point.
        pil_img = PILImage.open(abs_path)
        pil_img.load()  # force full decode now, not lazily later
        return _pil_image_to_flowable(pil_img, max_w, max_h)
    except Exception as e:
        return Paragraph(f"<i>Could not embed wiring image for {caption} ({e}).</i>", styles["RBSmall"])


def generate_resistance_bank_report(db, user_id: int) -> str:
    """Generates the final Resistance Bank Practical Report PDF.
    Raises ReportNotReady if Level 1 AND Level 2 are not both approved.
    Returns the absolute filesystem path to the generated PDF."""

    level1, level2 = check_report_eligibility(db, user_id)

    student = db.query(User).filter(User.id == user_id).first()
    if not student:
        raise ReportNotReady("Student record not found.")

    styles = _styles()
    story = []

    out_dir = os.path.join(REPORTS_DIR, str(user_id))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "resistance_bank_practical_report.pdf")

    doc = SimpleDocTemplate(
        out_path, pagesize=A4,
        topMargin=16 * mm, bottomMargin=16 * mm, leftMargin=20 * mm, rightMargin=20 * mm,
    )

    # ---------------- Header ----------------
    story.append(Paragraph("MOUSE INNOVATIONS", ParagraphStyle(
        name="brand", fontName="Helvetica-Bold", fontSize=10, alignment=TA_CENTER,
        textColor=colors.HexColor("#2563EB"), spaceAfter=2)))
    story.append(Paragraph("Resistance Bank — Final Practical Report", styles["RBTitle"]))
    story.append(Paragraph("Electrical Engineering Laboratory · Equivalent Resistance (Rth) Assessment",
                            styles["RBSubtitle"]))
    story.append(HRFlowable(width="100%", thickness=1.2, color=colors.HexColor("#0B2545"), spaceAfter=12))

    # ---------------- Student Details ----------------
    story.append(_section_header("STUDENT DETAILS", styles))
    story.append(Spacer(1, 6))
    student_name = student.name or student.email
    student_table = Table([
        _kv_row("Student Name", student_name, styles),
        _kv_row("Register Number", getattr(student, "register_number", "") or "—", styles),
        _kv_row("Email", student.email, styles),
        _kv_row("Department", student.department or "—", styles),
        _kv_row("Report Generated On", datetime.utcnow().strftime("%d %b %Y, %I:%M %p UTC"), styles),
        _kv_row("Connection Method", level1.connection_method or "Manual Connection", styles),
    ], colWidths=[45 * mm, 125 * mm])
    student_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(student_table)
    story.append(Spacer(1, 14))

    # ---------------- Level 1 ----------------
    story.append(_section_header("LEVEL 1 — EQUIVALENT RESISTANCE (Rth) ASSESSMENT", styles, bg="#1d4ed8"))
    story.append(Spacer(1, 8))
    story.append(Paragraph("Student Wiring — level1_connection.png", styles["RBLabel"]))
    story.append(Spacer(1, 3))
    story.append(_wiring_image_flowable(
        level1.wiring_image_path, "Level 1", styles,
        wiring_data_json=getattr(level1, "wiring_data", None),
        node_a=level1.node_a, node_b=level1.node_b,
    ))
    story.append(Spacer(1, 8))

    l1_table = Table([
        _kv_row("Measurement Nodes", f"Node A = {level1.node_a or '—'}   |   Node B = {level1.node_b or '—'}", styles),
        _kv_row("Student Answer", _fmt_ohms(level1.student_answer), styles, "RBValueBold"),
        _kv_row("System (Correct) Answer", _fmt_ohms(level1.correct_value), styles, "RBValueBold"),
        _kv_row("Tolerance", _fmt_percent(level1.tolerance_percent), styles),
        _kv_row("Error Percentage", _fmt_percent(level1.error_percent), styles),
        _kv_row("Time Taken", f"{level1.time_taken_seconds // 60} min {level1.time_taken_seconds % 60} sec"
                if level1.time_taken_seconds is not None else "—", styles),
    ], colWidths=[50 * mm, 120 * mm])
    l1_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(l1_table)
    story.append(Spacer(1, 8))

    story.append(Paragraph("Faculty Comments", styles["RBLabel"]))
    story.append(Paragraph(level1.review_comments or "<i>No comments provided.</i>", styles["RBComments"]))
    story.append(Spacer(1, 8))

    l1_approval_row = Table([[
        Paragraph("Faculty Approval:", styles["RBLabel"]),
        _approval_badge(level1.faculty_approved, styles),
        Paragraph(f"Reviewed by: <b>{level1.reviewer_name or '—'}</b>  ·  {_fmt_dt(level1.review_timestamp)}",
                  styles["RBSmall"]),
    ]], colWidths=[28 * mm, 45 * mm, 97 * mm])
    l1_approval_row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story.append(l1_approval_row)

    story.append(Spacer(1, 16))
    story.append(PageBreak())

    # ---------------- Level 2 ----------------
    story.append(_section_header("LEVEL 2 — TARGET RESISTANCE CHALLENGE", styles, bg="#7c3aed"))
    story.append(Spacer(1, 8))
    story.append(Paragraph("Student Wiring — level2_connection.png", styles["RBLabel"]))
    story.append(Spacer(1, 3))
    story.append(_wiring_image_flowable(
        level2.wiring_image_path, "Level 2", styles,
        wiring_data_json=getattr(level2, "wiring_data", None),
        node_a=level2.node_a, node_b=level2.node_b,
    ))
    story.append(Spacer(1, 8))

    l2_table = Table([
        _kv_row("Measurement Nodes", f"Node A = {level2.node_a or '—'}   |   Node B = {level2.node_b or '—'}", styles),
        _kv_row("Target Resistance", _fmt_ohms(level2.target_resistance_ohms), styles, "RBValueBold"),
        _kv_row("Student Answer", _fmt_ohms(level2.student_answer), styles, "RBValueBold"),
        _kv_row("System (Calculated) Answer", _fmt_ohms(level2.system_calculated_resistance), styles, "RBValueBold"),
        _kv_row("Tolerance", _fmt_percent(level2.tolerance_percent), styles),
        _kv_row("Error Percentage", _fmt_percent(level2.error_percent), styles),
        _kv_row("Time Taken", f"{level2.time_taken_seconds // 60} min {level2.time_taken_seconds % 60} sec"
                if level2.time_taken_seconds is not None else "—", styles),
    ], colWidths=[50 * mm, 120 * mm])
    l2_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(l2_table)
    story.append(Spacer(1, 8))

    story.append(Paragraph("Faculty Comments", styles["RBLabel"]))
    story.append(Paragraph(level2.review_comments or "<i>No comments provided.</i>", styles["RBComments"]))
    story.append(Spacer(1, 8))

    l2_approval_row = Table([[
        Paragraph("Faculty Approval:", styles["RBLabel"]),
        _approval_badge(level2.faculty_approved, styles),
        Paragraph(f"Reviewed by: <b>{level2.reviewer_name or '—'}</b>  ·  {_fmt_dt(level2.review_timestamp)}",
                  styles["RBSmall"]),
    ]], colWidths=[28 * mm, 45 * mm, 97 * mm])
    l2_approval_row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story.append(l2_approval_row)

    story.append(Spacer(1, 16))

    # ---------------- Final Result ----------------
    story.append(_section_header("FINAL RESULT", styles, bg="#0f766e"))
    story.append(Spacer(1, 8))

    l1_ok = (level1.faculty_approved or "").lower() == "approved"
    l2_ok = (level2.faculty_approved or "").lower() == "approved"
    overall = "PASS" if (l1_ok and l2_ok) else "FAIL"
    overall_color = "#166534" if overall == "PASS" else "#991b1b"
    overall_bg = "#dcfce7" if overall == "PASS" else "#fee2e2"

    final_table = Table([
        [Paragraph("Level 1 Status", styles["RBLabel"]), _approval_badge(level1.faculty_approved, styles)],
        [Paragraph("Level 2 Status", styles["RBLabel"]), _approval_badge(level2.faculty_approved, styles)],
    ], colWidths=[50 * mm, 50 * mm])
    final_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(final_table)
    story.append(Spacer(1, 8))

    overall_table = Table([[Paragraph(f"<b>OVERALL RESULT: {overall}</b>", ParagraphStyle(
        name="overall", fontName="Helvetica-Bold", fontSize=14, alignment=TA_CENTER,
        textColor=colors.HexColor(overall_color)))]], colWidths=[170 * mm], rowHeights=[28])
    overall_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(overall_bg)),
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor(overall_color)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(overall_table)
    story.append(Spacer(1, 30))

    # ---------------- Signatures ----------------
    sig_table = Table([
        ["_______________________________", "_______________________________"],
        [Paragraph("Faculty Signature", styles["RBLabel"]), Paragraph("Student Signature", styles["RBLabel"])],
        [Paragraph(level1.reviewer_name or level2.reviewer_name or "", styles["RBSmall"]),
         Paragraph(student_name, styles["RBSmall"])],
    ], colWidths=[85 * mm, 85 * mm])
    sig_table.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, 0), 20),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    story.append(sig_table)

    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#cbd5e1")))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "This report was auto-generated by the MIP COMPANY platform from faculty-approved "
        "Level 1 and Level 2 Resistance Bank submissions, including the automatically "
        "captured wiring images.",
        styles["RBSmall"],
    ))

    try:
        doc.build(story)
    except Exception as e:
        raise ReportGenerationFailed(
            f"Could not generate the report for user_id={user_id}: {e}"
        ) from e
    return out_path
