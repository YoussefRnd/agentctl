import { useState, type ReactNode } from 'react';
import { Inbox } from 'lucide-react';
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
} from '@agentctl/ui';

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
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-10">
        <header>
          <p className="text-role-eyebrow text-accent">Internal</p>
          <h1 className="mt-1 text-2xl font-semibold">UI gallery</h1>
          <p className="text-role-body text-text-muted mt-2 max-w-2xl">
            Shared Agentctl primitives and patterns in representative states. This page is available
            in development builds only.
          </p>
        </header>

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
