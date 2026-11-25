/**
 * The front page demo's stream picture: what a ginger tabby's phone films as it streams itself, selfie style, from the
 * top of a store shelf, pushing products off. The camera is the phone's front camera on a selfie stick in the cat's
 * paw.
 *
 * Lit like a shop: a ceiling key with soft shadows, the phone screen's glow on the cat's face, warm and cool rims from
 * the aisle behind, and image-based light for the tins. The cat is sculpted from smooth blended shapes, with tabby
 * markings drawn in its fur shader and glossy eyes that look into the lens. The aisle behind is drawn on its own at
 * half size and blurred like a phone's portrait mode. The picture then gets a phone camera finish: vignette, a little
 * colour fringing and grain.
 *
 * Every frame is a pure function of the stream second. That lets the demo seek (Jump in VOD), pause and hold a still,
 * and makes the posters and the panel's moment picture frames of the same scene.
 *
 * Loaded on its own, only when the demo comes near the screen and motion is allowed (LandingBesideChat).
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HalfFloatType,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Quaternion,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { KNOCK_S, SHOVE_S } from './catStreamTimes'

export interface CatStreamScene {
  /** Draws stream second `vt`. */
  render(vt: number): void
  /** Drawing-buffer size in CSS px, and the device pixel ratio to use. */
  setSize(width: number, height: number, pixelRatio: number): void
  /** Compiles the shaders off the main thread where the browser can, so the first frame does not stall. */
  warm(): Promise<void>
  dispose(): void
}

/** When the hand flinches, and how hard: the can at the opener, the pyramid at the moment. */
const JOLTS: readonly (readonly [number, number])[] = [[KNOCK_S + 0.05, 0.45], [SHOVE_S, 1]]
/** The pyramid's wobble from each tap before the shove. */
const WOBBLES: readonly (readonly [number, number])[] = [[5817.02, 0.05], [5818.53, 0.09]]

// ---------------------------------------------------------------- palette (sRGB)

const C = {
  fur: 0xe88a3d,
  furDark: 0xa24c1b,
  furSheen: 0xffc995,
  cream: 0xf3e1c8,
  nose: 0xd66f7e,
  earIn: 0xe69a9d,
  liner: 0x3a2217,
  mouth: 0x4a271b,
  whisker: 0xfbf7f0,
  shelf: 0xd8dbdf,
}

