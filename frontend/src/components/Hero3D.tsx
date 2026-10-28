import { Canvas, useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

const VIOLET = new THREE.Color('#8b5cf6')
const CYAN = new THREE.Color('#22d3ee')
const MINT = new THREE.Color('#34e0a1')

function fibonacciSphere(count: number, radius: number) {
  const points: THREE.Vector3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / (count - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * index
    points.push(new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius))
  }
  return points
}

function Globe({ reduced }: { reduced: boolean }) {
  const group = useRef<THREE.Group>(null)
  const inner = useRef<THREE.Group>(null)
  const pulseRefs = useRef<(THREE.Mesh | null)[]>([])
  const target = useRef({ x: 0, y: 0 })

  const nodes = useMemo(() => fibonacciSphere(150, 2.12), [])
  const nodeGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(nodes.length * 3)
    nodes.forEach((point, index) => {
      positions[index * 3] = point.x
      positions[index * 3 + 1] = point.y
      positions[index * 3 + 2] = point.z
    })
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geometry
  }, [nodes])

  const shellGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    const count = 1100
    const golden = Math.PI * (3 - Math.sqrt(5))
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const top = new THREE.Color("#c4b5fd")
    const bottom = new THREE.Color("#22d3ee")
    for (let index = 0; index < count; index += 1) {
      const y = 1 - (index / (count - 1)) * 2
      const r = Math.sqrt(Math.max(0, 1 - y * y))
      const theta = golden * index
      positions[index * 3] = Math.cos(theta) * r * 1.98
      positions[index * 3 + 1] = y * 1.98
      positions[index * 3 + 2] = Math.sin(theta) * r * 1.98
      // Vertical gradient so the shell reads as a sphere, not a flat disc.
      const shade = bottom.clone().lerp(top, (y + 1) / 2)
      colors[index * 3] = shade.r
      colors[index * 3 + 1] = shade.g
      colors[index * 3 + 2] = shade.b
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
    return geometry
  }, [])


  const { arcs, curves } = useMemo(() => {
    const pathPoints: THREE.Vector3[][] = []
    const pathCurves: THREE.QuadraticBezierCurve3[] = []
    for (let index = 0; index < 7; index += 1) {
      const start = nodes[(index * 13 + 3) % nodes.length]
      // Choose an endpoint that is close enough to keep the arc hugging the
      // sphere. Long hops lifted far off the surface and read as scribbles.
      let end = nodes[(index * 47 + 29) % nodes.length]
      for (let step = 1; step < nodes.length; step += 1) {
        const candidate = nodes[(index * 47 + 29 + step) % nodes.length]
        const span = start.distanceTo(candidate)
        if (span > 1.5 && span < 2.4) {
          end = candidate
          break
        }
      }
      const mid = start.clone().add(end).multiplyScalar(0.5)
      const lift = start.distanceTo(end) * 0.22 + 0.12
      mid.normalize().multiplyScalar(2.02 + lift)
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
      pathCurves.push(curve)
      pathPoints.push(curve.getPoints(30))
    }
    return { arcs: pathPoints, curves: pathCurves }
  }, [nodes])

  useEffect(() => {
    if (reduced) return
    const onPointer = (event: PointerEvent) => {
      target.current.x = (event.clientY / window.innerHeight - 0.5) * 0.35
      target.current.y = (event.clientX / window.innerWidth - 0.5) * 0.5
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    return () => window.removeEventListener('pointermove', onPointer)
  }, [reduced])

  useFrame((state, delta) => {
    if (!group.current) return
    if (!reduced) {
      group.current.rotation.y += delta * 0.055
      group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, target.current.x, 0.03)
      group.current.rotation.z = THREE.MathUtils.lerp(group.current.rotation.z, -target.current.y * 0.06, 0.03)
      if (inner.current) inner.current.rotation.y -= delta * 0.09
      // Travel pulses along the arcs: motion with intent instead of idle drift.
      pulseRefs.current.forEach((mesh, index) => {
        if (!mesh) return
        const curve = curves[index % curves.length]
        if (!curve) return
        const t = (state.clock.elapsedTime * 0.16 + index / curves.length) % 1
        mesh.position.copy(curve.getPoint(t))
      })
    }
  })

  return (
    <group ref={group} rotation={[0.12, -0.35, 0.05]} scale={0.92}>
      {/* Point-matrix shell. A filled sphere read as a flat purple disc on this
          background; dots give real depth falloff at the rim. */}
      <points geometry={shellGeometry}>
        <pointsMaterial
          vertexColors
          size={0.022}
          sizeAttenuation
          transparent
          opacity={1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
      {/* Single tight rim shell. A second, larger shell drew a visible bubble
          edge against the page background. */}
      <mesh scale={1.03}>
        <sphereGeometry args={[2.0, 40, 40]} />
        <meshBasicMaterial
          color={VIOLET}
          side={THREE.BackSide}
          transparent
          opacity={0.2}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <points geometry={nodeGeometry}>
        <pointsMaterial color="#c4b5fd" size={0.052} sizeAttenuation transparent opacity={1} blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      <group ref={inner}>
        {arcs.map((points, index) => (
          <Line
            key={index}
            points={points}
            color={index % 3 === 0 ? '#34e0a1' : index % 2 === 0 ? '#22d3ee' : '#a78bfa'}
            transparent
            opacity={0.8}
            lineWidth={1.5}
          />
        ))}
        {curves.slice(0, 4).map((_, index) => (
          <mesh
            key={`pulse-${index}`}
            ref={(node) => {
              pulseRefs.current[index] = node
            }}
          >
            <sphereGeometry args={[0.045, 12, 12]} />
            <meshBasicMaterial
              color={index % 2 === 0 ? '#34e0a1' : '#22d3ee'}
              transparent
              opacity={0.95}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        ))}
        {[0, 1].map((index) => (
          <mesh key={`ring-${index}`} rotation={[Math.PI / 2 + 0.42 + index * 0.26, 0, index * 0.8]}>
            <torusGeometry args={[2.14 + index * 0.16, 0.0038, 8, 220]} />
            <meshBasicMaterial
              color={index === 0 ? '#22d3ee' : '#8b5cf6'}
              transparent
              opacity={0.38}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        ))}
        {[0, 1, 2, 3, 4].map((index) => {
          const angle = (index / 5) * Math.PI * 2
          const radius = 2.75
          return (
            <mesh key={`sat-${index}`} position={[Math.cos(angle) * radius, Math.sin(angle * 1.7) * 0.9, Math.sin(angle) * radius]}>
              <sphereGeometry args={[0.022, 10, 10]} />
              <meshBasicMaterial color={index === 2 ? '#34e0a1' : '#e9d5ff'} />
            </mesh>
          )
        })}
      </group>
    </group>
  )
}

