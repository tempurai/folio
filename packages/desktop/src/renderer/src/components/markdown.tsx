import { Fragment, type MouseEvent, type ReactNode } from 'react';

import type { MemoryFile } from '@/lib/types';

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;

function fileIdFromHref(href: string, files: MemoryFile[]): string | null {
  const base = href.split('/').pop() ?? '';
  return files.some((f) => f.file === base) ? base : null;
}

function renderInline(
  text: string,
  keyPrefix: string,
  files: MemoryFile[],
  onOpenFile?: (id: string) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const token = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(
        <b key={key} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </b>,
      );
    } else {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (lm) {
        const [, label, href] = lm;
        const fileId = fileIdFromHref(href, files);
        const handle = (e: MouseEvent) => {
          e.preventDefault();
          if (fileId && onOpenFile) onOpenFile(fileId);
        };
        nodes.push(
          <a key={key} href={href} onClick={handle} title={href}>
            {label}
          </a>,
        );
      }
    }
    last = idx + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * 极简 markdown 渲染器（与 v2 静态版同规则）：
 * 代码块 / h1-h3 / 引用 / 无序列表 / hr / 段落 + 行内 code、bold、链接。
 * 指向库内文件的链接会触发 onOpenFile 内部跳转。
 */
export function Markdown({
  source,
  files,
  onOpenFile,
}: {
  source: string;
  /** 当前记忆库文件清单，用于判定链接是否指向库内文件 */
  files: MemoryFile[];
  onOpenFile?: (id: string) => void;
}) {
  const lines = source.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const ln = lines[i];

    if (ln.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾 ```
      blocks.push(
        <pre key={key++}>
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    if (/^- /.test(ln)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <ul key={key++}>
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `li-${key}-${j}`, files, onOpenFile)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (ln.startsWith('> ')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        buf.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <blockquote key={key++}>
          <p className="my-0">
            {renderInline(buf.join(' '), `bq-${key}`, files, onOpenFile)}
          </p>
        </blockquote>,
      );
      continue;
    }

    if (ln.startsWith('### ')) {
      blocks.push(
        <h3 key={key++}>{renderInline(ln.slice(4), `h3-${key}`, files, onOpenFile)}</h3>,
      );
      i++;
      continue;
    }
    if (ln.startsWith('## ')) {
      blocks.push(
        <h2 key={key++}>{renderInline(ln.slice(3), `h2-${key}`, files, onOpenFile)}</h2>,
      );
      i++;
      continue;
    }
    if (ln.startsWith('# ')) {
      blocks.push(
        <h1 key={key++}>{renderInline(ln.slice(2), `h1-${key}`, files, onOpenFile)}</h1>,
      );
      i++;
      continue;
    }
    if (/^---+$/.test(ln.trim())) {
      blocks.push(<hr key={key++} />);
      i++;
      continue;
    }
    if (ln.trim() === '') {
      i++;
      continue;
    }

    const buf: string[] = [ln];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(```|#|> |- |---)/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++}>{renderInline(buf.join(' '), `p-${key}`, files, onOpenFile)}</p>,
    );
  }

  return (
    <div className="md-body">
      {blocks.map((b, j) => (
        <Fragment key={j}>{b}</Fragment>
      ))}
    </div>
  );
}
