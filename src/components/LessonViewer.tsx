import React, { useState, useEffect } from 'react'
import { type TreeSitterAstNode } from '../lib/treeSitter'
import { BookOpen, ChevronsRight, FileJson } from 'lucide-react'
import { randomString } from '../lib/utils'
import { generateLessonPlan, type LessonStep } from '../lib/lessonPlanner'

export type LessonViewerProps = {
  root: TreeSitterAstNode
  code: string
  onReturnToAst: () => void
  onRevealEndIndexChange: (endIndex: number | undefined) => void
  onMaskRangesChange: (ranges: { start: number; end: number }[]) => void
}

const textForNode = (node: TreeSitterAstNode, code: string): string => {
  return code.substring(node.startIndex, node.endIndex)
}

type LessonHistoryItem = (LessonStep & { action?: 'next' | 'dig' })

type MaskRange = { start: number; end: number }

// Find nearest ancestor statement among the given types by walking down from root
function findEnclosingByTypes(
  root: TreeSitterAstNode,
  target: TreeSitterAstNode,
  types: string[],
): TreeSitterAstNode | undefined {
  let found: TreeSitterAstNode | undefined
  const walk = (n: TreeSitterAstNode) => {
    const kids = n.namedChildren || []
    for (const c of kids) {
      if (c.startIndex <= target.startIndex && c.endIndex >= target.endIndex) {
        if (types.includes(c.type)) found = c
        walk(c)
      }
    }
  }
  walk(root)
  return found
}

// Build mask for the leading keyword and compute answer text (header without trailing colon)
function headerMaskAndAnswer(
  stmt: TreeSitterAstNode,
  code: string,
): { masks: MaskRange[]; answerText: string } {
  const nonStructural = new Set([
    'block',
    'else_clause',
    'elif_clause',
    'finally_clause',
    'except_clause',
  ])
  const firstNamed = (stmt.namedChildren || []).find((c) => !nonStructural.has(c.type))
  const maskStart = stmt.startIndex
  const maskEnd = firstNamed ? firstNamed.startIndex : stmt.startIndex

  const full = code.substring(stmt.startIndex, stmt.endIndex)
  const colonIdx = full.indexOf(':')
  const answerText = (colonIdx >= 0 ? full.slice(0, colonIdx) : full.split('\n')[0]).trimEnd()

  const masks = maskEnd > maskStart ? [{ start: maskStart, end: maskEnd }] : []
  return { masks, answerText }
}

// Compute mask and statement-anchored answer for a step
function maskAndAnswerForStep(
  step: LessonStep,
  root: TreeSitterAstNode,
  code: string,
): { masks: MaskRange[]; answerText: string } {
  const headerTypes = ['if_statement', 'elif_clause', 'while_statement', 'for_statement']
  const role = step.semanticRole
  const isHeaderNode = headerTypes.includes(step.node.type)

  if (role === 'if_condition' || role === 'loop_condition' || isHeaderNode) {
    const stmt = isHeaderNode ? step.node : findEnclosingByTypes(root, step.node, headerTypes)
    if (stmt) {
      return headerMaskAndAnswer(stmt, code)
    }
  }
  return { masks: [], answerText: textForNode(step.node, code) }
}