function Dust({ reduced }: { reduced: boolean }) {
  const points = useRef<THREE.Points>(null)
  const geometry = useMemo(() => {
    const count = 260
    const positions = new Float32Array(count * 3)
    let seed = 0x5eed
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (let index = 0; index < count; index += 1) {
      const radius = 3.4 + random() * 2.8
      const theta = random() * Math.PI * 2
      const phi = Math.acos(2 * random() - 1)
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta)
      positions[index * 3 + 1] = radius * Math.cos(phi)
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
    }
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return buffer
  }, [])

  useFrame((_, delta) => {
    if (!reduced && points.current) points.current.rotation.y += delta * 0.012
  })

  return (
    <points ref={points} geometry={geometry}>
      <pointsMaterial color="#8b8fb0" size={0.014} transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  )
}

function webGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')))
  } catch {
    return false
  }
}

export function StaticOrbital() {
  return (
    <div className="relative flex h-full min-h-[320px] items-center justify-center" aria-hidden>
      <div className="absolute h-[300px] w-[300px] rounded-full bg-violet-600/10 blur-3xl md:h-[420px] md:w-[420px]" />
      <div className="absolute h-[300px] w-[300px] rounded-full border border-violet-400/20 md:h-[400px] md:w-[400px]" />
      <div className="absolute h-[220px] w-[220px] rounded-full border border-cyanx/15 md:h-[300px] md:w-[300px]" />
      <div className="absolute h-[340px] w-[340px] animate-spin-slow rounded-full border border-dashed border-white/10 md:h-[470px] md:w-[470px]" />
      <div className="relative h-40 w-40 rounded-full border border-violet-400/30 bg-[radial-gradient(circle_at_35%_30%,rgba(139,92,246,0.55),rgba(10,8,20,0.95)_65%)] shadow-[0_0_80px_rgba(124,58,237,0.35)] md:h-52 md:w-52" />
      <svg className="absolute h-[300px] w-[300px] opacity-60 md:h-[400px] md:w-[400px]" viewBox="0 0 400 400">
        <defs>
          <linearGradient id="orb-line" x1="0" x2="1">
            <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.1" />
            <stop offset="0.5" stopColor="#22d3ee" stopOpacity="0.8" />
            <stop offset="1" stopColor="#8b5cf6" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <path d="M40 260 C110 180, 170 320, 240 220 S340 140, 370 180" fill="none" stroke="url(#orb-line)" strokeWidth="1.2" />
        <circle cx="240" cy="220" r="2.5" fill="#34e0a1" />
        <circle cx="110" cy="225" r="1.8" fill="#22d3ee" />
      </svg>
    </div>
  )
}

export default function Hero3D() {
  const [supported] = useState<boolean>(() => webGLAvailable())
  const reduced = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false

  if (!supported) return <StaticOrbital />

  return (
    <div className="relative h-full w-full" aria-label="Animated 3D market intelligence sphere">
      <Canvas
        dpr={[1, 1.6]}
        camera={{ position: [0, 0.1, 7.4], fov: 42 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ background: 'transparent' }}
        frameloop={reduced ? 'demand' : 'always'}
      >
        <Globe reduced={reduced} />
        <Dust reduced={reduced} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_35%,rgba(6,6,11,0.55)_78%)]" />
    </div>
  )
}
