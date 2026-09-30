import { Activity, ListTree, Plug, Settings, Sparkles } from 'lucide-react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { FILES, TYPE_DOT_CLASS } from '@/data/mock';
import { INDEX_ID, type Route } from '@/lib/types';
import { cn } from '@/lib/utils';

const PAGES: Array<{
  kind: 'sources' | 'organize' | 'activity' | 'settings';
  label: string;
  icon: typeof Plug;
}> = [
  { kind: 'sources', label: '来源', icon: Plug },
  { kind: 'organize', label: '整理', icon: Sparkles },
  { kind: 'activity', label: '活动', icon: Activity },
  { kind: 'settings', label: '设置', icon: Settings },
];

export function CommandPalette({
  open,
  onOpenChange,
  onOpenFile,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenFile: (id: string) => void;
  onNavigate: (r: Route) => void;
}) {
  const pick = (fn: () => void) => () => {
    fn();
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="搜索记忆、页面…" />
      <CommandList>
        <CommandEmpty>没有匹配的记忆。</CommandEmpty>
        <CommandGroup heading="记忆">
          <CommandItem
            value="MEMORY.md 索引 index"
            onSelect={pick(() => onOpenFile(INDEX_ID))}
          >
            <ListTree className="opacity-70" />
            <span>MEMORY.md</span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              索引
            </span>
          </CommandItem>
          {FILES.map((f) => (
            <CommandItem
              key={f.file}
              value={`${f.title} ${f.file}`}
              onSelect={pick(() => onOpenFile(f.file))}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 flex-none rounded-full',
                  TYPE_DOT_CLASS[f.folder],
                )}
              />
              <span className="min-w-0 flex-1 truncate">{f.title}</span>
              <span className="ml-auto max-w-[45%] truncate font-mono text-[11px] text-muted-foreground">
                {f.folder}/{f.file}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="页面">
          {PAGES.map((p) => {
            const Icon = p.icon;
            return (
              <CommandItem
                key={p.kind}
                value={`页面 ${p.label}`}
                onSelect={pick(() => onNavigate({ kind: p.kind } as Route))}
              >
                <Icon className="opacity-70" />
                <span>{p.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
