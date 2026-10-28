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
import { OrbitControls } from '@react-three/drei'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

import { useReducedMotion } from '../lib/hooks'
import type { Bar } from '../lib/types'

const UP = '#34e0a1'
const DOWN = '#ff6b8a'
const VIOLET = '#8b5cf6'
const CYAN = '#22d3ee'

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

