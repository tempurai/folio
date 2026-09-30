import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { FILES, INDEX_MD, TYPE_DOT_CLASS, TYPE_LABEL } from '@/data/mock';
import { INDEX_ID } from '@/lib/types';
import { cn } from '@/lib/utils';

export function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[760px] px-12 pb-20 pt-10">{children}</div>
  );
}

export function PageHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h1 className="mb-1.5 text-[19px] font-[650] tracking-[-0.02em]">{title}</h1>
      <p className="mb-7 text-[12.5px] text-muted-foreground">{sub}</p>
    </>
  );
}

function Crumb({ segments }: { segments: string[] }) {
  return (
    <div className="mb-[22px] flex items-center gap-1.5 font-mono text-[11.5px] text-muted-foreground">
      {segments.map((seg, i) => {
        const last = i === segments.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="opacity-60">/</span>}
            <span className={cn(last && 'font-medium text-foreground/80')}>
              {seg}
            </span>
          </span>
        );
      })}
      <span className="ml-auto flex gap-0.5">
        {['编辑', '在 Finder 显示', '归档'].map((a) => (
          <Button
            key={a}
            variant="ghost"
            size="xs"
            className="font-sans text-[12px] font-normal text-muted-foreground hover:text-foreground"
          >
            {a}
          </Button>
        ))}
      </span>
    </div>
  );
}

/** 文件页：单条记忆 或 MEMORY.md 索引（id === __index__） */
export function FilePage({
  id,
  onOpenFile,
}: {
  id: string;
  onOpenFile: (fileId: string) => void;
}) {
  if (id === INDEX_ID) {
    return (
      <PageContainer>
        <Crumb segments={['memory', 'MEMORY.md']} />
        <h1 className="mb-3 text-[22px] font-[650] leading-[1.3] tracking-[-0.02em]">
          索引
        </h1>
        <div className="mb-[26px] border-b border-border pb-5 text-[12px] text-muted-foreground">
          <span className="font-mono text-[11px]">自动生成 · quick lookup</span>
        </div>
        <Markdown source={INDEX_MD} onOpenFile={onOpenFile} />
      </PageContainer>
    );
  }

  const f = FILES.find((x) => x.file === id);
  if (!f) {
    return (
      <PageContainer>
        <p className="text-muted-foreground">文件不存在：{id}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Crumb segments={['memory', f.folder, f.file]} />
      <h1 className="mb-3 text-[22px] font-[650] leading-[1.3] tracking-[-0.02em]">
        {f.title}
      </h1>
      <div className="mb-[26px] flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border pb-5 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', TYPE_DOT_CLASS[f.folder])} />
          {TYPE_LABEL[f.folder]}
        </span>
        <span className="font-mono text-[11px]">{f.scope}</span>
        <span>来自 {f.src}</span>
        <span className="font-mono text-[11px]">{f.from}</span>
        <span>更新于 {f.updated}</span>
        {f.tags.length > 0 && (
          <span className="text-foreground/70">
            {f.tags.map((t) => `#${t}`).join(' ')}
          </span>
        )}
      </div>
      <Markdown source={f.body} onOpenFile={onOpenFile} />
    </PageContainer>
  );
}
