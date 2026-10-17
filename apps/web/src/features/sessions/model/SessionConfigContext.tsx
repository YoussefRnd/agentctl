import { createContext, use, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SessionWithCapabilities, SessionMode, RepositoryReview } from '@agentctl/shared';
import { sessionDetailOptions } from '../api/sessionNavigation';
import { useSessionConfigState } from './useSessionConfigState';
import { useWorkspaceReviewState } from './useWorkspaceReviewState';

export type { PlanItem as StructuredPlanItem } from '@agentctl/shared';

interface SessionConfigContextValue {
  sessionId: string;
  sessionData: SessionWithCapabilities | null;
  capabilities: SessionWithCapabilities['capabilities'];
  isLoadingSession: boolean;
  reviewData: RepositoryReview;
  isLoadingReview: boolean;
  stageFile: (filePath: string) => Promise<void>;
  revertFile: (filePath: string) => Promise<void>;
  unstageFile: (filePath: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  commitChanges: (message: string, includeUnstaged?: boolean) => Promise<void>;
  pushChanges: () => Promise<{ success: boolean; output: string }>;
  pullChanges: () => Promise<{ success: boolean; output: string }>;
  mergeBranch: (branch: string) => Promise<void>;
  isMergingBranch: boolean;
  isPushing: boolean;
  isPulling: boolean;
  isCommitting: boolean;
  isStagingAll: boolean;
  isUnstagingAll: boolean;
  refetchReview: () => void;
  branches: string[];
  switchBranch: (branch: string) => Promise<void>;
  isSwitchingBranch: boolean;
  switchMode: (mode: SessionMode) => Promise<void>;
  isSwitchingMode: boolean;
  mergeSession: (commitMessage?: string, targetBranch?: string) => Promise<void>;
  isMergingSession: boolean;
  discardSession: () => Promise<void>;
  isDiscardingSession: boolean;
  setApprovalMode: (approvalMode: 'review' | 'auto_approve' | 'yolo') => Promise<void>;
  isUpdatingApprovalMode: boolean;
  setAgentPersona: (persona: string) => Promise<void>;
  isUpdatingAgentPersona: boolean;
  updateProvider: (providerId: string, modelId?: string) => Promise<void>;
  isUpdatingProvider: boolean;
  setSessionConfigOption: (configId: string, value: string) => Promise<void>;
  isUpdatingConfigOption: boolean;
}

const SessionConfigContext = createContext<SessionConfigContextValue | null>(null);

export function SessionConfigProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  const { data: sessionData = null, isLoading: isLoadingSession } = useQuery({
    ...sessionDetailOptions(sessionId),
  });

  const configState = useSessionConfigState(sessionId);
  const reviewState = useWorkspaceReviewState(sessionId);

  const value = useMemo(
    () => ({
      sessionId,
      sessionData,
      isLoadingSession,
      capabilities: sessionData?.capabilities ?? [],
      ...configState,
      ...reviewState,
    }),
    [sessionId, sessionData, isLoadingSession, configState, reviewState],
  );

  return <SessionConfigContext.Provider value={value}>{children}</SessionConfigContext.Provider>;
}

export function useSession() {
  const context = use(SessionConfigContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionConfigProvider');
  }
  return context;
}

/** Typed capability views over the existing configuration subscription; no new state owner. */
export type SessionWorkspaceModel = Pick<
  SessionConfigContextValue,
  | 'sessionId'
  | 'sessionData'
  | 'isLoadingSession'
  | 'reviewData'
  | 'isLoadingReview'
  | 'stageFile'
  | 'revertFile'
  | 'unstageFile'
  | 'stageAll'
  | 'unstageAll'
  | 'commitChanges'
  | 'pushChanges'
  | 'pullChanges'
  | 'mergeBranch'
  | 'isMergingBranch'
  | 'isPushing'
  | 'isPulling'
  | 'isCommitting'
  | 'isStagingAll'
  | 'isUnstagingAll'
  | 'refetchReview'
  | 'branches'
  | 'switchBranch'
  | 'isSwitchingBranch'
  | 'switchMode'
  | 'isSwitchingMode'
  | 'mergeSession'
  | 'isMergingSession'
  | 'discardSession'
  | 'isDiscardingSession'
>;
export type SessionConfigurationModel = Pick<
  SessionConfigContextValue,
  | 'sessionId'
  | 'sessionData'
  | 'isLoadingSession'
  | 'capabilities'
  | 'setApprovalMode'
  | 'isUpdatingApprovalMode'
  | 'setAgentPersona'
  | 'isUpdatingAgentPersona'
  | 'updateProvider'
  | 'isUpdatingProvider'
  | 'setSessionConfigOption'
  | 'isUpdatingConfigOption'
>;

export function useSessionWorkspace(): SessionWorkspaceModel {
  return useSession();
}
export function useSessionConfiguration(): SessionConfigurationModel {
  return useSession();
}
