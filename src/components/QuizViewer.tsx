import { useEffect, useMemo, useState } from 'react'
import type { TreeSitterAstNode } from '../lib/treeSitter'
import { randomString, shuffleArray } from '../lib/utils'

type QuizMode = 'setup' | 'active' | 'complete'

export type QuizViewerProps = {
  root: TreeSitterAstNode
  // Full source code for computing exact text of nodes
  code?: string
  // File context to load saved custom quizzes
  fileKey?: { kind: 'repo' | 'project'; id: string; path: string }
  mode: QuizMode
  onStart: () => void
  onCancel: () => void
  onComplete: () => void
  onReturnToAst: () => void
  // Notify parent of the absolute end index to reveal in the code viewer
  onRevealChange?: (endIndex: number | undefined) => void
}

type Question = {
  // Human-readable stem for the current question
  stem: string
  // The label corresponding to the correct answer
  answerLabel: string
  // Options to display
  options: string[]
  // Optional snippet text to show (used by custom quizzes)
  snippetText?: string
  // Optional metadata for AST-sourced questions
  parentType?: string
  childType?: string
  index?: number
  // For controlling how much of the parent's code to reveal while this question is active
  // Absolute indices within the source file. Only set for AST-sourced questions
  revealStart?: number
  revealEndBeforeChild?: number
  revealEndAfterChild?: number
}

const gatherContainerTypes = (node: TreeSitterAstNode, acc: Set<string>) => {
  if ((node.namedChildren || []).length > 0) {
    acc.add(node.type)
    for (const c of node.namedChildren || []) gatherContainerTypes(c, acc)
  }
  return acc
}

const generateDistractors = (correct: string): string[] => {
  const out = new Set<string>()
  while (out.size < 3) {
    const d = randomString(correct.length)
    if (d !== correct) out.add(d)
  }
  return Array.from(out)
}

const textForNode = (
  node: TreeSitterAstNode,
  code?: string,
): string | undefined => {
  if (node.text && node.text.length > 0) return node.text
  if (code) {
    return code.substring(node.startIndex, node.endIndex)
  }
  return undefined
}

const generateQuestions = (
  node: TreeSitterAstNode,
  breakdownTypes: Set<string>,
  code?: string,
): Question[] => {
  const questions: Question[] = []
  const children = node.namedChildren || []
  children.forEach((child, idx) => {
    if (
      breakdownTypes.has(child.type) &&
      (child.namedChildren || []).length > 0
    ) {
      questions.push(...generateQuestions(child, breakdownTypes, code))
    } else {
      const childType = child.type
      // Prefer the actual source text where available (identifier, parameters, etc.)
      const preferredLabel = textForNode(child, code) || childType
      const distractors = generateDistractors(preferredLabel)
      const options = shuffleArray([preferredLabel, ...distractors])

      // Compute reveal ranges relative to the parent
      const parentStart = node.startIndex
      const revealStart = parentStart
      const revealEndBeforeChild = child.startIndex
      const revealEndAfterChild = child.endIndex

      questions.push({
        stem: 'What comes next?',
        answerLabel: preferredLabel,
        options,
        parentType: node.type,
        index: idx,
        childType,
        revealStart,
        revealEndBeforeChild,
        revealEndAfterChild,
      })
    }
  })
  return questions
}

// Saved Custom Quiz structures (from LessonViewer)
type SavedCustomQuizCard = {
  order: number
  type: string
  text: string
  source: 'visited' | 'pending'
  action: 'next' | 'dig'
  // Optional metadata for smarter custom quizzes
  semanticRole?: string
  question?: string
}

type SavedCustomQuiz = {
  id: string
  kind: 'custom-quiz'
  createdAt: string
  root: { type: string; text: string }
  totalCards: number
  cards: SavedCustomQuizCard[]
}

