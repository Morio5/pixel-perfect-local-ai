import { createStore, del, entries, get, set } from "idb-keyval";
import { useEffect, useState } from "react";
import type { Project } from "./types";

/** PROJECT STORAGE SERVICE — stores projects & original images on-device (IndexedDB). */
const store = typeof indexedDB !== "undefined" ? createStore("khmer-comic-ai", "projects") : undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
/** Subscribe to project saves/deletes made in this tab. Returns an unsubscribe function. */
export function subscribeProjects(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export async function saveProject(p: Project) {
  p.updatedAt = Date.now();
  await set(p.id, p, store);
  notify();
}
export const loadProject = (id: string) => get<Project>(id, store);
export async function deleteProject(id: string) {
  await del(id, store);
  notify();
}
export async function listProjects(): Promise<Project[]> {
  const all = await entries<string, Project>(store);
  return all.map(([, p]) => p).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  useEffect(() => {
    const load = () => listProjects().then(setProjects).catch(() => setProjects([]));
    load();
    listeners.add(load);
    return () => {
      listeners.delete(load);
    };
  }, []);
  return projects;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
