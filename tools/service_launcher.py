import os
import sys
import subprocess
import time

def main():
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(project_dir)

    logs_dir = os.path.join(project_dir, "logs")
    os.makedirs(logs_dir, exist_ok=True)

    backend_log = open(os.path.join(logs_dir, "backend.log"), "a", encoding="utf-8")
    frontend_log = open(os.path.join(logs_dir, "frontend.log"), "a", encoding="utf-8")

    # Resolve Python
    py_exe = sys.executable
    venv_py = os.path.join(project_dir, "backend", ".venv", "Scripts", "python.exe")
    if os.path.isfile(venv_py):
        py_exe = venv_py

    # Resolve npm / frontend command
    frontend_dir = os.path.join(project_dir, "frontend")
    dist_dir = os.path.join(frontend_dir, "dist")
    has_dist = os.path.isdir(dist_dir)

    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    si.wShowWindow = 0  # SW_HIDE

    CREATE_NEW_CONSOLE = 0x00000010

    env = os.environ.copy()
    node_dir = r"C:\Program Files\nodejs"
    if os.path.isdir(node_dir) and node_dir not in env.get("PATH", ""):
        env["PATH"] = node_dir + os.pathsep + env.get("PATH", "")

    # Launch Backend
    backend_cmd = [py_exe, "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8001"]
    backend_proc = subprocess.Popen(
        backend_cmd,
        cwd=project_dir,
        startupinfo=si,
        creationflags=CREATE_NEW_CONSOLE,
        env=env
    )

    # Launch Frontend
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    sub_cmd = "preview" if has_dist else "dev"
    frontend_args = [npm_cmd, "run", sub_cmd, "--", "--port", "5174", "--host"]

    frontend_proc = subprocess.Popen(
        frontend_args,
        cwd=frontend_dir,
        startupinfo=si,
        creationflags=CREATE_NEW_CONSOLE,
        shell=True,
        env=env
    )

    print(f"[SUCCESS] AP-OCR Services launched in background:")
    print(f"  - Backend PID  : {backend_proc.pid} (port 8001)")
    print(f"  - Frontend PID : {frontend_proc.pid} (port 5174, mode: {sub_cmd})")
    print(f"  - Logs: logs\\backend.log, logs\\frontend.log")

if __name__ == "__main__":
    main()
