'use client'

import { useState } from 'react'

/**
 * Recursive org-unit tree of arbitrary depth.
 *
 * Replaces the two hardcoded nesting loops (school -> department) that made a
 * third level literally unrenderable. One node component that calls itself,
 * with a single "add sub-unit" affordance per node rather than two structurally
 * distinct add-forms.
 */

export interface OrgUnitNode {
  id: string
  name: string
  code: string | null
  parentId: string | null
  depth: number
  levelLabel: string
  isActive: boolean
  facultyCount: number
  rollupFacultyCount: number
  children: OrgUnitNode[]
}

interface Props {
  nodes: OrgUnitNode[]
  /** Tenant's own name for each depth, for the "Add a Department" affordance. */
  levelNameForDepth: (depth: number) => string
  maxDepth: number
  onRename: (id: string, name: string) => void
  onDelete: (id: string, name: string) => void
  onAddChild: (parentId: string, name: string) => void
  onManageHeads?: (id: string, name: string) => void
  headCounts?: Record<string, number>
}

function OrgUnitRow({
  node,
  levelNameForDepth,
  maxDepth,
  onRename,
  onDelete,
  onAddChild,
  onManageHeads,
  headCounts,
}: Omit<Props, 'nodes'> & { node: OrgUnitNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [adding, setAdding] = useState(false)

  const hasChildren = node.children.length > 0
  const canNest = node.depth + 1 <= maxDepth - 1
  const childLabel = levelNameForDepth(node.depth + 1)
  const headCount = headCounts?.[node.id] || 0

  const submitChild = () => {
    const name = draftName.trim()
    if (!name) return
    onAddChild(node.id, name)
    setDraftName('')
    setAdding(false)
  }

  return (
    <li>
      <div
        className="flex items-start justify-between gap-3 py-2 flex-wrap"
        // Indentation is driven by depth so any level reads correctly.
        style={{ paddingLeft: node.depth === 0 ? 0 : 16 }}
      >
        <div className="flex items-start gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setCollapsed(state => !state)}
            className={`mt-0.5 w-4 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ${
              hasChildren ? '' : 'invisible'
            }`}
            aria-label={collapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
          >
            {collapsed ? '▸' : '▾'}
          </button>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {node.name}
              {!node.isActive && (
                <span className="ml-2 text-xs font-normal text-gray-400">(inactive)</span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {node.levelLabel}
              {hasChildren && ` · ${node.children.length} sub-unit${node.children.length !== 1 ? 's' : ''}`}
              {` · ${node.rollupFacultyCount} faculty`}
              {node.facultyCount !== node.rollupFacultyCount && ` (${node.facultyCount} directly)`}
              {headCount > 0 && ` · ${headCount} head${headCount !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        <div className="flex gap-3 text-sm shrink-0">
          {canNest && (
            <button
              onClick={() => setAdding(state => !state)}
              className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
            >
              Add {childLabel.toLowerCase()}
            </button>
          )}
          {onManageHeads && (
            <button
              onClick={() => onManageHeads(node.id, node.name)}
              className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
            >
              Heads
            </button>
          )}
          <button
            onClick={() => onRename(node.id, node.name)}
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
          >
            Rename
          </button>
          <button
            onClick={() => onDelete(node.id, node.name)}
            className="text-red-600 hover:text-red-800 dark:text-red-400"
          >
            Delete
          </button>
        </div>
      </div>

      {adding && (
        <div className="flex gap-2 pb-2" style={{ paddingLeft: (node.depth + 1) * 16 }}>
          <input
            type="text"
            autoFocus
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submitChild()
              if (e.key === 'Escape') setAdding(false)
            }}
            placeholder={`Add a ${childLabel.toLowerCase()}...`}
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
          />
          <button
            onClick={submitChild}
            className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Add
          </button>
        </div>
      )}

      {hasChildren && !collapsed && (
        <ul className="border-l border-gray-100 dark:border-gray-700 ml-2">
          {node.children.map(child => (
            <OrgUnitRow
              key={child.id}
              node={child}
              levelNameForDepth={levelNameForDepth}
              maxDepth={maxDepth}
              onRename={onRename}
              onDelete={onDelete}
              onAddChild={onAddChild}
              onManageHeads={onManageHeads}
              headCounts={headCounts}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function OrgUnitTree({ nodes, ...handlers }: Props) {
  if (nodes.length === 0) return null
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
      {nodes.map(node => (
        <OrgUnitRow key={node.id} node={node} {...handlers} />
      ))}
    </ul>
  )
}

/** Depth-indented options for a single-select picker. `<optgroup>` cannot
 *  nest, which is exactly why the old two-level picker could not go deeper. */
export function flattenForSelect(nodes: OrgUnitNode[]): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = []
  const walk = (list: OrgUnitNode[]) => {
    for (const node of list) {
      out.push({ id: node.id, label: `${'  '.repeat(node.depth)}${node.depth > 0 ? '└ ' : ''}${node.name}` })
      walk(node.children)
    }
  }
  walk(nodes)
  return out
}
