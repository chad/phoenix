#!/usr/bin/env python3
"""
Capture terminal output as SVG screenshots using Rich.
Usage: echo "output" | python3 capture.py <name> [--width=N]
   or: python3 capture.py <name> --cmd="phoenix status" [--width=N]
"""
import sys
import subprocess
import os

from rich.console import Console
from rich.text import Text

def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "screenshot"
    width = 100
    cmd = None
    
    for arg in sys.argv[2:]:
        if arg.startswith("--width="):
            width = int(arg.split("=")[1])
        elif arg.startswith("--cmd="):
            cmd = arg.split("=", 1)[1]
    
    # Get the output
    if cmd:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            env={**os.environ, "FORCE_COLOR": "1", "TERM": "xterm-256color"}
        )
        raw = result.stdout + result.stderr
    else:
        raw = sys.stdin.read()
    
    out_dir = os.path.dirname(os.path.abspath(__file__))
    svg_path = os.path.join(out_dir, f"{name}.svg")
    
    console = Console(record=True, width=width, force_terminal=True)
    text = Text.from_ansi(raw)
    console.print(text)
    
    svg = console.export_svg(title=f"phoenix — {name}")
    with open(svg_path, "w") as f:
        f.write(svg)
    
    print(f"✔ {svg_path}", file=sys.stderr)

if __name__ == "__main__":
    main()
