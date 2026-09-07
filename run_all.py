#!/usr/bin/env python3
"""
EduNexus All-in-One Runner
Checks Ollama & models, starts FastAPI Backend (port 8123), and Frontend Server (port 5500).
Gracefully shuts down all subprocesses on Ctrl+C.
"""

import os
import sys
import time
import subprocess
import webbrowser
import urllib.request
import json

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")
MODELFILE_PATH = os.path.join(BACKEND_DIR, "Modelfile.edunexus")

OLLAMA_URL = "http://127.0.0.1:11434/api/tags"
BACKEND_URL = "http://127.0.0.1:8123/docs"
FRONTEND_URL = "http://127.0.0.1:5500"

processes = []

def print_banner():
    print("=" * 65)
    print("       ⚡  MOUSE INNOVATIONS · EDUNEXUS LAB SUITE  ⚡")
    print("=" * 65)

def check_ollama():
    print("[1/3] Checking Ollama & AI Models...")
    try:
        req = urllib.request.Request(OLLAMA_URL, headers={"User-Agent": "EduNexusRunner"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
            model_names = [m.get("name", "") for m in data.get("models", [])]
            
            # Check if edunexus-qwen3 exists
            has_edunexus = any("edunexus-qwen3" in name for name in model_names)
            if has_edunexus:
                print("  ✓ Ollama is running and 'edunexus-qwen3' model is ready.")
            else:
                print("  ! 'edunexus-qwen3' model not found. Creating it now from Modelfile...")
                # Check base model
                has_base = any("qwen3:4b" in name for name in model_names)
                if not has_base:
                    print("  → Pulling base model 'qwen3:4b' (this may take a couple minutes)...")
                    subprocess.run(["ollama", "pull", "qwen3:4b"], check=True)
                
                print("  → Building 'edunexus-qwen3'...")
                subprocess.run(["ollama", "create", "edunexus-qwen3", "-f", MODELFILE_PATH], check=True)
                print("  ✓ 'edunexus-qwen3' model created successfully!")
    except Exception as e:
        print(f"  ! Note: Could not reach Ollama at {OLLAMA_URL}.")
        print("    If Ollama is not started, run 'ollama serve' in another terminal.")
        print("    (Cloud API Groq fallback is also supported in the UI).")

def start_backend():
    print("\n[2/3] Starting Backend Server (port 8123)...")
    cmd = [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8123"]
    p = subprocess.Popen(cmd, cwd=BACKEND_DIR)
    processes.append(("Backend", p))
    print("  ✓ Backend process spawned on http://127.0.0.1:8123")

def start_frontend():
    print("\n[3/3] Starting Frontend Server (port 5500)...")
    cmd = [sys.executable, "frontend_server.py", "5500"]
    p = subprocess.Popen(cmd, cwd=ROOT_DIR)
    processes.append(("Frontend", p))
    print("  ✓ Frontend process spawned on http://127.0.0.1:5500")

def cleanup():
    print("\nShutting down EduNexus services...")
    for name, p in processes:
        try:
            print(f"  Stopping {name} (PID {p.pid})...")
            p.terminate()
            p.wait(timeout=3)
        except Exception:
            try:
                p.kill()
            except Exception:
                pass
    print("All services stopped. Goodbye!")

def main():
    print_banner()
    check_ollama()
    start_backend()
    start_frontend()

    # Wait for servers to spin up
    time.sleep(2)
    print("\n" + "=" * 65)
    print(f"  🚀 Frontend: {FRONTEND_URL}")
    print(f"  🔧 Backend Docs: {BACKEND_URL}")
    print(f"  🤖 AI Status: http://127.0.0.1:8123/api/ai-teacher/status")
    print("=" * 65)
    print("\nPress Ctrl+C at any time to stop all services.\n")

    # Open browser
    try:
        webbrowser.open(FRONTEND_URL)
    except Exception:
        pass

    try:
        while True:
            for name, p in processes:
                if p.poll() is not None:
                    print(f"\n[Warning] {name} exited unexpectedly with code {p.returncode}.")
                    cleanup()
                    sys.exit(1)
            time.sleep(1)
    except KeyboardInterrupt:
        cleanup()

if __name__ == "__main__":
    main()
