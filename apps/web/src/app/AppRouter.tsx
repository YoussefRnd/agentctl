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
import { Spinner } from '@agentctl/ui';

const SessionRoute = lazy(() =>
  import('../routes/SessionRoute.js').then((m) => ({ default: m.SessionRoute })),
);

export function AppRouter() {
  return (
    <Suspense
      fallback={
        <div className="bg-background flex h-screen w-screen items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
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
