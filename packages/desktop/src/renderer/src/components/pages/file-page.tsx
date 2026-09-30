import { useEffect, useState } from 'react';

import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { api, relPathOf } from '@/data/provider';
import { TYPE_DOT_CLASS, TYPE_LABEL } from '@/data/mock';
import { INDEX_ID, type MemoryFile } from '@/lib/types';
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

function Crumb({ segments, actions }: { segments: string[]; actions?: React.ReactNode }) {
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
      <span className="ml-auto flex gap-0.5">{actions}</span>
    </div>
  );
}

function CrumbButton({
  onClick,
  disabled,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={disabled}
      onClick={onClick}
      className="font-sans text-[12px] font-normal text-muted-foreground hover:text-foreground"
    >
      {children}
    </Button>
  );
}

/** 索引页（MEMORY.md） */
function IndexPage({
  files,
  onOpenFile,
}: {
  files: MemoryFile[];
  onOpenFile: (fileId: string) => void;
}) {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void api
      .readIndex()
      .then((text) => alive && setSource(text))
      .catch(() => alive && setSource(''));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <PageContainer>
      <Crumb
        segments={['memory', 'MEMORY.md']}
        actions={
          <>
            <CrumbButton disabled>编辑</CrumbButton>
            <CrumbButton onClick={() => void api.showInFolder('MEMORY.md')}>
              在 Finder 显示
            </CrumbButton>
            <CrumbButton disabled>归档</CrumbButton>
          </>
        }
      />
      <h1 className="mb-3 text-[22px] font-[650] leading-[1.3] tracking-[-0.02em]">
        索引
      </h1>
      <div className="mb-[26px] border-b border-border pb-5 text-[12px] text-muted-foreground">
        <span className="font-mono text-[11px]">自动生成 · quick lookup</span>
      </div>
      {source === null ? (
        <p className="text-muted-foreground">加载中…</p>
      ) : (
        <Markdown source={source} files={files} onOpenFile={onOpenFile} />
      )}
    </PageContainer>
  );
}

/** 文件页：单条记忆 或 MEMORY.md 索引（id === __index__） */
export function FilePage({
  id,
  files,
  onOpenFile,
  onChanged,
}: {
  id: string;
  files: MemoryFile[];
  onOpenFile: (fileId: string) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [loaded, setLoaded] = useState<MemoryFile | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stub = files.find((x) => x.file === id) ?? null;

  useEffect(() => {
    setLoaded(null);
    setMissing(false);
    setEditing(false);
    setError(null);
    if (!stub) {
      setMissing(true);
      return;
    }
    let alive = true;
    void api
      .readFile(relPathOf(stub.folder, stub.file))
      .then(({ meta, body }) => {
        if (!alive) return;
        setLoaded({ ...meta, body });
        setDraft(body);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setMissing(true);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
    // stub 来自 tree，变化时本组件已随 dataVersion 重挂载，这里只需按 id 加载
  }, [id]);

  if (id === INDEX_ID) {
    return <IndexPage files={files} onOpenFile={onOpenFile} />;
  }

  if (missing || !stub) {
    return (
      <PageContainer>
        <p className="text-muted-foreground">文件不存在：{id}</p>
        {error && <p className="mt-1 text-[12px] text-muted-foreground">{error}</p>}
      </PageContainer>
    );
  }

  if (!loaded) {
    return (
      <PageContainer>
        <p className="text-muted-foreground">加载中…</p>
      </PageContainer>
    );
  }

  const f = loaded;
  const relPath = relPathOf(f.folder, f.file);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const meta = await api.writeFile(relPath, draft);
      setLoaded({ ...meta, body: draft });
      setEditing(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const archive = async (): Promise<void> => {
    await api.archiveFile(relPath);
    onOpenFile(INDEX_ID);
    await onChanged();
  };

  return (
    <PageContainer>
      <Crumb
        segments={['memory', f.folder, f.file]}
        actions={
          editing ? (
            <>
              <CrumbButton
                onClick={() => {
                  setEditing(false);
                  setDraft(f.body);
                }}
              >
                取消
              </CrumbButton>
              <CrumbButton onClick={() => void save()} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </CrumbButton>
            </>
          ) : (
            <>
              <CrumbButton onClick={() => setEditing(true)}>编辑</CrumbButton>
              <CrumbButton onClick={() => void api.showInFolder(relPath)}>
                在 Finder 显示
              </CrumbButton>
              <CrumbButton onClick={() => void archive()}>归档</CrumbButton>
            </>
          )
        }
      />
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
        {f.from && <span className="font-mono text-[11px]">{f.from}</span>}
        <span>更新于 {f.updated}</span>
        {f.tags.length > 0 && (
          <span className="text-foreground/70">
            {f.tags.map((t) => `#${t}`).join(' ')}
          </span>
        )}
      </div>
      {error && <p className="mb-3 text-[12px] text-destructive">{error}</p>}
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="min-h-[320px] w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-[12.5px] leading-[1.7] text-foreground outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <Markdown source={f.body} files={files} onOpenFile={onOpenFile} />
      )}
    </PageContainer>
  );
}
