import { useEffect, useRef, useState } from 'react';

import { PageContainer, PageHeader } from '@/components/pages/file-page';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { api } from '@/data/provider';
import type { Settings, SettingsPatch } from '../../../../shared/ipc';

const SOURCE_LETTER: Record<string, string> = {
  'claude-code': 'C',
  codex: 'Cx',
  cursor: 'Cu',
  'kimi-code': 'K',
  zcode: 'Z',
};

function SettingGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-1 text-[13px] font-semibold">{title}</h3>
      <p className="mb-3.5 text-[11.8px] text-muted-foreground">{hint}</p>
      <div>{children}</div>
    </section>
  );
}

function SettingLine({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[132px_1fr] items-center gap-3 border-t border-border py-2 text-[12.8px]">
      <label className="text-muted-foreground">{label}</label>
      <div>{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    void api.getSettings().then((s) => {
      if (!alive) return;
      setSettings(s);
      setBaseURL(s.llm.baseURL);
      setModel(s.llm.model);
    });
    return () => {
      alive = false;
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const flashSaved = (): void => {
    setSavedAt(Date.now());
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedAt(null), 2000);
  };

  const save = async (patch: SettingsPatch, apiKey?: string): Promise<void> => {
    setError(null);
    try {
      setSettings(await api.saveSettings(patch, apiKey));
      flashSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!settings) {
    return (
      <PageContainer>
        <p className="text-muted-foreground">加载中…</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="设置"
        sub="保存于 ~/.folio/config.toml · 环境变量 FOLIO_LLM_API_KEY 可代替填写 Key"
      />
      {savedAt !== null && (
        <p className="mb-4 mt-[-16px] text-[12px] text-success">已保存 ✓</p>
      )}
      {error && <p className="mb-4 mt-[-16px] text-[12px] text-destructive">{error}</p>}

      <SettingGroup
        title="LLM"
        hint="用于整理记忆库。任何 OpenAI 兼容端点均可 —— 这是本应用唯一的网络出口。"
      >
        <SettingLine label="Base URL">
          <Input
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            onBlur={() => {
              if (baseURL.trim() && baseURL !== settings.llm.baseURL) {
                void save({ llm: { baseURL: baseURL.trim() } });
              }
            }}
            className="h-8 max-w-[340px] text-[12.5px]"
          />
        </SettingLine>
        <SettingLine label="模型">
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => {
              if (model.trim() && model !== settings.llm.model) {
                void save({ llm: { model: model.trim() } });
              }
            }}
            className="h-8 max-w-[340px] text-[12.5px]"
          />
        </SettingLine>
        <SettingLine label="API Key">
          <div className="flex max-w-[340px] items-center gap-2">
            <Input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onBlur={() => {
                const key = apiKeyInput.trim();
                if (key) {
                  setApiKeyInput('');
                  void save({}, key);
                }
              }}
              placeholder={
                settings.llm.hasApiKey
                  ? `已保存（${settings.llm.apiKeyMasked ?? ''}）`
                  : '未设置'
              }
              className="h-8 text-[12.5px]"
            />
            {settings.llm.hasApiKey && (
              <button
                type="button"
                onClick={() => void save({}, '')}
                className="flex-none text-[11.5px] text-muted-foreground hover:text-destructive"
              >
                清除
              </button>
            )}
          </div>
        </SettingLine>
        <SettingLine label="同步时自动分类">
          <Switch
            checked={settings.llm.classifyOnSync}
            onCheckedChange={(checked) => void save({ llm: { classifyOnSync: checked } })}
          />
        </SettingLine>
      </SettingGroup>

      <Separator className="my-8" />

      <SettingGroup
        title="适配器"
        hint="关闭后该 harness 不再参与同步，已导入的文件保留。"
      >
        {settings.adapters.map((a) => (
          <SettingLine
            key={a.id}
            label={
              <span className="flex items-center gap-2">
                <span className="w-[15px] text-center font-mono text-[10px] font-semibold text-muted-foreground">
                  {SOURCE_LETTER[a.id] ?? a.id.slice(0, 2)}
                </span>
                <span className="text-foreground">{a.name}</span>
              </span>
            }
          >
            <Switch
              checked={a.enabled}
              onCheckedChange={(checked) =>
                void save({ adapters: [{ id: a.id, enabled: checked }] })
              }
            />
          </SettingLine>
        ))}
      </SettingGroup>

      <Separator className="my-8" />

      <SettingGroup
        title="存储"
        hint="全部数据存于本地，无遥测。删除该目录即完全卸载数据。"
      >
        <SettingLine label="记忆库目录">
          <Input
            value={settings.home}
            readOnly
            className="h-8 max-w-[340px] text-[12.5px] text-muted-foreground"
          />
        </SettingLine>
      </SettingGroup>
    </PageContainer>
  );
}
