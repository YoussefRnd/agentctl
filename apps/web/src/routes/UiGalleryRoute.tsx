import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_FONT_CONFIG, type ElicitationItem } from '@agentctl/shared';
import { Inbox } from 'lucide-react';
import { SessionConfigProvider } from '@/features/sessions';
import {
  StreamingMarkdown,
  TextCard,
  ApprovalCard,
  ElicitationCard,
  CommandResultCard,
  ToolOutput,
  ToolDiffBlock,
} from '@/features/conversation';
import { CommandInputComposer } from '@/features/composer';
// Gallery-only screens stay outside the eager settings feature entry.
import { McpServerForm } from '../features/settings/ui/McpServerForm';
import { McpServerCard } from '../features/settings/ui/McpServerCard';
import { FontSettingsPanel } from '../features/settings/ui/FontSettingsPanel';
import { initialFormState } from '../features/settings/ui/McpUtils';
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  EmptyState,
  ErrorState,
  GlassPanel,
  Input,
  LoadingState,
  Select,
  Switch,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Dropdown,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  Tooltip,
} from '@agentctl/ui';

const longPath = `/workspace/${'very-long-project-directory/'.repeat(6)}file.ts`;
const stressMarkdown = [
  `A long path should wrap: ${longPath}`,
  `Inline code should wrap too: \`${longPath}\``,
  '```ts\nconst path = "' + longPath + '";\n```',
  '| File | Change | Status | Details | Owner |\n| --- | --- | --- | --- | --- |\n' +
    '| composer.tsx | Layout containment | Ready for review | Narrow panel verification | Interface team |',
].join('\n\n');

