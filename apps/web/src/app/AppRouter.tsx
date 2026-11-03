import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { HomeRoute } from '../routes/HomeRoute.js';
import { LoginRoute } from '../routes/LoginRoute.js';
import { SettingsRoute } from '../routes/SettingsRoute.js';
// Keep the development gallery out of the production module graph.
const galleryEnabled = import.meta.env.DEV || import.meta.env.MODE === 'gallery';
const UiGalleryRoute = galleryEnabled
  ? lazy(() => import('../routes/UiGalleryRoute.js').then((m) => ({ default: m.UiGalleryRoute })))
  : () => null;
import { LoadingState } from '@agentctl/ui';
import { AppShell, Sidebar } from './shell';

const SessionRoute = lazy(() =>
  import('../routes/SessionRoute.js').then((m) => ({ default: m.SessionRoute })),
);

export function AppRouter() {
  return (
    <Suspense
      fallback={
        <AppShell
          nav={<span className="text-role-control text-text-muted">Workspace</span>}
          sidebar={<Sidebar />}
        >
          <LoadingState message="Loading workspace…" className="h-full" />
        </AppShell>
      }
    >
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/" element={<HomeRoute />} />
        <Route path="/settings" element={<SettingsRoute />} />
        <Route path="/sessions/:sessionId" element={<SessionRoute />} />
        {galleryEnabled && <Route path="/_dev/ui" element={<UiGalleryRoute />} />}
      </Routes>
    </Suspense>
  );
}