/** A palette colour as a linear GLSL vec3. */
function glsl(hex: number): string {
  const c = new Color(hex)
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`
}

// ---------------------------------------------------------------- small helpers

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)

type V3 = readonly [number, number, number]
type Key<T> = readonly [number, T]

/** Eased piecewise track over stream seconds: holds the first value before, the last after. */
function track(vt: number, keys: readonly Key<number>[]): number {
  const first = keys[0]!
  if (vt <= first[0]) return first[1]
  for (let i = 1; i < keys.length; i += 1) {
    const [t1, v1] = keys[i]!
    const [t0, v0] = keys[i - 1]!
    if (vt < t1) return v0 + (v1 - v0) * smooth((vt - t0) / (t1 - t0))
  }
  return keys[keys.length - 1]![1]
}

function trackV(vt: number, keys: readonly Key<V3>[], out: Vector3): Vector3 {
  const first = keys[0]!
  if (vt <= first[0]) return out.set(...first[1])
  for (let i = 1; i < keys.length; i += 1) {
    const [t1, b] = keys[i]!
    const [t0, a] = keys[i - 1]!
    if (vt < t1) {
      const k = smooth((vt - t0) / (t1 - t0))
      return out.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k)
    }
  }
  return out.set(...keys[keys.length - 1]![1])
}

/** A blink 0..1 around `at`, closing fast and opening a little slower. */
function blinkAt(vt: number, at: number, length = 0.14): number {
  const d = vt - at
  if (d < 0 || d > length) return 0
  const k = d / length
  return k < 0.4 ? smooth(k / 0.4) : 1 - smooth((k - 0.4) / 0.6)
}

/** A seeded random stream, so every visit builds the same store. */
function seeded(seed: number): () => number {
  let r = seed
  return () => {
    r = (r * 16807) % 2147483647
    return r / 2147483647
  }
}

/** A repeatable 0..1 for integer n. */
function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

// ---------------------------------------------------------------- sculpting: smooth blended ellipsoids

interface Part {
  c: V3
  r: V3
  /** Blend width; larger melts the part into the rest. */
  k?: number
  /** Carves the part away instead of adding it. */
  cut?: boolean
}

function ellipsoid(x: number, y: number, z: number, c: V3, r: V3): number {
  const ax = (x - c[0]) / r[0]
  const ay = (y - c[1]) / r[1]
  const az = (z - c[2]) / r[2]
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az)
  const bx = ax / r[0]
  const by = ay / r[1]
  const bz = az / r[2]
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz)
  return k1 < 1e-9 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1
}

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

type Field = (x: number, y: number, z: number) => number

function blend(parts: readonly Part[], floorY?: number): Field {
  return (x, y, z) => {
    let d = 1e9
    for (const p of parts) {
      const e = ellipsoid(x, y, z, p.c, p.r)
      d = p.cut ? -smin(-d, e, p.k ?? 0.02) : smin(d, e, p.k ?? 0.06)
    }
    return floorY === undefined ? d : -smin(-d, y - floorY, 0.03)
  }
}

/** Where a ray from `center` along `dir` leaves the field. */
function surfaceAlong(f: Field, center: V3, dx: number, dy: number, dz: number, reach: number): number {
  let lo = 0
  let hi = reach
  for (let it = 0; it < 16; it += 1) {
    const mid = (lo + hi) / 2
    if (f(center[0] + dx * mid, center[1] + dy * mid, center[2] + dz * mid) < 0) lo = mid
    else hi = mid
  }
  return lo
}

/** A smooth mesh of the field's surface, shrink-wrapped from a sphere around `center`, with normals from the field. */
function sculpt(f: Field, center: V3, wide: number, high: number, reach: number): BufferGeometry {
  const g = new SphereGeometry(1, wide, high)
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const e = 1e-4
  for (let i = 0; i < pos.count; i += 1) {
    let dx = pos.getX(i)
    let dy = pos.getY(i)
    let dz = pos.getZ(i)
    const l = Math.hypot(dx, dy, dz) || 1
    dx /= l
    dy /= l
    dz /= l
    const t = surfaceAlong(f, center, dx, dy, dz, reach)
    const x = center[0] + dx * t
    const y = center[1] + dy * t
    const z = center[2] + dz * t
    pos.setXYZ(i, x, y, z)
    const nx = f(x + e, y, z) - f(x - e, y, z)
    const ny = f(x, y + e, z) - f(x, y - e, z)
    const nz = f(x, y, z + e) - f(x, y, z - e)
    const nl = Math.hypot(nx, ny, nz) || 1
    nor.setXYZ(i, nx / nl, ny / nl, nz / nl)
  }
  g.computeBoundingSphere()
  return g
}

/** A point carried onto the field's surface along the ray from `center`, then `lift` above it. */
function onSurface(f: Field, center: V3, p: V3, lift: number): Vector3 {
  const d = new Vector3(p[0] - center[0], p[1] - center[1], p[2] - center[2]).normalize()
  const t = surfaceAlong(f, center, d.x, d.y, d.z, 0.8)
  return new Vector3(...center).addScaledVector(d, t + lift)
}

// ---------------------------------------------------------------- the cat's shapes (head space and body space)

/** Head space: the head group sits at (0, 0.83, 0.03) in the cat. Eyes at (±0.112, 0.19), nose at the muzzle front. */
const HEAD_CENTER: V3 = [0, 0.15, 0.03]
const HEAD = blend([
  { c: [0, 0.17, -0.01], r: [0.31, 0.255, 0.27] },
  { c: [-0.15, 0.072, 0.07], r: [0.175, 0.13, 0.15], k: 0.09 },
  { c: [0.15, 0.072, 0.07], r: [0.175, 0.13, 0.15], k: 0.09 },
  { c: [0, 0.072, 0.2], r: [0.135, 0.082, 0.1], k: 0.06 },
  { c: [0, 0.008, 0.162], r: [0.07, 0.05, 0.07], k: 0.05 },
  { c: [0, 0.3, 0.12], r: [0.2, 0.08, 0.14], k: 0.08 },
  { c: [-0.112, 0.19, 0.252], r: [0.07, 0.068, 0.052], k: 0.022, cut: true },
  { c: [0.112, 0.19, 0.252], r: [0.07, 0.068, 0.052], k: 0.022, cut: true },
])

/** Body space (the torso group at the cat's origin): sitting, haunches out, a cream bib. */
const BODY_CENTER: V3 = [0, 0.36, 0]
const BODY = blend(
  [
    { c: [0, 0.22, 0], r: [0.4, 0.25, 0.33] },
    { c: [0, 0.53, 0.02], r: [0.27, 0.3, 0.24], k: 0.14 },
    { c: [0, 0.49, 0.15], r: [0.18, 0.24, 0.12], k: 0.08 },
    { c: [0, 0.77, 0.04], r: [0.18, 0.13, 0.15], k: 0.1 },
    { c: [-0.25, 0.18, -0.07], r: [0.19, 0.21, 0.27], k: 0.08 },
    { c: [0.25, 0.18, -0.07], r: [0.19, 0.21, 0.27], k: 0.08 },
    { c: [-0.27, 0.045, 0.17], r: [0.085, 0.05, 0.13], k: 0.04 },
    { c: [0.27, 0.045, 0.17], r: [0.085, 0.05, 0.13], k: 0.04 },
  ],
  0.004,
)

/**
 * Fur colour, drawn per pixel from the object-space position so the markings stay crisp at any size: cream muzzle,
 * bib and feet, a tabby M on the forehead, cheek lines, ringed body, bullseyes on the haunches, ringed legs and tail.
 */
const FUR_GLSL = /* glsl */ `
varying vec3 vFurP;
varying vec3 vFurN;
uniform int furKind;
const vec3 FUR = ${glsl(C.fur)};
const vec3 FUR_DARK = ${glsl(C.furDark)};
const vec3 CREAM = ${glsl(C.cream)};
const vec3 LINER = ${glsl(C.liner)};
float furHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float furNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(furHash(i), furHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(furHash(i + vec3(0.0, 1.0, 0.0)), furHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(furHash(i + vec3(0.0, 0.0, 1.0)), furHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(furHash(i + vec3(0.0, 1.0, 1.0)), furHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
float band(float phase, float width) {
  float s = 0.5 + 0.5 * cos(phase * 6.2831853);
  return smoothstep(1.0 - width, 1.0 - width + 0.2, s);
}
vec3 furColor(vec3 p, vec3 n) {
  float g = furNoise(p * 52.0) * 0.6 + furNoise(p * 131.0) * 0.4;
  float dark = 0.0;
  float cream = 0.0;
  float shade = 1.0;
  float liner = 0.0;
  if (furKind == 0) {
    cream = 1.0 - smoothstep(0.78, 1.08, length((p - vec3(0.0, 0.052, 0.25)) / vec3(0.158, 0.098, 0.13)));
    vec3 q = vec3(abs(p.x), p.y, p.z);
    cream = max(cream, 0.6 * (1.0 - smoothstep(0.55, 1.0, length((q - vec3(0.12, 0.138, 0.262)) / vec3(0.06, 0.022, 0.05)))));
    float crown = smoothstep(0.265, 0.32, p.y) * (1.0 - smoothstep(0.12, 0.34, -p.z));
    dark = crown * band(atan(p.x, p.y - 0.02) / 0.21, 0.34 + 0.12 * g);
    float l1 = 1.0 - smoothstep(0.005, 0.015, abs(p.y - (0.178 - (q.x - 0.165) * 0.5)));
    float l2 = 1.0 - smoothstep(0.005, 0.013, abs(p.y - (0.112 - (q.x - 0.19) * 0.35)));
    dark = max(dark, max(l1 * smoothstep(0.165, 0.19, q.x), l2 * smoothstep(0.195, 0.22, q.x)) * smoothstep(-0.12, 0.02, p.z));
    // The dark rim round each eye, painted where the socket meets the face, with a little flick at the outer corner.
    float e = length((q.xy - vec2(0.112, 0.19)) / vec2(0.074, 0.071));
    float flick = (1.0 - smoothstep(0.004, 0.012, abs(p.y - 0.168 - (q.x - 0.17) * 0.55))) * smoothstep(0.165, 0.18, q.x) * (1.0 - smoothstep(0.2, 0.215, q.x));
    liner = max((1.0 - smoothstep(0.035, 0.09, abs(e - 0.99))), flick) * smoothstep(0.17, 0.22, p.z);
  } else if (furKind == 1) {
    float bib = (1.0 - smoothstep(0.75, 1.05, length(vec2(p.x / 0.15, (p.y - 0.52) / 0.22)))) * smoothstep(0.2, 0.5, n.z);
    float belly = (1.0 - smoothstep(0.75, 1.05, length(vec2(p.x / 0.13, (p.y - 0.13) / 0.11)))) * smoothstep(0.3, 0.6, n.z);
    float feet = (1.0 - smoothstep(0.07, 0.11, p.y)) * smoothstep(0.05, 0.12, p.z);
    cream = max(max(bib, belly), feet);
    float back = 1.0 - smoothstep(0.1, 0.5, n.z);
    float rings = band(p.y / 0.095 + 0.35 * sin(atan(p.x, -p.z) * 2.0), 0.33 + 0.1 * g);
    vec3 h = p - vec3(sign(p.x) * 0.27, 0.19, -0.07);
    float bull = band(length(h.yz) / 0.075, 0.36 + 0.08 * g);
    float haunch = smoothstep(0.42, 0.3, p.y) * smoothstep(0.12, 0.2, abs(p.x));
    dark = back * mix(rings, bull, haunch);
  } else if (furKind == 2) {
    dark = band(p.y * 3.6, 0.3) * 0.85;
  } else if (furKind == 3) {
    dark = band(p.z / 0.13 + 0.5, 0.32);
  } else if (furKind == 4) {
    cream = 1.0;
    shade = 1.0 - 0.3 * (1.0 - smoothstep(0.02, 0.08, abs(abs(p.x) - 0.3))) * smoothstep(0.25, 0.6, p.z) * (1.0 - smoothstep(0.1, 0.5, p.y));
  } else if (furKind == 6) {
    dark = 1.0;
  } else if (furKind == 7) {
    dark = smoothstep(0.12, 0.26, p.y) * 0.45;
  }
  vec3 c = mix(FUR, FUR_DARK, dark);
  c = mix(c, CREAM, cream);
  c = c * shade * (0.88 + 0.24 * g);
  return mix(c, LINER, liner);
}
`

// ---------------------------------------------------------------- shelf geometry (world units, about 25 cm each)

/** The cat sits on top of a shelf unit: its top is y = 0, its front edge z = EDGE, its back edge z = BACK. */
const EDGE = 0.35
const BACK = -1.75
const SHELF_X = 8
const LOWER_Y = -0.98
const GRAVITY = 26

const CAN_R = 0.09
const CAN_H = 0.26

/** Can A: the one pushed off at 0:02:00. */
const CAN_A_REST: V3 = [0.5, CAN_H / 2, 0.15]
const CAN_A_DROP: V3 = [0.51, CAN_H / 2, 0.37]

/** The pyramid, three rows (3-2-1), on the cat's left. */
const PYR_Z = -0.02
const PYRAMID: readonly V3[] = [
  [0.73, CAN_H / 2, PYR_Z],
  [0.915, CAN_H / 2, PYR_Z],
  [1.1, CAN_H / 2, PYR_Z],
  [0.8225, CAN_H * 1.5, PYR_Z],
  [1.0075, CAN_H * 1.5, PYR_Z],
  [0.915, CAN_H * 2.5, PYR_Z],
]
/** How each can leaves when shoved: velocity and spin (world, per second). */
const PYRAMID_KICK: readonly (readonly [V3, V3])[] = [
  [[0.95, 0.35, 1.25], [3.5, 0.4, -4.5]],
  [[0.55, 0.25, 0.82], [2.4, 1.1, -3.2]],
  [[0.34, 0.12, 0.46], [1.2, -0.8, -2.2]],
  [[1.35, 0.95, 1.45], [4.6, 1.2, -6.4]],
  [[1.05, 1.05, 1.15], [-3.4, 2.2, -5.6]],
  [[1.2, 1.5, 1.6], [5.4, -2.2, -7.5]],
]

/** The aisle behind the cat's shelf: the next unit's face, its shelves and the cross aisle with the fridges. */
const FLOOR_Y = -6.4
const NEXT_FACE_Z = -8.6

// ---------------------------------------------------------------- the selfie camera

/** Vertical field of view of the phone's front camera, in degrees. */
const SELFIE_FOV = 56
/** Where the cat holds the phone: out in front, to its right, a little above its eyes. */
const SELFIE_AT: V3 = [-0.42, 1.42, 1.3]
/** What the phone points at when the cat just talks to chat: its face high in the picture, the shelf below. */
const AIM: V3 = [0.3, 0.8, -0.05]
/** Where it points while the cat pushes can A to the shelf edge, so the can goes over in the picture. */
const AIM_EDGE: V3 = [0.36, 0.64, 0.16]
/** A slight tilt of the hand. */
const SELFIE_ROLL = 0.045

// ---------------------------------------------------------------- the can falls, simulated once and sampled

interface Track {
  t0: number
  n: number
  pos: Float32Array
  quat: Float32Array
}

const SIM_HZ = 240
const SAMPLE_HZ = 60
const SIM_SECONDS = 3

function onShelf(x: number, z: number): boolean {
  return Math.abs(x) < SHELF_X && z > BACK && z < EDGE
}

/** Deterministic tumble of one can: gravity, the shelf tops, friction and a settle toward lying or standing. */
function simulate(t0: number, start: V3, vel: V3, spin: V3): Track {
  const dt = 1 / SIM_HZ
  const steps = SIM_SECONDS * SIM_HZ
  const every = SIM_HZ / SAMPLE_HZ
  const n = steps / every + 1
  const pos = new Float32Array(n * 3)
  const quat = new Float32Array(n * 4)
  const p = new Vector3(...start)
  const v = new Vector3(...vel)
  const w = new Vector3(...spin)
  const q = new Quaternion()
  const dq = new Quaternion()
  const axis = new Vector3()
  const up = new Vector3()
  const target = new Vector3()
  const settle = new Quaternion()
  let sample = 0
  const keep = () => {
    pos.set([p.x, p.y, p.z], sample * 3)
    quat.set([q.x, q.y, q.z, q.w], sample * 4)
    sample += 1
  }
  keep()
  for (let step = 1; step <= steps; step += 1) {
    v.y -= GRAVITY * dt
    p.addScaledVector(v, dt)
    const speed = w.length()
    if (speed > 1e-6) {
      dq.setFromAxisAngle(axis.copy(w).divideScalar(speed), speed * dt)
      q.premultiply(dq).normalize()
    }
    up.set(0, 1, 0).applyQuaternion(q)
    const support = (CAN_H / 2) * Math.abs(up.y) + CAN_R * Math.sqrt(Math.max(0, 1 - up.y * up.y))
    const floor = onShelf(p.x, p.z) ? (p.y > -0.3 ? 0 : LOWER_Y) : -2.4
    if (p.y - support < floor) {
      p.y = floor + support
      if (v.y < 0) v.y = v.y < -0.5 ? -v.y * 0.22 : 0
      const rub = Math.exp(-3.2 * dt)
      v.x *= rub
      v.z *= rub
      w.multiplyScalar(Math.exp(-5 * dt))
      // Settle toward standing or lying on its side.
      if (Math.abs(up.y) > 0.72) target.set(0, Math.sign(up.y), 0)
      else target.set(up.x, 0, up.z).normalize()
      settle.setFromUnitVectors(up, target)
      dq.identity().slerp(settle, 1 - Math.exp(-9 * dt))
      q.premultiply(dq).normalize()
    }
    if (step % every === 0) keep()
  }
  return { t0, n, pos, quat }
}

const qa = new Quaternion()
const qb = new Quaternion()

/** Puts `obj` where the track has it at `vt`; false once it has fallen out of the picture. */
function placeOnTrack(obj: Object3D, tr: Track, vt: number): boolean {
  const s = clamp01((vt - tr.t0) / SIM_SECONDS) * (tr.n - 1)
  const i = Math.min(tr.n - 2, Math.floor(s))
  const f = s - i
  const a = i * 3
  const b = a + 3
  obj.position.set(
    tr.pos[a]! + (tr.pos[b]! - tr.pos[a]!) * f,
    tr.pos[a + 1]! + (tr.pos[b + 1]! - tr.pos[a + 1]!) * f,
    tr.pos[a + 2]! + (tr.pos[b + 2]! - tr.pos[a + 2]!) * f,
  )
  qa.fromArray(tr.quat, i * 4)
  qb.fromArray(tr.quat, i * 4 + 4)
  obj.quaternion.slerpQuaternions(qa, qb, f)
  return obj.position.y > -1.9
}

// ---------------------------------------------------------------- printed things (canvas textures, no words)

function paint(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
  if (g) draw(g)
  return canvas
}

function pill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const r = Math.min(h, w) / 2
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
  g.fill()
}

function fish(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, body: string, belly: string): void {
  g.fillStyle = body
  g.beginPath()
  g.moveTo(cx + size * 0.55, cy)
  g.lineTo(cx + size * 0.95, cy - size * 0.32)
  g.lineTo(cx + size * 0.88, cy)
  g.lineTo(cx + size * 0.95, cy + size * 0.32)
  g.closePath()
  g.fill()
  g.beginPath()
  g.ellipse(cx, cy, size * 0.62, size * 0.34, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = belly
  g.beginPath()
  g.ellipse(cx - size * 0.04, cy + size * 0.12, size * 0.5, size * 0.16, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.arc(cx - size * 0.36, cy - size * 0.07, size * 0.09, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#14202c'
  g.beginPath()
  g.arc(cx - size * 0.38, cy - size * 0.07, size * 0.05, 0, Math.PI * 2)
  g.fill()
}

/** The pyramid's cans: cat food, a fish on a deep blue label with a cream wave and gold rims. */
function fishLabel(): HTMLCanvasElement {
  return paint(512, 256, (g) => {
    const bg = g.createLinearGradient(0, 0, 0, 256)
    bg.addColorStop(0, '#24589a')
    bg.addColorStop(1, '#173c6e')
    g.fillStyle = bg
    g.fillRect(0, 0, 512, 256)
    g.fillStyle = '#f4ead6'
    g.beginPath()
    g.moveTo(0, 168)
    for (let x = 0; x <= 512; x += 8) g.lineTo(x, 168 + Math.sin(x / 26) * 7)
    g.lineTo(512, 256)
    g.lineTo(0, 256)
    g.closePath()
    g.fill()
    for (const cx of [128, 384]) {
      fish(g, cx, 98, 86, '#f08a3a', '#ffd9a8')
      g.fillStyle = '#e23b3b'
      pill(g, cx - 54, 196, 108, 22)
      g.fillStyle = '#f4ead6'
      pill(g, cx - 36, 228, 72, 10)
    }
    g.fillStyle = 'rgba(255,255,255,0.22)'
    for (let i = 0; i < 24; i += 1) {
      g.beginPath()
      g.arc(20 + i * 21, 30 + (i % 3) * 9, 3, 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = '#d8b35c'
    g.fillRect(0, 0, 512, 12)
    g.fillRect(0, 244, 512, 12)
  })
}

/** The teal cans: a cream paw print. */
function pawLabel(): HTMLCanvasElement {
  return paint(512, 256, (g) => {
    g.fillStyle = '#0f8f88'
    g.fillRect(0, 0, 512, 256)
    g.fillStyle = '#0b6d68'
    g.fillRect(0, 170, 512, 86)
    for (const cx of [128, 384]) {
      g.fillStyle = '#fbefd6'
      g.beginPath()
      g.ellipse(cx, 104, 40, 32, 0, 0, Math.PI * 2)
      g.fill()
      for (const [dx, dy] of [[-44, -40], [-15, -60], [15, -60], [44, -40]] as const) {
        g.beginPath()
        g.ellipse(cx + dx, 104 + dy, 13, 16, dx * 0.01, 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = '#ffd04a'
      pill(g, cx - 50, 192, 100, 20)
    }
    g.fillStyle = '#d9dde2'
    g.fillRect(0, 0, 512, 10)
    g.fillRect(0, 246, 512, 10)
  })
}

/** A cereal box front: a sunburst, a bowl of rings, a name bar with no words. */
function cerealFront(main: string, sun: string, bowl: string, dots: readonly string[]): HTMLCanvasElement {
  return paint(256, 320, (g) => {
    const bg = g.createLinearGradient(0, 0, 0, 320)
    bg.addColorStop(0, main)
    bg.addColorStop(1, bowl)
    g.fillStyle = bg
    g.fillRect(0, 0, 256, 320)
    g.fillStyle = sun
    g.globalAlpha = 0.35
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2
      g.beginPath()
      g.moveTo(128, 170)
      g.arc(128, 170, 220, a, a + 0.12)
      g.closePath()
      g.fill()
    }
    g.globalAlpha = 1
    g.beginPath()
    g.arc(128, 170, 62, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#fffaf0'
    pill(g, 28, 30, 200, 44)
    g.fillStyle = main
    pill(g, 44, 42, 120, 20)
    pill(g, 172, 42, 36, 20)
    const rnd = seeded(main.length * 97 + main.charCodeAt(1))
    for (let i = 0; i < 26; i += 1) {
      g.fillStyle = dots[i % dots.length]!
      g.beginPath()
      g.arc(60 + rnd() * 136, 206 + rnd() * 26, 9 + rnd() * 4, 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = '#f7f2ea'
    g.beginPath()
    g.ellipse(128, 236, 100, 30, 0, 0, Math.PI)
    g.fill()
    g.fillStyle = 'rgba(0,0,0,0.12)'
    g.beginPath()
    g.ellipse(128, 238, 100, 8, 0, 0, Math.PI)
    g.fill()
    g.fillStyle = '#ffffff'
    pill(g, 166, 282, 72, 22)
  })
}

/** Packaging marks over a product's own colour: the transparent parts show the instance colour. */
function packMarks(kind: 'box' | 'tin'): HTMLCanvasElement {
  return paint(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128)
    if (kind === 'box') {
      g.fillStyle = 'rgba(0,0,0,0.28)'
      g.fillRect(0, 0, 128, 22)
      g.fillStyle = '#fbf8f2'
      pill(g, 14, 34, 100, 22)
      g.beginPath()
      g.arc(64, 86, 20, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(0,0,0,0.25)'
      g.fillRect(0, 112, 128, 16)
    } else {
      g.fillStyle = '#c9ced6'
      g.fillRect(0, 0, 128, 8)
      g.fillRect(0, 120, 128, 8)
      g.fillStyle = '#fbf8f2'
      g.fillRect(0, 70, 128, 18)
      g.beginPath()
      g.arc(32, 44, 16, 0, Math.PI * 2)
      g.arc(96, 44, 16, 0, Math.PI * 2)
      g.fill()
    }
  })
}

/** The price channel on a shelf's front: a pale rail with yellow tags, bars where the barcode would be. */
function priceRail(): HTMLCanvasElement {
  return paint(512, 64, (g) => {
    g.fillStyle = '#e8ebee'
    g.fillRect(0, 0, 512, 64)
    g.fillStyle = 'rgba(0,0,0,0.12)'
    g.fillRect(0, 0, 512, 4)
    for (const x of [24, 152, 280, 408]) {
      g.fillStyle = x === 280 ? '#ff5a3c' : '#ffd43b'
      g.fillRect(x, 10, 84, 44)
      g.fillStyle = '#1d1f22'
      g.fillRect(x + 8, 16, 34, 18)
      for (let b = 0; b < 12; b += 1) g.fillRect(x + 48 + b * 2.6, 18, b % 3 ? 1 : 2, 18)
      g.fillRect(x + 8, 40, 64, 4)
    }
  })
}

/** A shelf talker sticking out into the aisle: a yellow burst on a red card. */
function talker(): HTMLCanvasElement {
  return paint(128, 128, (g) => {
    g.fillStyle = '#e8352f'
    g.fillRect(0, 0, 128, 128)
    g.fillStyle = '#ffd43b'
    g.beginPath()
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2
      const r = i % 2 ? 40 : 56
      g.lineTo(64 + Math.cos(a) * r, 58 + Math.sin(a) * r)
    }
    g.closePath()
    g.fill()
    g.fillStyle = '#e8352f'
    pill(g, 34, 46, 60, 24)
    g.fillStyle = '#ffffff'
    pill(g, 22, 104, 84, 14)
  })
}

/** Corrugated card for the overstock cartons: flutes, a printed band, arrows and a white label. */
function carton(band: string): HTMLCanvasElement {
  return paint(256, 256, (g) => {
    g.fillStyle = '#c49a68'
    g.fillRect(0, 0, 256, 256)
    for (let x = 0; x < 256; x += 5) {
      g.fillStyle = x % 10 ? 'rgba(90,60,30,0.07)' : 'rgba(255,240,210,0.07)'
      g.fillRect(x, 0, 2, 256)
    }
    g.fillStyle = band
    g.fillRect(0, 150, 256, 46)
    g.fillStyle = '#fbf6ec'
    pill(g, 22, 160, 90, 26)
    g.fillStyle = 'rgba(70,44,20,0.75)'
    for (const x of [176, 206]) {
      g.beginPath()
      g.moveTo(x, 36)
      g.lineTo(x + 12, 56)
      g.lineTo(x + 4, 56)
      g.lineTo(x + 4, 84)
      g.lineTo(x - 4, 84)
      g.lineTo(x - 4, 56)
      g.lineTo(x - 12, 56)
      g.closePath()
      g.fill()
    }
    g.fillStyle = '#f7f4ee'
    g.fillRect(24, 34, 104, 64)
    g.fillStyle = '#222'
    for (let b = 0; b < 26; b += 1) g.fillRect(32 + b * 3.4, 44, b % 4 ? 1.4 : 2.6, 30)
    g.fillRect(32, 82, 80, 5)
    g.fillStyle = 'rgba(225,205,160,0.55)'
    g.fillRect(0, 0, 256, 18)
  })
}

/** Powder-coated steel shelf panels: a seam where two panels meet, speckle, scuffs and faint rings where tins stood. */
function steel(): HTMLCanvasElement {
  return paint(512, 256, (g) => {
    g.fillStyle = '#e6e8eb'
    g.fillRect(0, 0, 512, 256)
    const rnd = seeded(5)
    for (let i = 0; i < 5200; i += 1) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(40,40,50,0.05)' : 'rgba(255,255,255,0.07)'
      g.fillRect(rnd() * 512, rnd() * 256, 1.5, 1.5)
    }
    const fade = g.createLinearGradient(0, 0, 0, 256)
    fade.addColorStop(0, 'rgba(120,124,132,0)')
    fade.addColorStop(1, 'rgba(120,124,132,0.1)')
    g.fillStyle = fade
    g.fillRect(0, 0, 512, 256)
    g.strokeStyle = 'rgba(70,72,82,0.1)'
    g.lineCap = 'round'
    for (let i = 0; i < 14; i += 1) {
      g.lineWidth = 1 + rnd() * 2
      g.beginPath()
      const x = rnd() * 512
      const y = rnd() * 256
      g.moveTo(x, y)
      g.lineTo(x + 20 + rnd() * 70, y + (rnd() - 0.5) * 10)
      g.stroke()
    }
    for (let i = 0; i < 7; i += 1) {
      g.strokeStyle = `rgba(110,96,80,${0.08 + rnd() * 0.08})`
      g.lineWidth = 2 + rnd() * 2
      g.beginPath()
      g.arc(30 + rnd() * 452, 30 + rnd() * 196, 15 + rnd() * 3, 0, Math.PI * 2)
      g.stroke()
    }
    g.fillStyle = 'rgba(60,62,70,0.32)'
    g.fillRect(0, 0, 3, 256)
    g.fillStyle = 'rgba(255,255,255,0.5)'
    g.fillRect(3, 0, 2, 256)
  })
}

/** A tin's lid: a pale rim, a pressed groove, rings in the panel and a pull ring. */
function canLid(): HTMLCanvasElement {
  return paint(128, 128, (g) => {
    g.fillStyle = '#9aa2ab'
    g.fillRect(0, 0, 128, 128)
    const ring = (r: number, width: number, colour: string) => {
      g.strokeStyle = colour
      g.lineWidth = width
      g.beginPath()
      g.arc(64, 64, r, 0, Math.PI * 2)
      g.stroke()
    }
    const panel = g.createRadialGradient(56, 54, 4, 64, 64, 56)
    panel.addColorStop(0, '#c3c9d0')
    panel.addColorStop(1, '#a3abb4')
    g.fillStyle = panel
    g.beginPath()
    g.arc(64, 64, 55, 0, Math.PI * 2)
    g.fill()
    ring(60, 6, '#d9dde2')
    ring(55, 2.5, '#6f7781')
    ring(40, 1.5, 'rgba(90,98,108,0.6)')
    ring(28, 1.5, 'rgba(90,98,108,0.5)')
    g.fillStyle = '#b9c0c8'
    g.strokeStyle = '#6f7781'
    g.lineWidth = 2
    g.beginPath()
    g.ellipse(64, 46, 15, 11, 0, 0, Math.PI * 2)
    g.fill()
    g.stroke()
    g.fillStyle = '#8b939c'
    g.beginPath()
    g.ellipse(64, 45, 7, 5, 0, 0, Math.PI * 2)
    g.fill()
    g.beginPath()
    g.arc(64, 64, 4, 0, Math.PI * 2)
    g.fill()
  })
}

/** Glass fridge doors from the inside: frames, lit shelves of bottles and cartons. */
function fridgeDoors(): HTMLCanvasElement {
  return paint(256, 512, (g) => {
    g.fillStyle = '#dff1ff'
    g.fillRect(0, 0, 256, 512)
    const rnd = seeded(41)
    const colours = ['#e8452f', '#2f7be0', '#f2c230', '#33a35c', '#f7f3ea', '#9b59d6', '#f07a2a']
    for (let shelf = 0; shelf < 5; shelf += 1) {
      const y = 70 + shelf * 88
      g.fillStyle = '#b9c7d2'
      g.fillRect(0, y + 52, 256, 6)
      for (let x = 10; x < 246;) {
        const w = 14 + rnd() * 14
        const h = 30 + rnd() * 22
        g.fillStyle = colours[Math.floor(rnd() * colours.length)]!
        g.fillRect(x, y + 52 - h, w, h)
        x += w + 3
      }
    }
    g.fillStyle = '#2a3038'
    g.fillRect(0, 0, 256, 16)
    g.fillRect(0, 496, 256, 16)
    g.fillRect(0, 0, 10, 512)
    g.fillRect(246, 0, 10, 512)
    g.fillRect(124, 0, 8, 512)
  })
}

/** The department banner over the fridges: a red band with pale shapes, no words. */
function banner(): HTMLCanvasElement {
  return paint(512, 64, (g) => {
    g.fillStyle = '#c9322d'
    g.fillRect(0, 0, 512, 64)
    g.fillStyle = '#fff4e3'
    for (const x of [30, 300]) {
      pill(g, x, 18, 150, 28)
      g.beginPath()
      g.arc(x + 190, 32, 16, 0, Math.PI * 2)
      g.fill()
    }
  })
}

/** A soft round shadow or glow. */
function softSpot(inner: string, outer: string): HTMLCanvasElement {
  return paint(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 62)
    r.addColorStop(0, inner)
    r.addColorStop(1, outer)
    g.fillStyle = r
    g.fillRect(0, 0, 128, 128)
  })
}

/** The cat's eye: a gold-green iris with fibres and a dark limbal ring. The pupil is drawn by the shader. */
function irisCanvas(): HTMLCanvasElement {
  return paint(256, 256, (g) => {
    g.fillStyle = '#eee5c2'
    g.fillRect(0, 0, 256, 256)
    const R = 108
    const grad = g.createRadialGradient(128, 128, 8, 128, 128, R)
    grad.addColorStop(0, '#d79a26')
    grad.addColorStop(0.32, '#cdb436')
    grad.addColorStop(0.72, '#a9c445')
    grad.addColorStop(1, '#6e9a33')
    g.fillStyle = grad
    g.beginPath()
    g.arc(128, 128, R, 0, Math.PI * 2)
    g.fill()
    const rnd = seeded(7)
    for (let i = 0; i < 240; i += 1) {
      const a = rnd() * Math.PI * 2
      const r0 = 16 + rnd() * 30
      const r1 = 66 + rnd() * 38
      g.strokeStyle = rnd() < 0.55 ? `rgba(255,240,170,${0.12 + rnd() * 0.2})` : `rgba(60,72,16,${0.1 + rnd() * 0.18})`
      g.lineWidth = 0.8 + rnd() * 1.6
      g.beginPath()
      g.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0)
      g.lineTo(128 + Math.cos(a) * r1, 128 + Math.sin(a) * r1)
      g.stroke()
    }
    g.strokeStyle = 'rgba(36,48,14,0.9)'
    g.lineWidth = 8
    g.beginPath()
    g.arc(128, 128, R - 3, 0, Math.PI * 2)
    g.stroke()
    const lid = g.createLinearGradient(0, 0, 0, 118)
    lid.addColorStop(0, 'rgba(40,24,6,0.6)')
    lid.addColorStop(1, 'rgba(40,24,6,0)')
    g.fillStyle = lid
    g.fillRect(0, 0, 256, 118)
  })
}

// ---------------------------------------------------------------- post: the aisle blur and the phone camera finish

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** Portrait-mode blur for the aisle: a golden-angle disc gather that favours bright points, so lights turn into discs. */
const BOKEH_FRAG = /* glsl */ `
uniform sampler2D tFar;
uniform vec2 texel;
uniform float radius;
varying vec2 vUv;
const vec3 HAZE = vec3(0.42, 0.47, 0.55);
void main() {
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 36; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / 36.0) * radius;
    float a = fi * 2.39996323;
    vec3 c = texture2D(tFar, vUv + vec2(cos(a), sin(a)) * r * texel).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float w = 1.0 + 5.0 * smoothstep(0.85, 2.6, l);
    acc += c * w;
    wsum += w;
  }
  // Air between the cat and the far aisle: a little darker, a little cooler and greyer, so the cat stands out.
  vec3 c = acc / wsum;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(l), 0.22);
  c = mix(c * 0.8, HAZE, 0.16);
  gl_FragColor = vec4(c, 1.0);
}
`

/** Phone camera finish in display order: colour fringing, vignette, a cool/warm split, ACES, sRGB, then grain. */
const FINISH_FRAG = /* glsl */ `
#include <common>
uniform sampler2D tMain;
uniform float seed;
uniform float grain;
#include <tonemapping_pars_fragment>
varying vec2 vUv;
float grainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d);
  vec2 ca = d * r2 * 0.02;
  vec3 c = vec3(texture2D(tMain, vUv + ca).r, texture2D(tMain, vUv).g, texture2D(tMain, vUv - ca).b);
  c *= mix(1.0, 0.58, smoothstep(0.06, 0.5, r2 * 1.7));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(vec3(0.95, 1.0, 1.06), vec3(1.04, 1.0, 0.95), smoothstep(0.03, 0.55, l));
  c = ACESFilmicToneMapping(c);
  vec4 o = sRGBTransferOETF(vec4(c, 1.0));
  float n = grainHash(gl_FragCoord.xy + seed * 61.7) - 0.5;
  o.rgb += n * grain * (1.0 - 0.6 * o.g);
  gl_FragColor = vec4(o.rgb, 1.0);
}
`

// ---------------------------------------------------------------- the scene

export function createCatStreamScene(canvas: HTMLCanvasElement): CatStreamScene | null {
  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'default' })
  } catch {
    return null
  }
  renderer.outputColorSpace = SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.setClearColor(0x30363c, 1)

  const geometries: BufferGeometry[] = []
  const materials: Material[] = []
  const textures: Texture[] = []
  const geo = <G extends BufferGeometry>(g: G): G => {
    geometries.push(g)
    return g
  }
  const keep = <M extends Material>(m: M): M => {
    materials.push(m)
    return m
  }
  const std = (color: number, roughness = 0.6, metalness = 0): MeshStandardMaterial =>
    keep(new MeshStandardMaterial({ color, roughness, metalness }))
  const glow = (color: number, strength: number): MeshBasicMaterial => {
    const m = keep(new MeshBasicMaterial({ color }))
    m.color.multiplyScalar(strength)
    return m
  }
  const tex = (c: HTMLCanvasElement, repeatX = 1, repeatY = 1): CanvasTexture => {
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 8
    if (repeatX !== 1 || repeatY !== 1) {
      t.wrapS = RepeatWrapping
      t.wrapT = RepeatWrapping
      t.repeat.set(repeatX, repeatY)
    }
    textures.push(t)
    return t
  }
  const printed = (t: Texture, roughness = 0.55): MeshStandardMaterial => keep(new MeshStandardMaterial({ map: t, roughness }))
  /** Marks over each instance's own colour (packMarks): where the marks are clear, the product colour shows. */
  const marked = (t: Texture, roughness = 0.55): MeshStandardMaterial => {
    const m = keep(new MeshStandardMaterial({ color: 0xffffff, roughness }))
    m.defines = { ...m.defines, USE_UV: '' }
    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.marks = { value: t }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D marks;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nvec4 mk = texture2D(marks, vUv);\ndiffuseColor.rgb = mix(diffuseColor.rgb, mk.rgb, mk.a);',
        )
    }
    m.customProgramCacheKey = () => `marks-${t.id}`
    return m
  }
  const furMat = (kind: number): MeshPhysicalMaterial => {
    const m = keep(
      new MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.8,
        sheen: 1,
        sheenRoughness: 0.42,
        sheenColor: new Color(C.furSheen),
      }),
    )
    // One program for every fur part: the pattern is picked by a uniform, so the GPU compiles the fur shader once.
    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.furKind = { value: kind }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFurP;\nvarying vec3 vFurN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurP = position;\nvFurN = normal;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FUR_GLSL}`)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= furColor(vFurP, normalize(vFurN));')
    }
    m.customProgramCacheKey = () => 'fur'
    return m
  }
  const add = (
    g: BufferGeometry,
    m: Material | Material[],
    parent: Object3D,
    at: V3 = [0, 0, 0],
    scale?: V3,
    rot?: V3,
    shadows = true,
  ): Mesh => {
    const mesh = new Mesh(g, m)
    mesh.position.set(...at)
    if (scale) mesh.scale.set(...scale)
    if (rot) mesh.rotation.set(...rot)
    mesh.castShadow = shadows
    mesh.receiveShadow = shadows
    parent.add(mesh)
    return mesh
  }

  // Image-based light: a soft studio room, for the tins' reflections and gentle fill everywhere.
  const pmrem = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const envRT = pmrem.fromScene(room, 0.04)
  room.dispose()
  pmrem.dispose()

  const scene = new Scene()
  scene.environment = envRT.texture
  scene.environmentIntensity = 0.5
  /** The phone's front camera: a wide lens, held out a little above the cat's eyes. Placed every frame. */
  const camera = new PerspectiveCamera(SELFIE_FOV, 940 / 800, 0.04, 80)

  // Light: the store's ceiling panel above the aisle (key, soft shadows), the phone screen on the cat's face, a warm rim
  // from the shelf lights behind and a cool one from the fridges.
  scene.add(new HemisphereLight(0xeef3ff, 0x6f6152, 0.45))
  const key = new DirectionalLight(0xfff3e4, 2.7)
  key.position.set(-1.8, 5, 3.4)
  key.target.position.set(0.3, 0.3, -0.3)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.left = -2.6
  key.shadow.camera.right = 2.8
  key.shadow.camera.top = 2.4
  key.shadow.camera.bottom = -1.8
  key.shadow.camera.near = 0.5
  key.shadow.camera.far = 14
  key.shadow.bias = -0.0003
  key.shadow.normalBias = 0.02
  key.shadow.radius = 4
  scene.add(key, key.target)
  const screenGlow = new PointLight(0xdce8ff, 1.5, 0, 2)
  scene.add(screenGlow)
  const rimWarm = new DirectionalLight(0xffb57a, 2.4)
  rimWarm.position.set(2.6, 3, -4)
  scene.add(rimWarm)
  const rimCool = new DirectionalLight(0x9fd2ff, 1.3)
  rimCool.position.set(-3.2, 2.2, -3)
  scene.add(rimCool)

  // ------------------------------------------------ the cat's shelf unit
  const unit = new Group()
  scene.add(unit)
  const steelTex = tex(steel(), SHELF_X * 0.5, 1.4)
  const shelfMat = keep(new MeshStandardMaterial({ color: C.shelf, map: steelTex, roughness: 0.48, metalness: 0.05 }))
  const railMat = printed(tex(priceRail(), SHELF_X * 1.6, 1), 0.35)
  add(geo(new BoxGeometry(SHELF_X * 2, 0.05, EDGE - BACK)), shelfMat, unit, [0, -0.025, (EDGE + BACK) / 2])
  const railGeo = geo(new BoxGeometry(SHELF_X * 2, 0.11, 0.03))
  for (const top of [0, LOWER_Y, -2.3]) {
    if (top !== 0) add(geo(new BoxGeometry(SHELF_X * 2, 0.05, 0.95)), shelfMat, unit, [0, top - 0.025, EDGE - 0.47])
    add(railGeo, [shelfMat, shelfMat, shelfMat, shelfMat, railMat, shelfMat], unit, [0, top - 0.055, EDGE + 0.015])
  }
  // The unit's dark back and base below the lower shelves, so the phone never looks into empty space.
  add(geo(new PlaneGeometry(SHELF_X * 2, 3.2)), std(0x3b434c, 0.85), unit, [0, -1.6, -0.6])
  add(geo(new BoxGeometry(SHELF_X * 2, 1.3, 0.03)), std(0x2f353c, 0.8), unit, [0, -3.0, EDGE - 0.02])
  // Talkers sticking out into the aisle.
  const talkerMat = keep(new MeshStandardMaterial({ map: tex(talker()), roughness: 0.5, side: 2 }))
  for (const x of [-1.05, 2.05]) add(geo(new PlaneGeometry(0.2, 0.2)), talkerMat, unit, [x, -0.13, EDGE + 0.12], undefined, [0, Math.PI / 2, 0])

  // The lower shelves: rows of goods, one instanced mesh per shape with its marks over each product's own colour.
  const goodsColors = [0xd9483a, 0x2f6fd0, 0xeeb43a, 0x3a9a5e, 0x7d55d6, 0xe8862e, 0x139c90, 0xe5ddcc, 0xcf4677]
  const boxGeo = geo(new BoxGeometry(1, 1, 1))
  const tinGeo = geo(new CylinderGeometry(1, 1, 1, 24))
  const boxMarks = tex(packMarks('box'))
  const tinMarks = tex(packMarks('tin'))
  const boxMat = marked(boxMarks)
  const tinMat = marked(tinMarks, 0.4)
  const color = new Color()
  const placeGoods = (parent: Object3D, top: number, seed: number, from: number, to: number, front: number, scale = 1) => {
    const boxes: Matrix4[] = []
    const tins: Matrix4[] = []
    const boxColors: number[] = []
    const tinColors: number[] = []
    const rnd = seeded(seed)
    for (let x = from; x < to;) {
      const c = goodsColors[Math.floor(rnd() * goodsColors.length)]!
      if (rnd() < 0.6) {
        const w = (0.28 + rnd() * 0.14) * scale
        const h = (0.42 + rnd() * 0.32) * scale
        const facings = 1 + Math.floor(rnd() * 3)
        for (let f = 0; f < facings && x < to; f += 1) {
          boxes.push(new Matrix4().compose(new Vector3(x + w / 2, top + h / 2, front - 0.13 * scale + rnd() * 0.03), new Quaternion(), new Vector3(w, h, 0.22 * scale)))
          boxColors.push(c)
          x += w + 0.025 * scale
        }
      } else {
        const h = (0.24 + rnd() * 0.14) * scale
        const r = 0.085 * scale
        for (let k = 0; k < 3; k += 1) {
          tins.push(new Matrix4().compose(new Vector3(x + r + k * 2.1 * r, top + h / 2, front - r - 0.02 + rnd() * 0.02), new Quaternion(), new Vector3(r, h, r)))
          tinColors.push(c)
        }
        x += 6.3 * r + 0.03
      }
    }
    const instanced = (g: BufferGeometry, m: Material, list: Matrix4[], colors: number[]) => {
      const mesh = new InstancedMesh(g, m, list.length)
      list.forEach((mx, i) => {
        mesh.setMatrixAt(i, mx)
        mesh.setColorAt(i, color.setHex(colors[i]!))
      })
      mesh.castShadow = true
      mesh.receiveShadow = true
      parent.add(mesh)
    }
    instanced(boxGeo, boxMat, boxes, boxColors)
    instanced(tinGeo, tinMat, tins, tinColors)
  }
  placeGoods(unit, LOWER_Y, 29, -SHELF_X + 0.2, SHELF_X - 0.2, EDGE - 0.02)
  placeGoods(unit, -2.3, 53, -SHELF_X + 0.2, SHELF_X - 0.2, EDGE - 0.02)

  // Goods on the cat's shelf, each with its own print.
  const metal = keep(new MeshStandardMaterial({ color: 0xd3d8de, roughness: 0.28, metalness: 1, envMapIntensity: 0.85 }))
  const tinLid = keep(new MeshStandardMaterial({ map: tex(canLid()), roughness: 0.34, metalness: 1, envMapIntensity: 0.75 }))
  const fishSide = printed(tex(fishLabel()), 0.42)
  const pawSide = printed(tex(pawLabel()), 0.42)
  const canBody = geo(new CylinderGeometry(CAN_R, CAN_R, CAN_H, 40))
  const canRim = geo(new TorusGeometry(CAN_R - 0.004, 0.006, 6, 40))
  canRim.rotateX(Math.PI / 2)
  const makeCan = (side: Material): Mesh => {
    const mesh = new Mesh(canBody, [side, tinLid, tinLid])
    mesh.castShadow = true
    mesh.receiveShadow = true
    for (const y of [CAN_H / 2, -CAN_H / 2]) {
      const rim = new Mesh(canRim, metal)
      rim.position.y = y
      mesh.add(rim)
    }
    unit.add(mesh)
    return mesh
  }
  const cereal = (front: HTMLCanvasElement, sideColor: number, at: V3, size: V3, yaw = 0) => {
    const s = std(sideColor, 0.55)
    add(geo(new BoxGeometry(...size)), [s, s, s, s, printed(tex(front)), s], unit, at, undefined, [0, yaw, 0])
  }
  cereal(cerealFront('#f28b24', '#ffd23f', '#c2410c', ['#e23b3b', '#3b82f6', '#22c55e', '#fde047']), 0xd9741c, [-1.3, 0.33, -0.3], [0.42, 0.66, 0.16], 0.06)
  cereal(cerealFront('#2f6fd6', '#9cc7ff', '#1e3a8a', ['#f8fafc', '#fde68a']), 0x2658b0, [-1.78, 0.3, -0.31], [0.4, 0.6, 0.16], -0.04)
  cereal(cerealFront('#3aa565', '#fef3c7', '#166534', ['#f97316', '#fde047', '#fff7ed']), 0x2f8a52, [-2.25, 0.31, -0.3], [0.4, 0.62, 0.16], 0.03)
  cereal(cerealFront('#8b5cf6', '#fde68a', '#5b21b6', ['#f472b6', '#fde047', '#60a5fa']), 0x7445d8, [1.92, 0.3, -0.3], [0.4, 0.6, 0.16], -0.05)
  cereal(cerealFront('#e4573d', '#fff7ed', '#9a3412', ['#fde047', '#fff7ed']), 0xc4442d, [2.4, 0.33, -0.3], [0.42, 0.66, 0.16], 0.04)
  cereal(cerealFront('#14a3a3', '#cffafe', '#0e5e6f', ['#f97316', '#fde047']), 0x108787, [2.88, 0.31, -0.29], [0.4, 0.62, 0.16], -0.02)
  // A honey jar and a green bottle on the left.
  const jar = keep(new MeshPhysicalMaterial({ color: 0xe39a2c, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 }))
  add(geo(new CylinderGeometry(0.085, 0.085, 0.2, 32)), jar, unit, [-0.98, 0.1, 0.12])
  add(geo(new CylinderGeometry(0.09, 0.09, 0.05, 32)), std(0x6b4a2b, 0.5, 0.2), unit, [-0.98, 0.225, 0.12])
  const bottle = keep(new MeshPhysicalMaterial({ color: 0x2f8f5f, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }))
  add(geo(new CylinderGeometry(0.07, 0.075, 0.3, 32)), bottle, unit, [-1.55, 0.15, 0.14])
  add(geo(new CylinderGeometry(0.03, 0.06, 0.12, 32)), bottle, unit, [-1.55, 0.36, 0.14])
  add(geo(new CylinderGeometry(0.032, 0.032, 0.04, 24)), std(0xf3f4f6, 0.4), unit, [-1.55, 0.44, 0.14])
  add(geo(new CylinderGeometry(0.0755, 0.0755, 0.1, 32, 1, true)), printed(tex(cerealFront('#f5efe2', '#2f8f5f', '#f5efe2', ['#2f8f5f']))), unit, [-1.55, 0.13, 0.14])
  for (const [x, z] of [[1.42, -0.32], [1.62, -0.32], [1.52, -0.14], [3.3, -0.12], [3.5, -0.12], [3.4, -0.3]] as const) {
    const can = makeCan(pawSide)
    can.position.set(x, CAN_H / 2, z)
    can.rotation.y = x * 2.3
  }

  const canA = makeCan(fishSide)
  const pyramid = PYRAMID.map((at, i) => {
    const can = makeCan(fishSide)
    can.position.set(...at)
    can.rotation.y = i * 0.9
    return can
  })
  const pyramidYaw = pyramid.map((c) => c.rotation.y)

  // Overstock cartons on the back half of the shelf top, behind the cat.
  const cartonBlue = keep(new MeshStandardMaterial({ map: tex(carton('#2f6fb0')), roughness: 0.88 }))
  const cartonRed = keep(new MeshStandardMaterial({ map: tex(carton('#c8402f')), roughness: 0.88 }))
  for (const [m, at, size, yaw] of [
    [cartonBlue, [-1.05, 0.36, -1.1], [1.1, 0.72, 0.75], 0.04],
    [cartonRed, [0.2, 0.3, -1.3], [0.95, 0.6, 0.6], -0.05],
    [cartonRed, [2.55, 0.42, -1.15], [1.0, 0.84, 0.8], 0.07],
    [cartonBlue, [2.5, 1.0, -1.2], [0.62, 0.32, 0.5], -0.12],
    [cartonBlue, [-2.35, 0.3, -1.12], [0.9, 0.6, 0.7], -0.03],
    [cartonRed, [4.1, 0.36, -1.1], [1.0, 0.72, 0.75], 0.02],
  ] as const) {
    add(geo(new BoxGeometry(...size)), m, unit, at, undefined, [0, yaw, 0])
  }
  // An open tray of cans behind the pyramid.
  const tray = new Group()
  tray.position.set(1.35, 0, -1.05)
  tray.rotation.y = 0.06
  unit.add(tray)
  add(geo(new BoxGeometry(0.86, 0.16, 0.6)), cartonBlue, tray, [0, 0.08, 0])
  for (let i = 0; i < 8; i += 1) {
    const can = makeCan(i % 2 ? pawSide : fishSide)
    unit.remove(can)
    tray.add(can)
    can.position.set(-0.32 + (i % 4) * 0.21, CAN_H / 2 + 0.01, -0.12 + Math.floor(i / 4) * 0.24)
    can.rotation.y = i * 1.3
  }

  // Soft contact shadows under the cat and the pyramid.
  const spot = tex(softSpot('rgba(20,12,6,0.62)', 'rgba(20,12,6,0)'))
  const contactMat = keep(new MeshBasicMaterial({ map: spot, transparent: true, depthWrite: false }))
  const contact = add(geo(new PlaneGeometry(1, 1)), contactMat, unit, [0, 0.003, -0.09], [1.0, 0.78, 1], [-Math.PI / 2, 0, 0], false)
  const pyramidShadowMat = keep(new MeshBasicMaterial({ map: spot, transparent: true, depthWrite: false, opacity: 0.8 }))
  const pyramidShadow = add(geo(new PlaneGeometry(1, 1)), pyramidShadowMat, unit, [0.915, 0.003, PYR_Z], [0.7, 0.32, 1], [-Math.PI / 2, 0, 0], false)
  void contact

  const knockTrack = simulate(KNOCK_S, CAN_A_DROP, [0.08, 0, 0.42], [7, 0.4, 0.6])
  const shoveTracks = PYRAMID.map((at, i) => simulate(SHOVE_S, at, PYRAMID_KICK[i]![0], PYRAMID_KICK[i]![1]))

  // ------------------------------------------------ the cat
  const cat = new Group()
  cat.position.set(0, 0, -0.06)
  scene.add(cat)

  const torso = new Group()
  torso.rotation.x = -0.06
  cat.add(torso)
  add(geo(sculpt(BODY, BODY_CENTER, 96, 72, 0.8)), furMat(1), torso)

  // Head: one sculpted shape, eyes in sockets, a wet nose, a small mouth and whiskers.
  const head = new Group()
  head.rotation.order = 'YXZ'
  head.position.set(0, 0.83, 0.03)
  cat.add(head)
  add(geo(sculpt(HEAD, HEAD_CENTER, 96, 72, 0.7)), furMat(0), head)

  const noseGeo = geo(new SphereGeometry(1, 32, 20))
  {
    const p = noseGeo.getAttribute('position')
    for (let i = 0; i < p.count; i += 1) p.setX(i, p.getX(i) * (1 + 0.42 * p.getY(i)))
    noseGeo.computeVertexNormals()
  }
  const noseAt = onSurface(HEAD, HEAD_CENTER, [0, 0.128, 0.31], -0.012)
  add(noseGeo, keep(new MeshPhysicalMaterial({ color: C.nose, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.2 })), head, [noseAt.x, noseAt.y, noseAt.z], [0.042, 0.029, 0.03], [0.25, 0, 0])

  const line = (points: readonly V3[], radius: number, m: Material, parent: Object3D, lift: number) => {
    const curve = new CatmullRomCurve3(points.map((p) => onSurface(HEAD, HEAD_CENTER, p, lift)))
    return add(geo(new TubeGeometry(curve, 24, radius, 5)), m, parent, undefined, undefined, undefined, false)
  }
  const mouthMat = std(C.mouth, 0.6)
  line([[0, 0.1, 0.31], [0, 0.083, 0.31], [0, 0.068, 0.31]], 0.004, mouthMat, head, 0.001)
  line([[-0.05, 0.064, 0.29], [-0.026, 0.056, 0.3], [0, 0.068, 0.31], [0.026, 0.056, 0.3], [0.05, 0.064, 0.29]], 0.0042, mouthMat, head, 0.001)

  const whiskerMat = std(C.whisker, 0.35)
  const whiskers: Group[] = []
  for (const s of [-1, 1]) {
    const side = new Group()
    side.position.set(s * 0.06, 0.07, 0.27)
    head.add(side)
    for (let k = 0; k < 3; k += 1) {
      const pts = [
        new Vector3(0, -k * 0.015, 0.01),
        new Vector3(s * 0.14, 0.02 - k * 0.03, 0.03),
        new Vector3(s * 0.28, 0.01 - k * 0.06, 0.0),
        new Vector3(s * 0.4, -0.02 - k * 0.09, -0.05),
      ]
      add(geo(new TubeGeometry(new CatmullRomCurve3(pts), 20, 0.0024, 4)), whiskerMat, side, undefined, undefined, undefined, false)
    }
    for (let k = 0; k < 2; k += 1) {
      const brow = [
        new Vector3(s * (0.05 + k * 0.03), 0.2, -0.02),
        new Vector3(s * (0.1 + k * 0.04), 0.27, 0.0),
        new Vector3(s * (0.16 + k * 0.05), 0.31, -0.03),
      ]
      add(geo(new TubeGeometry(new CatmullRomCurve3(brow), 12, 0.0018, 4)), whiskerMat, side, undefined, undefined, undefined, false)
    }
    whiskers.push(side)
  }

  // Eyes: a glossy iris on a sphere that turns to look, a dark rim around each socket and an upper lid that blinks.
  const irisTex = tex(irisCanvas())
  const pupil = { value: 0.1 }
  const eyeMat = keep(new MeshPhysicalMaterial({ map: irisTex, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03 }))
  eyeMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.pupilW = pupil
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float pupilW;')
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\nfloat pd = length((vMapUv - 0.5) / vec2(pupilW, 0.33));\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.004, 0.003, 0.002), 1.0 - smoothstep(0.88, 1.04, pd));',
      )
  }
  eyeMat.customProgramCacheKey = () => 'cat-eye'
  const EYE_R = 0.066
  const eyeGeo = geo(new SphereGeometry(EYE_R, 48, 32))
  {
    const p = eyeGeo.getAttribute('position')
    const uv = eyeGeo.getAttribute('uv')
    for (let i = 0; i < p.count; i += 1) uv.setXY(i, p.getX(i) / (EYE_R * 2) + 0.5, p.getY(i) / (EYE_R * 2) + 0.5)
  }
  const linerMat = std(C.liner, 0.45)
  const lidGeo = geo(new SphereGeometry(0.0705, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2))
  const lidEdgeGeo = geo(new TorusGeometry(0.0705, 0.0055, 8, 56))
  lidEdgeGeo.rotateX(Math.PI / 2)
  const lidMat = furMat(5)
  const eyeballs: Mesh[] = []
  const lids: Group[] = []
  const sockets: Group[] = []
  for (const s of [-1, 1]) {
    // Set into the face: the socket squashes the eye front to back, so it sits in the head instead of bulging out
    // when the cat turns; the dark rim round it is painted in the head's fur.
    const socket = new Group()
    socket.position.set(s * 0.112, 0.19, 0.205)
    socket.rotation.set(-0.09, s * 0.33, 0, 'YXZ')
    socket.scale.set(1, 1, 0.78)
    head.add(socket)
    const ball = add(eyeGeo, eyeMat, socket, undefined, undefined, undefined, false)
    ball.rotation.order = 'YXZ'
    const lid = new Group()
    socket.add(lid)
    add(lidGeo, lidMat, lid, undefined, undefined, undefined, false)
    add(lidEdgeGeo, linerMat, lid, undefined, undefined, undefined, false)
    eyeballs.push(ball)
    lids.push(lid)
    sockets.push(socket)
  }

  // Ears: soft rounded cones with a pink inside.
  const earProfile = [[0, 0], [0.118, 0], [0.123, 0.02], [0.113, 0.07], [0.09, 0.13], [0.058, 0.19], [0.026, 0.236], [0.008, 0.252], [0, 0.255]]
  const earGeo = geo(new LatheGeometry(earProfile.map(([r, y]) => new Vector2(r!, y!)), 40))
  earGeo.scale(1, 1, 0.42)
  const earInGeo = geo(new LatheGeometry(earProfile.map(([r, y]) => new Vector2(r! * 0.7, y! * 0.84)), 40))
  earInGeo.scale(1, 1, 0.26)
  const earOut = furMat(7)
  const earIn = keep(new MeshStandardMaterial({ color: C.earIn, roughness: 0.7 }))
  const ears: Group[] = []
  for (const s of [-1, 1]) {
    const ear = new Group()
    ear.position.set(s * 0.17, 0.33, -0.02)
    head.add(ear)
    add(earGeo, earOut, ear)
    add(earInGeo, earIn, ear, [0, 0.022, 0.024], undefined, undefined, false)
    ears.push(ear)
  }

  // Tail: a ringed chain of segments lying on the shelf, around the cat's right side.
  const TAIL = 8
  const TAIL_LEN = 0.13
  const tailRoot = new Group()
  tailRoot.position.set(-0.12, 0.07, -0.31)
  cat.add(tailRoot)
  const tailSegs: Group[] = []
  const tailScaled: Mesh[] = []
  const tailFur = furMat(3)
  const jointFur = furMat(5)
  const jointGeo = geo(new SphereGeometry(1, 24, 16))
  let parent: Object3D = tailRoot
  for (let i = 0; i < TAIL; i += 1) {
    const seg = new Group()
    if (i > 0) seg.position.z = TAIL_LEN
    parent.add(seg)
    const r0 = 0.074 - i * 0.004
    const g = geo(new CylinderGeometry(r0 - 0.004, r0, TAIL_LEN, 24, 1, true))
    g.rotateX(Math.PI / 2)
    g.translate(0, 0, TAIL_LEN / 2)
    tailScaled.push(add(g, tailFur, seg))
    tailScaled.push(add(jointGeo, jointFur, seg, [0, 0, 0], [r0, r0, r0]))
    tailSegs.push(seg)
    parent = seg
  }
  add(jointGeo, furMat(6), parent, [0, 0, TAIL_LEN + 0.012], [0.048, 0.048, 0.054])

  // Legs: a shoulder pivot, a tapered ringed leg and a cream paw with toes that goes where it is told.
  const legGeo = geo(new CylinderGeometry(0.076, 0.062, 1, 24, 1, true))
  legGeo.translate(0, -0.5, 0)
  const legFur = furMat(2)
  const pawFur = furMat(4)
  const pawGeo = geo(new SphereGeometry(1, 32, 22))
  interface Leg { pivot: Group; leg: Mesh; paw: Mesh; shoulder: Vector3 }
  const makeLeg = (x: number): Leg => {
    const pivot = new Group()
    const shoulder = new Vector3(x, 0.6, 0.09)
    pivot.position.copy(shoulder)
    cat.add(pivot)
    const leg = add(legGeo, legFur, pivot)
    const paw = add(pawGeo, pawFur, cat, [0, 0, 0], [0.08, 0.058, 0.094])
    return { pivot, leg, paw, shoulder }
  }
  const phoneLeg = makeLeg(-0.2)
  const knockLeg = makeLeg(0.2)
  const down = new Vector3(0, -1, 0)
  const tmpDir = new Vector3()
  /** `worldTarget` is a world point; the cat's matrix must be current. */
  const pose = (l: Leg, worldTarget: Vector3) => {
    const t = cat.worldToLocal(worldTarget)
    tmpDir.copy(t).sub(l.shoulder)
    const len = tmpDir.length()
    tmpDir.divideScalar(len || 1)
    l.pivot.quaternion.setFromUnitVectors(down, tmpDir)
    l.leg.scale.set(1, Math.max(0.1, len - 0.03), 1)
    l.paw.position.copy(t)
    l.paw.quaternion.copy(l.pivot.quaternion)
  }

  // There is no phone in the picture: the picture is the phone. It sits on a selfie stick; the right paw holds the
  // rubber grip in front of the chest and the stick runs out of the bottom of the picture up to the phone.
  const stickPivot = new Group()
  scene.add(stickPivot)
  const stickGeo = geo(new CylinderGeometry(0.0095, 0.012, 1, 16))
  stickGeo.translate(0, 0.5, 0)
  const stick = add(stickGeo, std(0x1a1c21, 0.32, 0.75), stickPivot)
  stick.castShadow = false
  const grip = std(0x22252b, 0.85)
  add(geo(new CylinderGeometry(0.031, 0.029, 0.18, 24)), grip, stickPivot, [0, 0.03, 0])
  for (let k = 0; k < 4; k += 1) add(geo(new TorusGeometry(0.031, 0.004, 6, 24)), grip, stickPivot, [0, -0.03 + k * 0.04, 0], undefined, [Math.PI / 2, 0, 0])
  /** The handle, in the cat's own space, and where the stick meets the phone, in the camera's: just below the lens. */
  const HANDLE = new Vector3(-0.25, 0.68, 0.48)
  const MOUNT = new Vector3(0, -0.15, 0.02)
  const up = new Vector3(0, 1, 0)

  // ------------------------------------------------ the aisle behind (its own scene, blurred)
  const far = new Scene()
  far.environment = envRT.texture
  far.environmentIntensity = 0.45
  far.add(new HemisphereLight(0xf2f6ff, 0x6a6f76, 1.5))
  const farKey = new DirectionalLight(0xffffff, 1.3)
  farKey.position.set(2, 10, 4)
  far.add(farKey)
  add(geo(new PlaneGeometry(120, 120)), std(0xb7bcc0, 0.32), far, [10, FLOOR_Y, -20], undefined, [-Math.PI / 2, 0, 0], false)
  // The next unit across the aisle, facing the cat: shelves of goods, yellow tags, light strips under each shelf.
  const nextUnit = new Group()
  far.add(nextUnit)
  const backPanel = std(0x3a4450, 0.85)
  const UNIT_FROM = -18
  const UNIT_TO = 7.6
  const unitW = UNIT_TO - UNIT_FROM
  const unitMid = (UNIT_FROM + UNIT_TO) / 2
  for (const z0 of [NEXT_FACE_Z, NEXT_FACE_Z - 7.6, NEXT_FACE_Z - 15.2]) {
    add(geo(new PlaneGeometry(unitW, 9)), backPanel, nextUnit, [unitMid, FLOOR_Y + 4.5, z0 - 1.8], undefined, undefined, false)
    add(geo(new BoxGeometry(0.1, 9, 3.6)), std(0x1f6b57, 0.6), nextUnit, [UNIT_TO + 0.05, FLOOR_Y + 4.5, z0 - 1.8], undefined, undefined, false)
    add(geo(new BoxGeometry(0.12, 0.9, 3.4)), glow(0xffe08a, 1.6), nextUnit, [UNIT_TO + 0.1, FLOOR_Y + 9.4, z0 - 1.8], undefined, undefined, false)
    // An end display of drink cases on each unit's end.
    const rnd = seeded(Math.round(-z0 * 10))
    for (let k = 0; k < 9; k += 1) {
      const c = [0xc8322f, 0x2557a8, 0xf2b632, 0x2f9a5a][k % 4]!
      add(boxGeo, std(c, 0.5), nextUnit, [UNIT_TO + 0.75, FLOOR_Y + 0.45 + Math.floor(k / 3) * 0.9, z0 - 0.6 - (k % 3) * 1.15 - rnd() * 0.05], [1.2, 0.86, 1.1], undefined, false)
    }
  }
  const shelfFront = std(0xdfe3e7, 0.5)
  const ledMat = glow(0xf2f7ff, 3.2)
  const farRail = printed(tex(priceRail(), unitW * 0.9, 1), 0.4)
  for (let level = 0; level < 6; level += 1) {
    const y = FLOOR_Y + 0.4 + level * 1.4
    add(geo(new BoxGeometry(unitW, 0.06, 1.8)), shelfFront, nextUnit, [unitMid, y - 0.03, NEXT_FACE_Z - 0.9], undefined, undefined, false)
    add(geo(new BoxGeometry(unitW, 0.14, 0.04)), [shelfFront, shelfFront, shelfFront, shelfFront, farRail, shelfFront], nextUnit, [unitMid, y - 0.07, NEXT_FACE_Z + 0.02], undefined, undefined, false)
    add(geo(new BoxGeometry(unitW, 0.03, 0.03)), ledMat, nextUnit, [unitMid, y + 1.3, NEXT_FACE_Z - 0.04], undefined, undefined, false)
    placeGoods(nextUnit, y, 101 + level * 7, UNIT_FROM, UNIT_TO - 0.2, NEXT_FACE_Z - 0.05, 2.1)
  }
  // The cross aisle: a wall of fridges glowing cool, a red department band over them, a light pool on the floor.
  const fridgeTex = tex(fridgeDoors(), 20, 1)
  const fridgeMat = keep(new MeshBasicMaterial({ map: fridgeTex }))
  fridgeMat.color.setScalar(2.2)
  add(geo(new PlaneGeometry(76, 7.6)), fridgeMat, far, [24, FLOOR_Y + 3.8, -14], undefined, [0, -Math.PI / 2, 0], false)
  add(geo(new PlaneGeometry(76, 0.9)), keep(new MeshBasicMaterial({ map: tex(banner(), 14, 1), color: new Color(1.6, 1.6, 1.6) })), far, [23.9, 1.9, -14], undefined, [0, -Math.PI / 2, 0], false)
  add(geo(new PlaneGeometry(76, 12)), std(0x5b636c, 0.9), far, [24.05, 8.4, -14], undefined, [0, -Math.PI / 2, 0], false)
  const poolMat = keep(new MeshBasicMaterial({ map: tex(softSpot('rgba(160,215,255,0.5)', 'rgba(160,215,255,0)')), transparent: true, blending: AdditiveBlending, depthWrite: false }))
  add(geo(new PlaneGeometry(14, 60)), poolMat, far, [19, FLOOR_Y + 0.02, -14], undefined, [-Math.PI / 2, 0, 0], false)
  // A shopper walking the cross aisle.
  const shopper = new Group()
  far.add(shopper)
  const coat = std(0x3d5a8a, 0.7)
  add(geo(new CapsuleGeometry(0.8, 2.2, 6, 16)), coat, shopper, [0, 4.6, 0], undefined, undefined, false)
  add(geo(new SphereGeometry(0.55, 20, 14)), std(0xc99572, 0.6), shopper, [0, 6.6, 0], undefined, undefined, false)
  add(geo(new SphereGeometry(0.58, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55)), std(0x2b1d14, 0.8), shopper, [0, 6.68, -0.04], undefined, undefined, false)
  const shopperLegs = [-1, 1].map((s) => {
    const hip = new Group()
    hip.position.set(s * 0.38, 3.3, 0)
    shopper.add(hip)
    add(geo(new CapsuleGeometry(0.32, 2.6, 4, 12)), std(0x262c35, 0.8), hip, [0, -1.6, 0], undefined, undefined, false)
    return hip
  })

  // ------------------------------------------------ render targets and post
  const caps = renderer.capabilities
  const hdr = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float')
  const type = hdr ? HalfFloatType : UnsignedByteType
  const mainRT = new WebGLRenderTarget(1, 1, { type, samples: Math.min(4, caps.maxSamples) })
  const farRT = new WebGLRenderTarget(1, 1, { type })
  const blurRT = new WebGLRenderTarget(1, 1, { type })
  scene.background = blurRT.texture
  const bokehMat = keep(
    new ShaderMaterial({
      uniforms: { tFar: { value: farRT.texture }, texel: { value: new Vector2(1, 1) }, radius: { value: 5 } },
      vertexShader: QUAD_VERT,
      fragmentShader: BOKEH_FRAG,
      depthTest: false,
      depthWrite: false,
    }),
  )
  const finishMat = keep(
    new ShaderMaterial({
      uniforms: {
        tMain: { value: mainRT.texture },
        toneMappingExposure: { value: 0.95 },
        seed: { value: 0 },
        grain: { value: 0.035 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: FINISH_FRAG,
      depthTest: false,
      depthWrite: false,
    }),
  )
  const bokehQuad = new FullScreenQuad(bokehMat)
  const finishQuad = new FullScreenQuad(finishMat)

  // ------------------------------------------------ poses over time

  const REST: V3 = [0.17, 0.05, 0.24]
  /** The knocking paw, in world space: behind can A as it slides to the edge, then taps and shoves the pyramid. */
  const TOUCH: V3 = [0.62, 0.42, -0.03]
  const knockPaw: readonly Key<V3>[] = [
    [118.9, REST], [119.55, [0.4, 0.22, 0.07]], [120.0, [0.41, 0.2, 0.08]],
    [KNOCK_S, [0.42, 0.19, 0.3]], [121.2, [0.43, 0.22, 0.31]], [121.8, REST],
    [5815.95, REST], [5816.55, TOUCH],
    [5816.95, TOUCH], [5817.05, [0.68, 0.42, -0.03]], [5817.2, TOUCH],
    [5818.45, TOUCH], [5818.55, [0.69, 0.42, -0.03]], [5818.72, TOUCH],
    [5819.1, TOUCH], [5819.55, [0.52, 0.44, -0.06]], [5819.8, [0.77, 0.36, 0.05]],
    [5820.3, [0.78, 0.37, 0.06]], [5820.95, REST],
  ]
  /** How far the cat leans toward what it is reaching for (radians, to the right). */
  const lean: readonly Key<number>[] = [
    [119.0, 0], [119.55, 0.1], [121.2, 0.1], [121.8, 0],
    [5815.95, 0], [5816.55, 0.12], [5819.1, 0.12], [5819.55, 0.07], [5819.8, 0.2], [5820.3, 0.18], [5820.95, 0],
  ]
  /**
   * Head yaw (+ toward the cat's left), pitch (+ down) and roll. AT_PHONE looks into the lens and is worked out each
   * frame from where the phone is; the others look at the can at the edge, the pyramid and the falling cans.
   */
  const AT_PHONE: [number, number, number] = [0, 0, 0.08]
  const AT_DROP: V3 = [0.34, 0.36, -0.06]
  const AT_PYR: V3 = [0.46, 0.14, -0.04]
  const AT_FALL: V3 = [0.44, 0.32, -0.08]
  const look: readonly Key<V3>[] = [
    [120.7, AT_PHONE], [120.8, AT_DROP], [121.75, AT_DROP], [122.25, AT_PHONE],
    [5815.3, AT_PYR], [5815.7, AT_PHONE], [5816.3, AT_PHONE], [5816.6, AT_PYR], [5817.6, AT_PYR], [5817.9, AT_PHONE],
    [5818.2, AT_PHONE], [5818.4, AT_PYR], [5818.9, AT_PYR], [5819.1, AT_PHONE], [5819.82, AT_PHONE], [5819.95, AT_FALL],
    [5821.4, AT_FALL], [5821.9, AT_PHONE],
  ]
  /** What the eyes are on: 0 the lens, 1 can A, 2 the pyramid, 3 the falling cans. */
  const gazeAt: readonly Key<number>[] = [
    [120.66, 0], [120.7, 1], [121.75, 1], [122.1, 0],
    [5815.2, 2], [5815.6, 0], [5816.35, 0], [5816.5, 2], [5817.6, 2], [5817.8, 0],
    [5818.25, 0], [5818.35, 2], [5818.9, 2], [5819.05, 0], [5819.85, 0], [5819.9, 3],
    [5821.4, 3], [5821.8, 0],
  ]
  const earsBack: readonly Key<number>[] = [[5819.95, 0], [5820.1, 1], [5820.6, 1], [5821.2, 0]]
  const puff: readonly Key<number>[] = [[5819.95, 1], [5820.15, 1.42], [5820.8, 1.3], [5821.8, 1]]
  /** The upper lids: open, a smug half-close at chat after the first can goes, wide when the pyramid falls. */
  const lidOpen: readonly Key<number>[] = [
    [121.9, -0.66], [122.3, 0.02], [123.5, 0.02], [124.0, -0.66],
    [5819.9, -0.66], [5820.0, -0.86], [5821.0, -0.86], [5821.6, -0.66],
  ]
  /** Pupils widen with excitement. */
  const pupilW: readonly Key<number>[] = [
    [119.4, 0.1], [120.5, 0.25], [121.7, 0.25], [122.6, 0.12],
    [5815.6, 0.12], [5819.6, 0.12], [5819.95, 0.3], [5821.3, 0.3], [5822.2, 0.13],
  ]

  /** The phone swings a little toward what falls, the way a streamer shows chat the mess. */
  const aim: readonly Key<V3>[] = [
    [119.2, AIM], [119.9, AIM_EDGE], [121.4, AIM_EDGE], [122.3, AIM],
    [5819.85, AIM], [5820.35, [0.62, 0.62, 0.02]], [5821.4, [0.62, 0.62, 0.02]], [5822.1, AIM],
  ]
  /** The hand flinches when something falls: a short shake that dies away. */
  const jolt = (vt: number) => {
    let j = 0
    for (let i = 0; i < JOLTS.length; i += 1) {
      const d = vt - JOLTS[i]![0]
      if (d >= 0 && d < 1.6) j += JOLTS[i]![1] * Math.exp(-3.6 * d)
    }
    return j
  }

  const lookV = new Vector3()
  const pawV = new Vector3()
  const aimV = new Vector3()
  const toLens = new Vector3()
  const mountV = new Vector3()
  const gazeV = new Vector3()
  const gazeL = new Vector3()
  const pyrMid = new Vector3(0.915, 0.36, PYR_Z)
  /** The cat's eyes, between them, in the cat's own space. */
  const EYES = new Vector3(0, 1.02, 0.27)

  const wobble = (vt: number) => {
    let a = 0
    for (let i = 0; i < WOBBLES.length; i += 1) {
      const d = vt - WOBBLES[i]![0]
      if (d >= 0 && d < 1.5) a += WOBBLES[i]![1] * Math.exp(-6 * d) * Math.sin(26 * d)
    }
    return a
  }

  const update = (vt: number) => {
    const late = vt > 1000
    const reach = track(vt, lean)
    cat.rotation.z = -reach
    cat.updateMatrixWorld(true)
    // Breathing and idle life.
    const breathe = Math.sin((vt * Math.PI * 2) / 2.7) * 0.012
    torso.scale.set(1 + breathe * 0.5, 1 + breathe, 1 + breathe * 0.5)

    // The phone is the camera: it drifts a little in the paw, goes along when the cat leans to reach, shakes when
    // something falls and swings toward the mess.
    const j = jolt(vt)
    camera.position.set(
      SELFIE_AT[0] + reach * 0.5 + Math.sin(vt * 1.7) * 0.01 + j * 0.03 * Math.sin(vt * 23),
      SELFIE_AT[1] - reach * 0.12 + Math.sin(vt * 2.3 + 1) * 0.01 + j * 0.025 * Math.sin(vt * 29 + 2),
      SELFIE_AT[2],
    )
    camera.lookAt(trackV(vt, aim, aimV))
    camera.rotateZ(SELFIE_ROLL + Math.sin(vt * 0.73) * 0.012 + reach * 0.3 + j * 0.035 * Math.sin(vt * 19 + 1))
    camera.updateMatrixWorld()
    screenGlow.position.copy(camera.position)

    // Looking into the lens: the direction from the cat's eyes to the phone, in the cat's own space.
    cat.worldToLocal(toLens.copy(camera.position)).sub(EYES)
    AT_PHONE[0] = Math.atan2(toLens.x, toLens.z)
    AT_PHONE[1] = -Math.atan2(toLens.y, Math.hypot(toLens.x, toLens.z))

    trackV(vt, look, lookV)
    head.rotation.set(lookV.y + Math.sin(vt * 0.9) * 0.015, lookV.x + Math.sin(vt * 0.6 + 1) * 0.02, lookV.z)
    head.updateMatrixWorld(true)

    // Eyes: on the lens, can A, the pyramid or a falling can, with small darts between fixes.
    const g = Math.round(track(vt, gazeAt))
    if (g === 1) gazeV.copy(canA.visible ? canA.position : pyrMid)
    else if (g === 2) gazeV.copy(pyrMid)
    else if (g === 3) gazeV.copy(pyramid[3]!.visible ? pyramid[3]!.position : pyrMid)
    else gazeV.copy(camera.position)
    const dart = Math.floor(vt / 0.85)
    gazeV.x += (hash1(dart) - 0.5) * 0.05
    gazeV.y += (hash1(dart + 17) - 0.5) * 0.035
    eyeballs.forEach((ball, i) => {
      sockets[i]!.worldToLocal(gazeL.copy(gazeV))
      const yaw = clamp(Math.atan2(gazeL.x, gazeL.z), -0.5, 0.5)
      const pitch = clamp(Math.atan2(gazeL.y, Math.hypot(gazeL.x, gazeL.z)), -0.35, 0.35)
      ball.rotation.set(-pitch, yaw, 0)
    })
    pupil.value = track(vt, pupilW)

    let blink = blinkAt(vt % 4.3, 0)
    blink = Math.max(blink, blinkAt(vt, 122.45, 0.5), blinkAt(vt, 5822.3, 0.55))
    const open = track(vt, lidOpen)
    for (const lid of lids) lid.rotation.x = open + (1.2 - open) * blink

    const back = track(vt, earsBack)
    const twitch = (vt % 6.1) < 0.18 ? Math.sin(((vt % 6.1) / 0.18) * Math.PI) * 0.25 : 0
    ears.forEach((ear, i) => {
      const s = i === 0 ? -1 : 1
      ear.rotation.set(-0.12 - back * 0.45, s * (-0.12 + back * 0.3), -s * (0.24 + back * 0.6) + (i === 1 ? twitch : 0))
    })
    whiskers.forEach((w, i) => {
      const s = i === 0 ? -1 : 1
      const flick = (vt % 3.7) < 0.25 ? Math.sin(((vt % 3.7) / 0.25) * Math.PI) * 0.08 : 0
      w.rotation.set(0, 0, s * (Math.sin(vt * 1.3 + i) * 0.02 + flick) - back * s * 0.12)
    })

    // Tail: a slow sway that runs to the tip, a flick after each fall, puffed when startled.
    const excite = Math.max(
      Math.exp(-Math.max(0, vt - 120.8) * 1.4) * (vt > 120.8 ? 1 : 0),
      Math.exp(-Math.max(0, vt - 5819.9) * 1.1) * (vt > 5819.9 ? 1.2 : 0),
    )
    const p = track(vt, puff)
    tailSegs.forEach((seg, i) => {
      const k = i / (TAIL - 1)
      const sway = Math.sin(vt * 1.9 - i * 0.55) * (0.04 + 0.1 * k) * (1 + excite * 2.2)
      seg.rotation.set(i >= TAIL - 3 ? -0.12 * k - Math.max(0, Math.sin(vt * 3.1 - i)) * 0.12 * (1 + excite) : 0, (i === 0 ? -Math.PI / 2 : 0.31) + sway, 0)
    })
    tailScaled.forEach((m, i) => {
      if (i % 2 === 0) m.scale.set(p, p, 1)
      else {
        const r0 = 0.074 - Math.floor(i / 2) * 0.004
        m.scale.setScalar(r0 * p)
      }
    })

    // The right paw holds the stick's grip; the stick runs from it to the phone.
    cat.localToWorld(pawV.copy(HANDLE))
    stickPivot.position.copy(pawV)
    mountV.copy(MOUNT).applyMatrix4(camera.matrixWorld).sub(pawV)
    const stickLength = mountV.length()
    stickPivot.quaternion.setFromUnitVectors(up, mountV.divideScalar(stickLength || 1))
    stick.scale.set(1, stickLength, 1)
    pose(phoneLeg, pawV)

    trackV(vt, knockPaw, pawV)
    pose(knockLeg, pawV)

    // Can A: on the shelf until pushed off at 0:02:00, then gone for the rest of the stream.
    if (!late && vt < KNOCK_S) {
      const k = smooth(clamp01((vt - 120.0) / (KNOCK_S - 120.0)) ** 1.4)
      canA.visible = true
      canA.position.set(
        CAN_A_REST[0] + (CAN_A_DROP[0] - CAN_A_REST[0]) * k,
        CAN_H / 2,
        CAN_A_REST[2] + (CAN_A_DROP[2] - CAN_A_REST[2]) * k,
      )
      canA.quaternion.identity()
      canA.rotation.y = 0.4
    } else if (!late) {
      canA.visible = placeOnTrack(canA, knockTrack, vt)
    } else {
      canA.visible = false
    }

    // The pyramid: whole until the shove at 1:37:00, a little wobble from each tap before it.
    if (vt < SHOVE_S) {
      const a = late ? wobble(vt) : 0
      pyramid.forEach((can, i) => {
        const at = PYRAMID[i]!
        const row = i < 3 ? 0.3 : i < 5 ? 1 : 1.6
        const tip = -a * row
        can.visible = true
        can.rotation.set(0, pyramidYaw[i]!, tip, 'ZYX')
        can.position.set(at[0] - Math.sin(tip) * (CAN_H / 2) + a * 0.05 * row, at[1], at[2])
      })
    } else {
      pyramid.forEach((can, i) => {
        can.visible = placeOnTrack(can, shoveTracks[i]!, vt)
      })
    }
    pyramidShadowMat.opacity = 0.8 * (1 - clamp01((vt - SHOVE_S) / 0.25))

    // The shopper across the store wanders the cross aisle.
    const walk = vt * 0.19
    shopper.position.set(14.5, FLOOR_Y, -14.5 + Math.sin(walk) * 6)
    shopper.rotation.y = Math.cos(walk) >= 0 ? Math.PI : 0
    const stride = Math.sin(vt * 5.2) * 0.35 * Math.abs(Math.cos(walk))
    shopperLegs[0]!.rotation.x = stride
    shopperLegs[1]!.rotation.x = -stride
    shopper.position.y = FLOOR_Y + Math.abs(Math.sin(vt * 5.2)) * 0.06

    finishMat.uniforms.seed!.value = Math.floor(vt * 30) % 997
  }

  let width = 940
  let height = 800
  const api: CatStreamScene = {
    render(vt) {
      update(vt)
      renderer.setRenderTarget(farRT)
      renderer.render(far, camera)
      renderer.setRenderTarget(blurRT)
      bokehQuad.render(renderer)
      renderer.setRenderTarget(mainRT)
      renderer.render(scene, camera)
      renderer.setRenderTarget(null)
      finishQuad.render(renderer)
    },
    setSize(w, h, pixelRatio) {
      width = Math.max(1, Math.round(w))
      height = Math.max(1, Math.round(h))
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)
      const bw = Math.max(1, Math.round(width * pixelRatio))
      const bh = Math.max(1, Math.round(height * pixelRatio))
      mainRT.setSize(bw, bh)
      const fw = Math.max(1, Math.round(bw / 2))
      const fh = Math.max(1, Math.round(bh / 2))
      farRT.setSize(fw, fh)
      blurRT.setSize(fw, fh)
      bokehMat.uniforms.texel!.value.set(1 / fw, 1 / fh)
      bokehMat.uniforms.radius!.value = fw * 0.011
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    },
    warm() {
      // Each scene compiles against the target it draws into, so the programs match the ones render() uses.
      renderer.setRenderTarget(farRT)
      const farReady = renderer.compileAsync(far, camera)
      renderer.setRenderTarget(mainRT)
      const mainReady = renderer.compileAsync(scene, camera)
      renderer.setRenderTarget(null)
      return Promise.all([farReady, mainReady]).then(() => undefined)
    },
    dispose() {
      // The shelf goods are instanced: their matrix and colour buffers go with them.
      for (const root of [scene, far]) {
        root.traverse((o) => {
          if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose()
        })
      }
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      textures.forEach((t) => t.dispose())
      bokehQuad.dispose()
      finishQuad.dispose()
      mainRT.dispose()
      farRT.dispose()
      blurRT.dispose()
      envRT.dispose()
      renderer.dispose()
    },
  }
  api.setSize(width, height, 1)
  return api
}
