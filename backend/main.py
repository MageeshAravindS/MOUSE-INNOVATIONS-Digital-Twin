import json
import os
import sys
import shutil
import base64
from datetime import datetime
from typing import Optional

# Ensure backend directory is in sys.path so imports work from any working directory
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

import time
from fastapi import FastAPI, Depends, HTTPException, status, Body, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from models import (init_db, SessionLocal, User, Announcement, Project,
                    Application, AssessmentResult, AssessmentAuditLog,
                    Level2Assessment, Level2Result, Level2StudentTarget, engine)
from auth import hash_password, verify_password, create_access_token, decode_access_token
from ai.context import TeachingContext
from ai.ai_teacher import get_ai_teacher_answer
from ai.experiment_loader import load_experiment, ExperimentNotFoundError, ExperimentLoadError
from ai.circuit_analyzer import analyze_connections
from rb_report import generate_resistance_bank_report, ReportNotReady, ReportGenerationFailed, REPORTS_DIR
from level2_target_gen import generate_target_ohms
from hardware_relay import shutdown_relay, unlock_hardware, lock_hardware, release_port, get_relay_diagnostics
from live_classroom import classroom_hub
from create_dummy_teacher import seed_initial_accounts
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_initial_accounts()
    yield
    shutdown_relay()

app = FastAPI(title="EduNexus API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:8123",
        "http://localhost:8123",
        "*"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.query(User).filter(User.id == payload.get("user_id")).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_staff(user: User = Depends(get_current_user)) -> User:
    if user.role != "staff":
        raise HTTPException(status_code=403, detail="Staff access only")
    return user


def get_optional_current_user(token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> Optional[User]:
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload:
        return None
    return db.query(User).filter(User.id == payload.get("user_id")).first()


# ---------- Schemas ----------

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    role: str
    name: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GoogleLoginRequest(BaseModel):
    email: str
    name: str


class ProfileUpdateRequest(BaseModel):
    name: Optional[str] = None
    bio: Optional[str] = None
    university: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None
    graduation_year: Optional[str] = None
    subject: Optional[str] = None


class SkillRequest(BaseModel):
    skill: str


class AnnouncementRequest(BaseModel):
    title: str
    body: str


class ProjectRequest(BaseModel):
    title: str
    company: Optional[str] = ""
    location: Optional[str] = ""
    description: Optional[str] = ""
    skills: Optional[list[str]] = []
    difficulty: Optional[str] = "Intermediate"
    icon: Optional[str] = "🚀"
    icon_bg: Optional[str] = "#EEF2FF"


class AssessmentSubmitRequest(BaseModel):
    kit_id: str = "power_converter"
    experiment_name: str = "Power Converter Kit Assessment"
    score: int
    status: str
    time_taken_seconds: int
    groups_correct: int = 0
    groups_total: int = 0
    voltage_selected: str = ""
    wiring_data: Optional[list] = []     # raw wire pairs [[a,b],...]
    groups_data: Optional[list] = []     # connection groups [[node,...],...]
    group_correct_flags: Optional[list] = []
    cloud_submission_id: Optional[str] = ""
    # Resistance Bank fields (optional — unused for Power Converter submissions)
    node_a: Optional[str] = None
    node_b: Optional[str] = None
    student_answer: Optional[float] = None
    correct_value: Optional[float] = None
    error_percent: Optional[float] = None
    tolerance_percent: Optional[float] = None
    is_correct_client: Optional[bool] = None
    # Automatic wiring capture — base64 PNG data URL of the Resistance Bank
    # board (board + resistors + jumper wires only), captured client-side
    # at the moment of Submit. Saved server-side as level1_connection.png.
    wiring_image: Optional[str] = None
    # Auto-detected client-side (student never chooses this): "Hardware Kit"
    # if the experiment used the ESP32/Arduino trainer kit (Web Serial),
    # otherwise "Manual Connection" for the virtual wiring interface.
    connection_method: Optional[str] = "Manual Connection"


class AssessmentReviewRequest(BaseModel):
    action: str   # "approved" or "rejected"
    comments: Optional[str] = ""


# ---------- Level 2: Target Resistance Challenge schemas ----------

class Level2CreateRequest(BaseModel):
    title: Optional[str] = "Target Resistance Challenge"
    # Staff now configure a RANGE — each student gets their own randomly
    # generated, board-achievable target inside this range (see
    # level2_target_gen.py), instead of everyone getting the same number.
    target_min_ohms: float
    target_max_ohms: float
    tolerance_percent: float = 5.0
    time_limit_seconds: int = 1200
    max_attempts: int = 3
    # ---- Staff Level 2 Configuration module (additive, all optional) ----
    experiment_name: Optional[str] = "Resistance Bank"
    resistance_unit: Optional[str] = "Ω"
    node_a: Optional[str] = ""
    node_b: Optional[str] = ""
    instructions: Optional[str] = ""
    status: Optional[str] = "published"  # 'draft' or 'published' — defaults to 'published' to match prior behavior


class Level2SubmitRequest(BaseModel):
    assessment_id: int
    node_a: str = ""
    node_b: str = ""
    student_answer: Optional[float] = None
    system_calculated_resistance: Optional[float] = None
    time_taken_seconds: int = 0
    wiring_data: Optional[list] = []
    # Automatic wiring capture — base64 PNG data URL of the Resistance Bank
    # board (board + resistors + jumper wires only), captured client-side
    # at the moment of Submit. Saved server-side as level2_connection.png.
    wiring_image: Optional[str] = None
    # Auto-detected client-side (student never chooses this): "Hardware Kit"
    # if the experiment used the ESP32/Arduino trainer kit (Web Serial),
    # otherwise "Manual Connection" for the virtual wiring interface.
    connection_method: Optional[str] = "Manual Connection"


class AITeacherRequest(BaseModel):
    experiment_name: str = "bridge_rectifier"
    student_connections: Optional[list] = []
    student_question: str = ""
    mode: str = "experiment"   # "experiment" | "theory" | "viva" | "evaluator"
    provider: Optional[str] = None  # "ollama" | "api" | "groq" | "gemini"
    student_level: Optional[str] = "intermediate"
    previous_errors: Optional[list] = []
    extra_context: Optional[dict] = None


# ---------- Helpers ----------

# Automatic wiring image capture — storage location.
WIRING_IMAGE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", "wiring_images")
os.makedirs(WIRING_IMAGE_DIR, exist_ok=True)


def _save_wiring_image(data_url: Optional[str], assessment_id: int, level: int) -> str:
    """Decode a base64 PNG data URL captured client-side and save it to disk
    as level1_connection.png (level=1) or level2_connection.png (level=2),
    scoped to this assessment record. Returns the stored relative path, or
    "" if no image was provided / decoding failed (never raises)."""
    if not data_url:
        return ""
    try:
        b64data = data_url.split(",", 1)[1] if "," in data_url else data_url
        raw = base64.b64decode(b64data)
    except Exception as e:
        print("Wiring image decode failed:", e)
        return ""

    folder = os.path.join(WIRING_IMAGE_DIR, str(assessment_id))
    os.makedirs(folder, exist_ok=True)
    filename = "level1_connection.png" if level == 1 else "level2_connection.png"
    filepath = os.path.join(folder, filename)
    try:
        with open(filepath, "wb") as f:
            f.write(raw)
    except Exception as e:
        print("Wiring image save failed:", e)
        return ""
    return os.path.relpath(filepath, os.path.dirname(os.path.abspath(__file__)))


def user_to_dict(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "role": u.role,
        "name": u.name,
        "bio": u.bio,
        "university": u.university,
        "department": u.department,
        "phone": u.phone,
        "graduation_year": u.graduation_year,
        "subject": u.subject,
        "skills": json.loads(u.skills or "[]"),
        "completion": get_completion(u),
    }


def get_completion(u: User) -> int:
    fields = [u.name, u.bio, u.university, u.phone]
    filled = sum(1 for f in fields if f and f.strip())
    has_skills = 1 if json.loads(u.skills or "[]") else 0
    return round(((filled + has_skills) / (len(fields) + 1)) * 100)


def _assessment_to_dict(a: AssessmentResult, name: str) -> dict:
    return {
        "id": a.id,
        "student_name": name,
        "kit_id": a.kit_id,
        "experiment_name": a.experiment_name,
        "score": a.score,
        "status": a.status,
        "time_taken_seconds": a.time_taken_seconds,
        "attempt_number": a.attempt_number,
        "groups_correct": a.groups_correct,
        "groups_total": a.groups_total,
        "voltage_selected": a.voltage_selected,
        "faculty_approved": a.faculty_approved,
        "wiring_data": json.loads(a.wiring_data or "[]"),
        "groups_data": json.loads(a.groups_data or "[]"),
        "group_correct_flags": json.loads(a.group_correct_flags or "[]"),
        "submission_time": a.submission_time.isoformat() if a.submission_time else None,
        "reviewer_name": a.reviewer_name or "",
        "review_timestamp": a.review_timestamp.isoformat() if a.review_timestamp else None,
        "review_comments": a.review_comments or "",
        "cloud_submission_id": a.cloud_submission_id or "",
        "date": a.created_at.strftime("%d-%b-%Y"),
        # Resistance Bank fields — None for non-RB (e.g. Power Converter) rows
        "node_a": a.node_a,
        "node_b": a.node_b,
        "student_answer": a.student_answer,
        "correct_value": a.correct_value,          # faculty-facing only; frontend must not show this to students
        "error_percent": a.error_percent,
        "tolerance_percent": a.tolerance_percent,
        "is_correct_client": a.is_correct_client,
        "wiring_image_path": a.wiring_image_path or "",
        # Auto-detected (never chosen by the student): "Hardware Kit" or "Manual Connection".
        "connection_method": a.connection_method or "Manual Connection",
    }


# ---------- Auth routes ----------

@app.post("/auth/signup")
def signup(req: SignupRequest, db: Session = Depends(get_db)):
    if req.role not in ("student", "staff"):
        raise HTTPException(status_code=400, detail="Role must be 'student' or 'staff'")
    existing = db.query(User).filter(User.email == req.email.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists.")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    user = User(
        email=req.email.lower(),
        password_hash=hash_password(req.password),
        role=req.role,
        name=req.name or req.email.split("@")[0],
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"user_id": user.id})
    return {"token": token, "user": user_to_dict(user)}


@app.post("/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email.lower()).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    token = create_access_token({"user_id": user.id})
    return {"token": token, "user": user_to_dict(user)}


@app.post("/auth/google-login")
def google_login(req: GoogleLoginRequest, db: Session = Depends(get_db)):
    """
    Called after a successful Firebase Google sign-in.
    Finds or creates the user by email (no password required),
    assigns the correct role, and returns a JWT token.
    """
    env_staff = [e.strip().lower() for e in os.environ.get("STAFF_EMAILS", "").split(",") if e.strip()]
    STAFF_EMAILS = {
        "mouseinnovations@gmail.com",
        "teacher@edunexus.edu",
        "teacher@test.com",
    }.union(env_staff)
    email = req.email.lower().strip()
    role = "staff" if email in STAFF_EMAILS else "student"

    user = db.query(User).filter(User.email == email).first()
    if not user:
        # Auto-create account for Google users (no password needed)
        user = User(
            email=email,
            password_hash="",   # Google users never use password auth
            role=role,
            name=req.name or email.split("@")[0],
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        # Keep role in sync with the staff allow-list
        if user.role != role:
            user.role = role
            db.commit()

    token = create_access_token({"user_id": user.id})
    return {"token": token, "user": user_to_dict(user)}


@app.get("/auth/me")
def me(current_user: User = Depends(get_current_user)):
    return user_to_dict(current_user)


# ---------- Profile ----------

@app.put("/profile")
def update_profile(req: ProfileUpdateRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    data = req.dict(exclude_unset=True)
    for k, v in data.items():
        setattr(current_user, k, v)
    current_user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(current_user)
    return user_to_dict(current_user)


@app.post("/profile/skills")
def add_skill(req: SkillRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    skills = json.loads(current_user.skills or "[]")
    if req.skill in skills:
        raise HTTPException(status_code=400, detail="Skill already added.")
    skills.append(req.skill)
    current_user.skills = json.dumps(skills)
    db.commit()
    return {"skills": skills}


@app.delete("/profile/skills/{index}")
def remove_skill(index: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    skills = json.loads(current_user.skills or "[]")
    if index < 0 or index >= len(skills):
        raise HTTPException(status_code=400, detail="Invalid skill index.")
    skills.pop(index)
    current_user.skills = json.dumps(skills)
    db.commit()
    return {"skills": skills}


# ---------- Students ----------

@app.get("/students")
def list_students(current_user: User = Depends(require_staff), db: Session = Depends(get_db)):
    students = db.query(User).filter(User.role == "student").all()
    return [user_to_dict(s) for s in students]


# ---------- Announcements ----------

@app.get("/announcements")
def list_announcements(db: Session = Depends(get_db)):
    items = db.query(Announcement).order_by(Announcement.created_at.desc()).all()
    return [{"id": a.id, "title": a.title, "body": a.body, "author": a.author_name,
             "date": a.created_at.strftime("%-d %b %Y")} for a in items]


@app.post("/announcements")
def post_announcement(req: AnnouncementRequest, current_user: User = Depends(require_staff), db: Session = Depends(get_db)):
    item = Announcement(title=req.title, body=req.body, author_id=current_user.id,
                        author_name=current_user.name or current_user.email)
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"id": item.id, "title": item.title, "body": item.body,
            "author": item.author_name, "date": item.created_at.strftime("%-d %b %Y")}


# ---------- Projects ----------

@app.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    items = db.query(Project).order_by(Project.created_at.desc()).all()
    return [{"id": p.id, "title": p.title, "company": p.company, "location": p.location,
             "description": p.description, "skills": json.loads(p.skills or "[]"),
             "difficulty": p.difficulty, "icon": p.icon, "icon_bg": p.icon_bg} for p in items]


@app.post("/projects")
def create_project(req: ProjectRequest, current_user: User = Depends(require_staff), db: Session = Depends(get_db)):
    p = Project(title=req.title, company=req.company, location=req.location,
                description=req.description, skills=json.dumps(req.skills or []),
                difficulty=req.difficulty, icon=req.icon, icon_bg=req.icon_bg)
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"id": p.id}


@app.post("/projects/{project_id}/apply")
def apply_to_project(project_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    existing = db.query(Application).filter(Application.project_id == project_id,
                                             Application.user_id == current_user.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="You already applied to this project.")
    app_row = Application(project_id=project_id, user_id=current_user.id)
    db.add(app_row)
    db.commit()
    return {"status": "applied"}


@app.get("/projects/applications/me")
def my_applications(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    apps = db.query(Application).filter(Application.user_id == current_user.id).all()
    return {"project_ids": [a.project_id for a in apps]}


# ---------- Assessments ----------

@app.post("/assessments/submit")
def submit_assessment(req: AssessmentSubmitRequest, current_user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    prev_attempts = db.query(AssessmentResult).filter(
        AssessmentResult.user_id == current_user.id,
        AssessmentResult.kit_id == req.kit_id,
    ).count()
    row = AssessmentResult(
        user_id=current_user.id,
        kit_id=req.kit_id,
        experiment_name=req.experiment_name,
        score=req.score,
        status=req.status,
        time_taken_seconds=req.time_taken_seconds,
        attempt_number=prev_attempts + 1,
        groups_correct=req.groups_correct,
        groups_total=req.groups_total,
        voltage_selected=req.voltage_selected,
        faculty_approved="pending",  # ALWAYS starts as pending — staff must review
        wiring_data=json.dumps(req.wiring_data or []),
        groups_data=json.dumps(req.groups_data or []),
        group_correct_flags=json.dumps(req.group_correct_flags or []),
        cloud_submission_id=req.cloud_submission_id or "",
        submission_time=datetime.utcnow(),
        node_a=req.node_a,
        node_b=req.node_b,
        student_answer=req.student_answer,
        correct_value=req.correct_value,
        error_percent=req.error_percent,
        tolerance_percent=req.tolerance_percent,
        is_correct_client=req.is_correct_client,
        connection_method=req.connection_method or "Manual Connection",
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # Automatic wiring capture — store the captured board image (if any)
    # against this assessment record as level1_connection.png.
    if req.wiring_image:
        image_path = _save_wiring_image(req.wiring_image, row.id, level=1)
        if image_path:
            row.wiring_image_path = image_path
            db.commit()
            db.refresh(row)

    return _assessment_to_dict(row, current_user.name or current_user.email)


@app.get("/assessments/me")
def my_assessments(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(AssessmentResult).filter(AssessmentResult.user_id == current_user.id) \
        .order_by(AssessmentResult.created_at.desc()).all()
    name = current_user.name or current_user.email
    return [_assessment_to_dict(r, name) for r in rows]


@app.get("/assessments/analytics")
def assessment_analytics(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role == "staff":
        rows = db.query(AssessmentResult).order_by(AssessmentResult.created_at.desc()).all()
    else:
        rows = db.query(AssessmentResult).filter(AssessmentResult.user_id == current_user.id) \
            .order_by(AssessmentResult.created_at.desc()).all()
    total = len(rows)
    avg_score = round(sum(r.score for r in rows) / total) if total else 0
    best_score = max((r.score for r in rows), default=0)
    user_ids = {r.user_id for r in rows}
    users = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    recent = [_assessment_to_dict(r, users.get(r.user_id, "Student")) for r in rows[:10]]
    return {"total_completed": total, "average_score": avg_score, "best_score": best_score, "recent": recent}


# ---------- Staff: pending assessments for review ----------

@app.get("/assessments/pending")
def pending_assessments(current_user: User = Depends(require_staff), db: Session = Depends(get_db)):
    rows = db.query(AssessmentResult).filter(AssessmentResult.faculty_approved == "pending") \
        .order_by(AssessmentResult.submission_time.desc()).all()
    user_ids = {r.user_id for r in rows}
    users = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    return [_assessment_to_dict(r, users.get(r.user_id, "Student")) for r in rows]


@app.get("/assessments/all")
def all_assessments(current_user: User = Depends(require_staff), db: Session = Depends(get_db)):
    rows = db.query(AssessmentResult).order_by(AssessmentResult.submission_time.desc()).all()
    user_ids = {r.user_id for r in rows}
    users = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    return [_assessment_to_dict(r, users.get(r.user_id, "Student")) for r in rows]


@app.get("/assessments/{assessment_id}")
def get_assessment(assessment_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(AssessmentResult).filter(AssessmentResult.id == assessment_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Assessment not found")
    # students can only view their own
    if current_user.role == "student" and row.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    student = db.query(User).filter(User.id == row.user_id).first()
    name = (student.name or student.email) if student else "Student"
    return _assessment_to_dict(row, name)


@app.put("/assessments/{assessment_id}/review")
def review_assessment(assessment_id: int, req: AssessmentReviewRequest,
                      current_user: User = Depends(require_staff), db: Session = Depends(get_db)):
    """Staff reviews (approves or rejects) an assessment after inspecting wiring."""
    if req.action not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="action must be 'approved' or 'rejected'")

    row = db.query(AssessmentResult).filter(AssessmentResult.id == assessment_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Assessment not found")

    now = datetime.utcnow()
    row.faculty_approved = req.action
    row.reviewer_id = current_user.id
    row.reviewer_name = current_user.name or current_user.email
    row.review_timestamp = now
    row.review_comments = req.comments or ""

    # Write immutable audit log
    student = db.query(User).filter(User.id == row.user_id).first()
    audit = AssessmentAuditLog(
        assessment_id=row.id,
        student_name=(student.name or student.email) if student else "Student",
        assessment_name=row.experiment_name,
        submitted_connections=row.groups_data or "[]",
        staff_reviewer=current_user.name or current_user.email,
        reviewer_id=current_user.id,
        approval_timestamp=now,
        approval_status=req.action,
        score=row.score,
        comments=req.comments or "",
    )
    db.add(audit)
    db.commit()

    # Faculty Controlled Hardware Unlock — best-effort, never affects the
    # already-committed approval/rejection above.
    try:
        if req.action == "approved":
            unlock_hardware()
        else:
            lock_hardware()
    except Exception as exc:
        print(f"[Relay] Non-fatal exception during {req.action}: {exc}")

    return {"status": req.action, "reviewer": current_user.name or current_user.email,
            "timestamp": now.isoformat()}


# Legacy approve endpoint (kept for backward compat — now just calls review with approved)
@app.put("/assessments/{assessment_id}/approve")
def approve_assessment(assessment_id: int, current_user: User = Depends(require_staff),
                       db: Session = Depends(get_db)):
    row = db.query(AssessmentResult).filter(AssessmentResult.id == assessment_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Assessment not found")
    now = datetime.utcnow()
    row.faculty_approved = "approved"
    row.reviewer_id = current_user.id
    row.reviewer_name = current_user.name or current_user.email
    row.review_timestamp = now
    student = db.query(User).filter(User.id == row.user_id).first()
    audit = AssessmentAuditLog(
        assessment_id=row.id,
        student_name=(student.name or student.email) if student else "Student",
        assessment_name=row.experiment_name,
        submitted_connections=row.groups_data or "[]",
        staff_reviewer=current_user.name or current_user.email,
        reviewer_id=current_user.id,
        approval_timestamp=now,
        approval_status="approved",
        score=row.score,
    )
    db.add(audit)
    db.commit()

    # Faculty Controlled Hardware Unlock — best-effort, never affects the
    # already-committed approval above.
    unlock_hardware()

    return {"status": "approved"}


# ---------- Audit trail ----------

@app.get("/assessments/audit/all")
def get_audit_trail(current_user: User = Depends(require_staff), db: Session = Depends(get_db)):
    logs = db.query(AssessmentAuditLog).order_by(AssessmentAuditLog.created_at.desc()).all()
    return [{
        "id": l.id,
        "assessment_id": l.assessment_id,
        "student_name": l.student_name,
        "assessment_name": l.assessment_name,
        "submitted_connections": json.loads(l.submitted_connections or "[]"),
        "staff_reviewer": l.staff_reviewer,
        "approval_timestamp": l.approval_timestamp.isoformat() if l.approval_timestamp else None,
        "approval_status": l.approval_status,
        "score": l.score,
        "comments": l.comments,
        "created_at": l.created_at.isoformat(),
    } for l in logs]


# ---------- Level 2: Target Resistance Challenge ----------
# Separate from Level 1 — its own tables/routes. No staff approval, no PDF.

def _level2_to_dict(a: Level2Assessment) -> dict:
    return {
        "id": a.id,
        "title": a.title,
        "target_min_ohms": a.target_min_ohms,
        "target_max_ohms": a.target_max_ohms,
        "tolerance_percent": a.tolerance_percent,
        "time_limit_seconds": a.time_limit_seconds,
        "max_attempts": a.max_attempts,
        "is_active": a.is_active,
        "created_by_name": a.created_by_name,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "experiment_name": a.experiment_name or "Resistance Bank",
        "resistance_unit": a.resistance_unit or "Ω",
        "node_a": a.node_a or "",
        "node_b": a.node_b or "",
        "instructions": a.instructions or "",
        "status": a.status or "published",
    }


def _get_or_create_student_target(db: Session, assessment: Level2Assessment, user_id: int) -> Level2StudentTarget:
    """Return this student's own target for this assessment, generating and
    storing it the first time they open it. Stable across reloads/attempts."""
    row = db.query(Level2StudentTarget).filter(
        Level2StudentTarget.assessment_id == assessment.id,
        Level2StudentTarget.user_id == user_id,
    ).first()
    if row:
        return row

    value = generate_target_ohms(
        assessment_id=assessment.id, user_id=user_id,
        min_ohms=assessment.target_min_ohms, max_ohms=assessment.target_max_ohms,
    )
    row = Level2StudentTarget(
        assessment_id=assessment.id, user_id=user_id,
        target_resistance_ohms=value,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _level2_student_view(a: Level2Assessment, student_target: Level2StudentTarget) -> dict:
    """Student-facing view: the student's OWN individually-assigned target +
    tolerance are surfaced as the assessment definition, per spec. Time limit
    / attempts still drive the timer and attempts counter during the live
    attempt, but are not exposed here as configurable/inspectable settings."""
    return {
        "id": a.id,
        "title": a.title,
        "target_resistance_ohms": student_target.target_resistance_ohms,
        "tolerance_percent": a.tolerance_percent,
        "time_limit_seconds": a.time_limit_seconds,
        "max_attempts": a.max_attempts,
    }


@app.post("/level2/assessments")
def create_level2_assessment(req: Level2CreateRequest, current_user: User = Depends(require_staff),
                              db: Session = Depends(get_db)):
    if req.target_min_ohms <= 0 or req.target_max_ohms <= 0:
        raise HTTPException(status_code=400, detail="Target range values must be greater than 0.")
    if req.target_min_ohms > req.target_max_ohms:
        raise HTTPException(status_code=400, detail="Target min must be less than or equal to target max.")
    if req.tolerance_percent <= 0:
        raise HTTPException(status_code=400, detail="Tolerance must be greater than 0.")
    if req.time_limit_seconds <= 0:
        raise HTTPException(status_code=400, detail="Time limit must be greater than 0.")
    if req.max_attempts <= 0:
        raise HTTPException(status_code=400, detail="Number of attempts must be greater than 0.")

    status = req.status if req.status in ("draft", "published") else "published"
    is_publishing = status == "published"

    # Only deactivate previous assessments when publishing a new one — a
    # saved Draft must never affect which assessment students currently see.
    if is_publishing:
        db.query(Level2Assessment).filter(Level2Assessment.is_active == True).update({"is_active": False})

    row = Level2Assessment(
        title=req.title or "Target Resistance Challenge",
        # Legacy column — some existing SQLite DBs still have this as
        # NOT NULL (ALTER TABLE can't drop that constraint), so keep it
        # populated with the midpoint of the new range for compatibility.
        target_resistance_ohms=(req.target_min_ohms + req.target_max_ohms) / 2,
        target_min_ohms=req.target_min_ohms,
        target_max_ohms=req.target_max_ohms,
        tolerance_percent=req.tolerance_percent,
        time_limit_seconds=req.time_limit_seconds,
        max_attempts=req.max_attempts,
        is_active=is_publishing,
        created_by=current_user.id,
        created_by_name=current_user.name or current_user.email,
        experiment_name=req.experiment_name or "Resistance Bank",
        resistance_unit=req.resistance_unit or "Ω",
        node_a=req.node_a or "",
        node_b=req.node_b or "",
        instructions=req.instructions or "",
        status=status,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _level2_to_dict(row)


@app.get("/level2/assessments")
def list_level2_assessments(current_user: User = Depends(require_staff), db: Session = Depends(get_db)):
    rows = db.query(Level2Assessment).order_by(Level2Assessment.created_at.desc()).all()
    return [_level2_to_dict(r) for r in rows]


@app.get("/level2/assessments/active")
def get_active_level2_assessment(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(Level2Assessment).filter(Level2Assessment.is_active == True) \
        .order_by(Level2Assessment.created_at.desc()).first()
    if not row:
        raise HTTPException(status_code=404, detail="No active Level 2 assessment has been set up by staff yet.")
    # Extra safety net: students must never see a Draft even if is_active
    # were somehow left true — the existing student flow is unchanged either way.
    if current_user.role != "staff" and (row.status or "published") != "published":
        raise HTTPException(status_code=404, detail="No active Level 2 assessment has been set up by staff yet.")
    if current_user.role == "staff":
        return _level2_to_dict(row)
    # Every student gets their own randomly generated, board-achievable
    # target the first time they open this assessment — generated once and
    # reused for every subsequent attempt/reload so it stays stable for them.
    student_target = _get_or_create_student_target(db, row, current_user.id)
    return _level2_student_view(row, student_target)


@app.post("/level2/submit")
def submit_level2(req: Level2SubmitRequest, current_user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    assessment = db.query(Level2Assessment).filter(Level2Assessment.id == req.assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Level 2 assessment not found.")

    prev_attempts = db.query(Level2Result).filter(
        Level2Result.assessment_id == assessment.id,
        Level2Result.user_id == current_user.id,
    ).count()
    if prev_attempts >= assessment.max_attempts:
        raise HTTPException(status_code=400, detail="No attempts remaining for this assessment.")

    # Evaluate against THIS student's own individually-assigned target — not
    # a shared assessment-level value. get_or_create keeps it stable even if
    # this is somehow their first hit on this row (e.g. race with the
    # assessments/active call), and guarantees every submission is scored
    # against the exact target the student was shown.
    student_target_row = _get_or_create_student_target(db, assessment, current_user.id)
    target = student_target_row.target_resistance_ohms
    system_val = req.system_calculated_resistance
    if system_val is None:
        error_percent = None
        passed = False
    else:
        error_percent = abs(system_val - target) / target * 100.0 if target else None
        passed = error_percent is not None and error_percent <= assessment.tolerance_percent

    row = Level2Result(
        assessment_id=assessment.id,
        user_id=current_user.id,
        node_a=req.node_a,
        node_b=req.node_b,
        student_answer=req.student_answer,
        system_calculated_resistance=system_val,
        target_resistance_ohms=target,
        tolerance_percent=assessment.tolerance_percent,
        error_percent=error_percent,
        result="PASS" if passed else "FAIL",
        attempt_number=prev_attempts + 1,
        time_taken_seconds=req.time_taken_seconds,
        wiring_data=json.dumps(req.wiring_data or []),
        submission_time=datetime.utcnow(),
        faculty_approved="pending",  # every Level 2 submission now awaits staff approval
        connection_method=req.connection_method or "Manual Connection",
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # Automatic wiring capture — store the captured board image (if any)
    # against this Level 2 result record as level2_connection.png.
    if req.wiring_image:
        image_path = _save_wiring_image(req.wiring_image, row.id, level=2)
        if image_path:
            row.wiring_image_path = image_path
            db.commit()
            db.refresh(row)

    # Evaluation (system_calculated_resistance / target / tolerance / error /
    # PASS-FAIL) is computed and stored above so staff have it to review, but
    # it is intentionally withheld from the student's own submit response.
    # Students only get back what they already know (that it was received)
    # until a staff member approves or rejects it via the review endpoint.
    return {
        "id": row.id,
        "attempt_number": row.attempt_number,
        "attempts_remaining": assessment.max_attempts - row.attempt_number,
        "faculty_approved": row.faculty_approved,
    }


def _level2_result_to_dict(r: Level2Result, name: str = "", reveal: bool = True) -> dict:
    d = {
        "id": r.id, "assessment_id": r.assessment_id, "student_name": name,
        "node_a": r.node_a, "node_b": r.node_b,
        "student_answer": r.student_answer,
        "attempt_number": r.attempt_number,
        "time_taken_seconds": r.time_taken_seconds,
        "submission_time": r.submission_time.isoformat() if r.submission_time else None,
        "faculty_approved": r.faculty_approved or "pending",
        "reviewer_name": r.reviewer_name or "",
        "review_timestamp": r.review_timestamp.isoformat() if r.review_timestamp else None,
        "review_comments": r.review_comments or "",
        "wiring_image_path": r.wiring_image_path or "",
        "wiring_data": json.loads(r.wiring_data or "[]"),
        # Auto-detected (never chosen by the student): "Hardware Kit" or "Manual Connection".
        "connection_method": r.connection_method or "Manual Connection",
    }
    if reveal:
        # Only populated for staff views, or for the student once their
        # result has moved out of "pending" (approved/rejected).
        d.update({
            "system_calculated_resistance": r.system_calculated_resistance,
            "target_resistance_ohms": r.target_resistance_ohms,
            "tolerance_percent": r.tolerance_percent,
            "error_percent": r.error_percent,
            "result": r.result,
        })
    else:
        d.update({
            "system_calculated_resistance": None,
            "target_resistance_ohms": None,
            "tolerance_percent": None,
            "error_percent": None,
            "result": None,
        })
    return d


@app.get("/level2/results/me")
def my_level2_results(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Level2Result).filter(Level2Result.user_id == current_user.id) \
        .order_by(Level2Result.submission_time.desc()).all()
    name = current_user.name or current_user.email
    # Reveal the evaluation (result/target/error/etc.) to the student only
    # once staff have approved or rejected it — never while still pending.
    return [_level2_result_to_dict(r, name, reveal=(r.faculty_approved != "pending")) for r in rows]


# ---------- Level 2: Staff Approval ----------

@app.get("/level2/results/pending")
def pending_level2_results(current_user: User = Depends(require_staff), db: Session = Depends(get_db)):
    rows = db.query(Level2Result).filter(Level2Result.faculty_approved == "pending") \
        .order_by(Level2Result.submission_time.desc()).all()
    user_ids = {r.user_id for r in rows}
    users = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    return [_level2_result_to_dict(r, users.get(r.user_id, "Student")) for r in rows]


@app.get("/level2/results/all")
def all_level2_results(current_user: User = Depends(require_staff), db: Session = Depends(get_db)):
    rows = db.query(Level2Result).order_by(Level2Result.submission_time.desc()).all()
    user_ids = {r.user_id for r in rows}
    users = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    return [_level2_result_to_dict(r, users.get(r.user_id, "Student")) for r in rows]


@app.put("/level2/results/{result_id}/review")
def review_level2_result(result_id: int, req: AssessmentReviewRequest,
                          current_user: User = Depends(require_staff), db: Session = Depends(get_db)):
    """Staff approves or rejects a Level 2 submission. Does not touch the
    system's PASS/FAIL calculation — only the approval status/comments."""
    if req.action not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="action must be 'approved' or 'rejected'")

    row = db.query(Level2Result).filter(Level2Result.id == result_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Level 2 submission not found")

    row.faculty_approved = req.action
    row.reviewer_id = current_user.id
    row.reviewer_name = current_user.name or current_user.email
    row.review_timestamp = datetime.utcnow()
    row.review_comments = req.comments or ""
    db.commit()

    # Faculty Controlled Hardware Unlock — best-effort, never affects the
    # already-committed approval/rejection above.
    if req.action == "approved":
        unlock_hardware()
    else:
        lock_hardware()

    return {"status": req.action, "reviewer": current_user.name or current_user.email,
            "timestamp": row.review_timestamp.isoformat()}


# ---------- Stats ----------

@app.get("/stats")
def stats(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role == "staff":
        students = db.query(User).filter(User.role == "student").all()
        avg_completion = round(sum(get_completion(s) for s in students) / len(students)) if students else 0
        return {
            "total_students": len(students),
            "announcements_posted": db.query(Announcement).filter(Announcement.author_id == current_user.id).count(),
            "active_projects": db.query(Project).count(),
            "avg_completion": avg_completion,
        }
    else:
        apps = db.query(Application).filter(Application.user_id == current_user.id).count()
        return {
            "completion": get_completion(current_user),
            "skills": len(json.loads(current_user.skills or "[]")),
            "projects_applied": apps,
        }


# ---------- Seed + startup ----------

def _migrate_add_columns():
    """create_all() only creates missing TABLES, not missing COLUMNS on an
    existing table, so backfill Resistance Bank columns here if the DB file
    already existed before this module was added. No-op if already present.
    Does not touch any column unrelated to the Resistance Bank module."""
    try:
        with engine.connect() as conn:
            l2_tables = conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='level2_results'"
            ).fetchall()
            if l2_tables:
                l2_cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(level2_results)").fetchall()]
                additions = {
                    "faculty_approved": "VARCHAR DEFAULT 'pending'",
                    "reviewer_id": "INTEGER",
                    "reviewer_name": "VARCHAR DEFAULT ''",
                    "review_timestamp": "DATETIME",
                    "review_comments": "TEXT DEFAULT ''",
                    # Automatic wiring capture (level2_connection.png)
                    "wiring_image_path": "VARCHAR DEFAULT ''",
                    # Auto-detected Hardware Kit vs Manual Connection (never
                    # chosen by the student) — used only in report display.
                    "connection_method": "VARCHAR DEFAULT 'Manual Connection'",
                }
                for col, coltype in additions.items():
                    if col not in l2_cols:
                        conn.exec_driver_sql(f"ALTER TABLE level2_results ADD COLUMN {col} {coltype}")
                conn.commit()

            ar_tables = conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='assessment_results'"
            ).fetchall()
            if ar_tables:
                ar_cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(assessment_results)").fetchall()]
                additions = {
                    "node_a": "VARCHAR", "node_b": "VARCHAR",
                    "student_answer": "FLOAT", "correct_value": "FLOAT",
                    "error_percent": "FLOAT", "tolerance_percent": "FLOAT",
                    "is_correct_client": "BOOLEAN",
                    # Automatic wiring capture (level1_connection.png)
                    "wiring_image_path": "VARCHAR DEFAULT ''",
                    # Auto-detected Hardware Kit vs Manual Connection (never
                    # chosen by the student) — used only in report display.
                    "connection_method": "VARCHAR DEFAULT 'Manual Connection'",
                }
                for col, coltype in additions.items():
                    if col not in ar_cols:
                        conn.exec_driver_sql(f"ALTER TABLE assessment_results ADD COLUMN {col} {coltype}")
                conn.commit()

            # Staff Level 2 Configuration module — additive columns on
            # level2_assessments. Existing rows backfill to status='published'
            # so previously-created (pre-this-feature) assessments keep
            # behaving exactly as before (still visible to students via
            # is_active, unaffected by the new draft/published distinction).
            l2a_tables = conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='level2_assessments'"
            ).fetchall()
            if l2a_tables:
                l2a_cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(level2_assessments)").fetchall()]
                additions = {
                    "experiment_name": "VARCHAR DEFAULT 'Resistance Bank'",
                    "resistance_unit": "VARCHAR DEFAULT 'Ω'",
                    "node_a": "VARCHAR DEFAULT ''",
                    "node_b": "VARCHAR DEFAULT ''",
                    "instructions": "TEXT DEFAULT ''",
                    "status": "VARCHAR DEFAULT 'published'",
                    # Per-student randomized targets: staff now configure a
                    # RANGE instead of one fixed target_resistance_ohms.
                    "target_min_ohms": "FLOAT",
                    "target_max_ohms": "FLOAT",
                }
                for col, coltype in additions.items():
                    if col not in l2a_cols:
                        conn.exec_driver_sql(f"ALTER TABLE level2_assessments ADD COLUMN {col} {coltype}")
                conn.commit()
                # Backfill any NULL statuses left over from the ALTER (SQLite
                # applies the column default only to *new* rows after ALTER,
                # not retroactively) so old rows are unambiguously 'published'.
                conn.exec_driver_sql(
                    "UPDATE level2_assessments SET status = 'published' WHERE status IS NULL"
                )
                # Backfill target_min_ohms/target_max_ohms for any pre-existing
                # assessment row that still only has the old single
                # target_resistance_ohms value, using a ±20% band around it so
                # the assessment keeps working (with per-student variation)
                # instead of breaking on old data.
                conn.exec_driver_sql(
                    "UPDATE level2_assessments SET "
                    "target_min_ohms = target_resistance_ohms * 0.8, "
                    "target_max_ohms = target_resistance_ohms * 1.2 "
                    "WHERE target_min_ohms IS NULL AND target_resistance_ohms IS NOT NULL"
                )
                conn.commit()

            # New table for per-student randomized Level 2 targets — created
            # automatically by init_db()/create_all() for fresh installs, but
            # explicitly ensured here too in case this runs against an older
            # DB file where create_all() ran before this model existed in the
            # same process lifetime.
            conn.exec_driver_sql(
                "CREATE TABLE IF NOT EXISTS level2_student_targets ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "assessment_id INTEGER NOT NULL, "
                "user_id INTEGER NOT NULL, "
                "target_resistance_ohms FLOAT NOT NULL, "
                "recipe TEXT DEFAULT '', "
                "created_at DATETIME"
                ")"
            )
            conn.commit()
    except Exception as e:
        print("Migration check skipped/failed:", e)


def seed_projects(db: Session):
    if db.query(Project).count() > 0:
        return
    seed = [
        dict(title="E-Commerce Recommendation Engine", company="Flipkart", location="Bangalore",
             description="Build a collaborative filtering recommendation system for 100M+ users.",
             skills=["Python", "TensorFlow", "Spark"], difficulty="Advanced", icon="🛒", icon_bg="#FFF7ED"),
        dict(title="IoT Smart Home Dashboard", company="Bosch", location="Hyderabad",
             description="Real-time dashboard for smart home devices using MQTT and WebSockets.",
             skills=["React", "Node.js", "MQTT"], difficulty="Intermediate", icon="🏠", icon_bg="#F0FDF4"),
        dict(title="Payment Gateway Integration", company="Razorpay", location="Mumbai",
             description="Secure multi-currency payment with fraud detection and PCI DSS compliance.",
             skills=["Node.js", "PostgreSQL"], difficulty="Intermediate", icon="💳", icon_bg="#EDE9FE"),
        dict(title="GenAI Content Moderator", company="ShareChat", location="Bangalore",
             description="Multilingual AI moderation pipeline using LLMs for 12 Indian languages.",
             skills=["LLMs", "Python", "Kafka"], difficulty="Advanced", icon="🤖", icon_bg="#FFF1F2"),
    ]
    for s in seed:
        db.add(Project(title=s["title"], company=s["company"], location=s["location"],
                       description=s["description"], skills=json.dumps(s["skills"]),
                       difficulty=s["difficulty"], icon=s["icon"], icon_bg=s["icon_bg"]))
    db.commit()


@app.on_event("startup")
def on_startup():
    init_db()
    _migrate_add_columns()
    db = SessionLocal()
    try:
        seed_projects(db)
    finally:
        db.close()


@app.on_event("shutdown")
def on_shutdown():
    # Fail-safe: if the backend stops (crash, restart, manual shutdown),
    # immediately tell the relay to go LOCKED rather than relying solely
    # on the Arduino's heartbeat timeout to catch it a few seconds later.
    shutdown_relay()


@app.get("/")
def root():
    index_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "index.html")
    if os.path.isfile(index_file):
        from fastapi.responses import FileResponse
        return FileResponse(index_file)
    return {"status": "EduNexus API running"}


@app.get("/api/health")
def api_health():
    return {"status": "EduNexus API running"}


@app.post("/relay/release")
def relay_release(current_user: User = Depends(get_current_user)):
    """Frees this backend's hold on RELAY_SERIAL_PORT so the browser's Web
    Serial connection can open the same physical COM port for wiring/
    resistance-bank scanning. Call this right before reconnecting Web
    Serial for a new experiment attempt — otherwise the browser may hit
    an "Access is denied" error if the backend still has the port open
    from a previous approval/rejection cycle."""
    ok = release_port()
    return {"released": ok}


@app.get("/relay/status")
def relay_status_endpoint():
    """Live diagnostic stream for the hardware relay console.
    Reports connection health, active COM port, relay state, and recent transmission logs."""
    from hardware_relay import get_relay_diagnostics
    return get_relay_diagnostics()


class RelayTestRequest(BaseModel):
    action: str  # "UNLOCK", "LOCK", "HEARTBEAT"
    assessment_id: Optional[int] = None


@app.post("/relay/test")
def relay_test_endpoint(
    req: RelayTestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Trigger sending UNLOCK or LOCK signal.
    Allowed if:
    1. The user is a staff member.
    OR
    2. The user is a student whose assessment submission has already been approved by staff."""
    action = req.action.upper().strip()
    if action not in ("UNLOCK", "LOCK"):
        raise HTTPException(status_code=400, detail="Invalid action. Use UNLOCK or LOCK.")

    # Authorization: allow staff unconditionally
    is_staff = current_user.role == "staff"
    if not is_staff:
        # Check if the student has an approved assessment
        query = db.query(AssessmentResult).filter(
            AssessmentResult.user_id == current_user.id,
            AssessmentResult.faculty_approved == "approved"
        )
        if req.assessment_id:
            query = query.filter(AssessmentResult.id == req.assessment_id)
        has_approved = query.first() is not None
        if not has_approved:
            raise HTTPException(
                status_code=403,
                detail="Relay control is locked until faculty approves your assessment."
            )

    if action == "UNLOCK":
        ok = unlock_hardware()
    else:
        ok = lock_hardware()

    from hardware_relay import get_relay_diagnostics
    diag = get_relay_diagnostics()
    return {"success": ok, "action": action, "diagnostics": diag}


# ---------- Resistance Bank: Reset + Final Report ----------

def _delete_wiring_image_folder(assessment_id: int) -> None:
    """Delete the stored level1_connection.png / level2_connection.png (and
    its containing per-assessment folder) for a given Level 1 or Level 2
    record id, if present. Never raises."""
    folder = os.path.join(WIRING_IMAGE_DIR, str(assessment_id))
    try:
        if os.path.isdir(folder):
            shutil.rmtree(folder)
    except Exception as e:
        print("Wiring image cleanup failed:", e)


@app.delete("/assessments/resistance-bank/reset")
def reset_resistance_bank(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Reset Assessment — wipes the current student's entire Resistance Bank
    progress (Level 1 'Equivalent Resistance' + Level 2 'Target Resistance
    Challenge') so the assessment behaves exactly as if it had never been
    attempted:
      - Deletes every Level 1 submission (AssessmentResult, kit_id=resistance_bank)
        for this student, clearing faculty approval status/comments, the
        calculated/student answers, wiring/jumper data, timer/attempt state,
        and the captured board image (level1_connection.png).
      - Deletes every Level 2 submission (Level2Result) for this student,
        clearing the same fields plus level2_connection.png.
      - Deletes the generated Final Practical Report PDF, if one exists.
    Only affects the requesting student's own data. Does not touch the
    resistance calculation/solver, hardware integration, or the Level 2
    assessment definition staff configured (target value, tolerance, etc.) —
    only this student's attempts against it. The immutable staff audit trail
    (AssessmentAuditLog) is left in place as a compliance record and is not
    altered by this endpoint."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can reset their own assessment.")

    level1_rows = db.query(AssessmentResult).filter(
        AssessmentResult.user_id == current_user.id,
        AssessmentResult.kit_id == "resistance_bank",
    ).all()
    level2_rows = db.query(Level2Result).filter(
        Level2Result.user_id == current_user.id,
    ).all()

    for row in level1_rows:
        _delete_wiring_image_folder(row.id)
        db.delete(row)
    for row in level2_rows:
        _delete_wiring_image_folder(row.id)
        db.delete(row)

    db.commit()

    # Remove any previously generated combined Final Practical Report PDF.
    report_folder = os.path.join(REPORTS_DIR, str(current_user.id))
    try:
        if os.path.isdir(report_folder):
            shutil.rmtree(report_folder)
    except Exception as e:
        print("Report cleanup failed:", e)

    return {
        "status": "reset",
        "level1_removed": len(level1_rows),
        "level2_removed": len(level2_rows),
    }


@app.get("/assessments/resistance-bank-report/{user_id}")
def get_resistance_bank_report(user_id: int, current_user: User = Depends(get_current_user),
                               db: Session = Depends(get_db)):
    """Generate (or re-generate) the final Resistance Bank Practical Report PDF.
    STRICT GATE: only produced if BOTH Level 1 AND Level 2 are faculty-approved
    for this student. Does not modify any existing calculation/approval logic —
    it only reads already-stored, approved records."""
    if current_user.role == "student" and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    try:
        pdf_path = generate_resistance_bank_report(db, user_id)
    except ReportNotReady as e:
        raise HTTPException(status_code=409, detail=e.reason)
    except ReportGenerationFailed as e:
        # Eligibility was fine (both levels approved) but the PDF itself
        # failed to build — surface the real reason instead of letting an
        # unhandled exception fall through as an opaque, non-JSON 500 that
        # the frontend can't parse (and silently mislabels as "not ready").
        raise HTTPException(status_code=500, detail=e.reason)
    return FileResponse(pdf_path, media_type="application/pdf",
                        filename="resistance_bank_practical_report.pdf")


def _correct_groups(experiment: dict) -> dict:
    """
    Returns the correct connection groups from the experiment knowledge.
    """
    return experiment.get("correct_groups", {})


@app.get("/api/test-ai")
def test_ai():
    try:
        experiment = load_experiment("bridge_rectifier")

    except ExperimentNotFoundError:
        return {
            "status": "error",
            "message": "bridge_rectifier.json not found"
        }

    except ExperimentLoadError as exc:
        return {
            "status": "error",
            "message": str(exc)
        }

    return {
        "status": "success",
        "experiment": experiment.get("experiment"),
        "groups": len(_correct_groups(experiment)),
    }

@app.get("/api/test-analysis")
def test_analysis():

    student_connections = [
        ["12", "13", "17", "20", "6"],
        ["18", "21", "4", "8", "9"]
    ]

    try:
        experiment = load_experiment("bridge_rectifier")

    except ExperimentNotFoundError:
        return {
            "status": "error",
            "message": "Experiment knowledge not found."
        }

    except ExperimentLoadError as exc:
        return {
            "status": "error",
            "message": str(exc)
        }

    result = analyze_connections(
        student_connections,
        _correct_groups(experiment)
    )

    return {
        "status": "success",
        "experiment": experiment.get("experiment"),
        **result
    }


@app.post("/api/ai-feedback")
def ai_feedback(data: dict = Body(...)):

    student_connections = data.get("student_connections", [])
    experiment_name = data.get("experiment", "bridge_rectifier")

    try:
        experiment = load_experiment(experiment_name)

    except ExperimentNotFoundError:
        return {
            "status": "error",
            "message": "Experiment knowledge not found."
        }

    except ExperimentLoadError as exc:
        return {
            "status": "error",
            "message": str(exc)
        }

    result = analyze_connections(
        student_connections,
        _correct_groups(experiment)
    )

    return {
        "status": "success",
        "experiment": experiment.get("experiment"),
        **result
    }


# ---------- AI Teacher (new architecture) ----------

@app.post("/api/ai-teacher")
def ai_teacher_endpoint(req: AITeacherRequest):
    """
    Runs the full AI teacher pipeline (load experiment -> analyze circuit ->
    select mode -> build prompt -> execute with selected provider: Ollama Qwen3 or Cloud API).
    """
    try:
        context = TeachingContext(
            experiment_name=req.experiment_name,
            student_connections=req.student_connections or [],
            student_question=req.student_question,
            mode=req.mode,
            provider=req.provider,
            student_level=req.student_level or "intermediate",
            previous_errors=req.previous_errors or [],
            extra_context=req.extra_context,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return get_ai_teacher_answer(context)


@app.get("/api/ai-teacher/status")
def ai_teacher_status_endpoint():
    """
    Diagnostics endpoint reporting the health of both local Ollama (Qwen3:4B on RTX 2050)
    and Cloud API providers.
    """
    from ai.providers import get_provider
    ollama_provider = get_provider("ollama")
    api_provider = get_provider("api")
    active_env_provider = os.getenv("LLM_PROVIDER", "ollama")

    return {
        "status": "online",
        "active_default_provider": active_env_provider,
        "ollama": ollama_provider.health_check(),
        "api": api_provider.health_check(),
    }


@app.post("/api/ai-teacher/evaluate")
def ai_teacher_evaluate_endpoint(req: AITeacherRequest):
    """
    Specialized debounced circuit evaluation endpoint.
    Forces mode='evaluator' for fast Level 2 interpretation of wiring state.
    When using local Ollama, returns instant deterministic Level 1 evaluation (< 2ms)
    so Ollama is never locked up by continuous background wiring evaluations.
    """
    req.mode = "evaluator"
    active_provider = req.provider or os.getenv("LLM_PROVIDER", "ollama")
    if active_provider == "ollama":
        from ai.circuit_analyzer import analyze_connections
        from ai.experiment_loader import load_experiment, ExperimentNotFoundError, ExperimentLoadError
        from ai.modes.evaluator_mode import EvaluatorMode
        try:
            exp = load_experiment(req.experiment_name)
            analysis = analyze_connections(
                student_groups=req.student_connections or [],
                correct_groups=exp.get("correct_groups", {}),
                group_metadata=exp.get("group_metadata", {}),
                node_map=exp.get("node_map", {}),
                experiment_name=req.experiment_name,
                extra_context=req.extra_context,
            )
            analysis["component_map"] = exp.get("component_map", {})
            answer = EvaluatorMode.format_deterministic(analysis)
            return {
                "status": "success",
                "experiment": exp.get("experiment", req.experiment_name),
                "mode": "evaluator",
                "provider": "ollama",
                "model": "deterministic-fast",
                "latency_seconds": 0.001,
                "analysis": analysis,
                "answer": answer,
            }
        except Exception as e:
            pass  # Fall through to full LLM generation if any unexpected error
    try:
        return ai_teacher_endpoint(req)
    except Exception as e:
        return {
            "status": "partial",
            "message": str(e),
            "answer": "Keep wiring your circuit. Real-time digital twin monitoring is active.",
        }


# ============================================================================
# LIVE CLASSROOM REAL-TIME CIRCUIT MONITORING (WebSocket + REST)
# ============================================================================

@app.websocket("/ws/live-circuit")
async def ws_live_circuit(websocket: WebSocket):
    """
    WebSocket endpoint for real-time bidirectional circuit synchronization.
    - Teachers connect with {"type": "teacher_join"} and receive live broadcasts of all active students.
    - Students connect with {"type": "student_hello"} and push {"type": "circuit_update"} as they wire.
    """
    await websocket.accept()
    role = "unknown"
    student_id = None
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "teacher_join":
                role = "teacher"
                await classroom_hub.register_teacher(websocket)

            elif msg_type == "student_hello":
                role = "student"
                student_id = str(data.get("student_id") or "anonymous")
                await classroom_hub.register_student_socket(student_id, websocket)
                updated = classroom_hub.update_student_circuit(data)
                await classroom_hub.broadcast_to_teachers({
                    "type": "student_circuit_changed",
                    "student": updated,
                })

            elif msg_type == "circuit_update":
                role = "student"
                student_id = str(data.get("student_id") or student_id or "anonymous")
                updated = classroom_hub.update_student_circuit(data)
                await classroom_hub.broadcast_to_teachers({
                    "type": "student_circuit_changed",
                    "student": updated,
                })

            elif msg_type == "student_leave":
                if student_id:
                    classroom_hub.remove_student_session(student_id)
                    await classroom_hub.broadcast_to_teachers({
                        "type": "student_left",
                        "student_id": student_id,
                    })

            elif msg_type == "teacher_hint":
                # Teacher sending a real-time hint to student
                target_id = str(data.get("student_id"))
                hint = data.get("hint", "")
                teacher_name = data.get("teacher_name", "Faculty Instructor")
                sent = await classroom_hub.send_hint_to_student(target_id, hint, teacher_name)
                await websocket.send_json({
                    "type": "hint_sent_ack",
                    "student_id": target_id,
                    "success": sent,
                })

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        if role == "teacher":
            classroom_hub.unregister_teacher(websocket)
        elif role == "student" and student_id:
            classroom_hub.unregister_student_socket(student_id, websocket)
    except Exception:
        if role == "teacher":
            classroom_hub.unregister_teacher(websocket)
        elif role == "student" and student_id:
            classroom_hub.unregister_student_socket(student_id, websocket)


@app.get("/api/live-classroom/students")
def get_live_classroom_students(current_user: Optional[User] = Depends(get_optional_current_user)):
    """Returns all currently active online students working on assignments."""
    return {
        "count": len(classroom_hub.get_all_active_students()),
        "students": classroom_hub.get_all_active_students(),
        "timestamp": time.time(),
    }


@app.get("/api/live-classroom/student/{student_id}")
def get_live_classroom_student(student_id: str, current_user: Optional[User] = Depends(get_optional_current_user)):
    """Returns a specific student's real-time circuit state."""
    session = classroom_hub.get_student_session(student_id)
    if not session:
        raise HTTPException(status_code=404, detail="Student is not currently in an active laboratory session.")
    return session


@app.post("/api/live-classroom/circuit-state")
async def post_live_circuit_state(payload: dict = Body(...), current_user: Optional[User] = Depends(get_optional_current_user)):
    """
    HTTP REST fallback for student circuit updates.
    Updates the session and broadcasts to any connected teachers via WebSocket.
    """
    if current_user:
        if "student_id" not in payload or not payload["student_id"]:
            payload["student_id"] = current_user.id
        if "student_name" not in payload or not payload["student_name"]:
            payload["student_name"] = current_user.name or current_user.email
        if "student_email" not in payload or not payload["student_email"]:
            payload["student_email"] = current_user.email
    else:
        if "student_id" not in payload or not payload["student_id"]:
            payload["student_id"] = "anonymous"
        if "student_name" not in payload or not payload["student_name"]:
            payload["student_name"] = "Online Student"

    updated = classroom_hub.update_student_circuit(payload)
    await classroom_hub.broadcast_to_teachers({
        "type": "student_circuit_changed",
        "student": updated,
    })
    return {"status": "ok", "student": updated}


@app.post("/api/live-classroom/leave")
async def post_live_classroom_leave(payload: dict = Body(...), current_user: Optional[User] = Depends(get_optional_current_user)):
    """Signals that a student has closed or completed the assignment."""
    sid = str(payload.get("student_id") or (current_user.id if current_user else "anonymous"))
    classroom_hub.remove_student_session(sid)
    await classroom_hub.broadcast_to_teachers({
        "type": "student_left",
        "student_id": sid,
    })
    return {"status": "ok"}


@app.post("/api/live-classroom/send-hint")
async def post_live_classroom_hint(payload: dict = Body(...), current_user: Optional[User] = Depends(get_optional_current_user)):
    """Staff endpoint to send a live hint to a student."""
    if current_user and current_user.role != "staff":
        raise HTTPException(status_code=403, detail="Only staff can send classroom hints.")
    target_id = str(payload.get("student_id"))
    hint = payload.get("hint", "")
    teacher_name = (current_user.name if current_user else None) or payload.get("teacher_name") or "Faculty Instructor"
    sent = await classroom_hub.send_hint_to_student(target_id, hint, teacher_name)
    return {"status": "ok", "delivered_websocket": sent}


# ============================================================================
# Frontend Static Files Mount (Single-Container & Production Deployment)
# ============================================================================
frontend_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.isdir(frontend_path):
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")