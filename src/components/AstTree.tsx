import { Fragment } from 'react'
import type { JSX } from 'react'

import type { TreeSitterAstNode } from '../lib/treeSitter'

type AstNode = {
  type: string
  [key: string]: unknown
}

type AstTreeProps = {
  root: AstNode | TreeSitterAstNode
  defaultOpenDepth?: number
}

type TreeNodeProps = {
  label?: string
  value: unknown
  depth: number
  defaultOpenDepth: number
  seen: WeakSet<object>
}

const IGNORED_KEYS = new Set([
  'type',
  'loc',
  'start',
  'end',
  'leadingComments',
  'innerComments',
  'trailingComments',
  'extra',
  // Hide generic children array to avoid noise; for Tree-sitter we prefer namedChildren
  'children',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isAstNode = (value: unknown): value is AstNode =>
  isRecord(value) && typeof value.type === 'string'

const formatPrimitive = (value: unknown) => {
  if (typeof value === 'string') {
    return `"${value}"`
  }
  if (value === null) {
    return 'null'
  }
  return String(value)
}

const getChildEntries = (node: AstNode) =>
  Object.entries(node).filter(
    ([key, value]) => !IGNORED_KEYS.has(key) && value !== undefined,
  )

const renderTreeNode = ({
  value,
  label,
  depth,
  defaultOpenDepth,
  seen,
}: TreeNodeProps): JSX.Element | null => {
  if (value === undefined) {
    return null
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <li className="text-xs italic text-slate-400">
          {label}
          {': []'}
        </li>
      )
    }

    return (
      <li>
        <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700">
          {label ?? 'items'}
          <span className="ml-auto text-[11px] text-slate-500">[{value.length}]</span>
        </div>
        <ul className="space-y-2 border-l border-slate-200 pl-4">
          {value.map((item, index) => (
            <Fragment key={index}>
              {renderTreeNode({
                value: item,
                label: `${label ?? 'item'}[${index}]`,
                depth: depth + 1,
                defaultOpenDepth,
                seen,
              })}
            </Fragment>
          ))}
        </ul>
      </li>
    )
  }

  if (!isRecord(value)) {
    return (
      <li className="text-xs text-slate-600">
        {label}
        {': '}
        <span className="text-slate-700">{formatPrimitive(value)}</span>
      </li>
    )
  }

  if (seen.has(value)) {
    return (
      <li className="text-xs text-slate-500">
        {label}
        {': '}
        <span className="italic text-slate-400">[circular]</span>
      </li>
    )
  }
  seen.add(value)

  if (!isAstNode(value)) {
    return (
      <li>
        <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700">
          {label ?? 'object'}
        </div>
        <ul className="space-y-2 border-l border-slate-200 pl-4">
          {Object.entries(value).map(([childKey, childValue]) => (
            <Fragment key={childKey}>
              {renderTreeNode({
                value: childValue,
                label: childKey,
                depth: depth + 1,
                defaultOpenDepth,
                seen,
              })}
            </Fragment>
          ))}
        </ul>
      </li>
    )
  }

  const childEntries = getChildEntries(value)

  return (
    <li>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
          {value.type}
        </span>
        {label && <span className="text-xs text-slate-500">{label}</span>}
      </div>
      {childEntries.length > 0 ? (
        <ul className="space-y-2 border-l border-slate-200 pl-4">
          {childEntries.map(([childKey, childValue]) => (
            <Fragment key={childKey}>
              {renderTreeNode({
                value: childValue,
                label: childKey,
                depth: depth + 1,
                defaultOpenDepth,
                seen,
              })}
            </Fragment>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-2 text-xs italic text-slate-400">No children</p>
      )}
    </li>
  )
}

export const AstTree = ({ root, defaultOpenDepth = 1 }: AstTreeProps) => {
  const seen = new WeakSet<object>()

  return (
    <div className="space-y-1">
      {renderTreeNode({
        value: root,
        depth: 0,
        label: 'AST',
        defaultOpenDepth,
        seen,
      })}
    </div>
  )
}
