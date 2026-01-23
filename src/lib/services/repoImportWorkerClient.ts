import { Worker } from "node:worker_threads";
import { getDb } from "../sqlite";
import {
  parseAndPersistRepo,
  parseAndPersistRepoWithProgress,
  type ProgressEvent,
  type RepoProgress,
} from "./repoParser";

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
  const runInline = () => {
    const db = getDb();
    const abortSignal = { aborted: false };
    const result = options?.onProgress
      ? parseAndPersistRepoWithProgress(db, {
          ...params,
          onProgress: options.onProgress,
          abortSignal,
        })
      : parseAndPersistRepo(db, params);
    return {
      result,
      cancel: () => {
        abortSignal.aborted = true;
      },
    };
  };

  let worker: Worker | null = null;
  let cancelFn = () => {};
  let sawMessage = false;

  try {
    worker = new Worker(new URL("./repoImportWorker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return runInline();
  }

  cancelFn = () => {
    worker?.postMessage({ type: "cancel" });
  };
  let settled = false;

  const result = new Promise<RepoProgress>((resolve, reject) => {
    const cleanupWorker = () => {
      worker?.removeAllListeners("message");
      worker?.removeAllListeners("error");
      worker?.removeAllListeners("exit");
      if (worker) {
        void worker.terminate();
      }
      worker = null;
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanupWorker();
      fn();
    };

    worker?.on("message", (message: WorkerResponse) => {
      sawMessage = true;
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

    worker?.on("error", (err) => {
      if (!sawMessage) {
        const inline = runInline();
        cancelFn = inline.cancel;
        cleanupWorker();
        settled = true;
        inline.result.then(resolve).catch(reject);
        return;
      }
      settle(() => reject(err));
    });

    worker?.on("exit", (code) => {
      if (settled) return;
      if (code !== 0) {
        if (!sawMessage) {
          const inline = runInline();
          cancelFn = inline.cancel;
          cleanupWorker();
          settled = true;
          inline.result.then(resolve).catch(reject);
          return;
        }
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
    cancelFn();
  };

  return { result, cancel };
}
