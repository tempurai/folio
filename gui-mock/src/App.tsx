import { useCallback, useEffect, useState } from 'react';

import { CommandPalette } from '@/components/command-palette';
import { ActivityPage } from '@/components/pages/activity-page';
import { FilePage } from '@/components/pages/file-page';
import { OrganizePage } from '@/components/pages/organize-page';
import { SettingsPage } from '@/components/pages/settings-page';
import { SourcesPage } from '@/components/pages/sources-page';
import { Sidebar } from '@/components/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { INDEX_ID, type MemoryFolder, type Route } from '@/lib/types';

export default function App() {
  // 默认打开 MEMORY.md 索引页；文件夹默认全部展开
  const [route, setRoute] = useState<Route>({ kind: 'file', id: INDEX_ID });
  const [collapsed, setCollapsed] = useState<Set<MemoryFolder>>(new Set());
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

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

  const openFile = useCallback(
    (id: string) => setRoute({ kind: 'file', id }),
    [],
  );

  const toggleFolder = useCallback((f: MemoryFolder) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }, []);

  const routeKey = route.kind === 'file' ? `file:${route.id}` : route.kind;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen bg-background">
        <Sidebar
          route={route}
          collapsed={collapsed}
          libraryCollapsed={libraryCollapsed}
          onToggleLibrary={() => setLibraryCollapsed((v) => !v)}
          onToggleFolder={toggleFolder}
          onNavigate={setRoute}
          onOpenFile={openFile}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div key={routeKey}>
            {route.kind === 'file' && <FilePage id={route.id} onOpenFile={openFile} />}
            {route.kind === 'sources' && <SourcesPage />}
            {route.kind === 'organize' && <OrganizePage />}
            {route.kind === 'activity' && <ActivityPage />}
            {route.kind === 'settings' && <SettingsPage />}
          </div>
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenFile={openFile}
        onNavigate={setRoute}
      />
    </TooltipProvider>
  );
}
