import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import './styles.css'
import reportWebVitals from './reportWebVitals.ts'

import App from './App.tsx'
import { SandboxViewer } from './components/SandboxViewer'
import { sandboxRouteMap, sandboxRouteSet } from './sandboxFiles'

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <TanStackRouterDevtools />
    </>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: App,
})

const sandboxPlaceholderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$sandboxId',
  component: SandboxRoute,
})

const routeTree = rootRoute.addChildren([indexRoute, sandboxPlaceholderRoute])

const router = createRouter({
  routeTree,
  context: {},
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('app')
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()

function SandboxRoute() {
  const { sandboxId } = sandboxPlaceholderRoute.useParams()
  const fileName = sandboxRouteMap.get(sandboxId)

  if (!fileName || !sandboxRouteSet.has(sandboxId)) {
    return (
      <main className="min-h-screen bg-[#E8EBF0] text-slate-800">
        <section className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-16">
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-800">Route not found</h2>
            <p className="mt-2 text-sm text-slate-600">
              We couldn't find a sandbox file for the route "{sandboxId}".
            </p>
            <Link
              to="/"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:shadow"
            >
              Back to Routes
            </Link>
          </div>
        </section>
      </main>
    )
  }

  return (
    <SandboxViewer sandboxId={sandboxId} />
  )
}
