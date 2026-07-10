'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  HiBookOpen,
  HiCheck,
  HiExclamationTriangle,
  HiMagnifyingGlassMinus,
  HiMagnifyingGlassPlus,
  HiPencilSquare,
  HiSparkles,
  HiViewfinderCircle,
  HiXMark,
} from 'react-icons/hi2'

import type { DraftZeroClaim, DraftZeroGap } from '@/lib/draftZero/types'
import type { GuidelinePackDocument } from '@/lib/fundingGuidelines/types'
import { getStageNorms, StageNormsPanel } from './DraftZeroNorms'

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export interface MindMapStageGroup {
  key: string
  title: string
  readiness: number | undefined
  claims: DraftZeroClaim[]
  gaps: DraftZeroGap[] // open gaps only
}

export interface DraftZeroMindMapProps {
  anchorTitle: string
  anchorSummary: string
  stageGroups: MindMapStageGroup[]
  guidelinePack: GuidelinePackDocument | null
  readOnly: boolean
  busy: boolean
  aiFillBusy: boolean
  onConfirm: (claim: DraftZeroClaim) => Promise<void>
  onEditSave: (claim: DraftZeroClaim, text: string) => Promise<boolean>
  onReject: (claim: DraftZeroClaim) => Promise<void>
  onGapFill: (gap: DraftZeroGap, text: string) => Promise<boolean>
  onAiFill: (pointIds: string[]) => Promise<void>
}

// Fixed node geometry keeps the layout a pure function of the data.
const POINT_W = 236
const POINT_H = 58
const POINT_GAP = 10
const STAGE_W = 168
const STAGE_H = 52
const ANCHOR_W = 272
const ANCHOR_H = 132
const GAP_ANCHOR_STAGE = 64
const GAP_STAGE_POINT = 48
const STAGE_BLOCK_GAP = 26
const CANVAS_PAD = 32

type LeafNode =
  | { kind: 'claim'; claim: DraftZeroClaim }
  | { kind: 'gap'; gap: DraftZeroGap }

interface PositionedLeaf {
  id: string
  x: number
  y: number
  side: 'left' | 'right'
  stageKey: string
  node: LeafNode
}

interface PositionedStage {
  key: string
  title: string
  readiness: number | undefined
  x: number
  y: number
  side: 'left' | 'right'
  openGapIds: string[]
  unconfirmedCount: number
}

interface MindMapLayout {
  width: number
  height: number
  anchor: { x: number; y: number }
  stages: PositionedStage[]
  leaves: PositionedLeaf[]
}

/**
 * Two-sided mind map layout: the idea anchor sits in the middle, stages are
 * assigned greedily to the shorter side so both branches stay balanced, and
 * each stage fans its claims/gaps out one column further.
 */
function computeLayout(stageGroups: MindMapStageGroup[]): MindMapLayout {
  const sides: Record<'left' | 'right', { height: number; groups: MindMapStageGroup[] }> = {
    left: { height: 0, groups: [] },
    right: { height: 0, groups: [] },
  }
  const blockHeight = (group: MindMapStageGroup) => {
    const count = group.claims.length + group.gaps.length
    return Math.max(STAGE_H, count * POINT_H + Math.max(0, count - 1) * POINT_GAP)
  }
  for (const group of stageGroups) {
    const side = sides.right.height <= sides.left.height ? 'right' : 'left'
    sides[side].groups.push(group)
    sides[side].height += blockHeight(group) + STAGE_BLOCK_GAP
  }
  for (const side of ['left', 'right'] as const) {
    if (sides[side].groups.length) sides[side].height -= STAGE_BLOCK_GAP
  }

  const height = Math.max(sides.left.height, sides.right.height, ANCHOR_H) + CANVAS_PAD * 2
  const width = ANCHOR_W + 2 * (GAP_ANCHOR_STAGE + STAGE_W + GAP_STAGE_POINT + POINT_W) + CANVAS_PAD * 2
  const centerX = width / 2
  const anchor = { x: centerX, y: height / 2 }

  const stages: PositionedStage[] = []
  const leaves: PositionedLeaf[] = []
  for (const side of ['left', 'right'] as const) {
    const direction = side === 'right' ? 1 : -1
    const stageX =
      centerX + direction * (ANCHOR_W / 2 + GAP_ANCHOR_STAGE + STAGE_W / 2)
    const pointX = stageX + direction * (STAGE_W / 2 + GAP_STAGE_POINT + POINT_W / 2)
    let cursor = (height - sides[side].height) / 2
    for (const group of sides[side].groups) {
      const block = blockHeight(group)
      const children: LeafNode[] = [
        ...group.claims.map((claim) => ({ kind: 'claim' as const, claim })),
        ...group.gaps.map((gap) => ({ kind: 'gap' as const, gap })),
      ]
      stages.push({
        key: group.key,
        title: group.title,
        readiness: group.readiness,
        x: stageX,
        y: cursor + block / 2,
        side,
        openGapIds: group.gaps.map((gap) => gap.id),
        unconfirmedCount: group.claims.filter((claim) => claim.status === 'unconfirmed').length,
      })
      children.forEach((node, index) => {
        const id = node.kind === 'claim' ? `claim:${node.claim.id}` : `gap:${node.gap.id}`
        leaves.push({
          id,
          x: pointX,
          y: cursor + index * (POINT_H + POINT_GAP) + POINT_H / 2,
          side,
          stageKey: group.key,
          node,
        })
      })
      cursor += block + STAGE_BLOCK_GAP
    }
  }

  return { width, height, anchor, stages, leaves }
}

