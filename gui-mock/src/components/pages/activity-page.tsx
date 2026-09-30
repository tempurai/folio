import { PageContainer, PageHeader } from '@/components/pages/file-page';
import { ACT } from '@/data/mock';

export function ActivityPage() {
  return (
    <PageContainer>
      <PageHeader
        title="活动"
        sub="增量同步记录：只有内容变化的源文件才会触发更新；源文件被删除时，库内文件保留。"
      />
      <div className="border-t border-border">
        {ACT.map((a, i) => (
          <div
            key={i}
            className="flex items-baseline gap-3.5 border-b border-border px-1 py-2.5 text-[12.5px]"
          >
            <time className="w-[118px] flex-none font-mono text-[10.8px] text-muted-foreground">
              {a.t}
            </time>
            <span className="min-w-0 flex-1 text-muted-foreground">
              {a.what.map(([text, bold], j) =>
                bold ? (
                  <b key={j} className="font-[550] text-foreground">
                    {text}
                  </b>
                ) : (
                  <span key={j}>{text}</span>
                ),
              )}
            </span>
            <span className="flex-none font-mono text-[11px]">
              <span className="text-success">+{a.p}</span>{' '}
              <span className="text-primary">~{a.u}</span>{' '}
              <span className="text-muted-foreground/60">={a.s}</span>
            </span>
          </div>
        ))}
      </div>
    </PageContainer>
  );
}
