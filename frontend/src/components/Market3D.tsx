/**
 * 3D market visualisations.
 *
 * Deliberately explanatory rather than decorative: the surface shows the actual
 * distribution of recent session returns, and the funnel shows the forecast
 * interval the API returned. Nothing here invents data — if the underlying
 * series is absent the component renders nothing.
 *
 * Three.js is heavy, so pages load these through React.lazy, and the project's
 * existing reduced-motion hook disables animation the same way Hero3D does.
 */
import { Canvas, useFrame } from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
import { useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'

import { useReducedMotion } from '../lib/hooks'
import type { Bar } from '../lib/types'

const UP = '#34e0a1'
const DOWN = '#ff6b8a'
const VIOLET = '#8b5cf6'
const CYAN = '#22d3ee'

/** Even distribution of points on a sphere (golden-angle spiral). */
function spherePoints(count: number, radius: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  const total = Math.max(count, 2)
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / (total - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * index
    points.push(new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius))
  }
  return points
}

/**
 * Idle rotation for 3D scenes. It must live *inside* <Canvas>, because
 * useFrame requires the react-three-fiber context.
 */
function Spinning({
  children,
  reduced,
  speed = 0.4,
  continuous = false,
}: {
  children: ReactNode
  reduced: boolean
  speed?: number
  continuous?: boolean
}) {
  const group = useRef<THREE.Group>(null)
  useFrame((state) => {
    if (!group.current || reduced) return
    group.current.rotation.y = continuous
      ? state.clock.elapsedTime * speed
      : Math.sin(state.clock.elapsedTime * speed) * 0.4
  })
  return <group ref={group}>{children}</group>
}

function ReturnBars({ values, reduced }: { values: number[]; reduced: boolean }) {
  const group = useRef<THREE.Group>(null)
  const peak = Math.max(...values.map((value) => Math.abs(value)), 1e-9)
  const gap = 0.62

  useFrame((state) => {
    if (!group.current || reduced) return
    group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.25) * 0.38
  })

  return (
    <group ref={group}>
      {values.map((value, index) => {
        const height = Math.max(0.08, (Math.abs(value) / peak) * 3.4)
        const x = (index - (values.length - 1) / 2) * gap
        const color = value >= 0 ? UP : DOWN
        return (
          <mesh key={`${index}-${value}`} position={[x, value >= 0 ? height / 2 : -height / 2, 0]}>
            <boxGeometry args={[0.42, height, 0.42]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.35}
              metalness={0.3}
              roughness={0.35}
              transparent
              opacity={0.94}
            />
          </mesh>
        )
      })}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[values.length * gap + 1.2, 2.6]} />
        <meshStandardMaterial color="#12121f" transparent opacity={0.55} />
      </mesh>
    </group>
  )
}

/** Session-return surface. Values are simple returns derived from the given closes. */
export function ReturnSurface3D({ bars, height = 260 }: { bars: Bar[]; height?: number }) {
  const reduced = useReducedMotion()
  const values = useMemo(() => {
    const closes = bars.map((bar) => bar.close).filter((value) => Number.isFinite(value) && value > 0)
    const returns: number[] = []
    for (let index = 1; index < closes.length; index += 1) {
      returns.push(closes[index] / closes[index - 1] - 1)
    }
    return returns.slice(-28)
  }, [bars])

  if (values.length < 4) return null

  return (
    <div style={{ height }} className="w-full" aria-label="3D session return surface">
      <Canvas dpr={[1, 2]} camera={{ position: [0, 3.6, 9.6], fov: 42 }}>
        <color attach="background" args={['#0b0b14']} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[6, 9, 6]} intensity={1.1} />
        <pointLight position={[-6, -3, 4]} intensity={0.5} color={VIOLET} />
        <ReturnBars values={values} reduced={reduced} />
        <OrbitControls enablePan={false} enableZoom={false} maxPolarAngle={Math.PI / 2.05} minPolarAngle={0.6} />
      </Canvas>
    </div>
  )
}

/**
 * Forecast funnel: the point estimate is the tube, the residual interval is the
 * cone width. Both come from the API payload; no value is invented here.
 */
export function ForecastCone3D({
  last,
  expected,
  low,
  high,
  height = 230,
}: {
  last: number
  expected: number | null
  low: number | null
  high: number | null
  height?: number
}) {
  const reduced = useReducedMotion()
  const group = useRef<THREE.Group>(null)

  const geometry = useMemo(() => {
    const deltas = [expected, low, high]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .map((value) => Math.abs(value - last))
    const span = Math.max(...deltas, Math.abs(last) * 1e-4, 1e-9)
    const norm = (value: number | null) =>
      typeof value === 'number' && Number.isFinite(value) ? (value - last) / span : null
    const pointY = norm(expected)
    const lowY = norm(low)
    const highY = norm(high)
    const halfWidth = lowY !== null && highY !== null ? Math.max(0.12, (highY - lowY) / 2) : 0.32
    return { pointY, halfWidth }
  }, [expected, high, last, low])

  useFrame((state) => {
    if (!group.current || reduced) return
    group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.2) * 0.3
  })

  const up = (geometry.pointY ?? 0) >= 0
  const color = up ? UP : DOWN
  const funnelHeight = 3.4

  return (
    <div style={{ height }} className="w-full" aria-label="3D forecast interval funnel">
      <Canvas dpr={[1, 2]} camera={{ position: [3.4, 1.6, 6.4], fov: 42 }}>
        <color attach="background" args={['#0b0b14']} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 5]} intensity={1} />
        <pointLight position={[-4, 2, 3]} intensity={0.6} color={CYAN} />
        <group ref={group}>
          {geometry.pointY !== null && (
            <mesh position={[0, (geometry.pointY * funnelHeight) / 2, 0]}>
              <cylinderGeometry
                args={[0.06, 0.06, Math.max(0.4, Math.abs(geometry.pointY) * funnelHeight), 16]}
              />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
            </mesh>
          )}
          <mesh position={[0, funnelHeight / 2, 0]}>
            <cylinderGeometry args={[geometry.halfWidth, 0.02, funnelHeight, 28, 1, true]} />
            <meshStandardMaterial
              color={VIOLET}
              emissive={VIOLET}
              emissiveIntensity={0.25}
              transparent
              opacity={0.28}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
            <ringGeometry args={[0.5, 0.62, 40]} />
            <meshStandardMaterial color="#2c2c46" transparent opacity={0.6} />
          </mesh>
        </group>
        <OrbitControls enablePan={false} enableZoom={false} maxPolarAngle={Math.PI / 2.05} />
      </Canvas>
    </div>
  )
}

