// EFT writes the player's position and camera rotation into every screenshot file name, e.g.
//   2026-09-04[18-33]_7.86, 38.06, -27.57_-0.03307, -0.13322, 0.00384, -0.99053_21.87 (0).png
//   date[hh-mm]_ x, y, z _ qx, qy, qz, qw _ ...
// Numbers are separated by ", "; a decimal comma (Russian locale) is accepted too.
// The map name is NOT in the file name, so callers must check the position against the map bounds.

const NUM = '-?\\d+(?:[.,]\\d+)?';
const NAME_RE = new RegExp(
  `(?:(\\d{4})-(\\d{2})-(\\d{2})\\[(\\d{2})-(\\d{2})\\])?_(${NUM}), (${NUM}), (${NUM})_(${NUM}), (${NUM}), (${NUM}), (${NUM})`,
);

const toNumber = (s) => Number(s.replace(',', '.'));

export function parseEftScreenshotName(fileName) {
  if (!fileName) return null;
  const m = NAME_RE.exec(fileName);
  if (!m) return null;
  const position = { x: toNumber(m[6]), y: toNumber(m[7]), z: toNumber(m[8]) };
  const q = { x: toNumber(m[9]), y: toNumber(m[10]), z: toNumber(m[11]), w: toNumber(m[12]) };
  const values = [position.x, position.y, position.z, q.x, q.y, q.z, q.w];
  if (!values.every(Number.isFinite)) return null;
  const norm = Math.hypot(q.x, q.y, q.z, q.w);
  return {
    position,
    rotation: Math.abs(norm - 1) < 0.05 ? q : null,
    takenAt: m[1] ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : null,
  };
}

// Unity forward vector = q * (0, 0, 1), projected onto the horizontal plane (game X/Z).
export function forwardFromQuaternion(q) {
  if (!q) return null;
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const len = Math.hypot(fx, fz);
  if (len < 1e-3) return null;
  return { x: fx / len, z: fz / len };
}
