import sys
import os

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from models import SessionLocal, User, init_db
from auth import hash_password

def seed_initial_accounts():
    """
    Seeds initial demo teacher and student accounts into the database on startup.
    Ensures that fresh deployments (like Render or Docker) always have working
    demo accounts immediately available without needing manual SQL execution.
    """
    init_db()
    db = SessionLocal()
    try:
        accounts = [
            {
                "email": "teacher@edunexus.edu",
                "name": "Prof. Marcus Vance",
                "password": "teacher123",
                "role": "staff",
                "department": "Electrical & Electronics Engineering",
                "subject": "Circuit Analysis & Digital Twin Simulation",
                "bio": "Senior Faculty Instructor & Practical Laboratory Proctor.",
                "emp_id": "EMP-FAC-042",
                "skills": '["Circuit Theory", "Digital Twins", "Power Electronics", "Nodal Analysis"]'
            },
            {
                "email": "teacher@test.com",
                "name": "Demo Laboratory Instructor",
                "password": "password123",
                "role": "staff",
                "department": "Power Electronics Lab",
                "subject": "Hardware-in-the-Loop & Power Converters",
                "bio": "Test faculty account for lab assignment evaluations.",
                "emp_id": "EMP-DEMO-001",
                "skills": '["Power Converters", "Circuit Simulation", "Laboratory Safety"]'
            },
            {
                "email": "student@edunexus.edu",
                "name": "Alex Mercer",
                "password": "student123",
                "role": "student",
                "department": "Electrical & Electronics Engineering",
                "subject": "Circuit Analysis & Digital Twin Simulation",
                "bio": "Engineering undergraduate student.",
                "emp_id": "STU-2026-042",
                "skills": '["Basic Electronics", "Kirchhoff Laws"]'
            },
            {
                "email": "student@test.com",
                "name": "Demo Student",
                "password": "password123",
                "role": "student",
                "department": "Electrical Engineering",
                "subject": "Power Electronics",
                "bio": "Test student account for interactive experiments.",
                "emp_id": "STU-DEMO-001",
                "skills": '["Circuit Theory"]'
            }
        ]

        for acc in accounts:
            user = db.query(User).filter(User.email == acc["email"].lower()).first()
            if not user:
                user = User(
                    email=acc["email"].lower(),
                    password_hash=hash_password(acc["password"]),
                    role=acc["role"],
                    name=acc["name"],
                    university="EduNexus Institute of Technology",
                    department=acc["department"],
                    subject=acc["subject"],
                    bio=acc["bio"],
                    graduation_year=acc["emp_id"],
                    skills=acc.get("skills", "[]")
                )
                db.add(user)
                print(f"[SEEDED] Created {acc['role']} account: {acc['email']} | Password: {acc['password']}")
            else:
                user.role = acc["role"]
                user.name = acc["name"]
                user.password_hash = hash_password(acc["password"])
                user.department = acc["department"]
                user.subject = acc["subject"]
                user.bio = acc["bio"]
                user.graduation_year = acc["emp_id"]
                print(f"[SEEDED] Verified {acc['role']} account: {acc['email']}")

        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[SEED ERROR] Failed to seed initial accounts: {e}")
    finally:
        db.close()

# Alias for backwards compatibility
setup_dummy_teachers = seed_initial_accounts

if __name__ == "__main__":
    seed_initial_accounts()
