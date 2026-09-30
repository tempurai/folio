import { useCallback, useEffect, useState } from 'react';

import { CommandPalette } from '@/components/command-palette';
import { ActivityPage } from '@/components/pages/activity-page';
import { FilePage } from '@/components/pages/file-page';
import { OrganizePage } from '@/components/pages/organize-page';
import { SettingsPage } from '@/components/pages/settings-page';
import { SourcesPage } from '@/components/pages/sources-page';
import { Sidebar } from '@/components/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { api, relPathOf, toMemoryFile } from '@/data/provider';
import { INDEX_ID, type MemoryFile, type MemoryFolder, type Route } from '@/lib/types';
import type { WatchStatus } from '../../shared/ipc';

export default function App() {
  // 默认打开 MEMORY.md 索引页；文件夹默认全部展开
  const [route, setRoute] = useState<Route>({ kind: 'file', id: INDEX_ID });
  const [collapsed, setCollapsed] = useState<Set<MemoryFolder>>(new Set());
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [treeLoaded, setTreeLoaded] = useState(false);
  const [sourcesCount, setSourcesCount] = useState<number | undefined>(undefined);
  const [organizeCount, setOrganizeCount] = useState<number | undefined>(undefined);
  const [watchStatus, setWatchStatus] = useState<WatchStatus>({ enabled: false });
  const [syncing, setSyncing] = useState(false);
  // 任何数据变化 +1，当前页面强制重取数据
  const [dataVersion, setDataVersion] = useState(0);

  const refreshTree = useCallback(async () => {
    const tree = await api.listTree();
    setFiles(tree.folders.flatMap((f) => f.files.map(toMemoryFile)));
    setTreeLoaded(true);
  }, []);

  const refreshWatch = useCallback(async () => {
    setWatchStatus(await api.getWatchStatus());
  }, []);

  const bump = useCallback(() => setDataVersion((v) => v + 1), []);

  useEffect(() => {
    void refreshTree();
    void refreshWatch();
    void api.listSources().then((sources) => setSourcesCount(sources.length));
  }, [refreshTree, refreshWatch]);

  // watch 触发的同步完成 → 刷新树与状态（cleanup 调 unsubscribe）
  useEffect(() => {
    return api.onSyncDone(() => {
      void refreshTree();
      void refreshWatch();
      bump();
    });
  }, [refreshTree, refreshWatch, bump]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openFile = useCallback((id: string) => setRoute({ kind: 'file', id }), []);

  const toggleFolder = useCallback((f: MemoryFolder) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }, []);

  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await api.runSync();
      await Promise.all([refreshTree(), refreshWatch()]);
      bump();
    } finally {
      setSyncing(false);
    }
  }, [syncing, refreshTree, refreshWatch, bump]);

  const handleToggleWatch = useCallback(
    async (enabled: boolean) => {
      setWatchStatus(await api.setWatch(enabled));
    },
    [],
  );

  const handleNewFile = useCallback(
    async (folder: MemoryFolder) => {
      const info = await api.createFile(folder, '未命名', '');
      await refreshTree();
      bump();
      openFile(info.file);
    },
    [refreshTree, bump, openFile],
  );

  /** 文件内容变化（写/归档/整理应用）后的统一刷新 */
  const handleChanged = useCallback(async () => {
    await refreshTree();
    bump();
  }, [refreshTree, bump]);

  const handleShowInFolder = useCallback((folder: MemoryFolder, file: string) => {
    void api.showInFolder(relPathOf(folder, file));
  }, []);

  const handleArchive = useCallback(
    async (folder: MemoryFolder, file: string) => {
      await api.archiveFile(relPathOf(folder, file));
      if (route.kind === 'file' && route.id === file) openFile(INDEX_ID);
      await handleChanged();
    },
    [route, openFile, handleChanged],
  );

  const routeKey = route.kind === 'file' ? `file:${route.id}` : route.kind;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen bg-background">
        <Sidebar
          route={route}
          collapsed={collapsed}
          libraryCollapsed={libraryCollapsed}
          files={files}
          treeLoaded={treeLoaded}
          sourcesCount={sourcesCount}
          organizeCount={organizeCount}
          watchStatus={watchStatus}
          syncing={syncing}
          onToggleLibrary={() => setLibraryCollapsed((v) => !v)}
          onToggleFolder={toggleFolder}
          onNavigate={setRoute}
          onOpenFile={openFile}
          onOpenPalette={() => setPaletteOpen(true)}
          onSync={handleSync}
          onToggleWatch={handleToggleWatch}
          onNewFile={handleNewFile}
          onShowInFolder={handleShowInFolder}
          onArchive={handleArchive}
        />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div key={`${routeKey}:${dataVersion}`}>
            {route.kind === 'file' && (
              <FilePage id={route.id} files={files} onOpenFile={openFile} onChanged={handleChanged} />
            )}
            {route.kind === 'sources' && <SourcesPage />}
            {route.kind === 'organize' && (
              <OrganizePage onChanged={handleChanged} onPlanCount={setOrganizeCount} />
            )}
            {route.kind === 'activity' && <ActivityPage />}
            {route.kind === 'settings' && <SettingsPage />}
          </div>
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        files={files}
        onOpenFile={openFile}
        onNavigate={setRoute}
      />
    </TooltipProvider>
  );
}
