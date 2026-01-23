import { parentPort } from "node:worker_threads";
import { getDb } from "../sqlite";
import {
  parseAndPersistRepo,
  parseAndPersistRepoWithProgress,
  type ProgressEvent,
  type RepoProgress,
} from "./repoParser";

type ImportParams = {
  userId: string;
  repoId: string;
  url: string;
  owner: string;
  name: string;
  rootDir: string;
};

type StartMessage = {
  type: "start";
  params: ImportParams;
  withProgress: boolean;
};

type CancelMessage = { type: "cancel" };
type WorkerMessage = StartMessage | CancelMessage;

type WorkerResponse =
  | { type: "progress"; event: ProgressEvent }
  | { type: "result"; progress: RepoProgress }
  | { type: "error"; error: string };

if (!parentPort) {
  throw new Error("repoImportWorker must be run in a worker thread");
}

let abortSignal: { aborted: boolean } | undefined;
let started = false;

const runImport = async (message: StartMessage) => {
  if (started) return;
  started = true;

  try {
    const db = getDb();
    abortSignal = { aborted: false };

    if (message.withProgress) {
      const progress = await parseAndPersistRepoWithProgress(db, {
        ...message.params,
        onProgress: (event) =>
          parentPort?.postMessage({ type: "progress", event } satisfies WorkerResponse),
        abortSignal,
      });
      parentPort.postMessage({ type: "result", progress } satisfies WorkerResponse);
      return;
    }

    const progress = await parseAndPersistRepo(db, message.params);
    parentPort.postMessage({ type: "result", progress } satisfies WorkerResponse);
  } catch (err) {
    parentPort.postMessage({
      type: "error",
      error: String(err),
    } satisfies WorkerResponse);
  }
};

parentPort.on("message", (message: WorkerMessage) => {
  if (message.type === "cancel") {
    if (abortSignal) abortSignal.aborted = true;
    return;
  }

  if (message.type === "start") {
    runImport(message).catch((err) => {
      parentPort?.postMessage({
        type: "error",
        error: String(err),
      } satisfies WorkerResponse);
    });
  }
});
