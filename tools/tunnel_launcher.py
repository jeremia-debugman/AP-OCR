import os
import re
import sys
import subprocess
import time

def find_cloudflared(project_dir):
    local_cf = os.path.join(project_dir, "tools", "cloudflared.exe")
    if os.path.isfile(local_cf):
        return local_cf
    # Check PATH
    for path_dir in os.environ.get("PATH", "").split(os.pathsep):
        candidate = os.path.join(path_dir, "cloudflared.exe")
        if os.path.isfile(candidate):
            return candidate
    return None

def copy_to_clipboard(text):
    try:
        p = subprocess.Popen(['clip'], stdin=subprocess.PIPE, shell=True)
        p.communicate(text.encode('utf-8'))
        return True
    except Exception:
        return False

def main():
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(project_dir)

    cf_exe = find_cloudflared(project_dir)
    if not cf_exe:
        print("[ERROR] cloudflared.exe not found in tools/ or system PATH.")
        sys.exit(1)

    print("========================================================================")
    print("           AP-OCR On-Demand Public Tunnel (Cloudflare)                  ")
    print("========================================================================")
    print("[*] Target Local Service: http://localhost:5174")
    print("[*] Starting Cloudflare secure tunnel, please wait a moment...")
    print("------------------------------------------------------------------------")

    cmd = [cf_exe, "tunnel", "--url", "http://localhost:5174"]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1
    )

    url_found = False
    url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")

    try:
        for line in proc.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()

            if not url_found:
                match = url_pattern.search(line)
                if match:
                    url_found = True
                    tunnel_url = match.group(0)
                    copied = copy_to_clipboard(tunnel_url)
                    clip_msg = " [Copied to Clipboard!]" if copied else ""

                    print()
                    print("========================================================================")
                    print("                   >>> PUBLIC ACCESS LINK IS LIVE <<<                  ")
                    print("========================================================================")
                    print()
                    print(f"   PUBLIC URL   :  {tunnel_url}{clip_msg}")
                    print(f"   LOCAL TARGET :  http://localhost:5174")
                    print()
                    print("   Share this link with external users or test on your mobile device.")
                    print("   Keep this command window OPEN to maintain the active tunnel.")
                    print("   To stop the tunnel, press Ctrl+C.")
                    print("========================================================================")
                    print()

        proc.wait()
    except KeyboardInterrupt:
        print("\n[*] Stopping Cloudflare Tunnel...")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        print("[*] Tunnel closed.")

if __name__ == "__main__":
    main()
