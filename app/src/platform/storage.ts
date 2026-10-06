import type { WorkoutRecord } from "../types";

const DB_NAME = "chad-pace-coach";
const STORE = "workouts";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveWorkout(record: WorkoutRecord): Promise<void> {
  await run("readwrite", (s) => s.put(record));
}

export async function deleteWorkout(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}

export async function getWorkout(id: string): Promise<WorkoutRecord | undefined> {
  return run<WorkoutRecord | undefined>("readonly", (s) => s.get(id));
}

export async function listWorkouts(): Promise<WorkoutRecord[]> {
  const all = await run<WorkoutRecord[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.date.localeCompare(a.date));
}

export async function exportWorkoutsJson(): Promise<string> {
  return JSON.stringify(await listWorkouts(), null, 2);
}
