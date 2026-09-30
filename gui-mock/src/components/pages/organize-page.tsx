import { PageContainer, PageHeader } from '@/components/pages/file-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OPS } from '@/data/mock';
import type { OrganizeOp } from '@/lib/types';
import { cn } from '@/lib/utils';

// git status 字母配色：M 黄 / R 蓝 / A 绿 / ! 灰
const ST_CLASS: Record<OrganizeOp['st'], string> = {
  M: 'text-warning',
  R: 'text-primary',
  A: 'text-success',
  '!': 'text-muted-foreground',
};

export function OrganizePage() {
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
          4 项文件操作
        </Badge>
        <span className="ml-auto flex gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            className="text-[12px] font-normal text-muted-foreground hover:text-foreground"
          >
            重新生成
          </Button>
          <Button size="xs" className="text-[12px] font-medium">
            应用全部
          </Button>
        </span>
      </div>

      <div className="border-t border-border">
        {OPS.map((o, i) => (
          <div
            key={i}
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
                className="text-[12px] font-normal text-muted-foreground hover:text-foreground"
              >
                跳过
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="text-[12px] font-normal text-primary hover:text-primary"
              >
                应用
              </Button>
            </span>
          </div>
        ))}
      </div>
    </PageContainer>
  );
}
