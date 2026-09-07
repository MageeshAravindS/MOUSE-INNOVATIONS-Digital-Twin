import sys
from models import SessionLocal, User
from auth import hash_password

def setup_dummy_teachers():
    db = SessionLocal()
    teachers = [
        {
            "email": "teacher@edunexus.edu",
            "name": "Prof. Marcus Vance",
            "password": "teacher123",
            "department": "Electrical & Electronics Engineering",
            "subject": "Circuit Analysis & Digital Twin Simulation",
            "bio": "Senior Faculty Instructor & Practical Laboratory Proctor.",
            "emp_id": "EMP-FAC-042",
        },
        {
            "email": "teacher@test.com",
            "name": "Demo Laboratory Instructor",
            "password": "password123",
            "department": "Power Electronics Lab",
            "subject": "Hardware-in-the-Loop & Power Converters",
            "bio": "Test faculty account for lab assignment evaluations.",
            "emp_id": "EMP-DEMO-001",
        }
    ]

    for t in teachers:
        user = db.query(User).filter(User.email == t["email"].lower()).first()
        if not user:
            user = User(
                email=t["email"].lower(),
                password_hash=hash_password(t["password"]),
                role="staff",
                name=t["name"],
                university="EduNexus Institute of Technology",
                department=t["department"],
                subject=t["subject"],
                bio=t["bio"],
                graduation_year=t["emp_id"],
                skills='["Circuit Theory", "Digital Twins", "Power Electronics", "Nodal Analysis"]'
            )
            db.add(user)
            print(f"[CREATED] Staff account: {t['email']} | Password: {t['password']}")
        else:
            user.role = "staff"
            user.name = t["name"]
            user.password_hash = hash_password(t["password"])
            user.department = t["department"]
            user.subject = t["subject"]
            user.bio = t["bio"]
            user.graduation_year = t["emp_id"]
            print(f"[UPDATED] Staff account: {t['email']} | Password: {t['password']}")

    db.commit()
    db.close()

if __name__ == "__main__":
    setup_dummy_teachers()
