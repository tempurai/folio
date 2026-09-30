import { useCallback, useEffect, useState } from 'react';

import { PageContainer, PageHeader } from '@/components/pages/file-page';
import { Button } from '@/components/ui/button';
import { api } from '@/data/provider';
import { cn } from '@/lib/utils';
import type { SourceStatus } from '../../../../shared/ipc';

const SOURCE_LETTER: Record<string, string> = {
  'claude-code': 'C',
  codex: 'Cx',
  cursor: 'Cu',
  'kimi-code': 'K',
  zcode: 'Z',
};

export function SourcesPage() {
  const [sources, setSources] = useState<SourceStatus[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setSources(await api.listSources());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggleMcp = async (s: SourceStatus): Promise<void> => {
    setBusyId(s.id);
    setError(null);
    try {
      if (s.mcpRegistered) await api.uninstallMcp(s.id);
      else await api.installMcp(s.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="来源"
        sub="单向导入各 harness 的记忆文件，绝不写回。MCP 注册后，harness 可直接读写统一记忆库。"
      />
      {error && <p className="mb-3 text-[12px] text-destructive">{error}</p>}
      {sources === null ? (
        <p className="text-muted-foreground">加载中…</p>
      ) : (
        <div className="border-t border-border">
          {sources.map((s) => {
            const busy = busyId === s.id;
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 border-b border-border px-1 py-[13px]"
              >
                <span className="w-[15px] flex-none text-center font-mono text-[10px] font-semibold text-muted-foreground">
                  {SOURCE_LETTER[s.id] ?? s.id.slice(0, 2)}
                </span>
                <span className="w-[118px] flex-none font-[550]">{s.name}</span>
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[10.8px] text-muted-foreground"
                  title={s.configPath ?? undefined}
                >
                  {s.configPath ?? '（不支持 MCP）'}
                  {!s.detected && ' · 未检测到'}
                </span>
                <span className="flex w-[108px] flex-none items-center gap-1.5 text-[11.5px] text-foreground/80">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 flex-none rounded-full',
                      s.mcpRegistered ? 'bg-success' : 'bg-muted-foreground/35',
                    )}
                  />
                  {s.mcpRegistered ? 'MCP 已注册' : 'MCP 未注册'}
                </span>
                <span className="w-[58px] flex-none text-right text-[11.5px] text-muted-foreground">
                  {s.importedCount} 条
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy || s.configPath === null}
                  onClick={() => void toggleMcp(s)}
                  className="flex-none text-[12px] font-normal text-muted-foreground hover:text-foreground"
                >
                  {busy ? '处理中…' : s.mcpRegistered ? '注销' : '注册'}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
