import { BrowserAuthInteractionPresentation } from './BrowserAuthInteraction';
import { ProviderAuthPresentation } from './ProviderAuthPresentation';
import { providerAuthMethods } from './ProviderAuthBodyLayouts';
import { getProviderEnvKeys } from '@agentctl/shared';
import { lazy, Suspense } from 'react';
import type { ProviderAuthDialogProps } from './ProviderAuthDialog';
import { SkeletonSurface } from '@agentctl/ui';
import { ProviderAuthDialogFrame } from './ProviderAuthDialogFrame';

const AuthDialog = lazy(() =>
  import('./ProviderAuthDialog').then((module) => ({ default: module.ProviderAuthDialogContent })),
);

export function ProviderAuthDialog(props: ProviderAuthDialogProps) {
  if (!props.isOpen || !props.provider) return null;
  return (
    <ProviderAuthDialogFrame provider={props.provider} onClose={props.onClose}>
      <Suspense
        fallback={
          <SkeletonSurface message="Loading authentication…">
            <ProviderAuthPresentation
              provider={props.provider}
              interaction={
                props.provider.authInteraction ? (
                  <BrowserAuthInteractionPresentation
                    request={props.provider.authInteraction}
                    onOpened={() => undefined}
                    copyLink={async () => undefined}
                    respond={async () => undefined}
                  />
                ) : undefined
              }
              showAdvancedEnv={
                providerAuthMethods(props.provider).length === 0 &&
                getProviderEnvKeys(props.provider).length > 0
              }
              setShowAdvancedEnv={() => undefined}
              localEnv={{}}
              setLocalEnv={() => undefined}
              handleCancel={() => undefined}
              handleStartLogin={() => undefined}
              handleSaveEnv={async () => undefined}
              verifyProvider={() => undefined}
              logoutProvider={() => undefined}
              onAttemptAuth={() => undefined}
              onClose={() => undefined}
            />
          </SkeletonSurface>
        }
      >
        <AuthDialog {...props} />
      </Suspense>
    </ProviderAuthDialogFrame>
  );
}
