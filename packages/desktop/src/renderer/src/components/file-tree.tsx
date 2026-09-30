import { ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FOLDERS, TYPE_DOT_CLASS } from '@/data/mock';
import type { MemoryFile, MemoryFolder } from '@/lib/types';
import { cn } from '@/lib/utils';

function TrailingIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          className="h-[18px] w-[18px] rounded text-muted-foreground hover:bg-black/[0.06] hover:text-foreground"
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function FileRow({
  file,
  selected,
  onOpen,
  onShowInFolder,
  onArchive,
}: {
  file: string;
  selected: boolean;
  onOpen: () => void;
  onShowInFolder: () => void;
  onArchive: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className={cn(
        'group flex cursor-pointer select-none items-center rounded-md py-[3px] pl-2 pr-1 font-mono text-[12px] text-muted-foreground hover:bg-active hover:text-foreground',
        selected && 'bg-active text-foreground',
      )}
      onClick={onOpen}
    >
      <span className="min-w-0 flex-1 truncate">{file}</span>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <span
            className={cn(
              menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <TrailingIconButton label="更多操作">
              <MoreHorizontal size={13} strokeWidth={2} />
            </TrailingIconButton>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="w-44">
          <DropdownMenuItem onSelect={onOpen}>编辑</DropdownMenuItem>
          <DropdownMenuItem onSelect={onShowInFolder}>在 Finder 显示</DropdownMenuItem>
          <DropdownMenuItem>重命名</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onArchive}>归档</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive">
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function FolderNode({
  folder,
  collapsed,
  onToggle,
  files,
  selectedId,
  onOpenFile,
  onNewFile,
  onShowInFolder,
  onArchive,
}: {
  folder: MemoryFolder;
  collapsed: boolean;
  onToggle: () => void;
  files: MemoryFile[];
  selectedId: string | null;
  onOpenFile: (id: string) => void;
  onNewFile: (folder: MemoryFolder) => void;
  onShowInFolder: (folder: MemoryFolder, file: string) => void;
  onArchive: (folder: MemoryFolder, file: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const kids = files.filter((f) => f.folder === folder);
  return (
    <div>
      <div
        className="group flex cursor-pointer select-none items-center gap-[6px] rounded-md py-[3.5px] pl-1.5 pr-1 text-[13px] font-[550] text-foreground/80 hover:bg-active hover:text-foreground"
        onClick={onToggle}
      >
        <ChevronRight
          size={11}
          strokeWidth={2.5}
          className={cn(
            'flex-none text-muted-foreground transition-transform duration-100',
            !collapsed && 'rotate-90',
          )}
        />
        <span
          className={cn('h-1.5 w-1.5 flex-none rounded-full', TYPE_DOT_CLASS[folder])}
        />
        <span className="min-w-0 flex-1 truncate">{folder}/</span>
        {/* hover 时数量换成 trailing 操作（Notion 式）；菜单打开期间保持显示 */}
        <span
          className={cn(
            'items-center group-hover:hidden',
            menuOpen ? 'hidden' : 'flex',
          )}
        >
          <span className="px-1 text-[11px] font-normal text-muted-foreground">
            {kids.length}
          </span>
        </span>
        <span
          className={cn(
            'items-center gap-0.5',
            menuOpen ? 'flex' : 'hidden group-hover:flex',
          )}
        >
          <span onClick={(e) => e.stopPropagation()}>
            <TrailingIconButton label="新建文件" onClick={() => onNewFile(folder)}>
              <Plus size={13} strokeWidth={2} />
            </TrailingIconButton>
          </span>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <span onClick={(e) => e.stopPropagation()}>
                <TrailingIconButton label="更多操作">
                  <MoreHorizontal size={13} strokeWidth={2} />
                </TrailingIconButton>
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" className="w-44">
              <DropdownMenuItem onSelect={() => onNewFile(folder)}>新建文件</DropdownMenuItem>
              <DropdownMenuItem>重命名目录</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>在 Finder 显示</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      {!collapsed && (
        <div className="ml-[13px] border-l border-black/[0.03] pl-1.5">
          {kids.map((k) => (
            <FileRow
              key={k.file}
              file={k.file}
              selected={selectedId === k.file}
              onOpen={() => onOpenFile(k.file)}
              onShowInFolder={() => onShowInFolder(folder, k.file)}
              onArchive={() => onArchive(folder, k.file)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({
  collapsed,
  onToggleFolder,
  files,
  selectedId,
  onOpenFile,
  onNewFile,
  onShowInFolder,
  onArchive,
}: {
  collapsed: Set<MemoryFolder>;
  onToggleFolder: (f: MemoryFolder) => void;
  files: MemoryFile[];
  selectedId: string | null;
  onOpenFile: (id: string) => void;
  onNewFile: (folder: MemoryFolder) => void;
  onShowInFolder: (folder: MemoryFolder, file: string) => void;
  onArchive: (folder: MemoryFolder, file: string) => void;
}) {
  return (
    <div className="flex flex-col gap-px">
      {FOLDERS.map((f) => (
        <FolderNode
          key={f}
          folder={f}
          collapsed={collapsed.has(f)}
          onToggle={() => onToggleFolder(f)}
          files={files}
          selectedId={selectedId}
          onOpenFile={onOpenFile}
          onNewFile={onNewFile}
          onShowInFolder={onShowInFolder}
          onArchive={onArchive}
        />
      ))}
    </div>
  );
}