/**
 * Correlation globe: instruments sit on a sphere, and each edge is a real
 * pairwise correlation from the API's matrix. Warm edges are positive (the pair
 * moves together, so risk concentrates) and cool edges are negative.
 */
export function CorrelationGlobe3D({
  symbols,
  matrix,
  height = 320,
}: {
  symbols: string[]
  matrix: number[][]
  height?: number
}) {
  const reduced = useReducedMotion()
  const nodes = useMemo(() => spherePoints(symbols.length, 2.15), [symbols.length])
  const edges = useMemo(() => {
    const out: { from: THREE.Vector3; to: THREE.Vector3; corr: number }[] = []
    for (let row = 0; row < symbols.length; row += 1) {
      for (let col = row + 1; col < symbols.length; col += 1) {
        const corr = matrix?.[row]?.[col]
        if (typeof corr === 'number' && Number.isFinite(corr) && nodes[row] && nodes[col]) {
          out.push({ from: nodes[row], to: nodes[col], corr })
        }
      }
    }
    return out
  }, [matrix, nodes, symbols.length])

  if (symbols.length < 2 || edges.length === 0) return null

  return (
    <div style={{ height }} className="w-full" aria-label="3D correlation globe">
      <Canvas dpr={[1, 2]} camera={{ position: [0, 1.4, 7.2], fov: 45 }}>
        <color attach="background" args={['#0b0b14']} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[5, 7, 6]} intensity={1} />
        <pointLight position={[-5, -2, 3]} intensity={0.5} color={CYAN} />
        <Spinning reduced={reduced} speed={0.12} continuous>
          <mesh>
            <icosahedronGeometry args={[2.15, 1]} />
            <meshBasicMaterial color="#20203a" wireframe transparent opacity={0.55} />
          </mesh>
          {edges.map((edge, index) => {
            const strength = Math.min(1, Math.abs(edge.corr))
            return (
              <Line
                key={`edge-${index}`}
                points={[edge.from, edge.to]}
                color={edge.corr >= 0 ? DOWN : CYAN}
                lineWidth={0.6 + strength * 1.8}
                transparent
                opacity={0.18 + strength * 0.65}
              />
            )
          })}
          {nodes.map((node, index) => (
            <mesh key={`node-${symbols[index]}`} position={node}>
              <sphereGeometry args={[0.14, 18, 18]} />
              <meshStandardMaterial color={VIOLET} emissive={VIOLET} emissiveIntensity={0.7} />
            </mesh>
          ))}
        </Spinning>
        <OrbitControls enablePan={false} enableZoom={false} autoRotate={false} />
      </Canvas>
    </div>
  )
}

/**
 * Risk terrain: one 3D bar per position, height = its share of portfolio
 * variance from the API's risk_contribution block. Weight sets the colour so a
 * large position with small risk contribution is visibly distinct.
 */
export function RiskTerrain3D({
  items,
  height = 280,
}: {
  items: { symbol: string; weight: number; variance_contribution_pct: number }[]
  height?: number
}) {
  const reduced = useReducedMotion()
  const peaks = items.map((item) => Math.max(0, item.variance_contribution_pct ?? 0))
  const peak = Math.max(...peaks, 1e-9)
  const gap = 1.15

  if (items.length === 0) return null

  return (
    <div style={{ height }} className="w-full" aria-label="3D portfolio risk terrain">
      <Canvas dpr={[1, 2]} camera={{ position: [0, 4.4, 8.4], fov: 44 }}>
        <color attach="background" args={['#0b0b14']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[6, 9, 6]} intensity={1.15} />
        <pointLight position={[-5, -2, 4]} intensity={0.5} color={CYAN} />
        <Spinning reduced={reduced} speed={0.22}>
          {items.map((item, index) => {
            const barHeight = Math.max(0.12, (peaks[index] / peak) * 3.6)
            const x = (index - (items.length - 1) / 2) * gap
            const weightRatio = Math.min(1, Math.max(0, item.weight))
            const color = weightRatio > 0.3 ? DOWN : weightRatio > 0.15 ? VIOLET : CYAN
            return (
              <mesh key={`${item.symbol}-${index}`} position={[x, barHeight / 2, 0]}>
                <boxGeometry args={[0.62, barHeight, 0.62]} />
                <meshStandardMaterial
                  color={color}
                  emissive={color}
                  emissiveIntensity={0.32}
                  metalness={0.35}
                  roughness={0.4}
                  transparent
                  opacity={0.95}
                />
              </mesh>
            )
          })}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
            <planeGeometry args={[items.length * gap + 1.4, 2.6]} />
            <meshStandardMaterial color="#12121f" transparent opacity={0.6} />
          </mesh>
        </Spinning>
        <OrbitControls enablePan={false} enableZoom={false} maxPolarAngle={Math.PI / 2.05} minPolarAngle={0.5} />
      </Canvas>
    </div>
  )
}