function LayoutStressCases() {
  const [width, setWidth] = useState('360');
  const [fontSize, setFontSize] = useState('13');
  const [theme, setTheme] = useState('mocha');
  const [input, setInput] = useState(longPath);
  const [isFocused, setIsFocused] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [suggestions, setSuggestions] = useState<'none' | 'commands' | 'context'>('none');
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [contextFilter, setContextFilter] = useState<'all' | 'file' | 'folder' | 'git' | 'symbol'>(
    'all',
  );
  const [savedPrompt, setSavedPrompt] = useState(`Please review ${longPath}`);
  const [formState, setFormState] = useState(initialFormState);
  const [fontConfig, setFontConfig] = useState(DEFAULT_FONT_CONFIG);
  const [serverExpanded, setServerExpanded] = useState(true);
  const [serverEnabled, setServerEnabled] = useState(true);
  const [selected, setSelected] = useState('long');
  const [feedback, setFeedback] = useState('');
  const [showRequests, setShowRequests] = useState(false);
  const [requestStatus, setRequestStatus] = useState<ElicitationItem['status']>('pending');
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { enabled: false } } }),
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commandRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    const properties = ['--font-ui-size', '--font-chat-size'];
    const previousValues = properties.map((property) => root.style.getPropertyValue(property));
    root.setAttribute('data-theme', theme);
    root.style.setProperty('--font-ui-size', `${fontSize}px`);
    root.style.setProperty('--font-chat-size', `${Number(fontSize) + 2}px`);
    return () => {
      if (previousTheme === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previousTheme);
      properties.forEach((property, index) => {
        if (previousValues[index]) root.style.setProperty(property, previousValues[index]);
        else root.style.removeProperty(property);
      });
    };
  }, [fontSize, theme]);

  return (
    <GallerySection
      title="Layout stress cases"
      description="Real message, composer, and form components with long content. Preview settings are temporary."
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="gallery-width" className="text-role-label mb-1 block">
            Panel width
          </label>
          <Select
            id="gallery-width"
            value={width}
            onChange={setWidth}
            options={[
              { value: '240', label: 'Narrow — 240px' },
              { value: '360', label: 'Compact — 360px' },
              { value: '640', label: 'Wide — 640px' },
            ]}
          />
        </div>
        <div>
          <label htmlFor="gallery-font-size" className="text-role-label mb-1 block">
            UI font size
          </label>
          <Select
            id="gallery-font-size"
            value={fontSize}
            onChange={setFontSize}
            options={[
              { value: '13', label: 'Default — 13px' },
              { value: '18', label: 'Large — 18px' },
              { value: '20', label: 'Extra large — 20px' },
            ]}
          />
        </div>
        <div>
          <label htmlFor="gallery-theme" className="text-role-label mb-1 block">
            Theme
          </label>
          <Select
            id="gallery-theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'mocha', label: 'Mocha — dark' },
              { value: 'latte', label: 'Latte — light' },
            ]}
          />
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={isStreaming} onCheckedChange={setIsStreaming} />
          Streaming response
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={isDraggingOver} onCheckedChange={setIsDraggingOver} />
          Drop overlay
        </label>
        <Select
          aria-label="Composer suggestions"
          className="max-w-64"
          value={suggestions}
          onChange={(value) => {
            setSuggestions(value as typeof suggestions);
            setActiveSuggestion(0);
          }}
          options={[
            { value: 'none', label: 'Suggestions hidden' },
            { value: 'commands', label: 'Slash commands' },
            { value: 'context', label: 'Context suggestions' },
          ]}
        />
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open test dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="pr-6">Layout verification</DialogTitle>
              <DialogDescription>Check scrolling, focus, and rounded corners.</DialogDescription>
            </DialogHeader>
            <div className="prose prose-invert max-w-none">
              <StreamingMarkdown content={stressMarkdown} />
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div
        data-testid="layout-stress-panel"
        className="max-w-full space-y-5"
        style={{ width: `${width}px` }}
      >
        <Card>
          <CardContent>
            <label htmlFor="gallery-long-select" className="text-role-label mb-2 block">
              Long selection
            </label>
            <Select
              id="gallery-long-select"
              value={selected}
              onChange={setSelected}
              options={[
                { value: 'long', label: longPath },
                { value: 'short', label: 'Short label' },
              ]}
            />
          </CardContent>
        </Card>
        <QueryClientProvider client={queryClient}>
          {/* An empty session disables API queries; edits only update this fixture. */}
          <SessionConfigProvider sessionId="">
            <TextCard
              content={savedPrompt}
              variant="user"
              eventId={1}
              onEditSubmit={(_, text) => setSavedPrompt(text)}
            />
          </SessionConfigProvider>
        </QueryClientProvider>
        <GlassPanel className="p-4">
          <div data-font-ctx="chat" className="prose prose-invert max-w-none">
            <StreamingMarkdown content={stressMarkdown} isStreaming={isStreaming} />
          </div>
        </GlassPanel>
        <div className="relative">
          <CommandInputComposer
            flags={{ isFocused, isDraggingOver, showSlashMenu: suggestions === 'commands' }}
            input={input}
            handleInputChange={setInput}
            setIsFocused={setIsFocused}
            handleSubmit={() => setFeedback('Preview prompt submitted')}
            handlePaste={() => undefined}
            handleDrop={(event) => event.preventDefault()}
            handleAttachClick={() => setFeedback('Attachment action preview')}
            textareaRef={textareaRef}
            filteredCommands={Array.from({ length: 12 }, (_, index) => ({
              name: `command-${index + 1}-${longPath}`,
              description: longPath,
              input: { hint: longPath },
            }))}
            activeCommandIndex={activeSuggestion}
            setActiveCommandIndex={setActiveSuggestion}
            commandRefs={commandRefs}
            handleSelectCommand={(command) => {
              setFeedback(`Preview command: ${command.name}`);
              setSuggestions('none');
            }}
            contextAutocomplete={{
              isOpen: suggestions === 'context',
              setIsOpen: (open) => setSuggestions(open ? 'context' : 'none'),
              items: Array.from({ length: 12 }, (_, index) => ({
                id: `file-${index + 1}`,
                type: 'file',
                title: longPath,
                subtitle: longPath,
                value: longPath,
              })),
              isLoading: false,
              searchError: false,
              query: '',
              listboxId: 'gallery-context',
              syncSelection: () => undefined,
              activeIndex: activeSuggestion,
              setActiveIndex: setActiveSuggestion,
              filterType: contextFilter,
              setFilterType: setContextFilter,
              attachedContexts: [],
              selectItem: () => {
                setFeedback('Preview context attached');
                setSuggestions('none');
              },
              addAttachedContext: () => undefined,
              removeAttachedContext: () => undefined,
              clearAttachedContexts: () => undefined,
              resolveAttachedContexts: async () => null,
              handleKeyDown: () => false,
            }}
            attachments={[]}
            removeAttachment={() => undefined}
            retryAttachment={() => undefined}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span className="text-role-caption text-text-muted">Composer preview</span>
              <Button size="compact" onClick={() => setFeedback('Preview prompt submitted')}>
                Send
              </Button>
            </div>
          </CommandInputComposer>
        </div>
        <McpServerForm
          formState={formState}
          onChange={setFormState}
          isEditing={false}
          onSave={() => setFeedback('Preview form saved')}
          onCancel={() => setFormState(initialFormState)}
        />
        <QueryClientProvider client={queryClient}>
          <McpServerCard
            server={{
              id: 'gallery',
              name: 'A very long MCP server name',
              enabled: serverEnabled,
              autoApprove: false,
              type: 'local',
              command: longPath,
              launchArgs: '[]',
              approvalPolicy: 'always_prompt',
              toolPermissions: '{}',
              status: 'connected',
            }}
            isExpanded={serverExpanded}
            onToggleExpand={() => setServerExpanded(!serverExpanded)}
            onToggleEnabled={setServerEnabled}
            onEdit={() => setFeedback('Preview server edit')}
            onDelete={() => setFeedback('Preview server delete')}
            onUpdatePolicy={() => setFeedback('Preview policy change')}
            onUpdateToolPermission={() => undefined}
          />
        </QueryClientProvider>
        <FontSettingsPanel
          fontConfig={fontConfig}
          onUpdate={(partial) => setFontConfig({ ...fontConfig, ...partial })}
        />
        <Card>
          <CardHeader>Overlay stress cases</CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Long popover</Button>
              </PopoverTrigger>
              <PopoverContent className="w-[380px]">
                <PopoverTitle>Connection details</PopoverTitle>
                <p className="text-role-caption text-text-muted">{longPath}</p>
                <Input aria-label="Preview connection name" defaultValue={longPath} />
              </PopoverContent>
            </Popover>
            <Dropdown>
              <Dropdown.Trigger asChild>
                <Button variant="outline">Long menu</Button>
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content className="max-h-[380px] w-[380px]">
                  {Array.from({ length: 12 }, (_, index) => (
                    <Dropdown.Item
                      key={index}
                      onSelect={() => setFeedback(`Preview menu item ${index + 1} selected`)}
                    >
                      {`Item ${index + 1}: ${longPath}`}
                    </Dropdown.Item>
                  ))}
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown>
            <Tooltip content={longPath} delayDuration={0}>
              <Button variant="outline">Long tooltip</Button>
            </Tooltip>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>Tool output</CardHeader>
          <CardContent>
            <ToolOutput
              label="Preview tool output"
              action={
                <Button
                  size="compact"
                  variant="ghost"
                  aria-label="Preview copy output"
                  onClick={() => setFeedback('Preview output copied')}
                >
                  Copy
                </Button>
              }
            >
              {Array.from({ length: 24 }, (_, index) => `${index + 1}: ${longPath}`).join('\n')}
            </ToolOutput>
          </CardContent>
        </Card>
        <ToolDiffBlock
          block={{
            changes: [{ operation: 'modify', path: longPath, fileType: 'text' }],
            patch: { format: 'git_patch', text: `@@ -1 +1 @@\n-before\n+${longPath}` },
          }}
        />
        <CommandResultCard command={longPath} args={{ path: longPath }} />
        <Button
          variant="outline"
          onClick={() => {
            setRequestStatus('pending');
            setShowRequests(!showRequests);
          }}
        >
          {showRequests ? 'Hide request cards' : 'Show request cards'}
        </Button>
        {showRequests && (
          <>
            <ApprovalCard
              eventId={2}
              data={{
                message: `Approve access to ${longPath}?`,
                request: { toolCall: { name: longPath, arguments: { path: longPath } } },
              }}
              onApprove={() => setFeedback('Preview approved')}
              onDeny={() => setFeedback('Preview denied')}
            />
            <ElicitationCard
              elicitation={{
                id: longPath,
                status: requestStatus,
                createdAt: '2026-10-06T12:00:00Z',
                request: {
                  id: longPath,
                  mode: 'form',
                  message: `Provide a destination for ${longPath}`,
                  form: {
                    fields: [
                      {
                        id: 'destination',
                        label: longPath,
                        type: 'string',
                        required: false,
                        default: longPath,
                      },
                    ],
                  },
                },
              }}
              onRespond={(_, response) => {
                setRequestStatus(response.action === 'submit' ? 'completed' : 'declined');
                setFeedback(`Preview request: ${response.action}`);
              }}
            />
          </>
        )}
        <p role="status" className="text-role-caption text-text-muted">
          {feedback}
        </p>
      </div>
    </GallerySection>
  );
}