async function loadSavedCustomQuizzesFromApi(fileKey?: {
  kind: 'repo' | 'project'
  id: string
  path: string
}): Promise<SavedCustomQuiz[]> {
  try {
    if (!fileKey) return []
    const qs = new URLSearchParams({
      kind: fileKey.kind,
      id: fileKey.id,
      path: fileKey.path,
    })
    const res = await fetch(`/api/quizzes?${qs.toString()}`, { method: 'GET' })
    if (!res.ok) return []
    const data = await res.json()
    const list = Array.isArray(data.quizzes) ? data.quizzes : []
    const out: SavedCustomQuiz[] = list.map((q: any) => ({
      id: String(q.id || ''),
      kind: 'custom-quiz',
      createdAt: q.createdAt ? new Date(q.createdAt).toISOString() : new Date().toISOString(),
      root: { type: q.rootNode?.type || 'unknown', text: q.rootNode?.text || '' },
      totalCards: Array.isArray(q.cards) ? q.cards.length : 0,
      cards: (q.cards || []).map((c: any) => ({
        order: c.order,
        type: c.type,
        text: c.text,
        source: 'visited' as const,
        action: c.action === 'dig' ? 'dig' : 'next',
      })),
    }))
    return out
  } catch {
    return []
  }
}

const generateQuestionsFromCustom = (
  quiz: SavedCustomQuiz,
  code?: string,
  astRootFallback?: TreeSitterAstNode,
): Question[] => {
  // Progressive “What comes next?” using saved card texts.
  // Attempts to compute absolute reveal indices by searching within the file's code.
  // Ignore any cards saved from a "dig deeper" action to prevent duplicates
  const cards = quiz.cards
    .filter((c) => c.action !== 'dig')
    .slice()
    .sort((a, b) => a.order - b.order)
  const qs: Question[] = []

  let rootStart = -1
  if (typeof code === 'string') {
    rootStart = code.indexOf(quiz.root.text)
  }
  if (rootStart < 0 && astRootFallback) {
    rootStart = astRootFallback.startIndex
  }

  let cursor = rootStart >= 0 ? rootStart : 0

  for (const c of cards) {
    const correct = c.text
    const options = shuffleArray([correct, ...generateDistractors(correct)])
    const stem = c.question || 'What comes next?'

    if (typeof code === 'string' && rootStart >= 0) {
      let childStart = code.indexOf(correct, cursor)
      if (childStart < 0) {
        childStart = code.indexOf(correct, rootStart)
      }
      if (childStart >= 0) {
        const childEnd = childStart + correct.length
        qs.push({
          stem,
          answerLabel: correct,
          options,
          revealStart: rootStart,
          revealEndBeforeChild: childStart,
          revealEndAfterChild: childEnd,
        })
        cursor = childEnd
        continue
      }
    }

    // Fallback: no reveal indices if we cannot locate in source
    qs.push({
      stem,
      answerLabel: correct,
      options,
    })
  }

  return qs
}

