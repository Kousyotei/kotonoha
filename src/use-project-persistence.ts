import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "./model";
import { loadLocalProject, saveLocalProject, storageFailure, type LocalWorkspace } from "./project-storage";

export function useProjectPersistence(
  project: Project, draft: string, onRestore: (workspace: LocalWorkspace) => void,
) {
  // Tokens track dirty state without retaining an old project's large audio
  // strings after replacing a recording or switching projects.
  const token = useMemo(() => ({}), [project, draft]);
  const cleanToken = useRef(token);
  const pendingRestore = useRef<LocalWorkspace | null>(null);
  if (pendingRestore.current?.project === project && pendingRestore.current.draft === draft) {
    cleanToken.current = token;
    pendingRestore.current = null;
  }
  const current = useRef({ project, draft, token });
  current.current = { project, draft, token };
  const restore = useRef(onRestore); restore.current = onRestore;
  const alive = useRef(true), savingRef = useRef(false);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null), [error, setError] = useState("");
  const dirty = token !== cleanToken.current;

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const workspace = await loadLocalProject();
        if (cancelled) return;
        if (workspace) {
          pendingRestore.current = workspace;
          restore.current(workspace);
          setSavedAt(workspace.savedAt);
        }
      } catch (error) {
        if (!cancelled) setError(`读取本机项目失败：${storageFailure(error)} 原保存数据未改动。`);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; alive.current = false; };
  }, []);

  async function save() {
    if (loading || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError("");
    const snapshot = current.current;
    try {
      const date = await saveLocalProject(snapshot.project, snapshot.draft);
      if (alive.current) {
        cleanToken.current = snapshot.token;
        setSavedAt(date);
      }
      // Best effort: browsers decide whether to protect site data from
      // automatic eviction. Save success never depends on this grant.
      void globalThis.navigator?.storage?.persist?.().catch(() => {});
    } catch (error) {
      if (alive.current) setError(`保存失败：${storageFailure(error)}`);
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  }
  const latestSave = useRef(save); latestSave.current = save;
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault(); void latestSave.current();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (loading || (!dirty && !saving)) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [loading, dirty, saving]);

  const status = loading ? "正在恢复本机项目…" : saving ? "正在保存到本机…" :
    dirty ? "有未保存更改" : savedAt ?
      `已保存到本机 · ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "尚未保存到本机";
  return { loading, saving, dirty, status, error, save };
}
