from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey, Float, Boolean
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from datetime import datetime
import os

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./edunexus.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)  # 'student' or 'staff'
    name = Column(String, default="")
    bio = Column(Text, default="")
    university = Column(String, default="")
    department = Column(String, default="")
    phone = Column(String, default="")
    graduation_year = Column(String, default="")
    subject = Column(String, default="")
    skills = Column(Text, default="[]")  # JSON-encoded list
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Announcement(Base):
    __tablename__ = "announcements"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"))
    author_name = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    company = Column(String, default="")
    location = Column(String, default="")
    description = Column(Text, default="")
    skills = Column(Text, default="[]")  # JSON-encoded list
    difficulty = Column(String, default="Intermediate")  # Easy/Intermediate/Advanced
    icon = Column(String, default="🚀")
    icon_bg = Column(String, default="#EEF2FF")
    created_at = Column(DateTime, default=datetime.utcnow)


class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)


class AssessmentResult(Base):
    __tablename__ = "assessment_results"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    kit_id = Column(String, default="power_converter")
    experiment_name = Column(String, default="Power Converter Kit Assessment")
    score = Column(Integer, default=0)
    status = Column(String, default="FAIL")  # PASS / FAIL
    time_taken_seconds = Column(Integer, default=0)
    attempt_number = Column(Integer, default=1)
    groups_correct = Column(Integer, default=0)
    groups_total = Column(Integer, default=0)
    voltage_selected = Column(String, default="")
    faculty_approved = Column(String, default="pending")  # pending / approved / rejected
    # NEW: wiring data submitted by student
    wiring_data = Column(Text, default="[]")   # JSON: [[a,b], [c,d], ...]  (raw wire pairs)
    groups_data = Column(Text, default="[]")   # JSON: [[node,...], ...]  (connection groups)
    group_correct_flags = Column(Text, default="[]")  # JSON: [true, false, ...]
    submission_time = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Audit trail
    reviewer_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewer_name = Column(String, default="")
    review_timestamp = Column(DateTime, nullable=True)
    review_comments = Column(Text, default="")
    cloud_submission_id = Column(String, default="")  # ID from cloud server
    # Resistance Bank fields (nullable — unused by Power Converter rows)
    node_a = Column(String, nullable=True)
    node_b = Column(String, nullable=True)
    student_answer = Column(Float, nullable=True)
    correct_value = Column(Float, nullable=True)   # exact Rth computed client-side, shown to faculty only
    error_percent = Column(Float, nullable=True)
    tolerance_percent = Column(Float, nullable=True)
    is_correct_client = Column(Boolean, nullable=True)  # JS-computed correctness, pre-faculty-review
    # Automatic wiring capture — path to the captured board image
    # (Resistance Bank board + resistors + jumper wires only), saved as
    # level1_connection.png. Empty for kits/submissions with no captured image.
    wiring_image_path = Column(String, default="")

    # Auto-detected (never chosen by the student): "Hardware Kit" if the
    # experiment was performed via the ESP32/Arduino trainer kit (Web
    # Serial connected), otherwise "Manual Connection" for the virtual
    # wiring interface. Used only to display this field in reports.
    connection_method = Column(String, default="Manual Connection")


