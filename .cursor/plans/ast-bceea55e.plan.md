<!-- bceea55e-ebf7-496f-bdf1-be1a98d092d6 bddc1bc5-c8a6-4b5d-8790-d4094a6504fe -->
# AstChildrenSidebar correctness and portability fixes

### Scope

Apply targeted fixes and small robustness improvements to `src/components/AstChildrenSidebar.tsx` (and optionally `src/lib/treeSitter.ts` for field support) based on feedback. Keep existing UI semantics and stable section keys.

### 1) Dictionary comprehensions: correct key/value extraction (10–15 min)

Replace positional heuristic with explicit `pair` extraction.

```ts
case 'dictionary_comprehension': {
  // {k: v for ... if ...}
  const pair = firstChildOfType(node, 'pair')
  const key = pair?.namedChildren?.[0] ? [pair.namedChildren[0]] : []
  const value = pair?.namedChildren?.[1] ? [pair.namedChildren[1]] : []
  const generators = (node.namedChildren || []).filter(
    (c) => c.type === 'for_in_clause' || c.type === 'if_clause',
  )
  return [
    { key: 'key', items: key },
    { key: 'value', items: value },
    { key: 'generators', items: generators },
  ]
}
```

### 2) Class-pattern binds: only capture real bindings (20–30 min)

Limit bindings to `capture_pattern` and `as_pattern` identifiers.

```ts
case 'class_pattern': {
  const cls =
    firstChildOfType(node, 'identifier') ||
    firstChildOfType(node, 'dotted_name')

  const argsNode = firstChildOfTypes(node, ['argument_list', 'arguments'])
  const allArgs = argsNode ? argsNode.namedChildren || [] : []
  const keywords = allArgs.filter((c) => c.type === 'keyword_argument')
  const positionals = allArgs.filter((c) => c.type !== 'keyword_argument')

  const captureIds = collectDescendants(node, (n) => n.type === 'capture_pattern')
    .map((n) => firstChildOfType(n, 'identifier'))
    .filter(Boolean) as TreeSitterAstNode[]
  const asIds = collectDescendants(node, (n) => n.type === 'as_pattern')
    .map((n) => (n.namedChildren || []).find((c) => c.type === 'identifier'))
    .filter(Boolean) as TreeSitterAstNode[]
  const boundNames = [...captureIds, ...asIds]

  return [
    { key: 'class', items: cls ? [cls] : [] },
    { key: 'args', items: positionals },
    { key: 'keywords', items: keywords },
    { key: 'binds', items: boundNames },
  ]
}
```

### 3) Comparison handling: add `comparison` fallback (5–10 min)

Handle grammars that use `comparison` instead of `comparison_operator`.

```ts
case 'comparison':
case 'comparison_operator': {
  const children = node.namedChildren || []
  const left = children[0] ? [children[0]] : []
  const comparators = children.slice(1)
  return [
    { key: 'left', items: left },
    { key: 'comparators', items: comparators },
  ]
}
```

### 4) Yield-from detection: widen window, prefer structural if available (10–15 min)

More robust detection for whitespace/comments/long calls.

```ts
const isYieldFrom = (node: TreeSitterAstNode, code?: string) => {
  if (!isYieldType(node.type)) return false
  // Structural token detection if available in serialized nodes:
  // if ((node as any).children?.some((c: any) => c.type === 'from')) return true
  if (!code) return false
  const start = node.startIndex
  const end = Math.min(code.length, node.endIndex + 8) // small lookahead
  const snippet = code.slice(start, end)
  return /\byield\s+from\b/.test(snippet)
}
```

### 5) Boolean operators: mirror binary operator grouping (5–10 min)

```ts
case 'boolean_operator': {
  const children = node.namedChildren || []
  const left = children[0] ? [children[0]] : []
  const right = children.length > 1 ? [children[children.length - 1]] : []
  return [
    { key: 'left', items: left },
    { key: 'right', items: right },
  ]
}
```

### 6) Imports-from: expose wildcard distinctly (10–15 min)

