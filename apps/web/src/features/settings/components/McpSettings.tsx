import { useState } from 'react';
import { useMcpServers, useMcpTools } from '../../../hooks/useMcpServers';
import type { McpServerData } from '../../../hooks/useMcpServers';
import { Card, Button, Input, Switch, Select } from '@agentctl/ui';
import { Cpu, Plus, Trash2, Edit2, Settings, X, Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

function parseArgumentsText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '[]';
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return trimmed;
  } catch {
    // not JSON
  }
  const args = trimmed.split(/[\n,]+|\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/).flatMap((arg) => {
    const clean = arg.trim().replace(/^"|"$/g, '');
    return clean ? [clean] : [];
  });
  return JSON.stringify(args);
}

function formatArgumentsJson(jsonStr: string | null | undefined): string {
  if (!jsonStr) return '';
  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    if (Array.isArray(parsed)) {
      return (parsed as unknown[])
        .map((arg) => {
          const str = String(arg);
          return str.includes(' ') ? `"${str}"` : str;
        })
        .join(' ');
    }
  } catch {
    // ignore
  }
  return jsonStr || '';
}

function parseKeyValuesText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '{}';
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return trimmed;
  } catch {
    // not JSON
  }
  const obj: Record<string, string> = {};
  const lines = trimmed.split('\n');
  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;
    const delimiterIndex = cleanLine.includes('=')
      ? cleanLine.indexOf('=')
      : cleanLine.indexOf(':');
    if (delimiterIndex === -1) {
      obj[cleanLine] = '';
    } else {
      const key = cleanLine.substring(0, delimiterIndex).trim();
      const val = cleanLine.substring(delimiterIndex + 1).trim();
      obj[key] = val;
    }
  }
  return JSON.stringify(obj);
}

function formatKeyValuesJson(jsonStr: string | null | undefined): string {
  if (!jsonStr) return '';
  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join('\n');
    }
  } catch {
    // ignore
  }
  return jsonStr || '';
}

export function getToolOverride(
  toolPermissionsJson: string | null | undefined,
  toolName: string
): 'always_prompt' | 'auto_approve' | 'deny' | 'inherit' {
  if (!toolPermissionsJson) return 'inherit';
  try {
    const overrides = JSON.parse(toolPermissionsJson) as Record<string, unknown>;
    const val = overrides[toolName];
    if (val === 'always_prompt' || val === 'auto_approve' || val === 'deny' || val === 'inherit') {
      return val;
    }
  } catch {
    // ignore
  }
  return 'inherit';
}

export function updateToolOverride(
  toolPermissionsJson: string | null | undefined,
  toolName: string,
  val: 'always_prompt' | 'auto_approve' | 'deny' | 'inherit'
): string {
  let overridesMap: Record<string, string> = {};
  if (toolPermissionsJson) {
    try {
      const parsed = JSON.parse(toolPermissionsJson) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        overridesMap = parsed as Record<string, string>;
      } else {
        overridesMap = {};
      }
    } catch {
      // ignore
    }
  }

  if (val === 'inherit') {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [toolName]: _, ...rest } = overridesMap;
    overridesMap = rest;
  } else {
    overridesMap[toolName] = val;
  }

  return JSON.stringify(overridesMap);
}
const approvalPolicyOptions = [
  { value: 'always_prompt', label: 'PROMPT USER' },
  { value: 'auto_approve_all', label: 'AUTO-APPROVE ALL' },
  { value: 'deny_all', label: 'DENY ALL' },
];

