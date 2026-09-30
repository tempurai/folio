import {
  Activity,
  ChevronRight,
  ListTree,
  Plug,
  Plus,
  Search,
  Settings,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import { FileTree } from '@/components/file-tree';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { INDEX_ID, type MemoryFolder, type Route } from '@/lib/types';
import { cn } from '@/lib/utils';

const SYS_ROWS: Array<{
  kind: 'sources' | 'organize' | 'activity' | 'settings';
  label: string;
  icon: LucideIcon;
  cnt?: number;
}> = [
  { kind: 'sources', label: '来源', icon: Plug, cnt: 5 },
  { kind: 'organize', label: '整理', icon: Sparkles, cnt: 4 },
  { kind: 'activity', label: '活动', icon: Activity },
  { kind: 'settings', label: '设置', icon: Settings },
];

function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="group/sec flex items-center px-2 pb-[5px] pt-[14px] text-[11px] font-semibold tracking-[0.04em] text-muted-foreground">
      <span className="flex-1">{children}</span>
      {action}
    </div>
  );
}

export function Sidebar({
  route,
  collapsed,
  libraryCollapsed,
  onToggleLibrary,
  onToggleFolder,
  onNavigate,
  onOpenFile,
  onOpenPalette,
}: {
  route: Route;
  collapsed: Set<MemoryFolder>;
  libraryCollapsed: boolean;
  onToggleLibrary: () => void;
  onToggleFolder: (f: MemoryFolder) => void;
  onNavigate: (r: Route) => void;
  onOpenFile: (id: string) => void;
  onOpenPalette: () => void;
}) {
  const selectedFile = route.kind === 'file' ? route.id : null;

  return (
    <aside className="flex w-[258px] flex-none flex-col border-r border-border bg-muted">
      {/* 头部：logo + 名称 + home 路径 */}
      <div className="flex items-center gap-[9px] px-4 pb-3 pt-[14px]">
        <div className="h-[19px] w-[19px] flex-none rounded-[6px] bg-gradient-to-br from-[#4493f8] to-[#0550ae]" />
        <div className="text-[13px] font-semibold tracking-[-0.01em]">tememory</div>
        <div className="ml-auto font-mono text-[10.5px] text-muted-foreground">
          ~/.tememory
        </div>
      </div>

      {/* 搜索入口（⌘K） */}
      <div className="px-3 pb-3">
        <Button
          variant="outline"
          onClick={onOpenPalette}
          className="h-8 w-full justify-start gap-2 px-2.5 text-[12.5px] font-normal text-muted-foreground shadow-none"
        >
          <Search size={13} strokeWidth={2.4} />
          <span className="flex-1 text-left">搜索记忆…</span>
          <kbd className="rounded border border-border bg-muted px-1 py-px font-mono text-[10.5px] leading-[1.4] text-muted-foreground">
            ⌘K
          </kbd>
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <nav className="px-2 pb-3">
          <SectionTitle>系统</SectionTitle>
          <div className="flex flex-col gap-px">
            {SYS_ROWS.map((row) => {
              const Icon = row.icon;
              const selected = route.kind === row.kind;
              return (
                <div
                  key={row.kind}
                  className={cn(
                    'flex cursor-pointer select-none items-center gap-[7px] rounded-md px-2 py-[3.5px] text-[13px] text-muted-foreground hover:bg-active hover:text-foreground',
                    selected && 'bg-active text-foreground',
                  )}
                  onClick={() => onNavigate({ kind: row.kind } as Route)}
                >
                  <Icon size={14} strokeWidth={2} className="flex-none opacity-80" />
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {row.cnt != null && (
                    <span className="text-[11px] text-muted-foreground">
                      {row.cnt}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* 记忆库整段可折叠，位于系统分区之下 */}
          <div
            className="group/sec flex cursor-pointer select-none items-center px-2 pb-[5px] pt-[14px] text-[11px] font-semibold tracking-[0.04em] text-muted-foreground hover:text-foreground"
            onClick={onToggleLibrary}
          >
            <ChevronRight
              size={11}
              strokeWidth={2.5}
              className={cn(
                'mr-[3px] flex-none transition-transform duration-100',
                !libraryCollapsed && 'rotate-90',
              )}
            />
            <span className="flex-1">记忆库</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="新建记忆"
                  className="h-[18px] w-[18px] rounded text-muted-foreground opacity-0 transition-opacity hover:bg-black/[0.06] hover:text-foreground group-hover/sec:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Plus size={13} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">新建记忆</TooltipContent>
            </Tooltip>
          </div>

          {!libraryCollapsed && (
            <>
              {/* MEMORY.md 索引行 */}
              <div
                className={cn(
                  'flex cursor-pointer select-none items-center gap-[7px] rounded-md px-2 py-[3.5px] text-[13px] text-muted-foreground hover:bg-active hover:text-foreground',
                  selectedFile === INDEX_ID && 'bg-active text-foreground',
                )}
                onClick={() => onOpenFile(INDEX_ID)}
              >
                <ListTree size={13} strokeWidth={2} className="flex-none opacity-80" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                  MEMORY.md
                </span>
                <span className="text-[11px] text-muted-foreground">索引</span>
              </div>

              <div className="pt-1">
                <FileTree
                  collapsed={collapsed}
                  onToggleFolder={onToggleFolder}
                  selectedId={selectedFile}
                  onOpenFile={onOpenFile}
                />
              </div>
            </>
          )}
        </nav>
      </ScrollArea>

      {/* 底部同步状态 */}
      <div className="flex items-center gap-[7px] border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
        <span className="h-1.5 w-1.5 flex-none rounded-full bg-success" />
        watch 开启 · 2 分钟前同步
      </div>
    </aside>
  );
}
