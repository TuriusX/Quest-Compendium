"""
Prepare a gameplay recording for the sticky-marker test bench (tests/markers/replay.cjs).

Usage:  python tests/markers/prepare.py path/to/recording.mp4
Needs:  ffmpeg on PATH, and Python with numpy + opencv-python (pip install numpy opencv-python)

Writes to tests/markers/footage/ (git-ignored):
  frames384.bin      the recording at 30 fps, 384x216 grayscale: exactly what the tracker sees
  true_shifts.json   the true camera movement between frames (phase correlation at 960x540: slower, far more
                     accurate), used as the answer key
Record 30-60 s of walking around with Quest Compendium's markers turned off.
"""
import json, os, subprocess, sys
import cv2
import numpy as np

src = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), 'footage')
os.makedirs(out, exist_ok=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vf', 'fps=30,scale=384:216,format=gray', '-f', 'rawvideo', os.path.join(out, 'frames384.bin')], check=True)
big = os.path.join(out, 'frames960.tmp')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vf', 'fps=30,scale=960:540,format=gray', '-f', 'rawvideo', big], check=True)
W, H = 960, 540
n = os.path.getsize(big) // (W * H)
frames = np.memmap(big, dtype=np.uint8, mode='r', shape=(n, H, W))
win = cv2.createHanningWindow((W, H), cv2.CV_64F)
shifts = [[0.0, 0.0, 1.0]]
prev = frames[0].astype(np.float64)
for k in range(1, n):
    cur = frames[k].astype(np.float64)
    (dx, dy), resp = cv2.phaseCorrelate(prev, cur, win)
    shifts.append([dx / W, dy / H, resp])
    prev = cur
del frames
os.remove(big)
json.dump(shifts, open(os.path.join(out, 'true_shifts.json'), 'w'))
print(f'{n} frames ready in {out}')