function connectorPath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
}

function claimTone(claim: DraftZeroClaim): { dot: string; border: string } {
  if (claim.status === 'confirmed' || claim.status === 'edited') return { dot: 'bg-emerald-500', border: 'border-l-emerald-400' }
  if (claim.status === 'rejected') return { dot: 'bg-slate-300', border: 'border-l-slate-300' }
  if (claim.provenance === 'quoted') return { dot: 'bg-sky-500', border: 'border-l-sky-400' }
  if (claim.provenance === 'ai_generated') return { dot: 'bg-violet-500', border: 'border-l-violet-400' }
  return { dot: 'bg-amber-500', border: 'border-l-amber-400' }
}

function ProvenanceChip({ claim }: { claim: DraftZeroClaim }) {
  if (claim.status === 'confirmed' || claim.status === 'edited') {
    return <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">confirmed by you</span>
  }
  if (claim.provenance === 'quoted') {
    return (
      <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700" title={claim.sourceQuote || ''}>
        from your material
      </span>
    )
  }
  if (claim.provenance === 'ai_generated') {
    return (
      <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">
        AI-drafted · {Math.round(claim.confidence * 100)}%
      </span>
    )
  }
  return (
    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">inferred · {Math.round(claim.confidence * 100)}%</span>
  )
}

const oneLineClamp: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 1,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
}

