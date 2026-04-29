'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';
import { motion } from 'framer-motion';
import { toast, Toaster } from 'react-hot-toast';
import { HiExclamationTriangle } from 'react-icons/hi2';
import GrantPrepChatPane from '@/components/grantPrep/GrantPrepChatPane';
import GrantPrepContextPanel from '@/components/grantPrep/GrantPrepContextPanel';
import { useGrantPrepEmbeddedMode } from '@/components/grantPrep/GrantPrepEmbedModeContext';
import GrantPrepHandoffModal from '@/components/grantPrep/GrantPrepHandoffModal';
import GrantPrepStageEditorModal from '@/components/grantPrep/GrantPrepStageEditorModal';
import GrantPrepStageNavigator from '@/components/grantPrep/GrantPrepStageNavigator';
import GrantPrepTopBar from '@/components/grantPrep/GrantPrepTopBar';
import type { GrantPrepStageKey } from '@/lib/grantPrep/types';
import { GRANT_PREP_STAGE_BY_KEY } from '@/lib/grantPrep/stageLibrary';
import type {
  GrantPrepLayoutMode,
  PointAction,
  PrepContext,
  PrepDraftingContext,
  PrepEngagementMode,
  PrepFundingContext,
  PrepHandoffPreview,
  PrepPostLaunchImpact,
  PrepSession,
} from '@/components/grantPrep/types';
import { useAuth } from '@/lib/auth-context';
import { withGrantWorkspaceStage } from '@/lib/grants/workspaceNavigation';

const DESKTOP_SPLIT_KEY = 'grant-prep-desktop-split';
const DESKTOP_CONTEXT_KEY = 'grant-prep-desktop-context-open';
const CHAT_FULLSCREEN_KEY = 'grant-prep-chat-fullscreen';
const TABLET_CONTEXT_KEY = 'grant-prep-tablet-context-open';
const MOBILE_CONTEXT_KEY = 'grant-prep-mobile-context-open';
const ENGAGEMENT_MODE_OPTIONS: Array<{
  key: PrepEngagementMode;
  label: string;
  description: string;
}> = [
  { key: 'expert', label: 'Expert', description: 'Reviewer-rigorous discussion with stricter progression.' },
  { key: 'express', label: 'Express', description: 'Faster capture from a short pitch or pasted draft.' },
];

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function formatEngagementModeLabel(mode: PrepEngagementMode) {
  return ENGAGEMENT_MODE_OPTIONS.find((option) => option.key === mode)?.label || 'Expert';
}

function pointConversationRole(point: { conversationRole?: string; sourceTemplatePointer?: string | null; priority?: string }) {
  if (
    point.conversationRole === 'user_required' ||
    point.conversationRole === 'can_infer_and_confirm' ||
    point.conversationRole === 'ai_draftable' ||
    point.conversationRole === 'context_only'
  ) {
    return point.conversationRole;
  }
  if (point.priority === 'P3') return 'ai_draftable';
  return point.sourceTemplatePointer ? 'can_infer_and_confirm' : 'user_required';
}

function isUserFacingPoint(point: { conversationRole?: string; sourceTemplatePointer?: string | null; priority?: string }) {
  const role = pointConversationRole(point);
  return role === 'user_required' || role === 'can_infer_and_confirm';
}

