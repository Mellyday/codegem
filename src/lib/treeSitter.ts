import { Parser, Language, type Node as TreeSitterNode } from 'web-tree-sitter'

import pythonWasmUrl from 'tree-sitter-python/tree-sitter-python.wasm?url'
import treeSitterWasmUrl from 'web-tree-sitter/tree-sitter.wasm?url'

type SupportedLanguageId = 'python'

type LanguageConfig = {
  id: SupportedLanguageId
  wasmUrl: string
  extensions: ReadonlySet<string>
  displayName: string
}

type Position = {
  row: number
  column: number
}

export type TreeSitterAstNode = {
  type: string
  named: boolean
  startPosition: Position
  endPosition: Position
  // Absolute character indices within the full source string
  startIndex: number
  endIndex: number
  text?: string
  children: TreeSitterAstNode[]
  namedChildren: TreeSitterAstNode[]
}

const supportedLanguages: LanguageConfig[] = [
  {
    id: 'python',
    displayName: 'Python',
    wasmUrl: pythonWasmUrl,
    extensions: new Set(['py']),
  },
]

const extensionToLanguage = new Map<string, LanguageConfig>()
for (const config of supportedLanguages) {
  for (const ext of config.extensions) {
    extensionToLanguage.set(ext, config)
  }
}

let initPromise: Promise<void> | undefined

const getInitPromise = () => {
  if (!initPromise) {
    console.log('Initializing Tree-sitter...')
    initPromise = Parser.init({
      locateFile: (scriptName: string, scriptDirectory: string) => {
        const url =
          scriptName === 'tree-sitter.wasm'
            ? treeSitterWasmUrl
            : `${scriptDirectory}${scriptName}`
        console.log(`Loading WASM file: ${scriptName} from ${url}`)
        return url
      },
    })
      .then(() => {
        console.log('Tree-sitter initialization completed')
      })
      .catch((error) => {
        console.error('Tree-sitter initialization failed:', error)
        throw error
      })
  }
  return initPromise
}

const languageCache = new Map<SupportedLanguageId, Promise<Language>>()

const loadLanguage = async (config: LanguageConfig) => {
  const cached = languageCache.get(config.id)
  if (cached) {
    console.log(`Using cached language: ${config.id}`)
    return cached
  }

  console.log(`Loading language: ${config.id} from ${config.wasmUrl}`)
  const promise = getInitPromise()
    .then(async () => {
      console.log(`Tree-sitter initialized, loading language: ${config.id}`)
      const language = await Language.load(config.wasmUrl)
      console.log(`Language loaded successfully: ${config.id}`)
      return language
    })
    .catch((error) => {
      console.error(`Failed to load language ${config.id}:`, error)
      languageCache.delete(config.id)
      throw error
    })

  languageCache.set(config.id, promise)
  return promise
}

const serialiseNode = (node: TreeSitterNode): TreeSitterAstNode => {
  // Only serialise named children to avoid duplicating the tree structure
  // (namedChildren is a subset of children). Rendering both massively inflates
  // the AST and can freeze the UI.
  const toSerializableNamedChildren = (items: (TreeSitterNode | null)[]) =>
    items
      .filter((item): item is TreeSitterNode => item !== null)
      .map(serialiseNode)

  const namedChildren = toSerializableNamedChildren(node.namedChildren)

  const leafText = node.childCount === 0 ? node.text : undefined

  return {
    type: node.type,
    named: node.isNamed,
    startPosition: { ...node.startPosition },
    endPosition: { ...node.endPosition },
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    text: leafText?.length ? leafText : undefined,
    // Expose only named children; keep `children` empty to maintain shape
    children: [],
    namedChildren,
  }
}

export type TreeSitterParseSuccess = {
  ast: TreeSitterAstNode
  parser: 'tree-sitter'
  languageId: SupportedLanguageId
  languageName: string
}

export const canParseWithTreeSitter = (extension: string) =>
  extensionToLanguage.has(extension)

export const parseWithTreeSitter = async (
  code: string,
  extension: string,
): Promise<TreeSitterParseSuccess> => {
  console.log(`Starting Tree-sitter parse for .${extension} file`)
  const config = extensionToLanguage.get(extension)

  if (!config) {
    throw new Error(
      `Tree-sitter parser is not configured for .${extension || 'unknown'} files`,
    )
  }

  console.log(`Loading language for parsing: ${config.id}`)
  const language = await loadLanguage(config)
  console.log(`Language loaded, creating parser for ${config.id}`)
  const parser = new Parser()

  try {
    console.log(`Setting language and parsing code (${code.length} characters)`)
    parser.setLanguage(language)
    const tree = parser.parse(code)

    if (!tree) {
      throw new Error('Tree-sitter was unable to produce a syntax tree.')
    }

    console.log(
      `Parsing completed, tree has ${tree.rootNode.childCount} children`,
    )

    const ast = serialiseNode(tree.rootNode)
    console.log(`AST serialized, tree deleted`)
    tree.delete()

    return {
      ast,
      parser: 'tree-sitter',
      languageId: config.id,
      languageName: config.displayName,
    }
  } catch (error) {
    console.error(`Error during Tree-sitter parsing:`, error)
    throw error
  } finally {
    console.log(`Cleaning up parser`)
    parser.delete()
  }
}