export const QuizViewer = ({
  root,
  code,
  fileKey,
  mode,
  onStart,
  onCancel,
  onComplete,
  onReturnToAst,
  onRevealChange,
}: QuizViewerProps) => {
  // Setup state
  const containerTypes = useMemo(
    () => Array.from(gatherContainerTypes(root, new Set<string>())),
    [root],
  )
  const [breakdownTypes, setBreakdownTypes] = useState<Set<string>>(
    () => new Set(containerTypes.filter((t) => t === 'block')),
  )

  // Custom quiz selection state
  const [savedCustoms, setSavedCustoms] = useState<SavedCustomQuiz[]>([])
  const [selectedCustom, setSelectedCustom] = useState<
    SavedCustomQuiz | undefined
  >(undefined)

  useEffect(() => {
    let cancelled = false
    loadSavedCustomQuizzesFromApi(fileKey).then((list) => {
      if (!cancelled) setSavedCustoms(list)
    })
    return () => {
      cancelled = true
    }
  }, [mode, fileKey])

  // Quiz state
  const [questions, setQuestions] = useState<Question[]>([])
  const [current, setCurrent] = useState(0)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [score, setScore] = useState(0)

  useEffect(() => {
    if (mode === 'active') {
      const qs = selectedCustom
        ? generateQuestionsFromCustom(selectedCustom, code, root)
        : generateQuestions(root, breakdownTypes, code)
      setQuestions(qs)
      setCurrent(0)
      setSelected(undefined)
      setScore(0)
      // Initial reveal if available (applies to AST and custom)
      if (qs.length > 0 && typeof qs[0].revealEndBeforeChild === 'number') {
        onRevealChange?.(qs[0].revealEndBeforeChild)
      } else {
        onRevealChange?.(undefined)
      }
    }
  }, [mode, root, breakdownTypes, code, selectedCustom])

  // Clear reveal when leaving quiz modes
  useEffect(() => {
    if (mode !== 'active') {
      onRevealChange?.(undefined)
    }
  }, [mode, onRevealChange])

  const total = questions.length
  const currentQ = questions[current]

  const handleToggleType = (type: string) => {
    setBreakdownTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const renderSetup = () => {
    // Show unique container-like types available for breakdown selection
    const preview = generateQuestions(root, breakdownTypes)
    return (
      <div className="space-y-4">
        <div className="mb-2">
          <h3 className="text-lg font-semibold text-slate-800">Quiz Setup</h3>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Starting from: <span className="font-mono">{root.type}</span>
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-sm text-slate-700">
            Break down these node types into their children:
          </p>
          {containerTypes.length === 0 ? (
            <p className="text-xs italic text-slate-400">
              No container nodes detected
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {containerTypes.map((t) => (
                <li
                  key={t}
                  className="flex items-center gap-2 rounded bg-white px-2 py-1 text-sm shadow-sm"
                >
                  <input
                    id={`bd-${t}`}
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    checked={breakdownTypes.has(t)}
                    onChange={() => handleToggleType(t)}
                  />
                  <label
                    htmlFor={`bd-${t}`}
                    className="font-mono text-xs text-slate-700"
                  >
                    {t}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <span className="text-sm text-slate-700">
            Preview questions:{' '}
            <span className="font-semibold">{preview.length}</span>
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-amber-600"
              onClick={() => {
                setSelectedCustom(undefined)
                onStart()
              }}
            >
              Start Quiz
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-slate-700">Saved Custom Quizzes</p>
            <button
              type="button"
              className="text-xs text-slate-500 underline decoration-dotted"
              onClick={async () => setSavedCustoms(await loadSavedCustomQuizzesFromApi(fileKey))}
            >
              Refresh
            </button>
          </div>
          {savedCustoms.length === 0 ? (
            <p className="text-xs italic text-slate-400">
              No custom quizzes saved
            </p>
          ) : (
            <ul className="space-y-2">
              {savedCustoms.map((q) => (
                <li
                  key={q.id}
                  className="flex items-center justify-between rounded bg-white px-3 py-2 text-xs shadow-sm"
                >
                  <div className="flex-1">
                    <div className="text-slate-700">
                      {q.root.type}
                      <span className="ml-2 text-slate-400">
                        · {q.totalCards} cards
                      </span>
                    </div>
                    <div className="text-slate-400">
                      {new Date(q.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="ml-3 flex gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-amber-500 px-2.5 py-1 text-white shadow hover:bg-amber-600"
                      onClick={() => {
                        setSelectedCustom(q)
                        onStart()
                      }}
                    >
                      Start
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-slate-700 shadow-sm hover:bg-slate-50"
                      onClick={async () => {
                        try {
                          await fetch(`/api/quizzes?id=${encodeURIComponent(q.id)}`, { method: 'DELETE' })
                        } catch {}
                        setSavedCustoms(await loadSavedCustomQuizzesFromApi(fileKey))
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    )
  }

  const renderActive = () => {
    if (!currentQ) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          Generating questions…
        </div>
      )
    }

    const answered = selected !== undefined
    const correct = selected === currentQ.answerLabel

    const handleSelect = (opt: string) => {
      if (answered) return
      setSelected(opt)
      if (opt === currentQ.answerLabel) setScore((s) => s + 1)
      if (typeof currentQ.revealEndAfterChild === 'number') {
        onRevealChange?.(currentQ.revealEndAfterChild)
      }
    }

    const next = () => {
      if (current + 1 >= total) {
        onComplete()
      } else {
        setCurrent((i) => i + 1)
        setSelected(undefined)
        // Update reveal window for the next question if available (AST or custom)
        const nextQ = questions[current + 1]
        if (nextQ && typeof nextQ.revealEndBeforeChild === 'number') {
          onRevealChange?.(nextQ.revealEndBeforeChild)
        } else {
          onRevealChange?.(undefined)
        }
      }
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">
              {selectedCustom ? 'Custom Quiz' : 'AST Quiz'}
            </h3>
            {!selectedCustom && currentQ.parentType && (
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Parent: <span className="font-mono">{currentQ.parentType}</span>
              </p>
            )}
          </div>
          <div className="text-xs text-slate-500">
            Q {current + 1} / {total} · Score {score}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-800">{currentQ.stem}</p>
          <p className="text-xs text-slate-500">
            Choose the next part of the code.
          </p>

          <ul className="mt-3 grid gap-2">
            {currentQ.options.map((opt) => {
              const isCorrect = opt === currentQ.answerLabel
              const isSelected = selected === opt
              const base =
                'w-full rounded-md border px-3 py-2 text-left text-sm shadow-sm'
              const idle =
                'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
              const correctCls = 'border-green-200 bg-green-50 text-green-700'
              const wrongCls = 'border-rose-200 bg-rose-50 text-rose-700'
              const cls = !answered
                ? `${base} ${idle}`
                : `${base} ${isSelected ? (isCorrect ? correctCls : wrongCls) : isCorrect ? correctCls : idle}`
              return (
                <li key={opt}>
                  <button
                    type="button"
                    className={cls}
                    onClick={() => handleSelect(opt)}
                    disabled={answered}
                  >
                    <span className="font-mono">{opt}</span>
                  </button>
                </li>
              )
            })}
          </ul>

          {answered && (
            <div
              className={`mt-3 rounded-md px-3 py-2 text-sm ${correct ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}
            >
              {correct
                ? 'Correct!'
                : `Incorrect — answer: ${currentQ.answerLabel}`}
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-amber-600 disabled:opacity-50"
              onClick={next}
              disabled={!answered}
            >
              {current + 1 >= total ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderComplete = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-800">Quiz Complete</h3>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          You can return to the AST view.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm text-slate-700">Thanks for playing!</p>
      </div>
      <div className="flex justify-end gap-2">
        {!selectedCustom && (
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            onClick={async () => {
              const exportPayload = {
                type: 'ast-quiz',
                root: {
                  type: root.type,
                  startIndex: root.startIndex,
                  endIndex: root.endIndex,
                },
                totalQuestions: questions.length,
                questions: questions.map((q, i) => ({
                  index: i,
                  stem: q.stem,
                  parentType: q.parentType,
                  childType: q.childType,
                  correctAnswer: q.answerLabel,
                  revealStart: q.revealStart,
                  revealEndBeforeChild: q.revealEndBeforeChild,
                  revealEndAfterChild: q.revealEndAfterChild,
                  codeSnippet:
                    typeof code === 'string' &&
                    typeof q.revealStart === 'number' &&
                    typeof q.revealEndBeforeChild === 'number'
                      ? code.substring(q.revealStart, q.revealEndBeforeChild)
                      : undefined,
                  childText:
                    typeof code === 'string' &&
                    typeof q.revealEndBeforeChild === 'number' &&
                    typeof q.revealEndAfterChild === 'number'
                      ? code.substring(
                          q.revealEndBeforeChild,
                          q.revealEndAfterChild,
                        )
                      : undefined,
                  options: q.options,
                })),
              }

              const json = JSON.stringify(exportPayload, null, 2)

              const fallbackCopy = (text: string) => {
                try {
                  const ta = document.createElement('textarea')
                  ta.value = text
                  ta.style.position = 'fixed'
                  ta.style.left = '-9999px'
                  document.body.appendChild(ta)
                  ta.focus()
                  ta.select()
                  document.execCommand('copy')
                  document.body.removeChild(ta)
                  return true
                } catch {
                  return false
                }
              }

              try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  await navigator.clipboard.writeText(json)
                } else {
                  const ok = fallbackCopy(json)
                  if (!ok) throw new Error('Clipboard unavailable')
                }
              } catch {
                // ignore
              }
            }}
          >
            Copy JSON
          </button>
        )}
        <button
          type="button"
          className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-amber-600"
          onClick={onReturnToAst}
        >
          Return to AST
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      {mode === 'setup' && renderSetup()}
      {mode === 'active' && renderActive()}
      {mode === 'complete' && renderComplete()}
    </div>
  )
}
