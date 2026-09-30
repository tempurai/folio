import { PageContainer, PageHeader } from '@/components/pages/file-page';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { SOURCES } from '@/data/mock';

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
  return (
    <PageContainer>
      <PageHeader
        title="设置"
        sub="保存于 ~/.tememory/config.toml · 环境变量 TEMEMORY_LLM_API_KEY 可代替填写 Key"
      />

      <SettingGroup
        title="LLM"
        hint="用于整理记忆库。任何 OpenAI 兼容端点均可 —— 这是本应用唯一的网络出口。"
      >
        <SettingLine label="Base URL">
          <Input
            defaultValue="https://api.openai.com/v1"
            className="h-8 max-w-[340px] text-[12.5px]"
          />
        </SettingLine>
        <SettingLine label="模型">
          <Input defaultValue="gpt-4o-mini" className="h-8 max-w-[340px] text-[12.5px]" />
        </SettingLine>
        <SettingLine label="API Key">
          <Input
            type="password"
            defaultValue="sk-placeholder"
            className="h-8 max-w-[340px] text-[12.5px]"
          />
        </SettingLine>
        <SettingLine label="同步时自动分类">
          <Switch />
        </SettingLine>
      </SettingGroup>

      <Separator className="my-8" />

      <SettingGroup
        title="适配器"
        hint="关闭后该 harness 不再参与同步，已导入的文件保留。"
      >
        {SOURCES.map((s) => (
          <SettingLine
            key={s.name}
            label={
              <span className="flex items-center gap-2">
                <span className="w-[15px] text-center font-mono text-[10px] font-semibold text-muted-foreground">
                  {s.letter}
                </span>
                <span className="text-foreground">{s.name}</span>
              </span>
            }
          >
            <Switch defaultChecked />
          </SettingLine>
        ))}
      </SettingGroup>

      <Separator className="my-8" />

      <SettingGroup
        title="存储"
        hint="全部数据存于本地，无遥测。删除该目录即完全卸载数据。"
      >
        <SettingLine label="记忆库目录">
          <Input defaultValue="~/.tememory" className="h-8 max-w-[340px] text-[12.5px]" />
        </SettingLine>
      </SettingGroup>
    </PageContainer>
  );
}
