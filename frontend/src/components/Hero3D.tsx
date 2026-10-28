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

  const arcs = useMemo(() => {
    const list: THREE.Vector3[][] = []
    for (let index = 0; index < 11; index += 1) {
      const start = nodes[(index * 13 + 3) % nodes.length]
      const end = nodes[(index * 47 + 29) % nodes.length]
      const mid = start.clone().add(end).multiplyScalar(0.5)
      const lift = start.distanceTo(end) * 0.42 + 0.32
      mid.normalize().multiplyScalar(2.12 + lift)
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
      list.push(curve.getPoints(34))
    }
    return list
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
    }
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 0.8) * 0.008
    state.scene.scale.setScalar(pulse)
  })

  return (
    <group ref={group} rotation={[0.18, -0.4, 0.08]}>
      <mesh>
        <icosahedronGeometry args={[2.1, 3]} />
        <meshBasicMaterial color="#4c2a8f" wireframe transparent opacity={0.18} />
      </mesh>
      <mesh>
        <sphereGeometry args={[2.08, 64, 64]} />
        <meshStandardMaterial color="#120c24" metalness={0.62} roughness={0.45} transparent opacity={0.82} emissive="#1a0f35" emissiveIntensity={0.55} />
      </mesh>
      <mesh>
        <sphereGeometry args={[2.02, 48, 48]} />
        <meshBasicMaterial color="#2a1854" transparent opacity={0.35} />
      </mesh>
      <points geometry={nodeGeometry}>
        <pointsMaterial color="#a78bfa" size={0.035} sizeAttenuation transparent opacity={0.9} blending={THREE.AdditiveBlending} />
      </points>
      <group ref={inner}>
        {arcs.map((points, index) => (
          <Line
            key={index}
            points={points}
            color={index % 3 === 0 ? '#34e0a1' : index % 2 === 0 ? '#22d3ee' : '#a78bfa'}
            transparent
            opacity={0.26}
            lineWidth={0.7}
          />
        ))}
        {[0, 1, 2].map((index) => (
          <mesh key={`ring-${index}`} rotation={[Math.PI / 2 + index * 0.32, index * 0.6, 0]}>
            <torusGeometry args={[2.55 + index * 0.22, 0.0035, 8, 200]} />
            <meshBasicMaterial color={index === 1 ? '#22d3ee' : '#8b5cf6'} transparent opacity={0.34 - index * 0.07} />
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
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.9, 0.0018, 6, 220]} />
        <meshBasicMaterial color="#a78bfa" transparent opacity={0.3} />
      </mesh>
      <ambientLight intensity={0.5} />
      <pointLight position={[4, 4, 5]} intensity={22} color={VIOLET} distance={16} />
      <pointLight position={[-5, -2, 3]} intensity={16} color={CYAN} distance={14} />
      <pointLight position={[0, 3, -4]} intensity={9} color={MINT} distance={12} />
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
        camera={{ position: [0, 0.2, 6.6], fov: 45 }}
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