export default function DraftZeroMindMap(props: DraftZeroMindMapProps) {
  const {
    anchorTitle,
    anchorSummary,
    stageGroups,
    guidelinePack,
    readOnly,
    busy,
    aiFillBusy,
    onConfirm,
    onEditSave,
    onReject,
    onGapFill,
    onAiFill,
  } = props

  const layout = useMemo(() => computeLayout(stageGroups), [stageGroups])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scale, setScale] = useState(0.85)
  const [editText, setEditText] = useState('')
  const [editing, setEditing] = useState(false)
  const [gapText, setGapText] = useState('')
  const [spotCheckOpen, setSpotCheckOpen] = useState(false)
  const [normsOpen, setNormsOpen] = useState(true)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const selected = useMemo(() => {
    if (!selectedId) return null
    if (selectedId === 'anchor') return { kind: 'anchor' as const }
    if (selectedId.startsWith('stage:')) {
      const stage = layout.stages.find((entry) => `stage:${entry.key}` === selectedId)
      const group = stageGroups.find((entry) => entry.key === stage?.key)
      return stage && group ? { kind: 'stage' as const, stage, group } : null
    }
    const leaf = layout.leaves.find((entry) => entry.id === selectedId)
    return leaf ? { kind: 'leaf' as const, leaf } : null
  }, [selectedId, layout, stageGroups])

  // Selection state resets when a different node is picked.
  useEffect(() => {
    setEditing(false)
    setEditText('')
    setGapText('')
    setSpotCheckOpen(false)
  }, [selectedId])

  const fitToViewport = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const available = viewport.clientWidth - 16
    setScale(Math.min(1, Math.max(0.45, available / layout.width)))
  }, [layout.width])

  useEffect(() => {
    fitToViewport()
  }, [fitToViewport])

  const zoom = (delta: number) => setScale((value) => Math.min(1.25, Math.max(0.45, Math.round((value + delta) * 100) / 100)))

  const totalOpenGapIds = useMemo(
    () => stageGroups.flatMap((group) => group.gaps.map((gap) => gap.id)),
    [stageGroups]
  )

  const handleConfirmClick = useCallback(
    async (claim: DraftZeroClaim) => {
      if (claim.spotCheck && !spotCheckOpen) {
        setSpotCheckOpen(true)
        return
      }
      setSpotCheckOpen(false)
      await onConfirm(claim)
    },
    [onConfirm, spotCheckOpen]
  )

  const anchorSelected = selectedId === 'anchor'

  return (
    <div className="relative overflow-hidden rounded-2xl border border-prep-border bg-white shadow-prep-card">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2">
        <span className="text-xs font-medium text-slate-500">Idea map</span>
        <span className="hidden text-xs text-slate-400 sm:inline">— click any node to review or edit it</span>
        <div className="ml-auto flex items-center gap-1">
          {totalOpenGapIds.length && !readOnly ? (
            <button
              onClick={() => onAiFill(totalOpenGapIds)}
              disabled={busy || aiFillBusy}
              className="mr-2 flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <HiSparkles className="h-3.5 w-3.5" />
              {aiFillBusy ? 'AI drafting…' : `AI-fill ${totalOpenGapIds.length} gap${totalOpenGapIds.length === 1 ? '' : 's'}`}
            </button>
          ) : null}
          <button onClick={() => zoom(-0.1)} title="Zoom out" className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50">
            <HiMagnifyingGlassMinus className="h-4 w-4" />
          </button>
          <button onClick={() => zoom(0.1)} title="Zoom in" className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50">
            <HiMagnifyingGlassPlus className="h-4 w-4" />
          </button>
          <button onClick={fitToViewport} title="Fit to view" className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50">
            <HiViewfinderCircle className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex">
        {/* Canvas */}
        <div ref={viewportRef} className="min-h-[420px] flex-1 overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          <div
            style={{
              width: layout.width * scale,
              height: layout.height * scale,
            }}
          >
            <div
              className="relative"
              style={{ width: layout.width, height: layout.height, transform: `scale(${scale})`, transformOrigin: '0 0' }}
            >
              <svg className="absolute inset-0" width={layout.width} height={layout.height}>
                {layout.stages.map((stage) => {
                  const direction = stage.side === 'right' ? 1 : -1
                  return (
                    <path
                      key={`link-anchor-${stage.key}`}
                      d={connectorPath(
                        layout.anchor.x + direction * (ANCHOR_W / 2),
                        layout.anchor.y,
                        stage.x - direction * (STAGE_W / 2),
                        stage.y
                      )}
                      fill="none"
                      stroke="#99b8b1"
                      strokeWidth={1.5}
                    />
                  )
                })}
                {layout.leaves.map((leaf) => {
                  const stage = layout.stages.find((entry) => entry.key === leaf.stageKey)
                  if (!stage) return null
                  const direction = leaf.side === 'right' ? 1 : -1
                  const isGap = leaf.node.kind === 'gap'
                  const isAi = leaf.node.kind === 'claim' && leaf.node.claim.provenance === 'ai_generated'
                  return (
                    <path
                      key={`link-${leaf.id}`}
                      d={connectorPath(
                        stage.x + direction * (STAGE_W / 2),
                        stage.y,
                        leaf.x - direction * (POINT_W / 2),
                        leaf.y
                      )}
                      fill="none"
                      stroke={isGap ? '#cbd5e1' : isAi ? '#c4b5fd' : '#cfe5de'}
                      strokeWidth={1.5}
                      strokeDasharray={isGap ? '4 4' : undefined}
                    />
                  )
                })}
              </svg>

              {/* Anchor node */}
              <button
                onClick={() => setSelectedId('anchor')}
                className={clsx(
                  'absolute rounded-2xl bg-prep-accent p-4 text-left text-white shadow-prep-card transition-shadow hover:shadow-prep-float',
                  anchorSelected && 'ring-2 ring-offset-2 ring-prep-accentDark'
                )}
                style={{
                  left: layout.anchor.x - ANCHOR_W / 2,
                  top: layout.anchor.y - ANCHOR_H / 2,
                  width: ANCHOR_W,
                  height: ANCHOR_H,
                }}
              >
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-teal-100">
                  <HiCheck className="h-3.5 w-3.5" /> Idea anchor
                </div>
                <div className="mt-1 text-sm font-semibold leading-snug" style={{ ...oneLineClamp, WebkitLineClamp: 2 }}>
                  {anchorTitle || 'Your project idea'}
                </div>
                <p className="mt-1 text-xs leading-snug text-teal-50/90" style={{ ...oneLineClamp, WebkitLineClamp: 3 }}>
                  {anchorSummary}
                </p>
              </button>

              {/* Stage nodes */}
              {layout.stages.map((stage) => {
                const isSelected = selectedId === `stage:${stage.key}`
                const clean = stage.unconfirmedCount === 0 && stage.openGapIds.length === 0
                const normsCount = getStageNorms(stage.key, guidelinePack)?.ruleCount || 0
                return (
                  <button
                    key={`stage:${stage.key}`}
                    onClick={() => setSelectedId(`stage:${stage.key}`)}
                    className={clsx(
                      'absolute rounded-xl border bg-white px-3 py-2 text-left shadow-sm transition-shadow hover:shadow-prep-card',
                      clean ? 'border-emerald-200' : 'border-amber-200',
                      isSelected && 'ring-2 ring-prep-accent'
                    )}
                    style={{ left: stage.x - STAGE_W / 2, top: stage.y - STAGE_H / 2, width: STAGE_W, height: STAGE_H }}
                  >
                    <div className="text-xs font-semibold text-slate-800" style={oneLineClamp}>
                      {stage.title}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                      <span>{Math.round((stage.readiness || 0) * 100)}%</span>
                      {normsCount ? (
                        <span className="flex items-center gap-0.5">
                          <HiBookOpen className="h-3 w-3" /> {normsCount} norms
                        </span>
                      ) : null}
                      {stage.openGapIds.length ? <span className="text-slate-500">{stage.openGapIds.length} gaps</span> : null}
                    </div>
                  </button>
                )
              })}

              {/* Leaf nodes */}
              {layout.leaves.map((leaf) => {
                const isSelected = selectedId === leaf.id
                if (leaf.node.kind === 'claim') {
                  const claim = leaf.node.claim
                  const tone = claimTone(claim)
                  return (
                    <button
                      key={leaf.id}
                      onClick={() => setSelectedId(leaf.id)}
                      className={clsx(
                        'absolute rounded-lg border border-slate-200 border-l-4 bg-white px-2.5 py-1.5 text-left shadow-sm transition-shadow hover:shadow-prep-card',
                        tone.border,
                        isSelected && 'ring-2 ring-prep-accent'
                      )}
                      style={{ left: leaf.x - POINT_W / 2, top: leaf.y - POINT_H / 2, width: POINT_W, height: POINT_H }}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                        <span className={clsx('h-1.5 w-1.5 flex-none rounded-full', tone.dot)} />
                        <span className="font-medium text-slate-500" style={oneLineClamp}>
                          {claim.pointLabel}
                        </span>
                        {claim.provenance === 'ai_generated' && claim.status === 'unconfirmed' ? (
                          <HiSparkles className="h-3 w-3 flex-none text-violet-400" />
                        ) : null}
                      </div>
                      <p
                        className={clsx('mt-0.5 text-xs leading-snug', claim.status === 'rejected' ? 'text-slate-400 line-through' : 'text-slate-700')}
                        style={{ ...oneLineClamp, WebkitLineClamp: 2 }}
                      >
                        {claim.claimText}
                      </p>
                    </button>
                  )
                }
                const gap = leaf.node.gap
                return (
                  <button
                    key={leaf.id}
                    onClick={() => setSelectedId(leaf.id)}
                    className={clsx(
                      'absolute rounded-lg border border-dashed border-slate-300 bg-slate-50/80 px-2.5 py-1.5 text-left transition-shadow hover:shadow-prep-card',
                      isSelected && 'ring-2 ring-prep-accent'
                    )}
                    style={{ left: leaf.x - POINT_W / 2, top: leaf.y - POINT_H / 2, width: POINT_W, height: POINT_H }}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                      <HiExclamationTriangle className="h-3 w-3 flex-none text-slate-400" />
                      <span className="font-medium text-slate-500" style={oneLineClamp}>
                        {gap.pointLabel}
                      </span>
                      <span className="ml-auto rounded bg-slate-200/70 px-1 py-0.5 text-[9px]">{gap.priority}</span>
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-slate-500" style={{ ...oneLineClamp, WebkitLineClamp: 2 }}>
                      {gap.ask}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Inspector */}
        <aside className="hidden w-[340px] flex-none border-l border-slate-100 lg:block" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          <div className="h-full overflow-y-auto p-4">
            {!selected ? (
              <div className="mt-8 text-center text-xs text-slate-400">
                <HiViewfinderCircle className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                Select a node to review it here.
                <p className="mt-2">
                  Solid cards are claims to confirm or correct; dashed cards are gaps you can answer — or hand to the AI.
                </p>
              </div>
            ) : selected.kind === 'anchor' ? (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-prep-accent">Idea anchor</div>
                <h3 className="mt-1 text-sm font-semibold text-slate-900">{anchorTitle}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{anchorSummary}</p>
                <p className="mt-3 text-[11px] text-slate-400">
                  Every branch of this map must stay consistent with the anchor. Change it from the Grant Prep chat if the idea
                  itself is wrong.
                </p>
              </div>
            ) : selected.kind === 'stage' ? (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Section</div>
                <h3 className="mt-1 text-sm font-semibold text-slate-900">{selected.stage.title}</h3>
                <div className="mt-1 text-xs text-slate-500">
                  {Math.round((selected.stage.readiness || 0) * 100)}% ready · {selected.stage.unconfirmedCount} to confirm ·{' '}
                  {selected.stage.openGapIds.length} gaps
                </div>
                {selected.stage.openGapIds.length && !readOnly ? (
                  <button
                    onClick={() => onAiFill(selected.stage.openGapIds)}
                    disabled={busy || aiFillBusy}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    <HiSparkles className="h-3.5 w-3.5" />
                    {aiFillBusy ? 'AI drafting…' : `Let AI draft the ${selected.stage.openGapIds.length} open gap${selected.stage.openGapIds.length === 1 ? '' : 's'}`}
                  </button>
                ) : null}
                <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    <HiBookOpen className="h-3.5 w-3.5" /> Section norms
                  </div>
                  <StageNormsPanel stageKey={selected.stage.key} guidelinePack={guidelinePack} />
                </div>
              </div>
            ) : selected.leaf.node.kind === 'claim' ? (
              (() => {
                const claim = selected.leaf.node.claim
                return (
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="font-medium text-slate-500">{claim.pointLabel}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5">{claim.priority}</span>
                      <ProvenanceChip claim={claim} />
                    </div>
                    {editing ? (
                      <div className="mt-2">
                        <textarea
                          value={editText}
                          onChange={(event) => setEditText(event.target.value)}
                          rows={5}
                          className="w-full rounded-lg border border-slate-200 bg-prep-inputBg p-3 text-sm focus:border-prep-accent focus:outline-none"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={async () => {
                              if (await onEditSave(claim, editText.trim())) {
                                setEditing(false)
                                setEditText('')
                              }
                            }}
                            disabled={busy || !editText.trim()}
                            className="rounded-lg bg-prep-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-prep-accentDark disabled:bg-slate-200"
                          >
                            Save as mine
                          </button>
                          <button
                            onClick={() => setEditing(false)}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p
                        className={clsx(
                          'mt-2 text-sm leading-relaxed',
                          claim.status === 'rejected' ? 'text-slate-400 line-through' : 'text-slate-800'
                        )}
                      >
                        {claim.claimText}
                      </p>
                    )}
                    {claim.sourceQuote && !editing ? (
                      <p className="mt-2 border-l-2 border-sky-200 pl-2 text-xs italic text-slate-400">“{claim.sourceQuote}”</p>
                    ) : null}
                    {claim.assumption && !editing ? (
                      <p className="mt-2 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs text-violet-700">
                        {claim.assumption} — verify before you confirm.
                      </p>
                    ) : null}
                    {spotCheckOpen && claim.spotCheck ? (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-amber-700">Spot-check</div>
                        <p className="mt-1 text-sm text-amber-900">{claim.spotCheck}</p>
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => handleConfirmClick(claim)}
                            disabled={busy}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                          >
                            Yes — confirm
                          </button>
                          <button
                            onClick={() => {
                              setSpotCheckOpen(false)
                              setEditing(true)
                              setEditText(claim.claimText)
                            }}
                            className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100"
                          >
                            No — fix it
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {!readOnly && !editing && (claim.status === 'unconfirmed' || claim.status === 'rejected') ? (
                      <div className="mt-3 flex gap-2">
                        {claim.status === 'unconfirmed' ? (
                          <button
                            onClick={() => handleConfirmClick(claim)}
                            disabled={busy}
                            className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                          >
                            <HiCheck className="h-3.5 w-3.5" /> Confirm
                          </button>
                        ) : null}
                        <button
                          onClick={() => {
                            setEditing(true)
                            setEditText(claim.claimText)
                            setSpotCheckOpen(false)
                          }}
                          disabled={busy}
                          className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                        >
                          <HiPencilSquare className="h-3.5 w-3.5" /> {claim.status === 'rejected' ? 'Rewrite' : 'Edit'}
                        </button>
                        {claim.status === 'unconfirmed' ? (
                          <button
                            onClick={() => onReject(claim)}
                            disabled={busy}
                            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"
                          >
                            <HiXMark className="h-3.5 w-3.5" /> Strike
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                      <button
                        onClick={() => setNormsOpen((open) => !open)}
                        className="flex w-full items-center gap-1.5 text-xs font-semibold text-slate-600"
                      >
                        <HiBookOpen className="h-3.5 w-3.5" /> Section norms
                        <span className="ml-auto text-slate-400">{normsOpen ? 'hide' : 'show'}</span>
                      </button>
                      {normsOpen ? (
                        <div className="mt-2">
                          <StageNormsPanel stageKey={claim.stageKey} guidelinePack={guidelinePack} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })()
            ) : (
              (() => {
                const gap = selected.leaf.node.gap
                return (
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <HiExclamationTriangle className="h-3.5 w-3.5 text-slate-400" />
                      <span className="font-medium text-slate-500">{gap.pointLabel}</span>
                      <span className="rounded bg-slate-200/70 px-1.5 py-0.5">{gap.priority}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{gap.ask}</p>
                    {!readOnly ? (
                      <>
                        <textarea
                          value={gapText}
                          onChange={(event) => setGapText(event.target.value)}
                          rows={4}
                          placeholder="Type your answer…"
                          className="mt-3 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm focus:border-prep-accent focus:outline-none"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={async () => {
                              if (await onGapFill(gap, gapText.trim())) setGapText('')
                            }}
                            disabled={busy || !gapText.trim()}
                            className="rounded-lg bg-prep-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-prep-accentDark disabled:bg-slate-200 disabled:text-slate-400"
                          >
                            Save my answer
                          </button>
                          <button
                            onClick={() => onAiFill([gap.id])}
                            disabled={busy || aiFillBusy}
                            className="flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                          >
                            <HiSparkles className="h-3.5 w-3.5" /> {aiFillBusy ? 'Drafting…' : 'Let AI draft it'}
                          </button>
                        </div>
                        <p className="mt-2 text-[11px] text-slate-400">
                          AI drafts arrive as violet claims you still review and confirm — nothing enters the blueprint unchecked.
                        </p>
                      </>
                    ) : null}
                    <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                        <HiBookOpen className="h-3.5 w-3.5" /> Section norms
                      </div>
                      <StageNormsPanel stageKey={gap.stageKey} guidelinePack={guidelinePack} />
                    </div>
                  </div>
                )
              })()
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
