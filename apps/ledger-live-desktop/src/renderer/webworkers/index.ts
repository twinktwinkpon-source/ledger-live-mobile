export async function initWorker(path: string) {
  // Workers are compiled by rspack into separate files named [name].worker.js
  // (see getWorkerEntries() in rspack.worker.ts: "publicKeyTweakAdd.worker" -> workers/publicKeyTweakAdd.ts)
  // The raw .ts file served by the dev server returns wrong MIME type (video/mp2t),
  // so we must always load the compiled .worker.js bundle — in ALL modes (dev + prod).
  let workerPath = path.split("/").slice(-1)[0];
  if (workerPath.endsWith(".ts")) {
    workerPath = workerPath.replace(".ts", ".worker.js");
  } else if (workerPath.endsWith(".js")) {
    workerPath = workerPath.replace(".js", ".worker.js");
  } else {
    workerPath = workerPath + ".worker.js";
  }
  const worker = new Worker(workerPath, { type: "module" });
  return worker;
}