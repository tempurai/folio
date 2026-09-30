import { useEffect, useState } from 'react';

import { PageContainer, PageHeader } from '@/components/pages/file-page';
import { api } from '@/data/provider';
import { fmtTime } from '@/lib/format';
import type { ActivityEntry } from '../../../../shared/ipc';

interface ActivityRow {
  t: string;
  what: Array<[string, boolean]>;
  p: number;
  u: number;
  s: number;
}

function rowOf(entry: ActivityEntry): ActivityRow {
  const sum = (pick: (a: ActivityEntry['adapters'][number]) => number): number =>
    entry.adapters.reduce((n, a) => n + pick(a), 0);
  const what: Array<[string, boolean]> =
    entry.trigger === 'watch'
      ? [['watch', true], [' 触发 · 文件变化', false]]
      : entry.trigger === 'manual'
        ? [['手动 ', false], ['sync', true]]
        : [[entry.trigger, true]];
  return {
    t: fmtTime(entry.at),
    what,
    p: sum((a) => a.added),
    u: sum((a) => a.updated),
    s: sum((a) => a.skipped),
  };
}

export function ActivityPage() {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .listActivity(100)
      .then((entries) => alive && setRows(entries.map(rowOf)))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <PageContainer>
      <PageHeader
        title="活动"
        sub="增量同步记录：只有内容变化的源文件才会触发更新；源文件被删除时，库内文件保留。"
      />
      {rows === null ? (
        <p className="text-muted-foreground">加载中…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">还没有同步记录。</p>
      ) : (
        <div className="border-t border-border">
          {rows.map((a, i) => (
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
      )}
    </PageContainer>
  );
}