// EC-14: safe localStorage helpers
function safeLocalStorage(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function safeLocalStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

type GrantPrepPageProps = {
  onWorkspaceLaunched?: (payload: {
    grantSessionId?: string | null;
    blueprintId?: string | null;
    launchUrl?: string | null;
  }) => Promise<void> | void;
  postLaunchImpactOverride?: PrepPostLaunchImpact | null;
};

function buildPostLaunchWarning(impact: PrepPostLaunchImpact | null, sessionStatus?: string | null) {
  if (!impact || sessionStatus === 'archived') return null;

  if (impact.hasDraftContent) {
    return `Drafted grant content already exists in ${impact.draftedSectionCount} section${impact.draftedSectionCount === 1 ? '' : 's'}. You can continue Grant Prep, but changes may require updating the blueprint and reviewing drafted sections.`;
  }

  if (impact.hasBlueprint || impact.hasLaunchedWorkspace) {
    return 'A blueprint snapshot already exists. You can continue Grant Prep, but update the blueprint from the latest prep when you are done.';
  }

  return null;
}

export default function GrantPrepPage({
  onWorkspaceLaunched,
  postLaunchImpactOverride,
}: GrantPrepPageProps = {}) {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const forcedEmbedded = useGrantPrepEmbeddedMode();
  const { user, isLoading: authLoading } = useAuth();
  const projectId = params?.projectId as string | null;
  const grantId = params?.grantId as string | null;
  const isEmbeddedGrantMentor = forcedEmbedded || searchParams?.get('embed') === 'grantmentor';

  const [sessionData, setSessionData] = useState<PrepSession | null>(null);
  const [prepContext, setPrepContext] = useState<PrepContext | null>(null);
  const [fundingContext, setFundingContext] = useState<PrepFundingContext | null>(null);
  const [draftingContext, setDraftingContext] = useState<PrepDraftingContext | null>(null);
  const [postLaunchImpact, setPostLaunchImpact] = useState<PrepPostLaunchImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendCooldown, setSendCooldown] = useState(false);
  const [preview, setPreview] = useState<PrepHandoffPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [launching, setLaunching] = useState(false);
  const [actioning, setActioning] = useState<null | 'refresh' | 'restart' | 'archive'>(null);
  const [confirmAction, setConfirmAction] = useState<null | 'restart' | 'archive'>(null);
  const [viewportWidth, setViewportWidth] = useState(1440);
  const [desktopChatWidth, setDesktopChatWidth] = useState(65);
  const [desktopContextOpen, setDesktopContextOpen] = useState(true);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [tabletContextOpen, setTabletContextOpen] = useState(false);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const [draggingDivider, setDraggingDivider] = useState(false);
  const [stageEditorOpen, setStageEditorOpen] = useState(false);
  const [stageActioningKey, setStageActioningKey] = useState<GrantPrepStageKey | null>(null);
  const [focusedPointKey, setFocusedPointKey] = useState<string | null>(null);
  const [headerHeight, setHeaderHeight] = useState(140);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const desktopShellRef = useRef<HTMLDivElement | null>(null);

  const axiosConfig = useCallback(
    () => ({
      headers: {
        Authorization: `Bearer ${typeof window !== 'undefined' ? window.localStorage.getItem('auth_token') || '' : ''}`,
      },
    }),
    []
  );

  const hydrateSession = useCallback(async (sessionId: string) => {
    const response = await axios.get(`/api/grant-prep/sessions/${sessionId}`, axiosConfig());
    setSessionData(response.data.session);
    setPrepContext(response.data.prepContext);
    setFundingContext(response.data.fundingContext);
    setDraftingContext(response.data.draftingContext);
    setPostLaunchImpact(response.data.postLaunchImpact || null);
  }, [axiosConfig]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login');
    }
  }, [authLoading, router, user]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateWidth = () => setViewportWidth(window.innerWidth);
    updateWidth();

    const storedDesktopSplit = Number(safeLocalStorage(DESKTOP_SPLIT_KEY, '65'));
    if (!Number.isNaN(storedDesktopSplit)) {
      setDesktopChatWidth(Math.min(80, Math.max(55, storedDesktopSplit)));
    }

    setTabletContextOpen(safeLocalStorage(TABLET_CONTEXT_KEY, '0') === '1');
    setMobileContextOpen(safeLocalStorage(MOBILE_CONTEXT_KEY, '0') === '1');
    setDesktopContextOpen(safeLocalStorage(DESKTOP_CONTEXT_KEY, '1') === '1');
    setChatFullscreen(safeLocalStorage(CHAT_FULLSCREEN_KEY, '0') === '1');

    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    if (isEmbeddedGrantMentor) {
      setHeaderHeight(0);
      return;
    }
    if (!headerRef.current || typeof window === 'undefined') return;

    const updateHeaderHeight = () => {
      if (headerRef.current) {
        setHeaderHeight(Math.ceil(headerRef.current.getBoundingClientRect().height));
      }
    };

    updateHeaderHeight();
    window.addEventListener('resize', updateHeaderHeight);

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateHeaderHeight()) : null;
    if (observer) observer.observe(headerRef.current);

    return () => {
      window.removeEventListener('resize', updateHeaderHeight);
      observer?.disconnect();
    };
  }, [isEmbeddedGrantMentor, prepContext?.warning, sessionData?.last_handoff_error, viewportWidth]);

  useEffect(() => {
    if (authLoading || !user || !projectId || !grantId) return;

    let cancelled = false;
    const bootstrap = async () => {
      try {
        setLoading(true);
        const response = await axios.get(
          `/api/projects/${projectId}/grants/${grantId}`,
          axiosConfig()
        );
        if (cancelled) return;
        setSessionData(response.data.session);
        setPrepContext(response.data.prepContext);
        setFundingContext(response.data.fundingContext);
        setDraftingContext(response.data.draftingContext);
        setPostLaunchImpact(response.data.postLaunchImpact || null);
      } catch (error) {
        toast.error(
          axios.isAxiosError(error) && error.response?.data?.message
            ? error.response.data.message
            : 'Failed to open Grant Prep'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [authLoading, projectId, grantId, user, axiosConfig]);

  // EC-9: prevent text selection during drag
  useEffect(() => {
    if (!draggingDivider || typeof window === 'undefined') return;

    document.body.style.userSelect = 'none';

    const handleMove = (event: MouseEvent) => {
      if (!desktopShellRef.current) return;
      const bounds = desktopShellRef.current.getBoundingClientRect();
      const nextWidth = ((event.clientX - bounds.left) / bounds.width) * 100;
      const clamped = Math.min(80, Math.max(55, nextWidth));
      setDesktopChatWidth(clamped);
      safeLocalStorageSet(DESKTOP_SPLIT_KEY, String(clamped));
    };

    const handleUp = () => setDraggingDivider(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [draggingDivider]);

  const layoutMode: GrantPrepLayoutMode =
    viewportWidth >= 1280 ? 'desktop' : viewportWidth >= 1024 ? 'tablet' : 'mobile';
  const effectiveChatFullscreen = layoutMode === 'desktop' && chatFullscreen;
  const isContextOpen = effectiveChatFullscreen
    ? false
    : layoutMode === 'desktop'
      ? desktopContextOpen
      : layoutMode === 'tablet'
        ? tabletContextOpen
        : mobileContextOpen;

  const activeStage = prepContext ? prepContext.stageStates[prepContext.activeStageKey] : null;
  const sessionLocked =
    sessionData?.status === 'archived';
  const effectivePostLaunchImpact = postLaunchImpactOverride ?? postLaunchImpact;
  const postLaunchWarning = buildPostLaunchWarning(effectivePostLaunchImpact, sessionData?.status);
  const pendingReviewCount = useMemo(() => {
    if (!prepContext) return 0;
    return Object.values(prepContext.stageStates).filter(
      (stage) => stage.enabled && stage.status === 'needs_review'
    ).length;
  }, [prepContext]);

  const overallReadiness = useMemo(() => {
    if (!prepContext) return sessionData?.overall_readiness || 0;
    const stages = Object.values(prepContext.stageStates).filter(
      (stage) => stage.enabled && stage.pickable
    );
    if (stages.length === 0) return 0;
    return stages.reduce((sum, stage) => sum + stage.readiness, 0) / stages.length;
  }, [prepContext, sessionData?.overall_readiness]);

  const currentPointLabel = useMemo(() => {
    if (!prepContext || !activeStage) return null;
    const lastAssistant = sessionData?.messages.filter((m) => m.role === 'assistant').at(-1);
    if (lastAssistant?.current_point) {
      const point = activeStage.points.find((p) => p.key === lastAssistant.current_point);
      if (point) return point.label;
    }
    const nextPending = activeStage.points.find((p) => (p.status === 'pending' || p.status === 'needs_review') && isUserFacingPoint(p));
    return nextPending?.label || null;
  }, [prepContext, activeStage, sessionData?.messages]);

  const pendingPoints = useMemo(() => {
    if (!activeStage || !prepContext) return [];
    const mapping = prepContext.stageMapping[prepContext.activeStageKey];
    return activeStage.points
      .filter((p) => (p.status === 'pending' || p.status === 'needs_review') && isUserFacingPoint(p))
      .map((p) => {
        const mapped = mapping?.discussionPoints.find((dp) => dp.key === p.key);
        return { key: p.key, label: p.label, helpText: mapped?.helpText };
      });
  }, [activeStage, prepContext]);

  const handleStageChange = useCallback(
    async (stageKey: string) => {
      if (!sessionData?.id || !prepContext || stageKey === prepContext.activeStageKey) return;

      if (sessionLocked) {
        setPrepContext({
          ...prepContext,
          activeStageKey: stageKey as typeof prepContext.activeStageKey,
        });
        return;
      }

      try {
        await axios.put(
          `/api/grant-prep/sessions/${sessionData.id}/active-stage`,
          { stageKey },
          axiosConfig()
        );
        setPrepContext({
          ...prepContext,
          activeStageKey: stageKey as typeof prepContext.activeStageKey,
        });
      } catch {
        toast.error('Failed to switch stage');
      }
    },
    [sessionData?.id, prepContext, sessionLocked]
  );

  const handleEngagementModeChange = useCallback(
    async (engagementMode: PrepEngagementMode) => {
      if (!sessionData?.id || !prepContext || prepContext.engagementMode === engagementMode) return;

      try {
        const response = await axios.put(
          `/api/grant-prep/sessions/${sessionData.id}/engagement-mode`,
          { engagementMode },
          axiosConfig()
        );
        setPrepContext(response.data.prepContext);
        setSessionData((current) =>
          current ? { ...current, status: response.data.sessionStatus || current.status } : current
        );
        toast.success(`Engagement mode set to ${formatEngagementModeLabel(engagementMode)}`);
      } catch (error) {
        toast.error(
          axios.isAxiosError(error) && error.response?.data?.message
            ? error.response.data.message
            : 'Failed to update engagement mode'
        );
      }
    },
    [sessionData?.id, prepContext]
  );

  const refreshMapping = useCallback(async () => {
    if (!sessionData?.id || sessionLocked) return;

    setActioning('refresh');
    try {
      const response = await axios.post(
        `/api/grant-prep/sessions/${sessionData.id}/refresh-mapping`,
        {},
        axiosConfig()
      );
      setPrepContext(response.data.prepContext);
      setSessionData((current) =>
        current ? { ...current, status: response.data.sessionStatus } : current
      );
      setStageEditorOpen(false);
      setPreview(null);
      setPreviewOpen(false);
      setOverrideReason('');
      toast.success('Grant Prep mapping refreshed');
    } catch (error) {
      toast.error(
        axios.isAxiosError(error) && error.response?.data?.message
          ? error.response.data.message
          : 'Failed to refresh mapping'
      );
    } finally {
      setActioning(null);
    }
  }, [sessionData?.id, sessionLocked]);

  // EC-7: use custom confirm modal instead of window.confirm
  const restartPrep = useCallback(() => {
    if (!sessionData?.id) return;
    setConfirmAction('restart');
  }, [sessionData?.id]);

  const archivePrep = useCallback(() => {
    if (!sessionData?.id) return;
    setConfirmAction('archive');
  }, [sessionData?.id]);

  const executeConfirmedAction = useCallback(async () => {
    if (confirmAction === 'restart' && sessionData?.id) {
      setActioning('restart');
      try {
        const response = await axios.post(
          `/api/grant-prep/sessions/${sessionData.id}/restart`,
          {},
          axiosConfig()
        );
        await hydrateSession(response.data.session.id);
        setStageEditorOpen(false);
        setPreview(null);
        setPreviewOpen(false);
        setOverrideReason('');
        setInput('');
        toast.success('Started a new Grant Prep revision');
      } catch (error) {
        toast.error(
          axios.isAxiosError(error) && error.response?.data?.message
            ? error.response.data.message
            : 'Failed to restart Grant Prep'
        );
      } finally {
        setActioning(null);
      }
    }

    if (confirmAction === 'archive' && sessionData?.id) {
      setActioning('archive');
      try {
        await axios.post(
          `/api/grant-prep/sessions/${sessionData.id}/archive`,
          {},
          axiosConfig()
        );
        toast.success('Grant Prep archived');
        router.push(`/projects/${sessionData.project.id}/grants`);
      } catch (error) {
        toast.error(
          axios.isAxiosError(error) && error.response?.data?.message
            ? error.response.data.message
            : 'Failed to archive Grant Prep'
        );
      } finally {
        setActioning(null);
      }
    }

    setConfirmAction(null);
  }, [confirmAction, sessionData?.id, sessionData?.project?.id, hydrateSession, router]);

  // EC-11: cooldown only on success
  const sendMessage = useCallback(async (contentOverride?: string) => {
    const content = (contentOverride ?? input).trim();
    if (!sessionData?.id || !prepContext || !content || sessionLocked) return;

    const clientMessageId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setInput('');
    setSending(true);

    setSessionData((current) =>
      current
        ? { ...current, messages: [...current.messages, { id: clientMessageId, role: 'user', content }] }
        : current
    );

    try {
      const response = await axios.post(
        `/api/grant-prep/sessions/${sessionData.id}/message`,
        { content, clientMessageId, stageKey: prepContext.activeStageKey },
        axiosConfig()
      );
      if (response.data.warning) toast(response.data.warning, { icon: '!' });
      setPrepContext(response.data.prepContext);
      setSessionData((current) =>
        current
          ? { ...current, status: response.data.sessionStatus, messages: [...current.messages, response.data.message] }
          : current
      );
      setSendCooldown(true);
      setTimeout(() => setSendCooldown(false), 1500);
    } catch (error) {
      toast.error(
        axios.isAxiosError(error) && error.response?.data?.message
          ? error.response.data.message
          : 'Failed to send message'
      );
      setInput(content);
      setSessionData((current) =>
        current
          ? { ...current, messages: current.messages.filter((message) => message.id !== clientMessageId) }
          : current
      );
    } finally {
      setSending(false);
    }
  }, [input, prepContext, sessionData?.id, sessionLocked]);

  // EC-1: retry callback for orphan messages
  const retryMessage = useCallback((content: string) => {
    setInput(content);
    setSessionData((current) =>
      current && current.messages.length > 0 && current.messages[current.messages.length - 1].role === 'user'
        ? { ...current, messages: current.messages.slice(0, -1) }
        : current
    );
  }, []);

  const handlePointAction = useCallback(
    async (action: PointAction) => {
      if (!sessionData?.id) return;

      try {
        const response = await axios.patch(
          `/api/grant-prep/sessions/${sessionData.id}/points/${action.pointKey}`,
          action,
          axiosConfig()
        );
        setPrepContext(response.data.prepContext);
        setSessionData((current) =>
          current ? { ...current, status: response.data.sessionStatus } : current
        );
        setPreview(null);
        setPreviewOpen(false);
      } catch (error) {
        toast.error(
          axios.isAxiosError(error) && error.response?.data?.message
            ? error.response.data.message
            : 'Failed to update discussion point'
        );
      }
    },
    [sessionData?.id]
  );

  const openPreview = useCallback(async () => {
    if (!sessionData?.id || sessionLocked) return;

    try {
      const response = await axios.get(
        `/api/grant-prep/sessions/${sessionData.id}/handoff-preview`,
        axiosConfig()
      );
      setPreview(response.data.preview);
      setPreviewOpen(true);
    } catch {
      toast.error('Failed to build launch preview');
    }
  }, [sessionData?.id, sessionLocked]);

  const launchGrantWorkspace = useCallback(async () => {
    if (!sessionData?.id) return;
    setLaunching(true);
    try {
      const response = await axios.post(
        `/api/grant-prep/sessions/${sessionData.id}/handoff`,
        { overrideReason: overrideReason.trim() || undefined },
        axiosConfig()
      );
      toast.success('Local grant workspace created');
      if (onWorkspaceLaunched) {
        await onWorkspaceLaunched(response.data);
      } else if (response.data.launchUrl) {
        router.push(withGrantWorkspaceStage(response.data.launchUrl, 'BLUEPRINT'));
      }
    } catch (error) {
      toast.error(
        axios.isAxiosError(error) && error.response?.data?.message
          ? error.response.data.message
          : 'Failed to launch the local grant workspace'
      );
    } finally {
      setLaunching(false);
    }
  }, [axiosConfig, onWorkspaceLaunched, overrideReason, router, sessionData?.id]);

  const handleJumpToKeyword = useCallback(
    async (keyword: string) => {
      if (!prepContext) return;

      const match = Object.values(prepContext.stageStates)
        .filter((stage) => stage.enabled && stage.pickable)
        .flatMap((stage) =>
          stage.points
            .filter((point) => (point.capture?.keywords || []).includes(keyword))
            .map((point) => ({ stageKey: stage.stageKey, pointKey: point.key }))
        )[0];

      if (!match) return;
      if (prepContext.activeStageKey !== match.stageKey) await handleStageChange(match.stageKey);
      setFocusedPointKey(match.pointKey);
    },
    [handleStageChange, prepContext]
  );

  const toggleContext = useCallback(() => {
    if (layoutMode === 'desktop') {
      const next = !desktopContextOpen;
      setDesktopContextOpen(next);
      safeLocalStorageSet(DESKTOP_CONTEXT_KEY, next ? '1' : '0');
      return;
    }
    if (layoutMode === 'tablet') {
      const next = !tabletContextOpen;
      setTabletContextOpen(next);
      safeLocalStorageSet(TABLET_CONTEXT_KEY, next ? '1' : '0');
      return;
    }
    if (layoutMode === 'mobile') {
      const next = !mobileContextOpen;
      setMobileContextOpen(next);
      safeLocalStorageSet(MOBILE_CONTEXT_KEY, next ? '1' : '0');
    }
  }, [desktopContextOpen, layoutMode, mobileContextOpen, tabletContextOpen]);

  const toggleChatFullscreen = useCallback(() => {
    const next = !chatFullscreen;
    setChatFullscreen(next);
    safeLocalStorageSet(CHAT_FULLSCREEN_KEY, next ? '1' : '0');
  }, [chatFullscreen]);

  const handleEnableStage = useCallback(
    async (stageKey: GrantPrepStageKey) => {
      if (!sessionData?.id || sessionLocked) return;

      setStageActioningKey(stageKey);
      try {
        const response = await axios.put(
          `/api/grant-prep/sessions/${sessionData.id}/stages/${stageKey}/enable`,
          {},
          axiosConfig()
        );
        setPrepContext(response.data.prepContext);
        setPreview(null);
        setPreviewOpen(false);
        toast.success(`${response.data.prepContext.stageStates[stageKey].title} enabled`);
      } catch (error) {
        toast.error(
          axios.isAxiosError(error) && error.response?.data?.message
            ? error.response.data.message
            : 'Failed to enable stage'
        );
      } finally {
        setStageActioningKey(null);
      }
    },
    [sessionData?.id, sessionLocked]
  );

  const handleDisableStage = useCallback(
    async (stageKey: GrantPrepStageKey) => {
      if (!sessionData?.id || sessionLocked) return;

      setStageActioningKey(stageKey);
      try {
        const response = await axios.put(
          `/api/grant-prep/sessions/${sessionData.id}/stages/${stageKey}/disable`,
          {},
          axiosConfig()
        );
        setPrepContext(response.data.prepContext);
        setPreview(null);
        setPreviewOpen(false);
        toast.success(`${response.data.prepContext.stageStates[stageKey].title} disabled`);
      } catch (error) {
        toast.error(
          axios.isAxiosError(error) && error.response?.data?.message
            ? error.response.data.message
            : 'Failed to disable stage'
        );
      } finally {
        setStageActioningKey(null);
      }
    },
    [sessionData?.id, sessionLocked]
  );

  // EC-15: split loading vs corrupted state
  if (authLoading || loading || !sessionData || !prepContext) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-50">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-500" />
      </div>
    );
  }

  if (!activeStage) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 bg-prep-surface p-8">
        <HiExclamationTriangle className="h-10 w-10 text-amber-500" />
        <div className="text-center">
          <div className="text-lg font-semibold text-slate-900">Something went wrong</div>
          <div className="mt-1 text-sm text-slate-600">
            The session data appears to be corrupted. Try refreshing to re-sync.
          </div>
        </div>
        <button
          type="button"
          onClick={refreshMapping}
          className="rounded-lg bg-prep-accent px-4 py-2 text-sm font-medium text-white hover:bg-prep-accentDark"
        >
          Refresh Mapping
        </button>
      </div>
    );
  }

  const contextPanel = (
    <GrantPrepContextPanel
      prepContext={prepContext}
      fundingContext={fundingContext}
      draftingContext={draftingContext}
      overallReadiness={overallReadiness}
      focusedPointKey={focusedPointKey}
      sessionLocked={sessionLocked}
      onFocusedPointHandled={() => setFocusedPointKey(null)}
      onStageChange={handleStageChange}
      onJumpToKeyword={handleJumpToKeyword}
      onPointAction={handlePointAction}
      onOpenPreview={openPreview}
      topAccessory={
        layoutMode === 'desktop' && !effectiveChatFullscreen ? (
          <button
            type="button"
            onClick={toggleContext}
            className="text-xs font-medium text-slate-500 transition hover:text-slate-800"
          >
            Hide full
          </button>
        ) : null
      }
    />
  );

  return (
    <>
      <Toaster position="top-right" />
      {/* flex col fills the parent <main> which is flex-1 overflow-auto inside a h-screen flex */}
      <div className={clsx('flex flex-col bg-prep-surface', isEmbeddedGrantMentor ? 'h-screen' : 'h-full')}>
        {/* z-40 for header (EC-4) — not sticky since parent scrolls, this is a fixed header row */}
        {!isEmbeddedGrantMentor ? (
          <div ref={headerRef} className="z-40 flex-shrink-0 bg-white/95 backdrop-blur-sm">
            <GrantPrepTopBar
              session={sessionData}
              prepContext={prepContext}
              overallReadiness={overallReadiness}
              sessionLocked={sessionLocked}
              layoutMode={layoutMode}
              isContextOpen={isContextOpen}
              actioning={actioning}
              warning={prepContext.warning}
              handoffError={sessionData.last_handoff_error}
              pendingReviewCount={pendingReviewCount}
              activeStageTitle={activeStage.title}
              stageEditorDisabled={sessionLocked || sending || actioning !== null || stageActioningKey !== null}
              onRefreshMapping={refreshMapping}
              onRestartPrep={restartPrep}
              onArchivePrep={archivePrep}
              onOpenStageEditor={() => setStageEditorOpen(true)}
              onEngagementModeChange={handleEngagementModeChange}
              onToggleContext={toggleContext}
            />
          </div>
        ) : null}

        {/* This flex-1 + min-h-0 ensures the content area fills remaining height and doesn't overflow */}
        <div
          className={clsx(
            'flex w-full flex-1 flex-col',
            isEmbeddedGrantMentor
              ? 'px-4 py-4 sm:px-5 lg:px-6'
              : effectiveChatFullscreen
                ? 'px-4 py-4 sm:px-6 lg:px-8'
                : 'mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8'
          )}
          style={{ minHeight: 0 }}
        >
          {isEmbeddedGrantMentor && (prepContext.warning || sessionData.last_handoff_error || postLaunchWarning) ? (
            <div className="mb-4 space-y-2">
              {prepContext.warning ? (
                <div className="rounded-2xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-800">
                  {prepContext.warning}
                </div>
              ) : null}
              {postLaunchWarning ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {postLaunchWarning}
                </div>
              ) : null}
              {sessionData.last_handoff_error ? (
                <div className="rounded-2xl border border-rose-100 bg-rose-50/80 px-4 py-3 text-sm text-rose-800">
                  Last launch issue: {sessionData.last_handoff_error}
                </div>
              ) : null}
            </div>
          ) : null}
          {!isEmbeddedGrantMentor && postLaunchWarning ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {postLaunchWarning}
            </div>
          ) : null}
          {isEmbeddedGrantMentor && !effectiveChatFullscreen ? (
            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-prep-card sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Engagement mode</div>
                <div className="mt-1 text-sm text-slate-600">
                  {
                    ENGAGEMENT_MODE_OPTIONS.find((option) => option.key === prepContext.engagementMode)?.description
                  }
                </div>
              </div>
              <div className="inline-flex w-full items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 sm:w-auto">
                {ENGAGEMENT_MODE_OPTIONS.map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    onClick={() => handleEngagementModeChange(mode.key)}
                    disabled={sessionLocked}
                    title={mode.description}
                    className={clsx(
                      'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all sm:flex-none',
                      prepContext.engagementMode === mode.key
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700',
                      sessionLocked && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {/* EC-3: disable nav while sending */}
          {!effectiveChatFullscreen ? (
            <GrantPrepStageNavigator
              prepContext={prepContext}
              onStageChange={handleStageChange}
              disabled={sending || sendCooldown}
            />
          ) : null}

          {layoutMode === 'desktop' ? (
            <div ref={desktopShellRef} className="flex min-h-0 flex-1 items-stretch gap-0">
              <div style={{ width: `${isContextOpen ? desktopChatWidth : 100}%` }} className="relative flex min-w-0 flex-col pr-3">
                {!isContextOpen && !effectiveChatFullscreen ? (
                  <div className="absolute right-4 top-3 z-10">
                    <button
                      type="button"
                      onClick={toggleContext}
                      className="text-xs font-medium text-slate-500 transition hover:text-slate-800"
                    >
                      Show full
                    </button>
                  </div>
                ) : null}
                <GrantPrepChatPane
                  messages={sessionData.messages}
                  sending={sending}
                  sendCooldown={sendCooldown}
                  input={input}
                  onInputChange={setInput}
                  onSend={sendMessage}
                  onRetry={retryMessage}
                  sessionLocked={sessionLocked}
                  currentPointLabel={currentPointLabel}
                  activeStageTitle={activeStage.title}
                  activeStageDescription={GRANT_PREP_STAGE_BY_KEY[prepContext.activeStageKey]?.description}
                  pendingPoints={pendingPoints}
                  onToggleFullscreen={toggleChatFullscreen}
                  isFullscreen={effectiveChatFullscreen}
                />
              </div>
              {isContextOpen ? (
                <>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    onMouseDown={() => setDraggingDivider(true)}
                    className="mx-1 hidden w-3 cursor-col-resize rounded-full bg-slate-200 transition hover:bg-slate-300 xl:block"
                  />
                  <div className="flex min-w-[320px] flex-1 flex-col pl-3">{contextPanel}</div>
                </>
              ) : null}
            </div>
          ) : (
            <div className="relative flex min-h-0 flex-1 flex-col">
              {/* EC-5: mobile bottom padding */}
              <div className={clsx('flex min-h-0 flex-1 flex-col', layoutMode === 'mobile' && 'pb-20')}>
                <GrantPrepChatPane
                  messages={sessionData.messages}
                  sending={sending}
                  sendCooldown={sendCooldown}
                  input={input}
                  onInputChange={setInput}
                  onSend={sendMessage}
                  onRetry={retryMessage}
                  sessionLocked={sessionLocked}
                  currentPointLabel={currentPointLabel}
                  activeStageTitle={activeStage.title}
                  activeStageDescription={GRANT_PREP_STAGE_BY_KEY[prepContext.activeStageKey]?.description}
                  pendingPoints={pendingPoints}
                />
              </div>

              {layoutMode === 'tablet' ? (
                <>
                  {isContextOpen ? (
                    <div className="fixed inset-0 z-20 bg-slate-900/20" onClick={toggleContext} />
                  ) : null}
                  {/* EC-4: z-[35] for tablet aside */}
                  <motion.aside
                    initial={false}
                    animate={{ x: isContextOpen ? 0 : 420 }}
                    transition={{ type: 'spring', stiffness: 220, damping: 28 }}
                    style={{ top: headerHeight }}
                    className="fixed bottom-0 right-0 z-[35] w-[380px] overflow-y-auto border-l border-prep-border bg-prep-surface p-4 shadow-xl"
                  >
                    {contextPanel}
                  </motion.aside>
                </>
              ) : (
                // EC-4: z-[35] for mobile sheet
                <motion.div
                  initial={false}
                  animate={{ y: isContextOpen ? 0 : 'calc(100% - 64px)' }}
                  transition={{ type: 'spring', stiffness: 220, damping: 28 }}
                  className="fixed bottom-0 left-0 right-0 z-[35] h-[40vh] rounded-t-2xl border border-prep-border bg-prep-surface px-4 pb-4 pt-3 shadow-xl"
                >
                  <button
                    type="button"
                    onClick={toggleContext}
                    className="mx-auto mb-3 flex w-full max-w-xs flex-col items-center"
                  >
                    <span className="h-1.5 w-16 rounded-full bg-slate-300" />
                    <span className="mt-2 text-xs font-medium text-slate-500">
                      {isContextOpen ? 'Hide context' : 'Show context'}
                    </span>
                  </button>
                  <div className="h-[calc(100%-36px)] overflow-y-auto">{contextPanel}</div>
                </motion.div>
              )}
            </div>
          )}
        </div>
      </div>

      <GrantPrepHandoffModal
        isOpen={previewOpen}
        preview={preview}
        overrideReason={overrideReason}
        onOverrideReasonChange={setOverrideReason}
        onClose={() => setPreviewOpen(false)}
        onLaunch={launchGrantWorkspace}
        launching={launching}
      />

      <GrantPrepStageEditorModal
        open={stageEditorOpen}
        prepContext={prepContext}
        busyStageKey={stageActioningKey}
        disabled={sessionLocked || sending || actioning !== null}
        onClose={() => setStageEditorOpen(false)}
        onEnableStage={handleEnableStage}
        onDisableStage={handleDisableStage}
      />

      {/* EC-7: custom confirmation modal */}
      {confirmAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-prep-float">
            <div className="text-lg font-semibold text-slate-900">
              {confirmAction === 'restart' ? 'Start a New Revision?' : 'Archive This Session?'}
            </div>
            <div className="mt-2 text-sm text-slate-600">
              {confirmAction === 'restart'
                ? "The current session will be archived and a fresh one created. Your previous work is preserved but won't carry over."
                : 'This will archive the session and return you to the project dashboard. You can start a new prep session later.'}
            </div>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeConfirmedAction}
                disabled={actioning !== null}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {actioning
                  ? 'Working...'
                  : confirmAction === 'restart'
                    ? 'Yes, Start Fresh'
                    : 'Yes, Archive'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