export function McpSettings() {
  const { mcpServers, isLoading, addMcpServer, updateMcpServer, deleteMcpServer } = useMcpServers();
  const { tools: mcpTools } = useMcpTools();
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({});

  // Form states for Add/Edit
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'local' | 'remote'>('local');
  const [formCommand, setFormCommand] = useState('');
  const [formArgs, setFormArgs] = useState('');
  const [formEnv, setFormEnv] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formHeaders, setFormHeaders] = useState('');
  const [formApprovalPolicy, setFormApprovalPolicy] = useState<'always_prompt' | 'auto_approve_all' | 'deny_all'>('always_prompt');

  const toggleServerExpanded = (id: string) => {
    setExpandedServers((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleResetForm = () => {
    setFormName('');
    setFormType('local');
    setFormCommand('');
    setFormArgs('');
    setFormEnv('');
    setFormUrl('');
    setFormHeaders('');
    setFormApprovalPolicy('always_prompt');
    setIsAddingNew(false);
    setEditingId(null);
  };

  const handleSaveNew = () => {
    if (!formName) {
      toast.error('Name is required.');
      return;
    }
    if (formType === 'local') {
      if (!formCommand) {
        toast.error('Command is required for local servers.');
        return;
      }
    } else {
      if (!formUrl) {
        toast.error('URL is required for remote servers.');
        return;
      }
    }

    const generatedId = formName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/[\s_-]+/g, '-');

    addMcpServer({
      id: generatedId,
      name: formName.trim(),
      type: formType,
      command: formType === 'local' ? formCommand.trim() : null,
      launchArgs: formType === 'local' ? parseArgumentsText(formArgs) : '[]',
      launchEnv: formType === 'local' ? parseKeyValuesText(formEnv) : '{}',
      url: formType === 'remote' ? formUrl.trim() : null,
      headers: formType === 'remote' ? parseKeyValuesText(formHeaders) : '{}',
      enabled: true,
      approvalPolicy: formApprovalPolicy,
    });
    handleResetForm();
  };

  const handleStartEdit = (server: McpServerData) => {
    setEditingId(server.id);
    setFormName(server.name);
    setFormType(server.type);
    setFormCommand(server.command ?? '');
    setFormArgs(formatArgumentsJson(server.launchArgs));
    setFormEnv(formatKeyValuesJson(server.launchEnv));
    setFormUrl(server.url ?? '');
    setFormHeaders(formatKeyValuesJson(server.headers));
    setFormApprovalPolicy(server.approvalPolicy);
    setIsAddingNew(false);
  };

  const handleSaveEdit = (id: string) => {
    if (!formName) {
      toast.error('Name is required.');
      return;
    }
    if (formType === 'local') {
      if (!formCommand) {
        toast.error('Command is required for local servers.');
        return;
      }
    } else {
      if (!formUrl) {
        toast.error('URL is required for remote servers.');
        return;
      }
    }

    updateMcpServer({
      id,
      name: formName.trim(),
      type: formType,
      command: formType === 'local' ? formCommand.trim() : null,
      launchArgs: formType === 'local' ? parseArgumentsText(formArgs) : '[]',
      launchEnv: formType === 'local' ? parseKeyValuesText(formEnv) : '{}',
      url: formType === 'remote' ? formUrl.trim() : null,
      headers: formType === 'remote' ? parseKeyValuesText(formHeaders) : '{}',
      approvalPolicy: formApprovalPolicy,
    });
    handleResetForm();
  };

  const handleToggle = (server: McpServerData, checked: boolean) => {
    updateMcpServer({
      id: server.id,
      enabled: checked,
    });
  };

  return (
    <div className="animate-in fade-in relative mx-auto h-full w-full max-w-4xl overflow-y-auto p-6 select-none">
      <div className="relative z-10 mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-text-main text-2xl font-black tracking-widest uppercase">
            SETTINGS::MODEL_CONTEXT_PROTOCOL
          </h1>
          <p className="text-text-muted mt-1 text-[11px] font-bold tracking-tight uppercase opacity-60">
            MANAGE MCP INTEGRATIONS
          </p>
        </div>
        {!isAddingNew && !editingId && (
          <Button
            variant="outline"
            onClick={() => {
              setIsAddingNew(true);
            }}
            className="border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50 flex h-9 items-center gap-2 rounded-xl border px-4 text-[11px] font-bold tracking-widest uppercase"
          >
            <Plus className="h-3.5 w-3.5" />
            REGISTER_SERVER
          </Button>
        )}
      </div>

      <div className="relative z-10 space-y-4">
        {(isAddingNew || editingId) && (
          <Card className="border-accent/20 bg-accent/5 space-y-5 rounded-2xl border p-5">
            <div className="border-border/10 flex items-center justify-between border-b pb-3">
              <h3 className="text-text-main flex items-center gap-2 text-[11px] font-black tracking-wider uppercase">
                <Settings className="h-3.5 w-3.5 animate-spin" />
                {isAddingNew ? 'REGISTER NEW SERVER' : `EDIT SERVER`}
              </h3>
              <Button
                variant="ghost"
                onClick={handleResetForm}
                className="hover:bg-surface-secondary/40 h-7 w-7 rounded-full p-0"
              >
                <X className="text-text-muted h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4">
              {/* Field 1: Name */}
              <div className="space-y-1">
                <label
                  htmlFor="mcp-name"
                  className="text-text-muted text-[9px] font-black tracking-widest uppercase opacity-70"
                >
                  Display Name
                </label>
                <Input
                  id="mcp-name"
                  placeholder="Name"
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                  }}
                  className="bg-surface-secondary/35 border-border/55 focus:border-accent/40 h-9 w-full rounded-xl border text-xs"
                />
              </div>

              {/* Field 2: Server Type */}
              <div className="space-y-1">
                <span className="text-text-muted block text-[9px] font-black tracking-widest uppercase opacity-70">
                  Server Type
                </span>
                <div className="border-border/30 bg-surface/40 flex w-fit gap-1 rounded-xl border p-1">
                  {(['local', 'remote'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setFormType(type);
                      }}
                      className={`cursor-pointer rounded-lg px-4 py-1 text-center text-[10px] font-bold tracking-wider uppercase transition-all ${
                        formType === type
                          ? 'bg-accent text-brand-crust font-black shadow-sm'
                          : 'text-text-muted hover:text-text-main hover:bg-surface-secondary/40'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {formType === 'local' ? (
                <>
                  {/* Field 3: Command */}
                  <div className="space-y-1">
                    <label
                      htmlFor="mcp-command"
                      className="text-text-muted text-[9px] font-black tracking-widest uppercase opacity-70"
                    >
                      Command
                    </label>
                    <Input
                      id="mcp-command"
                      placeholder="Command (e.g. npx)"
                      value={formCommand}
                      onChange={(e) => {
                        setFormCommand(e.target.value);
                      }}
                      className="bg-surface-secondary/35 border-border/55 focus:border-accent/40 h-9 w-full rounded-xl border font-mono text-xs"
                    />
                  </div>

                  {/* Field 4: Arguments */}
                  <div className="space-y-1">
                    <label
                      htmlFor="mcp-args"
                      className="text-text-muted text-[9px] font-black tracking-widest uppercase opacity-70"
                    >
                      Arguments
                    </label>
                    <Input
                      id="mcp-args"
                      placeholder="Arguments (e.g. --debug)"
                      value={formArgs}
                      onChange={(e) => {
                        setFormArgs(e.target.value);
                      }}
                      className="bg-surface-secondary/35 border-border/55 focus:border-accent/40 h-9 w-full rounded-xl border font-mono text-xs"
                    />
                  </div>

                  {/* Field 5: Env Variables */}
                  <div className="space-y-1">
                    <label
                      htmlFor="mcp-env"
                      className="text-text-muted text-[9px] font-black tracking-widest uppercase opacity-70"
                    >
                      Environment Variables
                    </label>
                    <textarea
                      id="mcp-env"
                      placeholder="KEY=VALUE (one per line)"
                      value={formEnv}
                      onChange={(e) => {
                        setFormEnv(e.target.value);
                      }}
                      className="bg-surface-secondary/30 border-border/40 focus:border-accent/40 max-h-[120px] min-h-[60px] w-full rounded-xl border p-3 font-mono text-xs focus:outline-none"
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* Field 3: URL */}
                  <div className="space-y-1">
                    <label
                      htmlFor="mcp-url"
                      className="text-text-muted text-[9px] font-black tracking-widest uppercase opacity-70"
                    >
                      URL
                    </label>
                    <Input
                      id="mcp-url"
                      placeholder="URL (e.g. https://...)"
                      value={formUrl}
                      onChange={(e) => {
                        setFormUrl(e.target.value);
                      }}
                      className="bg-surface-secondary/35 border-border/55 focus:border-accent/40 h-9 w-full rounded-xl border font-mono text-xs"
                    />
                  </div>

                  {/* Field 4: Headers */}
                  <div className="space-y-1">
                    <label
                      htmlFor="mcp-headers"
                      className="text-text-muted text-[9px] font-black tracking-widest uppercase opacity-70"
                    >
                      Headers
                    </label>
                    <textarea
                      id="mcp-headers"
                      placeholder="Authorization=Bearer xyz (one per line)"
                      value={formHeaders}
                      onChange={(e) => {
                        setFormHeaders(e.target.value);
                      }}
                      className="bg-surface-secondary/30 border-border/40 focus:border-accent/40 max-h-[120px] min-h-[60px] w-full rounded-xl border p-3 font-mono text-xs focus:outline-none"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="border-border/10 flex items-center justify-between border-t pt-4">
              <div className="flex items-center gap-3 select-none">
                <label
                  htmlFor="mcp-form-approval-policy"
                  className="text-text-muted text-[10px] font-bold tracking-wider uppercase"
                >
                  Approval Policy
                </label>
                <Select
                  value={formApprovalPolicy}
                  onChange={(val) => {
                    setFormApprovalPolicy(val as 'always_prompt' | 'auto_approve_all' | 'deny_all');
                  }}
                  options={approvalPolicyOptions}
                  className="w-48"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={handleResetForm}
                  className="hover:bg-surface-secondary/40 text-text-muted h-9 rounded-xl px-4 text-[11px] font-bold tracking-widest uppercase"
                >
                  CANCEL
                </Button>
                <Button
                  onClick={() => {
                    if (editingId) {
                      handleSaveEdit(editingId);
                    } else {
                      handleSaveNew();
                    }
                  }}
                  className="bg-accent hover:bg-accent/80 text-brand-crust flex h-9 items-center gap-1.5 rounded-xl px-5 text-[11px] font-black tracking-widest uppercase"
                >
                  <Check className="h-3.5 w-3.5 stroke-[3]" />
                  SAVE_CONFIG
                </Button>
              </div>
            </div>
          </Card>
        )}

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 rounded-xl border border-white/5 bg-white/5" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {mcpServers.map((server) => {
              let parsedArgs: string[] = [];
              try {
                parsedArgs = JSON.parse(server.launchArgs ?? '[]') as string[];
              } catch {
                parsedArgs = [];
              }

              const serverTools = mcpTools.filter((t) => t.serverId === server.id);
              const isExpanded = expandedServers[server.id] ?? false;

              return (
                <Card
                  key={server.id}
                  className="group border-border/20 hover:border-accent/20 overflow-hidden rounded-2xl border transition-colors"
                >
                  {/* Clickable Header row similar to ProviderCard */}
                  <button
                    type="button"
                    onClick={() => {
                      toggleServerExpanded(server.id);
                    }}
                    className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent p-4 text-left select-none"
                  >
                    <div className="flex min-w-0 items-center gap-3.5">
                      <div className="border-border/30 bg-surface-secondary/40 group-hover:bg-surface-secondary/60 text-text-main flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border p-1.5 transition-all">
                        <Cpu className="h-4.5 w-4.5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-text-main flex items-center gap-2.5 text-[13px] font-black tracking-tighter uppercase">
                          {server.name}
                          {server.status === 'connected' ? (
                            <span className="rounded border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 text-[8px] font-black tracking-widest text-emerald-400 uppercase">
                              CONNECTED
                            </span>
                          ) : server.status === 'disconnected' ? (
                            <span className="rounded border border-red-500/30 bg-red-500/5 px-1.5 py-0.5 text-[8px] font-black tracking-widest text-red-400 uppercase">
                              DISCONNECTED
                            </span>
                          ) : (
                            <span className="border-border/40 text-text-muted rounded border px-1.5 py-0.5 text-[8px] font-black tracking-widest uppercase opacity-50">
                              DISABLED
                            </span>
                          )}
                        </h3>

                        {server.enabled && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {serverTools.slice(0, 3).map((t) => (
                              <span
                                key={t.name}
                                className="bg-surface-secondary/50 text-text-muted border-border/10 rounded border px-1.5 py-0.5 font-mono text-[9px] font-extrabold tracking-tight"
                              >
                                {t.name.split('__')[1] ?? t.name}
                              </span>
                            ))}
                            {serverTools.length > 3 && (
                              <span className="text-text-muted text-[9px] font-bold opacity-60">
                                +{serverTools.length - 3} more
                              </span>
                            )}
                            {serverTools.length === 0 && (
                              <span className="text-text-muted text-[9.5px] italic opacity-40">
                                Discovering tools...
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-3"
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <Switch
                        checked={server.enabled}
                        onCheckedChange={(checked) => {
                          handleToggle(server, checked);
                        }}
                      />
                      <ChevronDown
                        className={`text-text-muted h-3.5 w-3.5 transition-transform duration-300 ${
                          isExpanded ? 'text-text-main rotate-180' : ''
                        }`}
                      />
                    </div>
                  </button>

                  {/* Expanded Body section matching ProviderCard layout */}
                  {isExpanded && (
                    <div className="animate-in fade-in slide-in-from-top-1 border-border/10 bg-surface-secondary/5 space-y-4 border-t p-4">
                      {/* Default Policy Selector */}
                      <div className="border-border/55 bg-surface-secondary/20 flex flex-col gap-3 rounded-xl border p-4 select-none">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-text-main text-[11px] font-black tracking-widest uppercase">
                              DEFAULT_APPROVAL_POLICY
                            </p>
                            <p className="text-text-muted mt-0.5 text-[9.5px] font-bold tracking-tight uppercase opacity-65">
                              Default action for new or unconfigured tools from this server in auto-approve mode.
                            </p>
                          </div>
                          <Select
                            value={server.approvalPolicy}
                            onChange={(val) => {
                              updateMcpServer({
                                id: server.id,
                                approvalPolicy: val as 'always_prompt' | 'auto_approve_all' | 'deny_all',
                              });
                            }}
                            options={approvalPolicyOptions}
                            className="w-48"
                          />
                        </div>
                      </div>

                      {/* Connection details (URL / Command) */}
                      <div className="space-y-1">
                        <strong className="text-text-muted text-[9px] font-black tracking-widest uppercase opacity-45">
                          {server.type === 'remote' ? 'URL' : 'COMMAND'}
                        </strong>
                        <pre className="text-text-main bg-surface-secondary/30 border-border/25 overflow-x-auto rounded-xl border p-2.5 font-mono text-[10px] whitespace-pre-wrap">
                          {server.type === 'remote'
                            ? server.url
                            : `${server.command ?? ''} ${parsedArgs.join(' ')}`}
                        </pre>
                      </div>

                      {/* Config properties details */}
                      <div className="border-border/5 grid gap-4 border-t pt-3.5 text-[11px] sm:grid-cols-2">
                        <div className="space-y-1">
                          <strong className="text-text-muted text-[9px] font-black tracking-widest uppercase opacity-45">
                            {server.type === 'remote' ? 'HEADERS' : 'ENVIRONMENT VARIABLES'}
                          </strong>
                          <pre className="text-text-main bg-surface-secondary/30 border-border/25 overflow-x-auto rounded-xl border p-2.5 font-mono text-[10px] whitespace-pre-wrap">
                            {server.type === 'remote'
                              ? formatKeyValuesJson(server.headers) || 'None'
                              : formatKeyValuesJson(server.launchEnv) || 'None'}
                          </pre>
                        </div>
                        {server.type === 'local' && (
                          <div className="space-y-1">
                            <strong className="text-text-muted text-[9px] font-black tracking-widest uppercase opacity-45">
                              ARGUMENTS
                            </strong>
                            <pre className="text-text-main bg-surface-secondary/30 border-border/25 overflow-x-auto rounded-xl border p-2.5 font-mono text-[10px] whitespace-pre-wrap">
                              {formatArgumentsJson(server.launchArgs) || 'None'}
                            </pre>
                          </div>
                        )}
                      </div>

                      {/* Active discovered tools list with individual permissions */}
                      {server.enabled && serverTools.length > 0 && (
                        <div className="border-border/5 space-y-3 border-t pt-4">
                          <strong className="text-text-muted text-[9px] font-black tracking-widest uppercase opacity-45">
                            DISCOVERED TOOLS & PERMISSIONS ({serverTools.length})
                          </strong>
                          <div className="space-y-2">
                            {serverTools.map((t) => {
                              const shortName = t.name.split('__')[1] ?? t.name;
                              const currentOverride = getToolOverride(server.toolPermissions, shortName);

                              const handleUpdateOverride = (val: 'always_prompt' | 'auto_approve' | 'deny' | 'inherit') => {
                                const updatedJson = updateToolOverride(server.toolPermissions, shortName, val);
                                updateMcpServer({
                                  id: server.id,
                                  toolPermissions: updatedJson,
                                });
                              };

                              return (
                                <div key={t.name} className="bg-surface/20 border-border/10 flex items-center justify-between gap-4 rounded-xl border px-3.5 py-2.5">
                                  <div className="min-w-0">
                                    <span className="text-accent font-mono text-[11px] font-black tracking-tight">
                                      {shortName}
                                    </span>
                                    {t.description && (
                                      <p className="text-text-muted mt-0.5 line-clamp-1 text-[10px] opacity-70">
                                        {t.description}
                                      </p>
                                    )}
                                  </div>

                                  <div className="bg-surface-secondary/85 border-border/20 flex gap-1 rounded-xl border p-1 select-none">
                                    {([
                                      { label: 'Inherit', value: 'inherit' },
                                      { label: 'Allow', value: 'auto_approve' },
                                      { label: 'Prompt', value: 'always_prompt' },
                                      { label: 'Deny', value: 'deny' }
                                    ] as const).map((opt) => (
                                      <button
                                        key={opt.value}
                                        id={`mcp-tool-override-${server.id}-${shortName}-${opt.value}`}
                                        type="button"
                                        onClick={() => {
                                          handleUpdateOverride(opt.value);
                                        }}
                                        className={`cursor-pointer rounded-lg px-2.5 py-1 text-[9px] font-black tracking-widest uppercase transition-all ${
                                          currentOverride === opt.value
                                            ? 'bg-accent text-brand-crust shadow-sm'
                                            : 'text-text-muted hover:text-text-main hover:bg-white/5'
                                        }`}
                                      >
                                        {opt.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Card Row actions (Edit/Delete) */}
                      <div className="border-border/5 flex items-center justify-end gap-2 border-t pt-3.5">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            handleStartEdit(server);
                          }}
                          className="border-border/20 hover:bg-surface-secondary/40 text-text-muted hover:text-text-main flex h-8 items-center gap-1.5 border px-3 text-[10px] font-bold tracking-widest uppercase"
                        >
                          <Edit2 className="h-3 w-3" />
                          EDIT_SERVER
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`Are you sure you want to delete ${server.name}?`)) {
                              deleteMcpServer(server.id);
                            }
                          }}
                          className="text-text-muted flex h-8 items-center gap-1.5 border border-red-500/20 px-3 text-[10px] font-bold tracking-widest uppercase hover:bg-red-500/10 hover:text-rose-400"
                        >
                          <Trash2 className="h-3 w-3" />
                          DELETE_SERVER
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}

            {mcpServers.length === 0 && !isAddingNew && (
              <Card className="border-border/30 bg-surface/10 hover:border-border/30 flex flex-col items-center justify-center gap-4 rounded-2xl border-dashed p-12 text-center">
                <div className="bg-surface-secondary/30 border-border/20 flex h-12 w-12 items-center justify-center rounded-full border">
                  <Cpu className="text-text-muted/40 h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-text-muted text-[11px] font-black tracking-widest uppercase">
                    NO_MCP_SERVERS_REGISTERED
                  </h3>
                  <p className="text-text-muted mt-1 max-w-sm text-center text-[11.5px] leading-relaxed font-bold opacity-60">
                    Connect local and remote tools to give coding agents custom superpowers.
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setIsAddingNew(true);
                  }}
                  className="bg-accent hover:bg-accent/80 text-brand-crust mt-2 flex h-8 items-center gap-1 rounded-xl px-4 text-[10px] font-extrabold tracking-widest uppercase"
                >
                  <Plus className="h-3.5 w-3.5 stroke-[3]" />
                  REGISTER_FIRST_SERVER
                </Button>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
