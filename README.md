# Mouse Innovations · EduNexus Lab Suite

EduNexus is an interactive Digital Twin and Smart Assessment platform featuring:
- **Resistance Bank Training Kit**: Jumper wiring simulation with exact Nodal Laplacian circuit solver & automated Thevenin resistance grading.
- **Power Electronics Trainer**: Rectifier & DC-DC converter lab with virtual CRO waveforms.
- **EduNexus AI Teacher**: AI mentor powered by locally trained Ollama models (`edunexus-qwen3`) or cloud API fallback (Groq).

---

## ⚡ Quick Start (One-Click)

The easiest way to start everything (Ollama check, Backend, and Frontend):

### Windows:
Double-click **`start.bat`** (or run `python run_all.py` in your terminal).

### PowerShell:
```powershell
.\start.ps1
```

This single command will:
1. Verify Ollama is running and build the custom `edunexus-qwen3` model if needed.
2. Launch the FastAPI backend on port `8123`.
3. Launch the Frontend server on port `5500`.
4. Automatically open `http://127.0.0.1:5500` in your default browser.
5. Gracefully terminate both servers when you press `Ctrl+C`.

---

## 🛠️ Step-by-Step Setup from Scratch

### 1. Install & Configure Ollama (Local AI Teacher)

1. **Download Ollama**:
   - Download the installer from [ollama.com/download/windows](https://ollama.com/download/windows) (or run `winget install Ollama.Ollama`).
   - Run the installer and launch Ollama.

2. **Pull the Base Model**:
   Open a terminal and run:
   ```bash
   ollama pull qwen3:4b
   ```

3. **Build the Custom EduNexus Model**:
   Run this command from the project root:
   ```bash
   ollama create edunexus-qwen3 -f backend/Modelfile.edunexus
   ```
   *(To verify, run `ollama list` — you should see `edunexus-qwen3:latest` listed).*

---

### 2. Install Python Dependencies

Make sure Python 3.10+ is installed, then run:
```bash
cd backend
pip install -r requirements.txt
cd ..
```

---

### 3. Run Manually (Separate Terminals)

If you prefer running the backend and frontend in separate terminals:

**Terminal 1 — Backend:**
```bash
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8123 --reload
```
- API Health & Docs: `http://127.0.0.1:8123/docs`
- AI Teacher Diagnostics: `http://127.0.0.1:8123/api/ai-teacher/status`

**Terminal 2 — Frontend:**
```bash
python frontend_server.py 5500
```
- Web Application: `http://127.0.0.1:5500`

---

## 🤖 AI Provider Options in UI

Inside the EduNexus web interface, open the **AI Teacher** drawer (bottom right button). You can toggle between:
- **● Local Qwen3:4B (RTX/Ollama)**: Zero cloud cost, private, high-speed local inference.
- **⚡ Cloud API (Groq)**: Cloud fallback with ultra-low latency.

---

## 🚀 Deploying to Render

You can deploy EduNexus to Render either via **Blueprint (Automatic)** or as a **Manual Web Service**:

### Option 1: Render Blueprint (1-Click Automated)
1. Push this repository to GitHub or GitLab.
2. In your [Render Dashboard](https://dashboard.render.com), click **New +** -> **Blueprint**.
3. Select your repository. Render will automatically read `render.yaml`.
4. Fill in `GROQ_API_KEY` when prompted and click **Apply**.
5. Render will provision the web service, configure the environment variables, and provide your live HTTPS URL!

### Option 2: Standard Web Service
1. In Render Dashboard, click **New +** -> **Web Service**.
2. Connect your GitHub/GitLab repository.
3. Configure the service:
   - **Name:** `edunexus`
   - **Environment:** `Python 3`
   - **Region:** Any (e.g. Oregon or Frankfurt)
   - **Branch:** `main`
   - **Build Command:** `pip install -r backend/requirements.txt`
   - **Start Command:** `python -m uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
4. In **Environment Variables**, add:
   - `PYTHON_VERSION` = `3.11.9`
   - `LLM_PROVIDER` = `groq`
   - `GROQ_API_KEY` = `your_groq_api_key`
   - `GROQ_MODEL` = `qwen/qwen3.8-27b`
   - `EDUNEXUS_SECRET_KEY` = *(a random secure secret string)*
   - `STAFF_EMAILS` = `teacher@edunexus.edu,your_email@domain.com`
   - `DATABASE_URL` = *(optional: connect to Render PostgreSQL or Supabase for persistent DB)*
5. Click **Create Web Service**. Both the web application and backend API will run seamlessly on your Render domain with SSL and WebSockets enabled!