```ts
case 'import_from_statement': {
  const children = node.namedChildren || []
  const moduleNode = children.find(
    (c) => c.type === 'dotted_name' || c.type === 'relative_import',
  )
  const rest = children.filter((c) => c !== moduleNode)
  const wildcard = rest.find((c) => c.type === 'wildcard_import')
  const names = rest.filter(
    (c) =>
      c.type === 'aliased_import' ||
      c.type === 'dotted_name' ||
      c.type === 'identifier',
  )
  return [
    { key: 'module', items: moduleNode ? [moduleNode] : [] },
    ...(wildcard ? [{ key: 'wildcard', items: [wildcard] as TreeSitterAstNode[] }] : []),
    { key: 'names', items: names },
  ]
}
```

### 7) Calls: surface star-args and kwargs-splat (15–25 min)

```ts
case 'call': {
  const func = (node.namedChildren || [])[0]
  const argsList = firstChildOfType(node, 'argument_list')
  const args = argsList ? argsList.namedChildren || [] : []
  const keywords = args.filter((c) => c.type === 'keyword_argument')
  const starargs = args.filter((c) => c.type === 'starred_expression' || c.type === 'list_splat')
  const kwargs_splat = args.filter((c) => c.type === 'dictionary_splat')
  const positionals = args.filter(
    (c) =>
      c.type !== 'keyword_argument' &&
      c.type !== 'starred_expression' &&
      c.type !== 'list_splat' &&
      c.type !== 'dictionary_splat',
  )
  return [
    { key: 'func', items: func ? [func] : [] },
    { key: 'args', items: positionals },
    ...(starargs.length ? [{ key: 'starargs', items: starargs }] : []),
    { key: 'keywords', items: keywords },
    ...(kwargs_splat.length ? [{ key: 'kwargs_splat', items: kwargs_splat }] : []),
  ]
}
```

### 8) Decorators on def/class: expose when present (5–10 min)

Add non-breaking `decorators` section; hidden when empty.

```ts
// inside class_definition and function_definition returns
{ key: 'decorators', items: childrenOfType(node, 'decorator') },
```

### 9) Stable selection identity (10–15 min)

Avoid identity-based flicker.

```ts
const nodesEqual = (a?: TreeSitterAstNode, b?: TreeSitterAstNode) =>
  !!a && !!b && a.type === b.type && a.startIndex === b.startIndex && a.endIndex === b.endIndex

// use nodesEqual(...) wherever selection/hover is compared
```

### 10) Highlight colors: make matches intentional (5–10 min)

Use exact matches for class/func, optional tweak for keywords if desired.

```ts
if (type.startsWith('import')) return 'bg-green-50 border-green-200'
if (type === 'class_definition') return 'bg-purple-50 border-purple-200'
if (type === 'function_definition') return 'bg-blue-50 border-blue-200'
```

### 11) Prefer field-aware access (follow-up) (1.5–2.5 hrs)

Extend `TreeSitterAstNode` serialization in `src/lib/treeSitter.ts` to attach `fieldName?: string` to children, then gradually replace positional heuristics with field-based lookups while keeping fallbacks.

### QA checklist

- Dict comps with nested for/if; `{k: v for (k, v) in items if cond}`
- Patterns: `class_pattern` with `capture_pattern`/`as_pattern`; list/mapping rest
- Chained comparisons: `a < b <= c is not d`
- Yield forms: `yield from` long calls, `yield (x)` vs `yield x`
- Complex for targets: `for (a, (b, c)) in it:`
- Decorators stacked and with args
- Calls with `*args` and `**kwargs`
- Imports-from wildcard `from m import *`

### To-dos

- [ ] Fix dictionary_comprehension to extract key/value from pair
- [ ] Restrict class_pattern binds to capture/as pattern identifiers
- [ ] Support comparison in addition to comparison_operator
- [ ] Harden yield-from detection with lookahead and structural check
- [ ] Add boolean_operator handling like binary_operator
- [ ] Expose wildcard in import_from_statement distinctly
- [ ] Split call args into args, starargs, keywords, kwargs_splat
- [ ] Expose decorators on class/function definitions
- [ ] Compare node equality via type/startIndex/endIndex
- [ ] Tighten highlight colors to exact matches
- [ ] Add fieldName to serializer and use fields where available