class AssessmentAuditLog(Base):
    """Immutable audit trail for all assessment review actions."""
    __tablename__ = "assessment_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("assessment_results.id"))
    student_name = Column(String, default="")
    assessment_name = Column(String, default="")
    submitted_connections = Column(Text, default="[]")  # JSON snapshot
    staff_reviewer = Column(String, default="")
    reviewer_id = Column(Integer, nullable=True)
    approval_timestamp = Column(DateTime, nullable=True)
    approval_status = Column(String, default="")  # approved / rejected
    score = Column(Integer, default=0)
    comments = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Level2Assessment(Base):
    """Staff-created 'Target Resistance Challenge' assessment definition.
    Independent of Level 1 — does not touch AssessmentResult / Level 1 tables.
    Staff configure a TARGET RANGE (min/max ohms), not one fixed target — each
    student is assigned their own randomly-generated, board-achievable target
    within that range (see Level2StudentTarget), so students can't just share
    one answer with each other."""
    __tablename__ = "level2_assessments"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, default="Target Resistance Challenge")
    # Kept for backward compatibility with older rows / any code still reading
    # it directly; new logic uses target_min_ohms/target_max_ohms below.
    target_resistance_ohms = Column(Float, nullable=True)
    target_min_ohms = Column(Float, nullable=True)
    target_max_ohms = Column(Float, nullable=True)
    tolerance_percent = Column(Float, nullable=False, default=5.0)
    time_limit_seconds = Column(Integer, nullable=False, default=1200)
    max_attempts = Column(Integer, nullable=False, default=3)
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    # ---- Staff Level 2 Configuration module (additive, new columns only) ----
    experiment_name = Column(String, default="Resistance Bank")
    resistance_unit = Column(String, default="Ω")          # Ω / kΩ / MΩ — display unit only; target_resistance_ohms stays the source of truth in ohms
    node_a = Column(String, default="")                    # Measurement Terminal A (e.g. "Node 1")
    node_b = Column(String, default="")                    # Measurement Terminal B (e.g. "Node 2")
    instructions = Column(Text, default="")
    status = Column(String, default="published")           # draft / published — Draft assessments are never returned to students


class Level2StudentTarget(Base):
    """Each student's individually-assigned target resistance for a given
    Level 2 assessment. Generated once (on first fetch) from real board
    resistor combinations within the assessment's staff-set range, then
    reused for every attempt by that student so it stays stable across
    reloads/retries. This is what makes every student's question different."""
    __tablename__ = "level2_student_targets"

    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("level2_assessments.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    target_resistance_ohms = Column(Float, nullable=False)
    recipe = Column(Text, default="")  # human-unreadable-by-design internal note of which resistors were combined (staff/debug only)
    created_at = Column(DateTime, default=datetime.utcnow)


class Level2Result(Base):
    """Student submission for a Level 2 Target Resistance Challenge.
    Auto-evaluated (Target vs System-Calculated Resistance) — no staff approval."""
    __tablename__ = "level2_results"

    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("level2_assessments.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    node_a = Column(String, default="")
    node_b = Column(String, default="")
    student_answer = Column(Float, nullable=True)          # student's manually-calculated value
    system_calculated_resistance = Column(Float, nullable=True)  # solver's Rth for the wiring
    target_resistance_ohms = Column(Float, nullable=True)
    tolerance_percent = Column(Float, nullable=True)
    error_percent = Column(Float, nullable=True)           # |system - target| / target * 100
    result = Column(String, default="FAIL")                # PASS / FAIL (system auto-evaluation, unchanged)
    attempt_number = Column(Integer, default=1)
    time_taken_seconds = Column(Integer, default=0)
    wiring_data = Column(Text, default="[]")
    submission_time = Column(DateTime, default=datetime.utcnow)
    # Staff Approval workflow (additive — does not touch the calculation/result above)
    faculty_approved = Column(String, default="pending")    # pending / approved / rejected
    reviewer_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewer_name = Column(String, default="")
    review_timestamp = Column(DateTime, nullable=True)
    review_comments = Column(Text, default="")
    # Automatic wiring capture — path to the captured board image
    # (Resistance Bank board + resistors + jumper wires only), saved as
    # level2_connection.png.
    wiring_image_path = Column(String, default="")

    # Auto-detected (never chosen by the student): "Hardware Kit" if the
    # experiment was performed via the ESP32/Arduino trainer kit (Web
    # Serial connected), otherwise "Manual Connection" for the virtual
    # wiring interface. Used only to display this field in reports.
    connection_method = Column(String, default="Manual Connection")


def init_db():
    Base.metadata.create_all(bind=engine)
