"""Simple autotune: snap vocal pitch to the nearest note of the detected key (WORLD vocoder)."""
import sys
import numpy as np
import pyworld as pw
import soundfile as sf

src, dst = sys.argv[1], sys.argv[2]
retune_ms = float(sys.argv[3]) if len(sys.argv) > 3 else 15.0  # lower = harder, more robotic

x, fs = sf.read(src)
if x.ndim > 1:
    x = x.mean(axis=1)
x = np.ascontiguousarray(x, dtype=np.float64)

period = 5.0
f0, t = pw.harvest(x, fs, f0_floor=80, f0_ceil=1000, frame_period=period)
sp = pw.cheaptrick(x, f0, t, fs)
ap = pw.d4c(x, f0, t, fs)

voiced = f0 > 0
midi = np.zeros_like(f0)
midi[voiced] = 69 + 12 * np.log2(f0[voiced] / 440.0)

# Detect key: weight pitch classes, pick the best-fitting major scale (relative minor shares it).
pc_hist = np.bincount(np.round(midi[voiced]).astype(int) % 12, minlength=12).astype(float)
major = np.array([0, 2, 4, 5, 7, 9, 11])
scores = [pc_hist[(major + k) % 12].sum() for k in range(12)]
key = int(np.argmax(scores))
scale = (major + key) % 12
names = "C C# D D# E F F# G G# A A# B".split()
print(f"Detected key: {names[key]} major / {names[(key + 9) % 12]} minor; "
      f"{100 * max(scores) / pc_hist.sum():.0f}% of sung pitch fits the scale")

def snap(m):
    base = np.floor(m)
    cands = np.array([base + d for d in range(-2, 4)])
    cands = cands[np.isin(cands.astype(int) % 12, scale)]
    return cands[np.argmin(np.abs(cands - m))]

target = midi.copy()
target[voiced] = [snap(m) for m in midi[voiced]]

# Retune speed: one-pole glide toward the target within each voiced run.
alpha = 1 - np.exp(-period / max(retune_ms, 0.1))
out = np.zeros_like(target)
prev = None
for i in range(len(target)):
    if not voiced[i]:
        prev = None
        continue
    prev = target[i] if prev is None else prev + alpha * (target[i] - prev)
    out[i] = prev

f0_new = np.zeros_like(f0)
f0_new[voiced] = 440.0 * 2 ** ((out[voiced] - 69) / 12)
shift = np.abs(out[voiced] - midi[voiced])
print(f"Average correction: {shift.mean() * 100:.0f} cents, max {shift.max() * 100:.0f} cents")

y = pw.synthesize(f0_new, sp, ap, fs, period)
y = y / (np.max(np.abs(y)) + 1e-9) * 0.9
sf.write(dst, y, fs)