const selectOptions = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
];

function GallerySection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`gallery-${title.toLowerCase().replaceAll(/[^a-z]+/g, '-')}`}>
      <div className="mb-3">
        <h2
          id={`gallery-${title.toLowerCase().replaceAll(/[^a-z]+/g, '-')}`}
          className="text-role-title text-text-main"
        >
          {title}
        </h2>
        <p className="text-role-body text-text-muted mt-1">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function UiGalleryRoute() {
  const [selectedAgent, setSelectedAgent] = useState('claude');
  const [enabled, setEnabled] = useState(true);

  return (
    <main className="bg-background text-text-main min-h-screen overflow-y-auto">
      <div className="mx-auto flex max-w-5xl min-w-0 flex-col gap-10 px-4 py-8 sm:px-6 sm:py-10">
        <header>
          <p className="text-role-eyebrow text-accent">Internal</p>
          <h1 className="mt-1 text-2xl font-semibold">UI gallery</h1>
          <p className="text-role-body text-text-muted mt-2 max-w-2xl">
            Shared Agentctl primitives and patterns in representative states. This page is available
            in development builds only.
          </p>
        </header>

        <LayoutStressCases />

        <GallerySection
          title="Buttons"
          description="Variants, sizes, disabled, and in-progress states."
        >
          <GlassPanel className="border-border/50 gap-4 border p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="solid">Solid</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="compact">Compact</Button>
              <Button size="default">Default</Button>
              <Button size="large">Large</Button>
              <Button disabled>Disabled</Button>
              <Button isLoading>Saving</Button>
            </div>
          </GlassPanel>
        </GallerySection>

        <GallerySection
          title="Inputs and selects"
          description="Editable, placeholder, validation, disabled, and selected states."
        >
          <GlassPanel className="border-border/50 grid gap-5 border p-5 sm:grid-cols-2">
            <label className="text-role-label text-text-muted flex flex-col gap-2">
              Project name
              <Input defaultValue="agentctl" aria-label="Project name" />
            </label>
            <label className="text-role-label text-text-muted flex flex-col gap-2">
              Placeholder
              <Input placeholder="Enter a value…" aria-label="Placeholder example" />
            </label>
            <label className="text-role-label text-danger flex flex-col gap-2">
              Invalid value
              <Input
                defaultValue="Unavailable"
                aria-label="Invalid value"
                aria-invalid="true"
                aria-describedby="gallery-input-error"
              />
              <span id="gallery-input-error">Choose a different value.</span>
            </label>
            <label className="text-role-label text-text-muted flex flex-col gap-2">
              Disabled
              <Input disabled defaultValue="Read only" aria-label="Disabled input" />
            </label>
            <div className="text-role-label text-text-muted flex flex-col gap-2">
              <label htmlFor="gallery-agent">Agent</label>
              <Select
                id="gallery-agent"
                value={selectedAgent}
                onChange={setSelectedAgent}
                options={selectOptions}
              />
            </div>
            <div className="text-role-label text-text-muted flex flex-col gap-2">
              <label htmlFor="gallery-disabled-agent">Disabled select</label>
              <Select
                id="gallery-disabled-agent"
                value="codex"
                onChange={() => undefined}
                options={selectOptions}
                disabled
              />
            </div>
          </GlassPanel>
        </GallerySection>

        <GallerySection title="Switches" description="On, off, compact, and disabled states.">
          <GlassPanel className="border-border/50 flex flex-wrap gap-6 border p-5">
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              Notifications {enabled ? 'on' : 'off'}
            </label>
            <label className="flex items-center gap-3 text-sm">
              <Switch size="compact" defaultChecked={false} />
              Compact
            </label>
            <label className="text-text-muted flex items-center gap-3 text-sm">
              <Switch checked disabled />
              Disabled
            </label>
          </GlassPanel>
        </GallerySection>

        <GallerySection
          title="Cards and surfaces"
          description="Shared containers and semantic card statuses."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(['default', 'success', 'warning', 'error', 'pending'] as const).map((status) => (
              <Card key={status} status={status}>
                <CardHeader>
                  <h3 className="text-role-title capitalize">{status}</h3>
                </CardHeader>
                <CardContent>
                  <p className="text-role-body text-text-muted">
                    A card using the shared {status} presentation.
                  </p>
                </CardContent>
                <CardFooter>
                  <span className="text-role-caption text-text-muted">Card footer</span>
                </CardFooter>
              </Card>
            ))}
            <GlassPanel intensity="high" className="border-border/50 border p-4">
              <h3 className="text-role-title">Glass panel</h3>
              <p className="text-role-body text-text-muted mt-2">High-intensity shared surface.</p>
            </GlassPanel>
          </div>
        </GallerySection>

        <GallerySection
          title="Feedback states"
          description="Loading, error, and empty patterns used for asynchronous content."
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <LoadingState message="Loading sessions…" className="min-h-52" />
            </Card>
            <Card>
              <ErrorState
                title="Could not load sessions"
                message="Check the connection and try again."
                onRetry={() => undefined}
                className="min-h-52"
              />
            </Card>
            <Card>
              <EmptyState
                icon={<Inbox aria-hidden="true" className="icon-prominent" />}
                title="No sessions yet"
                description="Start a session to see it here."
                action={<Button size="compact">New session</Button>}
                className="min-h-52"
              />
            </Card>
          </div>
        </GallerySection>
      </div>
    </main>
  );
}
