import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import Dexie from "dexie";
Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
Object.assign(globalThis, { indexedDB, IDBKeyRange });
