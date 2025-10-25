import type { TreeSitterAstNode } from './treeSitter'
import { randomString } from './utils'

export type LessonStep = {
  id: string
  node: TreeSitterAstNode
  semanticRole: string
  prompt: string
  isDigable: boolean
}

export type LessonPlanOptions = {
  includeNames?: boolean
}

const firstChildOfType = (node: TreeSitterAstNode, type: string) =>
  (node.namedChildren || []).find((c) => c.type === type)

const childrenOfType = (node: TreeSitterAstNode, type: string) =>
  (node.namedChildren || []).filter((c) => c.type === type)

export const generateLessonPlan = (
  node: TreeSitterAstNode,
  options: LessonPlanOptions = {},
): LessonStep[] => {
  const includeNames = options.includeNames ?? true
  const steps: LessonStep[] = []
  const children = node.namedChildren || []

  switch (node.type) {
    case 'module': {
      children.forEach((child) => {
        steps.push(...generateLessonPlan(child, options))
      })
      break
    }

    case 'decorated_definition': {
      // Unwrap and plan the inner definition (class or function)
      const inner = children.find(
        (c) => c.type === 'class_definition' || c.type === 'function_definition',
      )
      if (inner) steps.push(...generateLessonPlan(inner, options))
      break
    }

    case 'class_definition': {
      const name = firstChildOfType(node, 'identifier')
      const body = firstChildOfType(node, 'block')
      const argList = firstChildOfType(node, 'argument_list')
      const bases = argList
        ? (argList.namedChildren || []).filter((c) => c.type !== 'keyword_argument')
        : []
      if (name && includeNames) {
        steps.push({
          id: randomString(8),
          node: name,
          semanticRole: 'class_name',
          prompt: 'We define a class named:',
          isDigable: false,
        })
      }
      if (bases.length > 0) {
        steps.push({
          id: randomString(8),
          node: bases[0], // show first base; can dig to see more
          semanticRole: 'class_base',
          prompt: 'This class inherits from:',
          isDigable: bases.length > 0,
        })
      }
      if (body) {
        steps.push({
          id: randomString(8),
          node: body,
          semanticRole: 'class_body',
          prompt: "Now, let's look inside the class body.",
          isDigable: true,
        })
      }
      break
    }

    case 'function_definition': {
      const name = firstChildOfType(node, 'identifier')
      const params = firstChildOfType(node, 'parameters')
      const returnType = firstChildOfType(node, 'type') || firstChildOfType(node, 'return_type')
      const body = firstChildOfType(node, 'block')

      if (name && includeNames) {
        steps.push({
          id: randomString(8),
          node: name,
          semanticRole: 'function_name',
          prompt: 'We define a function named:',
          isDigable: false,
        })
      }
      if (params) {
        steps.push({
          id: randomString(8),
          node: params,
          semanticRole: 'parameters',
          prompt: 'These are the parameters:',
          isDigable: (params.namedChildren || []).length > 0,
        })
      }
      if (returnType) {
        steps.push({
          id: randomString(8),
          node: returnType,
          semanticRole: 'return_type',
          prompt: 'What is the return type of this function?',
          isDigable: false,
        })
      }
      if (body) {
        steps.push({
          id: randomString(8),
          node: body,
          semanticRole: 'function_body',
          prompt: "Now, let's explore the function body.",
          isDigable: true,
        })
      }
      break
    }

    case 'if_statement': {
      // test, body, orelse (elif/else)
      const test = (children || []).find(
        (c) => !['block', 'elif_clause', 'else_clause'].includes(c.type),
      )
      const body = childrenOfType(node, 'block')[0]
      if (test) {
        steps.push({
          id: randomString(8),
          node: test,
          semanticRole: 'if_condition',
          prompt: 'The if condition is:',
          isDigable: (test.namedChildren || []).length > 0,
        })
      }
      if (body) {
        steps.push({
          id: randomString(8),
          node: body,
          semanticRole: 'if_body',
          prompt: 'If true, this block runs:',
          isDigable: true,
        })
      }
      // Elif/else summarized as diggable children
      const elifs = childrenOfType(node, 'elif_clause')
      const elseClause = firstChildOfType(node, 'else_clause')
      if (elifs.length > 0) {
        steps.push({
          id: randomString(8),
          node: elifs[0],
          semanticRole: 'if_elif',
          prompt: 'Elif clause present (explore for details):',
          isDigable: true,
        })
      }
      if (elseClause) {
        const elseBlock = firstChildOfType(elseClause, 'block') || elseClause
        steps.push({
          id: randomString(8),
          node: elseBlock,
          semanticRole: 'if_else',
          prompt: 'Else branch:',
          isDigable: true,
        })
      }
      break
    }

    case 'while_statement': {
      // Show only the condition first, then the body, hiding the 'while' keyword itself
      const condition = (children || []).find(
        (c) => c.type !== 'block' && c.type !== 'else_clause',
      )
      const body = firstChildOfType(node, 'block')
      if (condition) {
        steps.push({
          id: randomString(8),
          node: condition,
          semanticRole: 'loop_condition',
          prompt: 'The loop continues while this is true:',
          isDigable: (condition.namedChildren || []).length > 0,
        })
      }
      if (body) {
        steps.push({
          id: randomString(8),
          node: body,
          semanticRole: 'loop_body',
          prompt: 'While true, this block executes:',
          isDigable: true,
        })
      }
      const elseClause = firstChildOfType(node, 'else_clause')
      if (elseClause) {
        const elseBlock = firstChildOfType(elseClause, 'block') || elseClause
        steps.push({
          id: randomString(8),
          node: elseBlock,
          semanticRole: 'loop_else',
          prompt: 'Loop else branch (runs if no break):',
          isDigable: true,
        })
      }
      break
    }

    case 'for_statement': {
      const block = firstChildOfType(node, 'block')
      // Heuristic: all head children before body/else, last is iter, preceding are targets
      const head = (children || []).filter(
        (c) => c.type !== 'block' && c.type !== 'else_clause',
      )
      if (head.length >= 1) {
        const iter = head[head.length - 1]
        const targets = head.slice(0, -1)
        if (targets.length > 0) {
          steps.push({
            id: randomString(8),
            node: targets[0],
            semanticRole: 'for_target',
            prompt: 'For-loop target(s):',
            isDigable: targets.length > 1 || (targets[0].namedChildren || []).length > 0,
          })
        }
        if (iter) {
          steps.push({
            id: randomString(8),
            node: iter,
            semanticRole: 'for_iterable',
            prompt: 'Iterating over:',
            isDigable: (iter.namedChildren || []).length > 0,
          })
        }
      }
      if (block) {
        steps.push({
          id: randomString(8),
          node: block,
          semanticRole: 'for_body',
          prompt: 'Loop body:',
          isDigable: true,
        })
      }
      break
    }

    default: {
      children.forEach((child) => {
        steps.push({
          id: randomString(8),
          node: child,
          semanticRole: 'child',
          prompt: `The next piece is a '${child.type}':`,
          isDigable: (child.namedChildren || []).length > 0,
        })
      })
      break
    }
  }

  return steps
}

