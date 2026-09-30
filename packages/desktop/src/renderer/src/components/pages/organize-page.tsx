import { useCallback, useEffect, useState } from 'react';

import { PageContainer, PageHeader } from '@/components/pages/file-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/data/provider';
import { cn } from '@/lib/utils';
import type { OrganizePlanResponse } from '../../../../shared/ipc';

// git status 字母配色：M 黄 / R 蓝 / A 绿 / ! 灰
const ST_CLASS: Record<string, string> = {
  M: 'text-warning',
  R: 'text-primary',
  A: 'text-success',
  '!': 'text-muted-foreground',
};

export function OrganizePage({
  onChanged,
  onPlanCount,
}: {
  onChanged: () => void | Promise<void>;
  onPlanCount?: (count: number | undefined) => void;
}) {
  const [plan, setPlan] = useState<OrganizePlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const regenerate = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.planOrganize();
      setPlan(next);
      setSkipped(new Set());
      onPlanCount?.(next.ops.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onPlanCount]);

  useEffect(() => {
    void regenerate();
    return () => onPlanCount?.(undefined);
  }, [regenerate, onPlanCount]);

  const apply = async (indexes: number[]): Promise<void> => {
    if (indexes.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const report = await api.applyOrganize(indexes);
      if (report.errors.length > 0) setError(report.errors.join('；'));
      await onChanged();
      await regenerate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  const visible = plan ? plan.views.filter((v) => !skipped.has(v.index)) : [];

  return (
    <PageContainer>
      <PageHeader
        title="整理"
        sub="LLM 对记忆库提出的文件改动建议，应用前逐条确认。重分类即移动文件，合并即并入一个文件。"
      />

      {/* 汇总条 */}
      <div className="mb-[26px] mt-[-8px] flex items-center gap-2.5 rounded-md border border-border bg-muted px-4 py-2.5 text-[12.5px]">
        <span className="text-foreground/80">本次计划</span>
        <Badge variant="secondary" className="font-mono font-medium">
          {loading ? '生成中…' : `${visible.length} 项文件操作`}
        </Badge>
        {plan?.llmUsed && (
          <Badge variant="secondary" className="font-mono font-medium">
            LLM
          </Badge>
        )}
        <span className="ml-auto flex gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            disabled={loading || applying}
            onClick={() => void regenerate()}
            className="text-[12px] font-normal text-muted-foreground hover:text-foreground"
          >
            重新生成
          </Button>
          <Button
            size="xs"
            disabled={loading || applying || visible.length === 0}
            onClick={() => void apply(visible.map((v) => v.index))}
            className="text-[12px] font-medium"
          >
            {applying ? '应用中…' : '应用全部'}
          </Button>
        </span>
      </div>

      {error && <p className="mb-3 text-[12px] text-destructive">{error}</p>}
      {plan && plan.notes.length > 0 && (
        <div className="mb-4 text-[12px] text-muted-foreground">
          {plan.notes.map((n, i) => (
            <p key={i}>· {n}</p>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground">正在生成整理计划…</p>
      ) : visible.length === 0 ? (
        <p className="text-muted-foreground">没有需要整理的内容，记忆库状态良好。</p>
      ) : (
        <div className="border-t border-border">
          {visible.map((o) => (
            <div
              key={o.index}
              className="flex items-start gap-3 border-b border-border px-1 py-[14px]"
            >
              <span
                className={cn(
                  'mt-px w-4 flex-none text-center font-mono text-[11px] font-bold leading-5',
                  ST_CLASS[o.st],
                )}
              >
                {o.st}
              </span>
              <div className="min-w-0">
                <div className="break-all font-mono text-[11.8px] leading-[1.5] text-foreground">
                  {o.files}
                  {o.to && <span className="text-muted-foreground"> → {o.to}</span>}
                </div>
                <div className="mt-[3px] text-[12px] text-muted-foreground">{o.why}</div>
              </div>
              <span className="ml-auto flex flex-none gap-0.5">
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={applying}
                  onClick={() => setSkipped((prev) => new Set(prev).add(o.index))}
                  className="text-[12px] font-normal text-muted-foreground hover:text-foreground"
                >
                  跳过
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={applying}
                  onClick={() => void apply([o.index])}
                  className="text-[12px] font-normal text-primary hover:text-primary"
                >
                  应用
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
