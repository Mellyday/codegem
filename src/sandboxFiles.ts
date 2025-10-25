import { canParseWithBabel } from './lib/ast'
import { canParseWithTreeSitter } from './lib/treeSitter'

const sandboxModules = import.meta.glob<string>('../code_sandbox/*', {
  eager: false,
  query: '?raw',
  import: 'default',
})

const extractFileName = (path: string) => path.split('/').pop() ?? ''
const stripExtension = (fileName: string) => fileName.replace(/\.[^/.]+$/, '')
const getExtension = (fileName: string) => fileName.split('.').pop() ?? ''

const sandboxFiles = Object.keys(sandboxModules)
  .map(extractFileName)
  .filter((fileName) => fileName.length > 0)
  .sort()

type SandboxRoute = {
  fileName: string
  routePath: string
  label: string
  astSupport: 'babel' | 'tree-sitter' | 'none'
}

export type { SandboxRoute }

export const sandboxRoutes: SandboxRoute[] = sandboxFiles.map((fileName) => {
  const routePath = stripExtension(fileName)
  const extension = getExtension(fileName)

  const astSupport = canParseWithBabel(fileName)
    ? 'babel'
    : canParseWithTreeSitter(extension)
      ? 'tree-sitter'
      : 'none'

  return {
    fileName,
    routePath,
    label: routePath,
    astSupport,
  }
})

export const sandboxRouteMap = new Map(
  sandboxRoutes.map(({ routePath, fileName }) => [routePath, fileName] as const),
)

export const sandboxRouteSet = new Set(sandboxRouteMap.keys())

export const sandboxModuleMap = new Map(
  Object.entries(sandboxModules) as [string, () => Promise<string>][],
)

export const getSandboxModuleLoader = (routePath: string) => {
  const fileName = sandboxRouteMap.get(routePath)
  if (!fileName) {
    return undefined
  }

  const modulePath = `../code_sandbox/${fileName}`
  return sandboxModules[modulePath]
}

export const getSandboxFileName = (routePath: string) => sandboxRouteMap.get(routePath)