export const LessonViewer: React.FC<LessonViewerProps> = ({
  root,
  code,
  onReturnToAst,
  onRevealEndIndexChange,
  onMaskRangesChange,
}) => {
  const [lessonQueue, setLessonQueue] = useState<LessonStep[]>([])
  const [currentStep, setCurrentStep] = useState(0)
  const [history, setHistory] = useState<LessonHistoryItem[]>([])

  useEffect(() => {
    if (root) {
      // Prefer semantic steps over raw namedChildren
      // Hide function/class names by default for more useful prompts
      const plan = generateLessonPlan(root, { includeNames: false })
      setLessonQueue(plan)
      setCurrentStep(0)
      setHistory([])
    }
  }, [root])

  useEffect(() => {
    if (!lessonQueue.length) return

    if (currentStep === 0) {
      onRevealEndIndexChange(root.startIndex)
    } else {
      const prevStep = lessonQueue[currentStep - 1]
      const currStep = lessonQueue[currentStep]
      if (prevStep) {
        const safeReveal = Math.min(prevStep.node.endIndex, currStep?.node.startIndex ?? prevStep.node.endIndex)
        onRevealEndIndexChange(safeReveal)
      }
    }

    const curr = lessonQueue[currentStep]
    if (curr) {
      const { masks } = maskAndAnswerForStep(curr, root, code)
      onMaskRangesChange(masks)
    } else {
      onMaskRangesChange([])
    }
  }, [currentStep, lessonQueue, root, code, onRevealEndIndexChange, onMaskRangesChange])

  useEffect(() => {
    return () => {
      onRevealEndIndexChange(undefined)
      onMaskRangesChange([])
    }
  }, [onRevealEndIndexChange, onMaskRangesChange])

  const handleNext = () => {
    if (currentStep < lessonQueue.length) {
      const currentStepObject = lessonQueue[currentStep]
      setHistory((prev) => [...prev, { ...currentStepObject, action: 'next' }])
      setCurrentStep((prev) => prev + 1)
    }
  }

  const handleDigDeeper = () => {
    if (currentStep < lessonQueue.length) {
      const stepToExpand = lessonQueue[currentStep]
      const childrenSteps = generateLessonPlan(stepToExpand.node, { includeNames: false })

      if (childrenSteps.length > 0) {
        setHistory((prev) => [...prev, { ...stepToExpand, action: 'dig' }])
        setLessonQueue((prev) => {
          const newQueue = [...prev]
          newQueue.splice(currentStep, 1, ...childrenSteps)
          return newQueue
        })
      }
    }
  }

  const handleSaveCustomQuiz = () => {
    try {
      // Helper to convert a LessonStep into a quiz card with semantic context
      const stepToCard = (
        step: LessonStep,
        order: number,
        source: 'visited' | 'pending',
        action: 'next' | 'dig' = 'next',
      ) => {
        let question = `What is this ${step.node.type}?`
        switch (step.semanticRole) {
          case 'return_type':
            question = 'What is the return type of this function?'
            break
          case 'loop_condition':
          case 'if_condition':
            // Prefer full header instead of just the condition
            question = 'Write the full header line'
            break
        }
        const { answerText } = maskAndAnswerForStep(step, root, code)
        return {
          order,
          type: step.node.type,
          text: answerText,
          source,
          action,
          // extra metadata for smarter custom quizzes
          semanticRole: step.semanticRole,
          question,
        }
      }

      // Exclude any cards where we "dug deeper" to avoid duplicates
      const filteredHistory = history.filter((h) => h.action !== 'dig')
      const visitedCards = filteredHistory.map((step, idx) =>
        stepToCard(step, idx, 'visited', step.action ?? 'next'),
      )
      const pendingCards = lessonQueue
        .slice(currentStep)
        .map((step, i) => stepToCard(step, filteredHistory.length + i, 'pending'))

      const cards = [...visitedCards, ...pendingCards]

      const quiz = {
        id: `${Date.now().toString(36)}_${randomString(6)}`,
        kind: 'custom-quiz' as const,
        createdAt: new Date().toISOString(),
        root: { type: root.type, text: textForNode(root, code) },
        totalCards: cards.length,
        cards,
      }

      const STORAGE_KEY = 'codegem:custom-quizzes'
      const existingRaw = (typeof window !== 'undefined')
        ? window.localStorage.getItem(STORAGE_KEY)
        : null
      const existing: any[] = existingRaw ? JSON.parse(existingRaw) : []
      existing.push(quiz)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))
      }
      alert('Custom quiz saved!')
    } catch (err) {
      console.error('Failed to save custom quiz:', err)
      alert('Failed to save custom quiz.')
    }
  }

  const isComplete = currentStep >= lessonQueue.length
  const nextStep = !isComplete ? lessonQueue[currentStep] : null
  const nextNode = nextStep?.node

  if (isComplete) {
    return (
      <div className="flex h-full flex-col justify-between">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-800">
            Lesson Complete!
          </h3>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            You've walked through the entire code structure.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
          <p className="text-sm text-slate-700">Great job!</p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            onClick={handleSaveCustomQuiz}
          >
            <FileJson className="h-4 w-4" />
            Save Custom Quiz
          </button>
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
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Code Lesson</h3>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Step {currentStep + 1}
          </p>
        </div>
      </div>

      <div className="flex-grow rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
        <p className="text-sm text-slate-800">{nextStep?.prompt}</p>
        <div className="rounded-md bg-white p-3 border border-slate-200">
          <p className="text-xs text-slate-500 font-mono mb-1">
            {nextNode?.type}
          </p>
          <pre className="text-sm text-slate-900 font-mono bg-slate-100 p-2 rounded overflow-auto">
            <code>{nextNode ? textForNode(nextNode, code) : ''}</code>
          </pre>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
          onClick={handleSaveCustomQuiz}
        >
          <FileJson className="h-4 w-4" />
          Save Custom Quiz
        </button>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleDigDeeper}
          disabled={!nextStep?.isDigable}
        >
          <BookOpen className="h-4 w-4" />
          Dig Deeper
        </button>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-amber-600"
          onClick={handleNext}
        >
          Next
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
