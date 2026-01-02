type RunControllerMap = Map<string, AbortController>;

const globalForRuns = globalThis as {
  __distractorRunControllers?: RunControllerMap;
};

const controllers: RunControllerMap =
  globalForRuns.__distractorRunControllers ?? new Map<string, AbortController>();

if (!globalForRuns.__distractorRunControllers) {
  globalForRuns.__distractorRunControllers = controllers;
}

export function registerRunController(runId: string, controller: AbortController) {
  controllers.set(runId, controller);
}

export function clearRunController(runId: string) {
  controllers.delete(runId);
}

export function cancelRunController(runId: string): boolean {
  const controller = controllers.get(runId);
  if (!controller) return false;
  try {
    controller.abort();
  } catch { }
  controllers.delete(runId);
  return true;
}
