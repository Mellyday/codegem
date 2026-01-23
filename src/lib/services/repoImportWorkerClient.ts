import { Worker } from "node:worker_threads";
import type { ProgressEvent, RepoProgress } from "./repoParser";

export type RepoImportParams = {
  userId: string;
  repoId: string;
  url: string;
  owner: string;
  name: string;
  rootDir: string;
};

type WorkerResponse =
  | { type: "progress"; event: ProgressEvent }
  | { type: "result"; progress: RepoProgress }
  | { type: "error"; error: string };

export function runRepoImportInWorker(
  params: RepoImportParams,
  options?: { onProgress?: (event: ProgressEvent) => void }
) {
  const worker = new Worker(new URL("./repoImportWorker.ts", import.meta.url), {
    type: "module",
  });
  let settled = false;

  const result = new Promise<RepoProgress>((resolve, reject) => {
    const cleanup = () => {
      worker.removeAllListeners("message");
      worker.removeAllListeners("error");
      worker.removeAllListeners("exit");
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate();
      fn();
    };

    worker.on("message", (message: WorkerResponse) => {
      if (message.type === "progress") {
        options?.onProgress?.(message.event);
        return;
      }
      if (message.type === "result") {
        settle(() => resolve(message.progress));
        return;
      }
      if (message.type === "error") {
        settle(() => reject(new Error(message.error)));
      }
    });

    worker.on("error", (err) => {
      settle(() => reject(err));
    });

    worker.on("exit", (code) => {
      if (settled) return;
      if (code !== 0) {
        settle(() => reject(new Error(`Import worker exited with code ${code}`)));
      }
    });
  });

  worker.postMessage({
    type: "start",
    params,
    withProgress: Boolean(options?.onProgress),
  });

  const cancel = () => {
    worker.postMessage({ type: "cancel" });
  };

  return { result, cancel };
}
