import { PageContainer, PageHeader } from '@/components/pages/file-page';
import { Button } from '@/components/ui/button';
import { SOURCES } from '@/data/mock';
import { cn } from '@/lib/utils';

export function SourcesPage() {
  return (
    <PageContainer>
      <PageHeader
        title="来源"
        sub="单向导入各 harness 的记忆文件，绝不写回。MCP 注册后，harness 可直接读写统一记忆库。"
      />
      <div className="border-t border-border">
        {SOURCES.map((s) => (
          <div
            key={s.name}
            className="flex items-center gap-3 border-b border-border px-1 py-[13px]"
          >
            <span className="w-[15px] flex-none text-center font-mono text-[10px] font-semibold text-muted-foreground">
              {s.letter}
            </span>
            <span className="w-[118px] flex-none font-[550]">{s.name}</span>
            <span
              className="min-w-0 flex-1 truncate font-mono text-[10.8px] text-muted-foreground"
              title={s.paths}
            >
              {s.paths}
            </span>
            <span className="flex w-[108px] flex-none items-center gap-1.5 text-[11.5px] text-foreground/80">
              <span
                className={cn(
                  'h-1.5 w-1.5 flex-none rounded-full',
                  s.mcp ? 'bg-success' : 'bg-muted-foreground/35',
                )}
              />
              {s.mcp ? 'MCP 已注册' : 'MCP 未注册'}
            </span>
            <span className="w-[58px] flex-none text-right text-[11.5px] text-muted-foreground">
              {s.cnt} 条
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="flex-none text-[12px] font-normal text-muted-foreground hover:text-foreground"
            >
              {s.mcp ? '注销' : '注册'}
            </Button>
          </div>
        ))}
      </div>
    </PageContainer>
  );
}
