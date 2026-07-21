import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Copy, CheckCircle2, AlertCircle, MessageSquare, Info, MousePointer2, Calendar, Link as LinkIcon, Github, ArrowRight, Wand2, RotateCcw, ChevronLeft, ChevronRight, Clock, Users, X } from 'lucide-react';
import { createMeeting as createRemoteMeeting, getMeetingCount, joinMeeting as joinRemoteMeeting, loadMeeting, loadMeetingByShareCode, saveParticipantAvailability, subscribeToMeeting } from './lib/boardApi';
import { isSupabaseConfigured } from './lib/supabase';

const buildBoardHours = (start, end) => {
  const hours = [];
  for (let i = start; i <= end; i++) {
    const formatted = i.toString().padStart(2, '0');
    hours.push(`${formatted}:00`);
    if (i !== end) hours.push(`${formatted}:30`);
  }
  return hours;
};

const SLACK_NOTIFICATION = 'Slack';
const CREATOR_NOTIFICATION_CHANNELS = [SLACK_NOTIFICATION];
const NO_CREATOR_NOTIFICATION = '받지 않음';
const DRAG_START_THRESHOLD = 6;
const AVAILABILITY_SAVE_DELAY = 100;
const LUNCH_TIME_SLOTS = new Set(['11:30', '12:00', '12:30']);
const MEETING_TYPES = {
  REGULAR: 'regular',
  WORK: 'work',
};
const WEEKDAY_OPTIONS = [
  { key: 'mon', label: '월' },
  { key: 'tue', label: '화' },
  { key: 'wed', label: '수' },
  { key: 'thu', label: '목' },
  { key: 'fri', label: '금' },
  { key: 'sat', label: '토' },
  { key: 'sun', label: '일' },
];
const WEEKDAY_LABELS = WEEKDAY_OPTIONS.reduce((labels, day) => ({ ...labels, [day.key]: day.label }), {});
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const GITHUB_REPOSITORY_API = 'https://api.github.com/repos/sangjun121/moitime';
// New codes are 8-character Base64URL tokens; keep 10-character hex support for an older migration.
const SHARE_CODE_PATTERN = /^(?:[A-Za-z0-9_-]{8}|[a-f0-9]{10})$/;

const GithubStarBadge = () => {
  const [starCount, setStarCount] = useState(null);

  useEffect(() => {
    let isActive = true;

    fetch(GITHUB_REPOSITORY_API, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then(response => {
        if (!response.ok) throw new Error('GitHub star count unavailable');
        return response.json();
      })
      .then(repository => {
        if (isActive && Number.isInteger(repository.stargazers_count)) {
          setStarCount(repository.stargazers_count);
        }
      })
      .catch(() => {});

    return () => {
      isActive = false;
    };
  }, []);

  return (
    <span
      title="GitHub 저장소 스타 수"
      className="group inline-flex h-6 overflow-hidden rounded-[4px] border border-[#d0d7de] bg-white text-xs font-semibold leading-none text-[#24292f] transition-colors hover:border-[#b8c0c8]"
    >
      <span className="inline-flex items-center gap-0.5 bg-[#f6f8fa] px-1.5 group-hover:bg-[#eef1f3]">
        <Github className="h-2.5 w-2.5 shrink-0" size={10} strokeWidth={2.1} aria-hidden="true" />
        <span>Star</span>
      </span>
      <span className="inline-flex min-w-[34px] items-center justify-center border-l border-[#d0d7de] bg-white px-1 text-[#24292f] tabular-nums group-hover:bg-[#f6f8fa]">
        {starCount === null ? '-' : starCount.toLocaleString('ko-KR')}
      </span>
    </span>
  );
};

const parseBoardHash = hash => {
  if (!hash.startsWith('#board?')) return null;

  const params = new URLSearchParams(hash.slice('#board?'.length));
  const meetingId = params.get('id')?.trim();
  if (meetingId) return { type: 'id', value: meetingId };

  const shareCode = params.get('code')?.trim();
  return shareCode ? { type: 'shareCode', value: shareCode } : null;
};

const getAppBasePath = pathname => {
  const segments = pathname.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1];

  if (SHARE_CODE_PATTERN.test(lastSegment || '')) segments.pop();
  return segments.length > 0 ? `/${segments.join('/')}/` : '/';
};

const parseBoardPath = pathname => {
  const segments = pathname.split('/').filter(Boolean);
  const shareCode = segments[segments.length - 1] || '';
  return SHARE_CODE_PATTERN.test(shareCode) ? shareCode : null;
};

const parseBoardSearch = search => {
  const params = new URLSearchParams(search);
  const shareCode = params.get('code')?.trim();
  return shareCode ? { type: 'shareCode', value: shareCode } : null;
};

const getAppBaseUrl = () => `${window.location.origin}${getAppBasePath(window.location.pathname)}`;

const getBoardShareUrl = boardParams => {
  const baseUrl = getAppBaseUrl();
  if (!boardParams?.shareCode) {
    return `${baseUrl}#board?id=${encodeURIComponent(boardParams?.id || '')}`;
  }

  // GitHub Pages returns 404 for clean subpaths, so query URLs keep Kakao's crawler on a 200 response.
  return `${baseUrl}?code=${encodeURIComponent(boardParams.shareCode)}`;
};

let googleIdentityScriptPromise = null;

const loadGoogleIdentityScript = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('브라우저에서만 Google Calendar를 연결할 수 있습니다.'));
  }

  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (googleIdentityScriptPromise) return googleIdentityScriptPromise;

  googleIdentityScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`);
    const script = existingScript || document.createElement('script');

    const handleLoad = () => {
      if (window.google?.accounts?.oauth2) {
        resolve();
      } else {
        reject(new Error('Google Identity Services를 불러오지 못했습니다.'));
      }
    };
    const handleError = () => reject(new Error('Google 인증 스크립트를 불러오지 못했습니다.'));

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });

    if (!existingScript) {
      script.src = GOOGLE_IDENTITY_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch(error => {
    googleIdentityScriptPromise = null;
    throw error;
  });

  return googleIdentityScriptPromise;
};

const getUserFacingErrorMessage = (error, fallbackMessage) => {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (!message || error?.name === 'TypeError' || message.startsWith('TypeError')) {
    return fallbackMessage;
  }
  return message;
};

const requestGoogleAccessToken = async () => {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

  if (!clientId) {
    throw new Error('VITE_GOOGLE_CLIENT_ID가 설정되지 않았습니다. 배포 환경변수에 Google OAuth 웹 클라이언트 ID를 추가해주세요.');
  }

  await loadGoogleIdentityScript();

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Google 권한 창이 닫혔거나 응답 시간이 초과되었습니다. 다시 시도해주세요.'));
      }
    }, 90000);

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      callback(value);
    };

    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_CALENDAR_SCOPE,
        callback: response => {
          if (!response?.access_token || response.error) {
            finish(reject, new Error(response?.error_description || 'Google Calendar 권한을 승인하지 않았습니다.'));
            return;
          }

          finish(resolve, response.access_token);
        },
      });

      tokenClient.requestAccessToken({ prompt: '' });
    } catch (error) {
      finish(reject, error instanceof Error ? error : new Error('Google Calendar 권한 요청에 실패했습니다.'));
    }
  });
};

const createLocalDateTime = (dateKey, hour = 0, minute = 0) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getCalendarDateRange = dates => {
  const validDates = dates
    .map(date => createLocalDateTime(date))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  if (validDates.length === 0) {
    throw new Error('Google Calendar와 비교할 날짜가 없습니다.');
  }

  const timeMin = validDates[0];
  const timeMax = new Date(validDates[validDates.length - 1]);
  timeMax.setDate(timeMax.getDate() + 1);

  return {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
  };
};

const fetchGoogleCalendarList = async accessToken => {
  const calendars = [];
  let nextPageToken = '';

  do {
    const query = new URLSearchParams({
      maxResults: '250',
      showHidden: 'false',
    });

    if (nextPageToken) query.set('pageToken', nextPageToken);

    const response = await fetch(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error?.message || `Google Calendar 목록을 불러오지 못했습니다. (${response.status})`);
    }

    calendars.push(...(Array.isArray(result.items) ? result.items : []));
    nextPageToken = result.nextPageToken || '';
  } while (nextPageToken);

  return calendars
    .filter(calendar => !calendar.hidden && calendar.accessRole !== 'none')
    .sort((a, b) => {
      if (Boolean(a.primary) !== Boolean(b.primary)) return a.primary ? -1 : 1;
      if (Boolean(a.selected) !== Boolean(b.selected)) return a.selected ? -1 : 1;
      return (a.summaryOverride || a.summary || '').localeCompare(b.summaryOverride || b.summary || '');
    });
};

const fetchGoogleCalendarEvents = async (accessToken, calendarId, dates) => {
  const { timeMin, timeMax } = getCalendarDateRange(dates);
  const events = [];
  let nextPageToken = '';

  do {
    const query = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
    });

    if (nextPageToken) query.set('pageToken', nextPageToken);

    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error?.message || `Google Calendar 일정을 불러오지 못했습니다. (${response.status})`);
    }

    events.push(...(Array.isArray(result.items) ? result.items : []));
    nextPageToken = result.nextPageToken || '';
  } while (nextPageToken);

  return events
    .filter(event => event.status !== 'cancelled' && event.transparency !== 'transparent')
    .map(event => {
      const start = event.start?.dateTime
        ? new Date(event.start.dateTime)
        : event.start?.date
          ? createLocalDateTime(event.start.date)
          : null;
      const end = event.end?.dateTime
        ? new Date(event.end.dateTime)
        : event.end?.date
          ? createLocalDateTime(event.end.date)
          : null;

      if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
      return { start, end };
    })
    .filter(Boolean);
};

const getBoardSlotRange = (date, hour, boardEnd) => {
  const [hourValue, minuteValue] = hour.split(':').map(Number);
  const start = createLocalDateTime(date, hourValue, minuteValue);
  if (!start) return null;

  const durationMinutes = boardEnd === 23 && hourValue === boardEnd && minuteValue === 0 ? 60 : 30;
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + durationMinutes);
  return { start, end };
};

const isGoogleCalendarSlotAvailable = (events, date, hour, boardEnd) => {
  const slot = getBoardSlotRange(date, hour, boardEnd);
  if (!slot) return false;

  return !events.some(event => event.start < slot.end && event.end > slot.start);
};

const AppModal = ({ open, icon: Icon = Info, title, children, actions, onClose, closeOnOverlay = true }) => {
  useEffect(() => {
    if (!open || !onClose) return undefined;

    const handleKeyDown = event => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1d1d1f]/15 px-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={event => {
        if (closeOnOverlay && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-[18px] border border-[#e0e0e0] bg-white shadow-[0_20px_60px_rgba(29,29,31,0.16)]"
        role="dialog"
        aria-modal="true"
        aria-label={title || '알림'}
        onMouseDown={event => event.stopPropagation()}
      >
        {title && (
          <div className="flex items-center gap-2 border-b border-[#f0f0f0] px-5 py-4">
            <Icon className="text-[#19734d]" size={20} />
            <h2 className="font-bold text-[#1d1d1f]">{title}</h2>
          </div>
        )}
        <div className="px-5 py-6">{children}</div>
        {actions && <div className="modal-actions bg-[#f5f5f7] px-5 py-4">{actions}</div>}
      </div>
    </div>
  );
};

export default function App() {
  // --- 라우팅 상태 (메인 페이지 vs 보드 페이지) ---
  const [appState, setAppState] = useState('home');
  const [boardParams, setBoardParams] = useState(null);

  // --- 메인 페이지(생성) 폼 상태 ---
  const [meetingType, setMeetingType] = useState(MEETING_TYPES.WORK);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [selectedDates, setSelectedDates] = useState([]);
  const [calendarStartDate, setCalendarStartDate] = useState(() => {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    start.setDate(today.getDate() - today.getDay());
    return start;
  });
  const [startHour, setStartHour] = useState('09');
  const [endHour, setEndHour] = useState('18');
  const [isCreatorNotificationEnabled, setIsCreatorNotificationEnabled] = useState(false);
  const [expectedParticipantCount, setExpectedParticipantCount] = useState('');
  const [creatorNotificationPreference, setCreatorNotificationPreference] = useState(NO_CREATOR_NOTIFICATION);
  const [meetingCount, setMeetingCount] = useState(null);

  // --- 보드(투표) 페이지 상태 ---
  const [currentUser, setCurrentUser] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [availability, setAvailability] = useState({});
  const [participantId, setParticipantId] = useState(null);
  const [participantAuthError, setParticipantAuthError] = useState('');
  const [isBoardLoading, setIsBoardLoading] = useState(false);
  const [boardLoadError, setBoardLoadError] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [isCreatingMeeting, setIsCreatingMeeting] = useState(false);
  const [isSavingAvailability, setIsSavingAvailability] = useState(false);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const [shareMessage, setShareMessage] = useState('');
  const [waveSlots, setWaveSlots] = useState({});
  const [isSlackConnectModalOpen, setIsSlackConnectModalOpen] = useState(false);
  const [slackConnectTarget, setSlackConnectTarget] = useState('home');
  
  // 드래그 및 UI 상태
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState(null); 
  const [tooltipData, setTooltipData] = useState({ visible: false, x: 0, y: 0, slotKey: null });
  const [toastMessage, setToastMessage] = useState(null);
  
  // 구글 캘린더 연동 상태
  const [isCalendarPickerOpen, setIsCalendarPickerOpen] = useState(false);
  const [googleCalendars, setGoogleCalendars] = useState([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState([]);
  const [isCalendarAutoFilling, setIsCalendarAutoFilling] = useState(false);
  const [isLunchHintVisible, setIsLunchHintVisible] = useState(true);
  const [dialog, setDialog] = useState(null);
  const lastSavedAvailabilityRef = useRef(null);
  const availabilityRef = useRef(availability);
  const currentUserRef = useRef(currentUser);
  const pendingLocalSlotKeysRef = useRef(null);
  const isDraggingRef = useRef(false);
  const dragModeRef = useRef(null);
  const activePointerIdRef = useRef(null);
  const activePointerTargetRef = useRef(null);
  const pointerStartRef = useRef(null);
  const lastPaintedSlotRef = useRef(null);
  const lastGestureCellRef = useRef(null);
  const pointerEndHandlerRef = useRef(null);
  const availabilitySaveQueueRef = useRef(Promise.resolve());
  const latestAvailabilitySaveSignatureRef = useRef(null);
  const realtimeRefreshRequestRef = useRef(0);
  const googleAccessTokenRef = useRef(null);

  const showAlert = message => {
    setDialog({ type: 'alert', title: '알림', message });
  };

  const showConfirm = (message, onConfirm) => {
    setDialog({ type: 'confirm', title: '확인해주세요', message, onConfirm });
  };

  const closeDialog = () => setDialog(null);

  const handleDialogConfirm = () => {
    const onConfirm = dialog?.onConfirm;
    setDialog(null);
    onConfirm?.();
  };

  useEffect(() => {
    availabilityRef.current = availability;
  }, [availability]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  const hasActiveParticipantSession = isJoined
    && Boolean(participantId)
    && Boolean(currentUser.trim())
    && Boolean(currentPassword.trim());

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    let isActive = true;
    getMeetingCount()
      .then(count => {
        if (isActive) setMeetingCount(count);
      })
      .catch(() => {
        if (isActive) setMeetingCount(null);
      });

    return () => {
      isActive = false;
    };
  }, []);

  const getCurrentUserSlotKeys = (nextAvailability) => (
    Object.entries(nextAvailability)
      .filter(([, users]) => Array.isArray(users) && users.includes(currentUserRef.current))
      .map(([slotKey]) => slotKey)
      .sort()
  );

  const areSlotKeyListsEqual = (first, second) => (
    JSON.stringify(first || []) === JSON.stringify(second || [])
  );

  const setAvailabilitySafely = (nextAvailability, { markLocalPending = false } = {}) => {
    availabilityRef.current = nextAvailability;
    if (markLocalPending) {
      pendingLocalSlotKeysRef.current = getCurrentUserSlotKeys(nextAvailability);
    }
    setAvailability(nextAvailability);
  };

  const mergeAvailabilityWithPendingLocal = (remoteAvailability) => {
    const pendingSlotKeys = pendingLocalSlotKeysRef.current;
    const localUser = currentUserRef.current;
    if (!pendingSlotKeys || !localUser) return remoteAvailability;

    const mergedAvailability = {};
    Object.entries(remoteAvailability).forEach(([slotKey, users]) => {
      const nextUsers = (Array.isArray(users) ? users : []).filter(user => user !== localUser);
      if (nextUsers.length > 0) mergedAvailability[slotKey] = nextUsers;
    });

    pendingSlotKeys.forEach(slotKey => {
      const slotUsers = mergedAvailability[slotKey] || [];
      mergedAvailability[slotKey] = slotUsers.includes(localUser) ? slotUsers : [...slotUsers, localUser];
    });

    return mergedAvailability;
  };

  // --- URL Hash 기반 라우팅 ---
  useEffect(() => {
    let isActive = true;

    const resetBoardSession = () => {
      setParticipants([]);
      setAvailability({});
      setParticipantId(null);
      setCurrentUser('');
      setCurrentPassword('');
      setParticipantAuthError('');
      setSelectedResultIndex(0);
      setShareMessage('');
      setWaveSlots({});
      googleAccessTokenRef.current = null;
      setIsCalendarPickerOpen(false);
      setGoogleCalendars([]);
      setSelectedCalendarIds([]);
      lastSavedAvailabilityRef.current = null;
      pendingLocalSlotKeysRef.current = null;
      isDraggingRef.current = false;
      dragModeRef.current = null;
      activePointerIdRef.current = null;
      activePointerTargetRef.current = null;
      pointerStartRef.current = null;
      lastPaintedSlotRef.current = null;
    };

    const handleHashChange = async () => {
      if (window.location.hash === '' && window.location.href.endsWith('#')) {
        window.history.replaceState(window.history.state, '', window.location.href.slice(0, -1));
      }

      const hash = window.location.hash;
      const pathname = window.location.pathname;
      const pathShareCode = parseBoardPath(pathname);
      const boardRoute = pathShareCode
        ? { type: 'shareCode', value: pathShareCode }
        : parseBoardSearch(window.location.search) || parseBoardHash(hash);
      window.scrollTo(0, 0);

      const isBoardHash = hash.startsWith('#board?');
      if (!boardRoute && !isBoardHash) {
        setAppState('home');
        setBoardParams(null);
        setIsBoardLoading(false);
        setBoardLoadError('');
        resetBoardSession();
        return;
      }

      if (!boardRoute) {
        setAppState('board');
        setBoardParams(null);
        setIsBoardLoading(false);
        setBoardLoadError('유효한 모임 링크가 아닙니다. 새 모임을 만들거나 올바른 링크를 확인해주세요.');
        resetBoardSession();
        return;
      }

      if (!isSupabaseConfigured) {
        setAppState('board');
        setBoardParams(null);
        setIsBoardLoading(false);
        setBoardLoadError('이 모임 링크를 열려면 Supabase 환경변수를 먼저 설정해야 합니다.');
        resetBoardSession();
        return;
      }

      setAppState('board');
      setBoardParams(null);
      setIsBoardLoading(true);
      setBoardLoadError('');
      resetBoardSession();

      try {
        const remoteBoard = boardRoute.type === 'shareCode'
          ? await loadMeetingByShareCode(boardRoute.value)
          : await loadMeeting(boardRoute.value);
        if (!isActive || window.location.pathname !== pathname || window.location.hash !== hash) return;

        if (boardRoute.type === 'id' && remoteBoard.boardParams.shareCode) {
          const canonicalUrl = getBoardShareUrl(remoteBoard.boardParams);
          if (window.location.href !== canonicalUrl) {
            window.history.replaceState(window.history.state, '', canonicalUrl);
          }
        }

        setBoardParams(remoteBoard.boardParams);
        setParticipants(remoteBoard.participants);
        setAvailabilitySafely(remoteBoard.availability);
        setIsBoardLoading(false);
      } catch (error) {
        if (!isActive || window.location.pathname !== pathname || window.location.hash !== hash) return;
        setIsBoardLoading(false);
        setBoardLoadError(getUserFacingErrorMessage(error, '모임 정보를 불러오지 못했습니다.'));
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange(); // 초기 로드
    return () => {
      isActive = false;
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (!boardParams?.id) return undefined;
    let isActive = true;

    const refreshBoard = async () => {
      const requestId = realtimeRefreshRequestRef.current + 1;
      realtimeRefreshRequestRef.current = requestId;

      try {
        const remoteBoard = await loadMeeting(boardParams.id);
        if (!isActive || requestId !== realtimeRefreshRequestRef.current) return;
        setParticipants(remoteBoard.participants);

        const pendingSlotKeys = pendingLocalSlotKeysRef.current;
        if (
          pendingSlotKeys
          && areSlotKeyListsEqual(getCurrentUserSlotKeys(remoteBoard.availability), pendingSlotKeys)
        ) {
          pendingLocalSlotKeysRef.current = null;
        }

        setAvailabilitySafely(mergeAvailabilityWithPendingLocal(remoteBoard.availability));
      } catch (error) {
        if (isActive && requestId === realtimeRefreshRequestRef.current) {
          showToast(getUserFacingErrorMessage(error, '응답을 새로고침하지 못했습니다.'));
        }
      }
    };

    const unsubscribe = subscribeToMeeting(boardParams.id, refreshBoard);
    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [boardParams?.id]);

  // --- 공통 유틸 ---
  const formatDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatMonthLabel = (date, previousDate) => {
    const monthLabel = `${date.getMonth() + 1}월`;
    if (!previousDate) return monthLabel;

    const previousMonthLabel = `${previousDate.getMonth() + 1}월`;
    if (previousDate.getMonth() !== date.getMonth()) {
      return `${previousMonthLabel}/${monthLabel}`;
    }

    return monthLabel;
  };

  const isSameDay = (a, b) => formatDateKey(a) === formatDateKey(b);

  const showToast = (message) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const copyToClipboard = (text, successMsg = '복사되었습니다.') => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "absolute";
    textArea.style.left = "-999999px";
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showToast(successMsg);
    } catch (err) {
      showToast('복사에 실패했습니다.');
    } finally {
      textArea.remove();
    }
  };

  const handleShareMessageToKakao = async () => {
    if (!shareMessage.trim()) {
      showAlert('공유할 메시지가 없습니다.');
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: boardParams?.title || '모아타임',
          text: shareMessage,
        });
        showToast('공유 창을 열었습니다.');
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }

    copyToClipboard(shareMessage, '메시지를 복사했습니다. 카카오톡에 붙여넣어 공유해주세요.');
  };

  const handleShareMessageToSlack = () => {
    if (!shareMessage.trim()) {
      showAlert('공유할 메시지가 없습니다.');
      return;
    }

    copyToClipboard(shareMessage, '메시지를 복사했습니다. Slack에 붙여넣어 공유해주세요.');
  };

  // --- 메인 페이지 핸들러 ---
  const handleToggleCalendarDate = (date) => {
    const dateKey = formatDateKey(date);
    setSelectedDates(prev => (
      prev.includes(dateKey)
        ? prev.filter(selectedDate => selectedDate !== dateKey)
        : [...prev, dateKey].sort()
    ));
  };

  const handleToggleWeekday = (weekdayKey) => {
    setSelectedDates(prev => (
      prev.includes(weekdayKey)
        ? prev.filter(selectedDate => selectedDate !== weekdayKey)
        : [...prev, weekdayKey].sort((a, b) => (
          WEEKDAY_OPTIONS.findIndex(day => day.key === a) - WEEKDAY_OPTIONS.findIndex(day => day.key === b)
        ))
    ));
  };

  const moveCalendarByWeeks = (weekOffset) => {
    setCalendarStartDate(prev => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + weekOffset * 7);
      return next;
    });
  };

  const calendarWeeks = useMemo(() => {
    return Array.from({ length: 5 }).map((_, weekIndex) => (
      Array.from({ length: 7 }).map((__, dayIndex) => {
        const date = new Date(calendarStartDate);
        date.setDate(calendarStartDate.getDate() + weekIndex * 7 + dayIndex);
        return date;
      })
    ));
  }, [calendarStartDate]);

  const formatColumnLabel = (value) => {
    if (WEEKDAY_LABELS[value]) return WEEKDAY_LABELS[value];

    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
    return `${month}/${day} (${weekday})`;
  };

  const formatResultTime = (date, hour) => {
    if (WEEKDAY_LABELS[date]) return `${WEEKDAY_LABELS[date]} ${hour}`;

    const [year, month, day] = date.split('-').map(Number);
    const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(year, month - 1, day).getDay()];
    return `${month}월 ${day}일(${weekday}) ${hour}`;
  };

  const handleCreateMeeting = async () => {
    if (selectedDates.length === 0) {
      showAlert(meetingType === MEETING_TYPES.REGULAR ? '요일을 하나 이상 선택해주세요.' : '날짜를 하루 이상 선택해주세요.');
      return;
    }
    if (parseInt(startHour) > parseInt(endHour)) {
      showAlert('시작 시간은 종료 시간보다 늦을 수 없습니다.');
      return;
    }
    if (isCreatorNotificationEnabled && expectedParticipantCount && parseInt(expectedParticipantCount, 10) < 1) {
      showAlert('예상 참여 인원은 1명 이상으로 입력해주세요.');
      return;
    }
    if (!isSupabaseConfigured) {
      showAlert('Supabase 환경변수가 설정되지 않았습니다. .env.local 또는 배포 환경변수를 먼저 설정해주세요.');
      return;
    }

    const safeMeetingTitle = meetingTitle.trim() || '모임';

    setIsCreatingMeeting(true);
    try {
      const createdMeeting = await createRemoteMeeting({
        title: safeMeetingTitle,
        type: meetingType,
        dates: selectedDates,
        start: startHour,
        end: endHour,
        expectedParticipants: isCreatorNotificationEnabled && expectedParticipantCount ? Number(expectedParticipantCount) : null,
        notificationChannel: isCreatorNotificationEnabled ? creatorNotificationPreference : NO_CREATOR_NOTIFICATION,
      });

      setMeetingCount(currentCount => (
        typeof currentCount === 'number' ? currentCount + 1 : currentCount
      ));
      if (createdMeeting.shareCode) {
        window.location.href = getBoardShareUrl(createdMeeting);
      } else {
        window.location.hash = `board?id=${encodeURIComponent(createdMeeting.id)}`;
      }
    } catch (error) {
      showAlert(getUserFacingErrorMessage(error, '모임을 만들지 못했습니다.'));
    } finally {
      setIsCreatingMeeting(false);
    }
  };

  // --- 보드 페이지 로직 ---
  const boardHours = useMemo(() => {
    if (!boardParams) return [];
    return buildBoardHours(boardParams.start, boardParams.end);
  }, [boardParams]);

  const hasLunchTimeSlots = boardHours.some(hour => LUNCH_TIME_SLOTS.has(hour));

  const handleJoinBoard = async (e) => {
    e.preventDefault();
    const participantName = currentUser.trim();
    const temporaryPassword = currentPassword.trim();

    if (!participantName || !temporaryPassword) {
      setParticipantAuthError('이름과 임시 비밀번호를 입력해주세요.');
      return;
    }

    if (temporaryPassword.length < 4) {
      setParticipantAuthError('임시 비밀번호는 4자 이상 입력해주세요.');
      return;
    }

    const isExistingParticipant = participants.some(participant => participant.toLowerCase() === participantName.toLowerCase());
    setIsJoining(true);
    setParticipantAuthError('');

    try {
      const participant = await joinRemoteMeeting({
        meetingId: boardParams.id,
        name: participantName,
        password: temporaryPassword,
      });

      const savedSlotKeys = Object.entries(availabilityRef.current)
        .filter(([, users]) => Array.isArray(users) && users.includes(participant.name))
        .map(([slotKey]) => slotKey)
        .sort();
      lastSavedAvailabilityRef.current = `${participant.id}:${JSON.stringify(savedSlotKeys)}`;
      pendingLocalSlotKeysRef.current = null;
      setParticipantId(participant.id);
      setCurrentUser(participant.name);
      setIsJoined(true);
      if (!isExistingParticipant) setParticipants(prev => [...prev, participant.name]);
      showToast(isExistingParticipant ? '기존 응답을 불러왔습니다.' : `${participant.name}님으로 참여했습니다.`);
    } catch (error) {
      setParticipantAuthError(getUserFacingErrorMessage(error, '모임 참여에 실패했습니다.'));
    } finally {
      setIsJoining(false);
    }
  };

  const updateSlot = (slotKey, forceMode) => {
    if (!hasActiveParticipantSession) return;
    setWaveSlots(prev => {
      if (!prev[slotKey]) return prev;
      const next = { ...prev };
      delete next[slotKey];
      return next;
    });

    setAvailability(prev => {
      const currentSlotUsers = prev[slotKey] || [];
      const hasUser = currentSlotUsers.includes(currentUser);
      let newSlotUsers = [...currentSlotUsers];

      if (forceMode === 'add' && !hasUser) newSlotUsers.push(currentUser);
      else if (forceMode === 'remove' && hasUser) newSlotUsers = newSlotUsers.filter(u => u !== currentUser);

      const nextAvailability = { ...prev };
      if (newSlotUsers.length > 0) nextAvailability[slotKey] = newSlotUsers;
      else delete nextAvailability[slotKey];

      availabilityRef.current = nextAvailability;
      pendingLocalSlotKeysRef.current = getCurrentUserSlotKeys(nextAvailability);
      return nextAvailability;
    });

  };

  const updateDateColumn = (date, forceMode) => {
    if (!hasActiveParticipantSession || !boardHours.length) return;

    setAvailability(prev => {
      const nextAvailability = { ...prev };

      boardHours.forEach(hour => {
        const slotKey = `${date}-${hour}`;
        const currentSlotUsers = nextAvailability[slotKey] || [];
        const hasUser = currentSlotUsers.includes(currentUser);

        if (forceMode === 'add' && !hasUser) {
          nextAvailability[slotKey] = [...currentSlotUsers, currentUser];
        } else if (forceMode === 'remove' && hasUser) {
          const nextSlotUsers = currentSlotUsers.filter(user => user !== currentUser);
          if (nextSlotUsers.length > 0) nextAvailability[slotKey] = nextSlotUsers;
          else delete nextAvailability[slotKey];
        }
      });

      availabilityRef.current = nextAvailability;
      pendingLocalSlotKeysRef.current = getCurrentUserSlotKeys(nextAvailability);
      return nextAvailability;
    });
  };

  const paintSlot = (slotKey, mode) => {
    if (!slotKey || !mode || lastPaintedSlotRef.current === slotKey) return;
    lastPaintedSlotRef.current = slotKey;
    updateSlot(slotKey, mode);
  };

  const paintDateColumn = (date, mode) => {
    const columnKey = date ? `date:${date}` : null;
    if (!date || !mode || lastPaintedSlotRef.current === columnKey) return;
    lastPaintedSlotRef.current = columnKey;
    updateDateColumn(date, mode);
  };

  const getSlotCoordinates = slotKey => {
    if (!slotKey || !boardParams) return null;
    const separator = slotKey.lastIndexOf('-');
    if (separator < 0) return null;

    const dateIndex = boardParams.dates.indexOf(slotKey.slice(0, separator));
    const hourIndex = boardHours.indexOf(slotKey.slice(separator + 1));
    if (dateIndex < 0 || hourIndex < 0) return null;

    return { dateIndex, hourIndex };
  };

  const paintSlotPath = (fromSlotKey, toSlotKey, mode) => {
    const from = getSlotCoordinates(fromSlotKey);
    const to = getSlotCoordinates(toSlotKey);
    if (!from || !to) return;

    const steps = Math.max(
      Math.abs(to.dateIndex - from.dateIndex),
      Math.abs(to.hourIndex - from.hourIndex),
    );

    for (let step = 0; step <= steps; step += 1) {
      const progress = steps === 0 ? 1 : step / steps;
      const dateIndex = Math.round(from.dateIndex + (to.dateIndex - from.dateIndex) * progress);
      const hourIndex = Math.round(from.hourIndex + (to.hourIndex - from.hourIndex) * progress);
      paintSlot(`${boardParams.dates[dateIndex]}-${boardHours[hourIndex]}`, mode);
    }
  };

  const paintDateColumnPath = (fromDate, toDate, mode) => {
    if (!boardParams || !fromDate || !toDate) return;
    const fromIndex = boardParams.dates.indexOf(fromDate);
    const toIndex = boardParams.dates.indexOf(toDate);
    if (fromIndex < 0 || toIndex < 0) return;

    const direction = fromIndex <= toIndex ? 1 : -1;
    for (let index = fromIndex; direction > 0 ? index <= toIndex : index >= toIndex; index += direction) {
      paintDateColumn(boardParams.dates[index], mode);
    }
  };

  const getSlotKeyFromPoint = (x, y) => {
    const target = document.elementFromPoint(x, y);
    return target?.closest?.('[data-availability-slot]')?.dataset.availabilitySlot;
  };

  const getDateKeyFromPoint = (x, y) => {
    const target = document.elementFromPoint(x, y);
    return target?.closest?.('[data-availability-date]')?.dataset.availabilityDate;
  };

  const handleAvailabilityPointerDown = (event, slotKey) => {
    if (!hasActiveParticipantSession) {
      showAlert('먼저 이름과 임시 비밀번호를 입력하고 참여해주세요.');
      return;
    }
    if (event.button !== undefined && event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const hasUser = (availabilityRef.current[slotKey] || []).includes(currentUser);
    const newMode = hasUser ? 'remove' : 'add';
    const shouldWaitForDrag = event.pointerType === 'touch';
    isDraggingRef.current = !shouldWaitForDrag;
    dragModeRef.current = newMode;
    activePointerIdRef.current = event.pointerId;
    activePointerTargetRef.current = event.currentTarget;
    pointerStartRef.current = {
      type: 'slot',
      slotKey,
      x: event.clientX,
      y: event.clientY,
      shouldWaitForDrag,
    };
    lastGestureCellRef.current = { type: 'slot', slotKey };
    lastPaintedSlotRef.current = null;
    setIsDragging(!shouldWaitForDrag);
    setDragMode(newMode);
    if (!shouldWaitForDrag) paintSlot(slotKey, newMode);
  };

  const handleDateColumnPointerDown = (event, date) => {
    if (!hasActiveParticipantSession) {
      showAlert('먼저 이름과 임시 비밀번호를 입력하고 참여해주세요.');
      return;
    }
    if (event.button !== undefined && event.button !== 0) return;

    const isTouchPointer = event.pointerType === 'touch';
    if (!isTouchPointer) {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    const isEverySlotAvailable = boardHours.every(hour => (
      (availabilityRef.current[`${date}-${hour}`] || []).includes(currentUser)
    ));
    const newMode = isEverySlotAvailable ? 'remove' : 'add';

    const shouldWaitForDrag = event.pointerType === 'touch';
    isDraggingRef.current = !shouldWaitForDrag;
    dragModeRef.current = newMode;
    activePointerIdRef.current = event.pointerId;
    activePointerTargetRef.current = event.currentTarget;
    pointerStartRef.current = {
      type: 'date',
      date,
      x: event.clientX,
      y: event.clientY,
      shouldWaitForDrag,
    };
    lastGestureCellRef.current = { type: 'date', date };
    lastPaintedSlotRef.current = null;
    setIsDragging(!shouldWaitForDrag);
    setDragMode(newMode);
    if (!shouldWaitForDrag) paintDateColumn(date, newMode);
  };

  const handleResetCurrentUserAvailability = () => {
    if (!hasActiveParticipantSession) {
      showAlert('먼저 이름과 임시 비밀번호를 입력하고 참여해주세요.');
      return;
    }

    showConfirm('내가 표시한 가능 시간을 모두 초기화할까요?', () => {
      setAvailability(prev => {
        const nextAvailability = {};

        Object.entries(prev).forEach(([slotKey, users]) => {
          const remainingUsers = (Array.isArray(users) ? users : []).filter(user => user !== currentUser);
          if (remainingUsers.length > 0) nextAvailability[slotKey] = remainingUsers;
        });

        availabilityRef.current = nextAvailability;
        pendingLocalSlotKeysRef.current = getCurrentUserSlotKeys(nextAvailability);
        return nextAvailability;
      });
      setWaveSlots({});
      lastSavedAvailabilityRef.current = null;
      showToast('내 가능 시간을 초기화했습니다.');
    });
  };

  const handleExcludeLunchTime = () => {
    if (!hasActiveParticipantSession) {
      showAlert('먼저 이름과 임시 비밀번호를 입력하고 참여해주세요.');
      return;
    }

    const lunchHours = boardHours.filter(hour => LUNCH_TIME_SLOTS.has(hour));
    if (lunchHours.length === 0) {
      showToast('현재 시간대에는 점심시간 슬롯이 없습니다.');
      return;
    }

    setAvailability(prev => {
      const nextAvailability = { ...prev };

      boardParams.dates.forEach(date => {
        lunchHours.forEach(hour => {
          const slotKey = `${date}-${hour}`;
          const remainingUsers = (nextAvailability[slotKey] || []).filter(user => user !== currentUser);
          if (remainingUsers.length > 0) nextAvailability[slotKey] = remainingUsers;
          else delete nextAvailability[slotKey];
        });
      });

      availabilityRef.current = nextAvailability;
      pendingLocalSlotKeysRef.current = getCurrentUserSlotKeys(nextAvailability);
      return nextAvailability;
    });

    setWaveSlots(prev => {
      const nextWaveSlots = { ...prev };
      boardParams.dates.forEach(date => {
        lunchHours.forEach(hour => {
          delete nextWaveSlots[`${date}-${hour}`];
        });
      });
      return nextWaveSlots;
    });
    showToast('점심시간을 제외했습니다.');
  };

  const handleAvailabilityPointerMove = (event) => {
    if (!dragModeRef.current || activePointerIdRef.current !== event.pointerId || !pointerStartRef.current) return;

    const distanceX = event.clientX - pointerStartRef.current.x;
    const distanceY = event.clientY - pointerStartRef.current.y;

    // On mobile, a horizontal gesture on the date header should scroll the grid.
    if (
      pointerStartRef.current.type === 'date'
      && pointerStartRef.current.shouldWaitForDrag
      && Math.abs(distanceX) > DRAG_START_THRESHOLD
      && Math.abs(distanceX) > Math.abs(distanceY)
    ) {
      handleAvailabilityPointerEnd({ type: 'pointercancel', pointerId: event.pointerId });
      return;
    }

    event.preventDefault();

    if (
      pointerStartRef.current.shouldWaitForDrag
      && !isDraggingRef.current
      && Math.hypot(distanceX, distanceY) < DRAG_START_THRESHOLD
    ) return;

    if (!isDraggingRef.current) {
      isDraggingRef.current = true;
      setIsDragging(true);
    }

    if (pointerStartRef.current.type === 'date') {
      const nextDate = getDateKeyFromPoint(event.clientX, event.clientY);
      paintDateColumnPath(lastGestureCellRef.current?.date, nextDate, dragModeRef.current);
      if (nextDate) lastGestureCellRef.current = { type: 'date', date: nextDate };
    } else {
      const nextSlot = getSlotKeyFromPoint(event.clientX, event.clientY);
      paintSlotPath(lastGestureCellRef.current?.slotKey, nextSlot, dragModeRef.current);
      if (nextSlot) lastGestureCellRef.current = { type: 'slot', slotKey: nextSlot };
    }
  };

  const handleAvailabilityPointerEnd = (event) => {
    if (activePointerIdRef.current !== null && event?.pointerId !== undefined && activePointerIdRef.current !== event.pointerId) return;

    const shouldToggleClick = event?.type !== 'pointercancel' && !isDraggingRef.current && pointerStartRef.current && dragModeRef.current;

    if (activePointerTargetRef.current && activePointerIdRef.current !== null) {
      try {
        activePointerTargetRef.current.releasePointerCapture?.(activePointerIdRef.current);
      } catch {
        // Pointer capture can already be released by the browser.
      }
    }

    if (shouldToggleClick) {
      if (pointerStartRef.current.type === 'date') {
        paintDateColumn(pointerStartRef.current.date, dragModeRef.current);
      } else {
        paintSlot(pointerStartRef.current.slotKey, dragModeRef.current);
      }
    }

    isDraggingRef.current = false;
    dragModeRef.current = null;
    activePointerIdRef.current = null;
    activePointerTargetRef.current = null;
    pointerStartRef.current = null;
    lastPaintedSlotRef.current = null;
    lastGestureCellRef.current = null;
    setIsDragging(false);
    setDragMode(null);
  };

  pointerEndHandlerRef.current = handleAvailabilityPointerEnd;

  useEffect(() => {
    const handlePointerEnd = event => pointerEndHandlerRef.current?.(event);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    return () => {
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, []);

  useEffect(() => {
    if (!isJoined || !participantId || !boardParams?.id || !currentPassword || isDragging) return undefined;

    const slotKeys = Object.entries(availability)
      .filter(([, users]) => Array.isArray(users) && users.includes(currentUser))
      .map(([slotKey]) => slotKey)
      .sort();
    const saveSignature = `${participantId}:${JSON.stringify(slotKeys)}`;
    latestAvailabilitySaveSignatureRef.current = saveSignature;

    if (lastSavedAvailabilityRef.current === saveSignature) return undefined;

    const timer = window.setTimeout(async () => {
      availabilitySaveQueueRef.current = availabilitySaveQueueRef.current
        .catch(() => {})
        .then(async () => {
          setIsSavingAvailability(true);

          try {
            await saveParticipantAvailability({
              meetingId: boardParams.id,
              participantId,
              password: currentPassword,
              slotKeys,
            });
            lastSavedAvailabilityRef.current = saveSignature;
            if (latestAvailabilitySaveSignatureRef.current === saveSignature) {
              setParticipantAuthError('');
            }
          } catch (error) {
            if (latestAvailabilitySaveSignatureRef.current === saveSignature) {
              setParticipantAuthError(getUserFacingErrorMessage(error, '가능 시간을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.'));
            }
          } finally {
            setIsSavingAvailability(false);
          }
        });
    }, AVAILABILITY_SAVE_DELAY);

    return () => window.clearTimeout(timer);
  }, [availability, boardParams?.id, currentPassword, currentUser, isDragging, isJoined, participantId]);

  const applyCalendarAvailability = (isSlotAvailable, { replaceCurrentUser = false } = {}) => {
    const nextWaveSlots = {};
    const nextAvailability = {};

    Object.entries(availability).forEach(([slotKey, users]) => {
      const nextUsers = (Array.isArray(users) ? users : [])
        .filter(user => !replaceCurrentUser || user !== currentUser);

      if (nextUsers.length > 0) nextAvailability[slotKey] = nextUsers;
    });

    boardParams.dates.forEach((date, dateIndex) => {
      boardHours.forEach((hour, hourIndex) => {
        if (isSlotAvailable(date, hour)) {
          const slotKey = `${date}-${hour}`;
          const currentUsers = nextAvailability[slotKey] || [];

          if (!currentUsers.includes(currentUser)) {
            nextAvailability[slotKey] = [...currentUsers, currentUser];
            nextWaveSlots[slotKey] = hourIndex + dateIndex * 2;
          }
        }
      });
    });

    const filledCount = Object.keys(nextWaveSlots).length;
    setAvailabilitySafely(nextAvailability, { markLocalPending: true });
    setWaveSlots(nextWaveSlots);
    window.setTimeout(() => setWaveSlots({}), 1200);

    return filledCount;
  };

  // --- Google Calendar 연동 ---
  const handleSyncGoogleCalendar = () => {
    if (!isJoined) {
      showAlert('먼저 이름과 임시 비밀번호를 입력하고 참여해주세요.');
      return;
    }
    if (isCalendarAutoFilling) return;
    handleConfirmGoogleCalendar();
  };

  const closeCalendarPicker = () => {
    googleAccessTokenRef.current = null;
    setIsCalendarPickerOpen(false);
    setGoogleCalendars([]);
    setSelectedCalendarIds([]);
  };

  const handleConfirmGoogleCalendar = async () => {
    if (!boardParams) return;

    setIsCalendarAutoFilling(true);

    try {
      const accessToken = await requestGoogleAccessToken();
      const calendars = await fetchGoogleCalendarList(accessToken);

      if (calendars.length === 0) {
        throw new Error('읽을 수 있는 Google Calendar가 없습니다. 계정의 캘린더 공유 권한을 확인해주세요.');
      }

      googleAccessTokenRef.current = accessToken;
      const primaryCalendar = calendars.find(calendar => calendar.primary);
      const selectedCalendars = primaryCalendar
        ? [primaryCalendar.id]
        : calendars.filter(calendar => calendar.selected).map(calendar => calendar.id);

      setGoogleCalendars(calendars);
      setSelectedCalendarIds(selectedCalendars.length > 0 ? selectedCalendars : [calendars[0].id]);
      setIsCalendarPickerOpen(true);
    } catch (error) {
      showAlert(getUserFacingErrorMessage(error, 'Google Calendar 연동에 실패했습니다.'));
    } finally {
      setIsCalendarAutoFilling(false);
    }
  };

  const handleApplySelectedCalendars = async () => {
    if (!boardParams || !googleAccessTokenRef.current) {
      showAlert('Google Calendar를 다시 연결해주세요.');
      closeCalendarPicker();
      return;
    }

    if (selectedCalendarIds.length === 0) {
      showAlert('캘린더를 하나 이상 선택해주세요.');
      return;
    }

    setIsCalendarAutoFilling(true);

    try {
      const eventGroups = await Promise.all(
        selectedCalendarIds.map(calendarId => (
          fetchGoogleCalendarEvents(googleAccessTokenRef.current, calendarId, boardParams.dates)
        ))
      );
      const events = eventGroups.flat();
      const filledCount = applyCalendarAvailability(
        (date, hour) => isGoogleCalendarSlotAvailable(events, date, hour, boardParams.end),
        { replaceCurrentUser: true }
      );

      closeCalendarPicker();
      showToast(`${selectedCalendarIds.length}개 캘린더 기준으로 ${filledCount}개 시간을 채웠습니다.`);
    } catch (error) {
      showAlert(getUserFacingErrorMessage(error, 'Google Calendar 연동에 실패했습니다.'));
    } finally {
      setIsCalendarAutoFilling(false);
    }
  };

  const getHeatmapColor = (count, max) => {
    if (count === 0) return 'bg-white hover:bg-gray-50';
    const ratio = count / max;
    if (ratio <= 0.25) return 'bg-[#eaf1eb] hover:bg-[#d6eadc] text-[#19734d]';
    if (ratio <= 0.5) return 'bg-[#8fc69e] hover:bg-[#72b886] text-white';
    if (ratio <= 0.75) return 'bg-[#2b9668] hover:bg-[#2b9668] text-white';
    return 'bg-[#0d5a3a] hover:bg-[#19734d] text-white font-bold';
  };

  const results = useMemo(() => {
    if (!boardParams) return [];
    const slotStats = [];
    boardParams.dates.forEach(date => {
      boardHours.forEach(hour => {
        const key = `${date}-${hour}`;
        const available = availability[key] || [];
        const unavailable = participants.filter(p => !available.includes(p));
        
        if (available.length > 0) {
          slotStats.push({
            date, hour, time: formatResultTime(date, hour),
            availableCount: available.length,
            available, unavailable
          });
        }
      });
    });
    return slotStats.sort((a, b) => b.availableCount - a.availableCount).slice(0, 3);
  }, [availability, participants, boardParams, boardHours]);

  const currentUserSlotKeys = useMemo(() => (
    Object.entries(availability)
      .filter(([, users]) => Array.isArray(users) && users.includes(currentUser))
      .map(([slotKey]) => slotKey)
      .sort()
  ), [availability, currentUser]);

  const currentVoteSaveSignature = participantId
    ? `${participantId}:${JSON.stringify(currentUserSlotKeys)}`
    : null;
  const isVoteCompletionReady = isJoined
    && !isSavingAvailability
    && lastSavedAvailabilityRef.current === currentVoteSaveSignature;

  // 선택된 결과에 따른 메시지 템플릿
  const generatedMessage = useMemo(() => {
    if (results.length === 0) return boardParams?.type === MEETING_TYPES.REGULAR ? "아직 가능한 시간이 없습니다." : "입력된 시간이 없습니다.";
    const selected = results[selectedResultIndex] || results[0];
    const title = boardParams?.title || '모임';
    const availableNames = selected.available.join(', ');
    const unavailableNames = selected.unavailable.length > 0 ? selected.unavailable.join(', ') : '모두 가능해요';

    if (boardParams?.type === MEETING_TYPES.REGULAR) {
      return `[${title} 시간 조율]
안녕하세요! 정기 모임 시간 중 가장 많이 겹치는 시간은 아래와 같아요.

⏰ ${selected.time}
👥 ${selected.availableCount}명 가능
가능한 사람: ${availableNames}

이 시간으로 정해도 괜찮을까요? 의견 남겨주세요 🙂`;
    }
    
    return `[${title} 일정 조율]
안녕하세요! 후보 시간 중 가장 많이 겹치는 시간입니다.

📅 ${selected.time}
👥 ${selected.availableCount}명 가능
가능한 사람: ${availableNames}
불가능한 사람: ${selected.unavailable.length > 0 ? unavailableNames : '없음'}

이 시간으로 진행해도 괜찮을까요? 확인 부탁드립니다! 🙂`;
  }, [results, selectedResultIndex, boardParams]);

  const handleOpenSlackConnectModal = (target) => {
    setSlackConnectTarget(target);
    setIsSlackConnectModalOpen(true);
  };

  const handleRequestHomeSlackConnect = () => {
    if (!expectedParticipantCount) {
      showAlert('예상 참여 인원 수를 먼저 입력해주세요.');
      return;
    }

    handleOpenSlackConnectModal('home');
  };

  const handleConfirmSlackConnect = () => {
    setIsSlackConnectModalOpen(false);

    if (slackConnectTarget === 'home') {
      setIsCreatorNotificationEnabled(true);
      setCreatorNotificationPreference(SLACK_NOTIFICATION);
    }

    showToast('Slack 연동이 완료된 것으로 처리했습니다.');
  };

  const boardExpectedParticipantCount = boardParams?.expectedParticipants || null;
  const isWorkMeeting = boardParams?.type === MEETING_TYPES.WORK;
  const isRegularMeeting = boardParams?.type === MEETING_TYPES.REGULAR;
  const hasResponseCompletionAlert = boardParams?.notificationChannel === SLACK_NOTIFICATION;

  const handleShareVoteCompletion = async () => {
    if (!isVoteCompletionReady) return;

    const title = boardParams?.title || '모아타임 모임';
    const text = `“${title}” 투표 완료했어요!\n시간 확인해 주세요 🙂`;
    const url = getBoardShareUrl(boardParams);

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${title} 투표 완료`,
          text,
          url,
        });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }

    copyToClipboard(
      `${text}\n${url}`,
      '완료 메시지와 링크를 복사했어요. 받은 채팅방에 붙여넣어 주세요.'
    );
  };

  useEffect(() => {
    setShareMessage(generatedMessage);
  }, [generatedMessage]);

  return (
    <div className="app-shell min-h-screen bg-[#f5f5f7] text-[#1d1d1f] pb-20 select-none">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+20px)] z-[80] flex -translate-x-1/2 transform items-center gap-2 rounded-full border border-[#e0e0e0] bg-white px-4 py-2 text-[#1d1d1f] shadow-[0_12px_30px_rgba(0,0,0,0.12)]">
          <CheckCircle2 size={18} className="text-[#19734d]" />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {dialog && (
        <AppModal
          open
          icon={dialog.type === 'confirm' ? Info : AlertCircle}
          title={dialog.title}
          onClose={closeDialog}
          actions={(
            <>
              {dialog.type === 'confirm' && (
                <button
                  type="button"
                  onClick={closeDialog}
                  className="rounded-full px-4 py-2 text-sm font-medium text-[#333333] transition-colors hover:bg-[#f0f0f0]"
                >
                  취소
                </button>
              )}
              <button
                type="button"
                onClick={dialog.type === 'confirm' ? handleDialogConfirm : closeDialog}
                className="rounded-full bg-[#19734d] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2b9668]"
              >
                확인
              </button>
            </>
          )}
        >
          <p className="whitespace-pre-line text-sm leading-relaxed text-[#333333]">{dialog.message}</p>
        </AppModal>
      )}

      <AppModal
        open={isCalendarPickerOpen}
        icon={Calendar}
        title="캘린더 선택"
        onClose={closeCalendarPicker}
        closeOnOverlay={!isCalendarAutoFilling}
        actions={(
          <>
            <button
              type="button"
              onClick={closeCalendarPicker}
              disabled={isCalendarAutoFilling}
              className="rounded-full px-4 py-2 text-sm font-medium text-[#333333] transition-colors hover:bg-[#f0f0f0] disabled:cursor-not-allowed disabled:opacity-60"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleApplySelectedCalendars}
              disabled={isCalendarAutoFilling || selectedCalendarIds.length === 0}
              className="rounded-full bg-[#19734d] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2b9668] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCalendarAutoFilling ? '일정 확인 중...' : '선택한 캘린더로 채우기'}
            </button>
          </>
        )}
      >
        <p className="text-sm leading-relaxed text-[#333333]">
          어떤 캘린더를 기준으로 가능 시간을 채울까요?
        </p>
        <div className="mt-4 max-h-64 space-y-2 overflow-y-auto rounded-[14px] border border-[#e0e0e0] bg-[#f5f5f7] p-2">
          {googleCalendars.length > 0 ? googleCalendars.map(calendar => {
            const calendarName = calendar.summaryOverride || calendar.summary || '이름 없는 캘린더';
            const isSelected = selectedCalendarIds.includes(calendar.id);

            return (
              <label
                key={calendar.id}
                className={`flex cursor-pointer items-center gap-3 rounded-[12px] px-3 py-3 transition-colors ${
                  isSelected ? 'bg-white' : 'hover:bg-white/70'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => setSelectedCalendarIds(prev => (
                    prev.includes(calendar.id)
                      ? prev.filter(id => id !== calendar.id)
                      : [...prev, calendar.id]
                  ))}
                  className="h-4 w-4 accent-[#19734d]"
                />
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: calendar.backgroundColor || '#19734d' }}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-[#333333]">{calendarName}</span>
                {calendar.primary && (
                  <span className="shrink-0 text-[11px] font-semibold text-[#19734d]">기본</span>
                )}
              </label>
            );
          }) : (
            <p className="px-3 py-5 text-center text-sm text-[#7a7a7a]">읽을 수 있는 캘린더가 없습니다.</p>
          )}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[#7a7a7a]">
          공휴일·생일처럼 일정이 없는 시간도 막을 수 있는 캘린더는 필요할 때만 선택하세요.
        </p>
      </AppModal>

      <AppModal
        open={isSlackConnectModalOpen}
        onClose={() => setIsSlackConnectModalOpen(false)}
        actions={(
          <>
            <button
              type="button"
              onClick={() => setIsSlackConnectModalOpen(false)}
              className="rounded-full px-4 py-2 text-sm font-medium text-[#333333] transition-colors hover:bg-[#f0f0f0]"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleConfirmSlackConnect}
              className="rounded-full bg-[#19734d] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2b9668]"
            >
              확인
            </button>
          </>
        )}
      >
        <p className="text-center text-sm leading-relaxed text-[#333333]">
          현재 준비 중인 서비스입니다. 😊
        </p>
      </AppModal>

      {/* Header */}
      <header className="bg-[#f5f5f7]/92 backdrop-blur-xl text-[#1d1d1f] h-16 px-5 sticky top-0 z-50 border-b border-[#e0e0e0] animate-fade-in">
        <div className="max-w-6xl mx-auto h-full flex items-center justify-between">
          <button
            type="button"
            className="flex items-center gap-2 text-sm font-semibold text-[#1d1d1f] hover:text-[#2b9668] transition-colors"
            onClick={() => {window.location.href = getAppBaseUrl();}}
          >
            <span className="w-9 h-9 rounded-full bg-[#19734d] text-white flex items-center justify-center">
              <Calendar size={17} />
            </span>
            <span className="text-xl font-bold">모아타임</span>
          </button>
          <a
            href="https://github.com/sangjun121/moitime"
            target="_blank"
            rel="noreferrer"
            aria-label="Moitime GitHub 저장소 열기"
            className="inline-flex rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b9668]"
          >
            <GithubStarBadge />
          </a>
        </div>
      </header>

      <div className="bg-[#f5f5f7]/85 backdrop-blur-xl border-b border-[#e0e0e0] sticky top-16 z-40">
        <div className="max-w-6xl mx-auto h-14 px-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#1d1d1f] truncate">
              {appState === 'board' && boardParams ? boardParams.title : '모아타임'}
            </p>
            <p className="text-xs text-[#7a7a7a]">
              {appState === 'board' && boardParams
                ? `${boardParams.dates.length}${boardParams.type === MEETING_TYPES.REGULAR ? '개 요일' : '일'} · ${boardParams.start}:00-${boardParams.end}:00`
                : meetingType === MEETING_TYPES.REGULAR ? '요일별 가능한 시간 정하기' : '가능한 날짜 및 시간 정하기'}
            </p>
          </div>
          {appState === 'board' && (
            <button
              onClick={() => copyToClipboard(
                getBoardShareUrl(boardParams),
                boardParams?.type === MEETING_TYPES.REGULAR ? '모임 링크가 복사되었습니다.' : '초대 링크가 복사되었습니다.'
              )}
              className="shrink-0 text-xs sm:text-sm bg-[#19734d] hover:bg-[#2b9668] text-white px-3 sm:px-4 py-2 rounded-full flex items-center gap-1.5 font-semibold transition-colors"
            >
              <LinkIcon size={14}/> {boardParams?.type === MEETING_TYPES.REGULAR ? '링크 공유' : '초대'}
            </button>
          )}
        </div>
      </div>

      <main>
        {appState === 'board' && isBoardLoading && !boardParams && (
          <section className="max-w-3xl mx-auto px-4 py-24 text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#333333] border border-[#e0e0e0]">
              <Calendar size={16} className="text-[#19734d]" />
              모임 정보를 불러오는 중입니다.
            </div>
          </section>
        )}

        {appState === 'board' && boardLoadError && !boardParams && (
          <section className="max-w-xl mx-auto px-4 py-24 text-center">
            <AlertCircle size={32} className="mx-auto mb-3 text-[#19734d]" />
            <h2 className="text-lg font-semibold text-[#1d1d1f]">모임을 열 수 없습니다.</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#7a7a7a]">{boardLoadError}</p>
          </section>
        )}
        
        {/* =========================================
            메인 페이지 (Home / Create Event) 
            ========================================= */}
        {appState === 'home' && (
          <div className="animate-in fade-in">
            <section className="home-hero relative px-4 pt-12 pb-12 sm:pt-20 sm:pb-16 text-center overflow-hidden">
              <div className="hero-copy">
              <p className="hero-kicker text-sm font-semibold text-[#19734d] mb-4 animate-fade-up">모아타임</p>
              <h2 className="mx-auto max-w-4xl text-[clamp(48px,8vw,104px)] font-semibold leading-[0.95] text-[#1d1d1f]">
                <>
                  <span className="inline-block animate-word-pop delay-100">시간</span>{' '}
                  <span className="inline-block animate-word-pop delay-300">맞추기,</span><br />
                  <span className="inline-block animate-word-pop delay-500">링크</span>{' '}
                  <span className="inline-block animate-word-pop delay-700">하나로 끝내세요</span>
                </>
              </h2>
              <p className="hero-description mx-auto mt-6 max-w-2xl text-base sm:text-xl leading-relaxed text-[#333333] animate-fade-up delay-900">
                {meetingType === MEETING_TYPES.REGULAR
                  ? '월요일에서 일요일까지 가능한 시간을 표시하고, 정기 시간표를 만들어보세요.'
                  : '각자 가능한 시간을 표시하고, 모두 가능한 시간을 찾아보세요.'}
              </p>
              {typeof meetingCount === 'number' && (
                <p className="mt-3 text-sm text-[#7a7a7a]" aria-live="polite">
                  모아타임에서 지금까지 <strong className="font-semibold tabular-nums text-[#19734d]">{meetingCount.toLocaleString()}개의 모임</strong>이 만들어졌어요!
                </p>
              )}
              </div>
              <div className="hero-preview" aria-hidden="true">
                <div className="preview-caption">
                  <strong>2주차 회의</strong>
                </div>
                <div className="preview-grid">
                  {['월', '화', '수', '목', '금', '토', '일'].map(day => (
                    <span key={day} className="preview-day">{day}</span>
                  ))}
                  {Array.from({ length: 21 }).map((_, index) => (
                    <span key={index} className={`preview-cell ${[1, 2, 4, 5, 8, 9, 10, 13, 15, 16, 19, 20].includes(index) ? 'is-on' : ''}`} />
                  ))}
                </div>
                <div className="preview-footer">
                  <span className="inline-flex items-center gap-2"><span className="preview-marker" /> 모두가 가능한 시간</span>
                  <span>모아타임</span>
                </div>
              </div>
            </section>

            <section className="home-form-section max-w-3xl mx-auto px-4 animate-slide-up delay-300">
            {/* 약속 만들기 */}
            <div className="home-form-card w-full bg-white p-5 sm:p-8 rounded-[18px] border border-[#e0e0e0]">
              <div className="mb-7">
                <p className="text-sm font-semibold text-[#1d1d1f] mb-2">{meetingType === MEETING_TYPES.REGULAR ? '새 정기 모임' : '새 일정'}</p>
                <h2 className="text-2xl sm:text-3xl font-semibold mb-2 text-[#1d1d1f]">
                  {meetingType === MEETING_TYPES.REGULAR ? '매주 만날 요일을 골라주세요' : '만날 날짜를 골라주세요'}
                </h2>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-[#333333] mb-2">어떤 약속인가요?</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-[18px] bg-[#f5f5f7] p-2 border border-[#e0e0e0]">
                    {[
                      { type: MEETING_TYPES.WORK, title: '날짜로 정하기', description: '특정 날짜 중 가능한 시간을 골라요' },
                      { type: MEETING_TYPES.REGULAR, title: '요일로 정하기', description: '매주 반복할 요일과 시간을 골라요' },
                    ].map(option => {
                      const isSelected = meetingType === option.type;
                      return (
                        <button
                          key={option.type}
                          type="button"
                          onClick={() => {
                            setMeetingType(option.type);
                            if (option.type === MEETING_TYPES.REGULAR) {
                              setSelectedDates(WEEKDAY_OPTIONS.map(day => day.key));
                              setStartHour('00');
                              setEndHour('23');
                            } else {
                              setSelectedDates([]);
                              setStartHour('09');
                              setEndHour('18');
                            }
                          }}
                          className={`rounded-[14px] px-4 py-4 text-left transition-colors ${
                            isSelected ? 'bg-white text-[#1d1d1f] border border-[#19734d]' : 'text-[#7a7a7a] hover:bg-white/70 border border-transparent'
                          }`}
                        >
                          <span className="block text-sm font-semibold">{option.title}</span>
                          <span className="mt-1 block text-xs">{option.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-[#333333] mb-2">{meetingType === MEETING_TYPES.REGULAR ? '모임 이름' : '일정 이름'}</label>
                  <input 
                    type="text" 
                    value={meetingTitle}
                    onChange={(e) => setMeetingTitle(e.target.value)}
                    className="w-full border-0 bg-[#f5f5f7] rounded-[12px] px-4 py-3 focus:ring-2 focus:ring-[#2b9668] outline-none text-[#1d1d1f] placeholder:text-[#7a7a7a]"
                    placeholder={meetingType === MEETING_TYPES.REGULAR ? '예: 스터디 정기 모임' : '예: 팀 회의'}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-semibold text-[#333333]">{meetingType === MEETING_TYPES.REGULAR ? '반복 요일' : '후보 날짜'}</label>
                    <span className="text-xs font-semibold text-[#2b9668]">{selectedDates.length}{meetingType === MEETING_TYPES.REGULAR ? '개 요일' : '일'} 선택</span>
                  </div>
                  {meetingType === MEETING_TYPES.REGULAR ? (
                    <div className="rounded-[18px] border border-[#e0e0e0] bg-[#f5f5f7] p-4">
                      <div className="grid grid-cols-7 gap-2">
                        {WEEKDAY_OPTIONS.map(day => {
                          const isSelected = selectedDates.includes(day.key);
                          return (
                            <button
                              key={day.key}
                              type="button"
                              onClick={() => handleToggleWeekday(day.key)}
                              className={`h-12 rounded-[12px] border text-base font-semibold transition-colors ${
                                isSelected
                                  ? 'bg-[#19734d] border-[#19734d] text-white'
                                  : 'bg-white border-[#e0e0e0] text-[#1d1d1f] hover:border-[#19734d] hover:bg-[#f5f5f7]'
                              }`}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedDates(WEEKDAY_OPTIONS.map(day => day.key))}
                          className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#333333] border border-[#e0e0e0] hover:bg-[#f0f0f0] transition-colors"
                        >
                          월~일 전체
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedDates(WEEKDAY_OPTIONS.slice(0, 5).map(day => day.key))}
                          className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#333333] border border-[#e0e0e0] hover:bg-[#f0f0f0] transition-colors"
                        >
                          평일만
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedDates(WEEKDAY_OPTIONS.slice(5).map(day => day.key))}
                          className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#333333] border border-[#e0e0e0] hover:bg-[#f0f0f0] transition-colors"
                        >
                          주말만
                        </button>
                      </div>
                    </div>
                  ) : (
                  <div className="calendar-picker-panel rounded-[18px] border border-[#e0e0e0] bg-[#f5f5f7] p-4">
                    <div className="flex items-center justify-between mb-4">
                      <button
                        type="button"
                        onClick={() => moveCalendarByWeeks(-1)}
                        className="w-9 h-9 rounded-full bg-white hover:bg-[#f0f0f0] border border-[#e0e0e0] text-[#333333] flex items-center justify-center transition-colors"
                        aria-label="이전 주"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <div className="text-center">
	                        <div className="text-lg font-semibold text-[#1d1d1f]">
                          {calendarStartDate.toLocaleString('ko-KR', { year: 'numeric', month: 'long' })}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => moveCalendarByWeeks(1)}
                        className="w-9 h-9 rounded-full bg-white hover:bg-[#f0f0f0] border border-[#e0e0e0] text-[#333333] flex items-center justify-center transition-colors"
                        aria-label="다음 주"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>

                    <div className="calendar-picker-grid grid grid-cols-7 gap-1 items-center text-center">
                      {['일', '월', '화', '수', '목', '금', '토'].map((dayLabel, index) => (
	                        <div key={`${dayLabel}-${index}`} className="calendar-weekday-label text-sm font-semibold text-[#333333] py-1">
                          {dayLabel}
                        </div>
                      ))}

                      {calendarWeeks.map((week, weekIndex) => {
                        const firstDate = week[0];
                        const today = new Date();

                        return (
                          <React.Fragment key={formatDateKey(firstDate)}>
                            {week.map(date => {
                              const dateKey = formatDateKey(date);
                              const isSelected = selectedDates.includes(dateKey);
                              const isToday = isSameDay(date, today);

                              return (
                                <button
                                  key={dateKey}
                                  type="button"
                                  aria-pressed={isSelected}
                                  onClick={() => handleToggleCalendarDate(date)}
                                  className={`calendar-date-button rounded-[10px] border text-base font-semibold tabular-nums transition-colors
                                    ${isSelected
                                      ? 'bg-[#19734d] border-[#19734d] text-white'
                                      : isToday
                                        ? 'bg-white border-[#19734d] text-[#2b9668] hover:bg-[#f5f5f7]'
                                        : 'bg-white border-[#e0e0e0] text-[#1d1d1f] hover:bg-[#f5f5f7] hover:border-[#19734d]'
                                    }`}
                                >
                                  {isToday ? '오늘' : date.getDate()}
                                </button>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </div>

                  </div>
                  )}
                </div>

                <div>
	                  <div className="flex items-center justify-between mb-2">
	                    <label className="block text-sm font-semibold text-[#333333]">투표할 시간대</label>
	                    <button
	                      type="button"
	                      onClick={() => {
	                        setStartHour('00');
	                        setEndHour('23');
	                      }}
	                      className="rounded-full bg-[#eaf1eb] px-3 py-1 text-xs font-semibold text-[#19734d] hover:bg-[#d6eadc] transition-colors"
	                    >
	                      전체 시간
	                    </button>
	                  </div>
                  <div className="flex items-center gap-3">
	                    <select value={startHour} onChange={(e) => setStartHour(e.target.value)} className="border-0 bg-[#f5f5f7] rounded-[12px] px-3 py-3 flex-1 focus:ring-2 focus:ring-[#2b9668] outline-none">
                      {Array.from({length: 24}).map((_, i) => (
                        <option key={i} value={i.toString().padStart(2, '0')}>{i.toString().padStart(2, '0')}:00</option>
                      ))}
                    </select>
                    <span className="text-[#7a7a7a] font-bold">~</span>
	                    <select value={endHour} onChange={(e) => setEndHour(e.target.value)} className="border-0 bg-[#f5f5f7] rounded-[12px] px-3 py-3 flex-1 focus:ring-2 focus:ring-[#2b9668] outline-none">
                       {Array.from({length: 24}).map((_, i) => (
                        <option key={i} value={i.toString().padStart(2, '0')}>{i.toString().padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                  <p className="mt-2 text-xs text-[#7a7a7a]">
                    종료시간을 23시로 설정하면, 23시~24시 슬롯까지 선택됩니다.
                  </p>
                </div>

                <div className="rounded-[18px] border border-[#e0e0e0] bg-[#f5f5f7] p-4">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-[#333333] mb-2">응답 완료 알림</label>
                      <p className="text-xs leading-relaxed text-[#7a7a7a]">
                        {isCreatorNotificationEnabled
                          ? '예상한 인원이 다 응답하면 Slack으로 알려드려요.'
                          : '사람들이 모두 작성하면 알림 메시지를 받을 수 있어요.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreatorNotificationEnabled(prev => {
                          const next = !prev;
                          if (!next) {
                            setExpectedParticipantCount('');
                            setCreatorNotificationPreference(NO_CREATOR_NOTIFICATION);
                          }
                          return next;
                        });
                      }}
                      className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                        isCreatorNotificationEnabled
                          ? 'bg-white text-[#7a7a7a] border border-[#e0e0e0]'
                          : 'bg-[#19734d] text-white hover:bg-[#2b9668]'
                      }`}
                    >
                      {isCreatorNotificationEnabled ? '사용 안 함' : '사용하기'}
                    </button>
                  </div>
                  {isCreatorNotificationEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.5fr] gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#7a7a7a] mb-1">예상 참여 인원</label>
                        <input
                          type="number"
                          min="1"
                          inputMode="numeric"
                          value={expectedParticipantCount}
                          onChange={(e) => setExpectedParticipantCount(e.target.value.replace(/[^0-9]/g, ''))}
                          className="w-full border-0 bg-white rounded-[12px] px-4 py-3 focus:ring-2 focus:ring-[#2b9668] outline-none text-[#1d1d1f] placeholder:text-[#7a7a7a]"
                          placeholder="예: 5"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#7a7a7a] mb-1">생성자 알림 채널</label>
                        <div className="grid grid-cols-1 gap-2">
                          {CREATOR_NOTIFICATION_CHANNELS.map(channel => (
                            <button
                              key={channel}
                              type="button"
                              onClick={handleRequestHomeSlackConnect}
                              className={`rounded-full px-3 py-3 text-xs font-semibold border transition-colors ${
                                creatorNotificationPreference === channel
                                  ? 'bg-[#19734d] border-[#19734d] text-white'
                                  : 'bg-white border-[#e0e0e0] text-[#333333] hover:border-[#19734d]'
                              }`}
                            >
                              Slack 연결하기
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {!isSupabaseConfigured && (
                  <p className="mt-4 rounded-[12px] bg-[#fff8e8] px-3 py-2 text-xs leading-relaxed text-[#8a6418]">
                    모임을 만들려면 Supabase 환경변수 설정이 필요합니다.
                  </p>
                )}
                <button 
                  onClick={handleCreateMeeting}
                  disabled={isCreatingMeeting || !isSupabaseConfigured}
                  className="w-full mt-4 bg-[#19734d] hover:bg-[#2b9668] text-white font-semibold text-base py-4 rounded-full flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreatingMeeting ? '모임 만드는 중...' : meetingType === MEETING_TYPES.REGULAR ? '정기 모임 보드 만들기' : '보드 생성하기'} <ArrowRight size={20} />
                </button>
              </div>
            </div>

	          </section>
          </div>
        )}

        {/* =========================================
            보드 페이지 (Board / Vote) 
            ========================================= */}
        {appState === 'board' && boardParams && (
          <div className="animate-in fade-in">
            {/* Tooltip for Heatmap */}
            {tooltipData.visible && tooltipData.slotKey && (
              <div 
                className="fixed z-50 bg-white border border-[#e0e0e0] rounded-[18px] p-3 w-48 pointer-events-none transform -translate-x-1/2 -translate-y-full mt-[-10px]"
                style={{ left: tooltipData.x, top: tooltipData.y }}
              >
                <div className="text-sm font-bold border-b border-[#f0f0f0] pb-2 mb-2 text-center text-[#1d1d1f]">
                  {tooltipData.slotKey}
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-[#2b9668] flex justify-between">
                    <span>가능</span>
                    <span>{(availability[tooltipData.slotKey] || []).length}명</span>
                  </div>
                  <div className="text-xs text-[#333333] break-words leading-tight">
                    {(availability[tooltipData.slotKey] || []).join(', ') || '-'}
                  </div>
                </div>
                <div className="space-y-1 mt-3">
                  <div className="text-xs font-semibold text-[#7a7a7a] flex justify-between">
                    <span>{isWorkMeeting ? '불가능' : '미선택'}</span>
                    <span>
                      {participants.filter(p => !(availability[tooltipData.slotKey] || []).includes(p)).length}명
                    </span>
                  </div>
                  <div className="text-xs text-[#333333] break-words leading-tight">
                    {participants.filter(p => !(availability[tooltipData.slotKey] || []).includes(p)).join(', ') || '-'}
                  </div>
                </div>
              </div>
            )}

            {/* 타이틀 영역 & 로그인 폼 */}
            <div className="max-w-6xl mx-auto px-4 py-5 sm:py-8">
            <section className="bg-white text-[#1d1d1f] p-5 sm:p-10 rounded-[18px] border border-[#e0e0e0] mb-6">
              <div className="flex flex-col lg:flex-row lg:items-end gap-5 sm:gap-6 justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#19734d] mb-3">
                    <Calendar size={16} />
                    {isWorkMeeting ? '약속 보드' : '모임 보드'}
                  </div>
                  <h2 className="text-3xl sm:text-5xl font-semibold leading-tight break-words text-[#1d1d1f]">{boardParams.title}</h2>
                  <div className="flex flex-wrap gap-2 mt-5">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f5f7] px-3 py-1.5 text-xs font-semibold text-[#333333]">
                      <Calendar size={13} /> {boardParams.dates.length}{isRegularMeeting ? '개 요일' : '일'}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f5f7] px-3 py-1.5 text-xs font-semibold text-[#333333]">
                      <Clock size={13} /> {boardParams.start}:00-{boardParams.end}:00
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f5f7] px-3 py-1.5 text-xs font-semibold text-[#333333]">
                      <Users size={13} /> {participants.length}명 참여
                    </span>
                    {hasResponseCompletionAlert && boardExpectedParticipantCount && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eaf1eb] px-3 py-1.5 text-xs font-semibold text-[#19734d]">
                        예상 {boardExpectedParticipantCount}명
                      </span>
                    )}
                  </div>
                </div>

                <form onSubmit={handleJoinBoard} className="w-full lg:w-[440px] lg:flex-none">
                  <div className="rounded-[18px] bg-[#f5f5f7] p-2 flex flex-col sm:flex-row gap-2 border border-[#e0e0e0]">
                    <input
                      type="text"
                      value={currentUser}
                      onChange={(e) => {
                        setCurrentUser(e.target.value);
                        setParticipantAuthError('');
                      }}
                      disabled={isJoined || isJoining}
                      placeholder="이름 입력"
                      autoComplete="username"
                      className="min-w-0 w-full sm:flex-1 lg:w-40 border-0 bg-white sm:bg-transparent rounded-[12px] sm:rounded-none px-3 py-3 sm:py-2 text-sm text-[#1d1d1f] placeholder:text-[#7a7a7a] focus:ring-0 outline-none disabled:text-[#7a7a7a]"
                    />
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => {
                        setCurrentPassword(e.target.value);
                        setParticipantAuthError('');
                      }}
                      disabled={isJoined || isJoining}
                      placeholder="임시 비밀번호"
                      autoComplete="new-password"
                      className="min-w-0 w-full sm:flex-1 lg:w-40 border-0 sm:border-l sm:border-[#e0e0e0] bg-white sm:bg-transparent rounded-[12px] sm:rounded-none px-3 py-3 sm:py-2 text-sm text-[#1d1d1f] placeholder:text-[#7a7a7a] focus:ring-0 outline-none disabled:text-[#7a7a7a]"
                    />
                    {!isJoined ? (
                      <button
                        type="submit"
                        disabled={isJoining || !currentUser.trim() || currentPassword.trim().length < 4}
                        className="w-full sm:w-auto shrink-0 bg-[#19734d] hover:bg-[#2b9668] text-white px-4 py-3 sm:py-2 rounded-full text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isJoining ? '확인 중...' : '참여'}
                      </button>
                    ) : (
                      <button type="button" onClick={() => { setIsJoined(false); setParticipantId(null); setCurrentUser(''); setCurrentPassword(''); lastSavedAvailabilityRef.current = null; pendingLocalSlotKeysRef.current = null; }} className="w-full sm:w-auto shrink-0 bg-white hover:bg-[#f0f0f0] text-[#1d1d1f] px-4 py-3 sm:py-2 rounded-full text-sm font-semibold transition-colors">
                        변경
                      </button>
                    )}
                  </div>
                  {participantAuthError && (
                    <p className="mt-2 min-h-8 text-right text-xs leading-4 text-red-600" aria-live="polite">{participantAuthError}</p>
                  )}
                  {!participantAuthError && (
                    <p className="mt-2 min-h-8 text-right text-xs leading-4 text-[#7a7a7a]" aria-live="polite">
                      <span className="whitespace-normal font-medium text-[#8a6418] sm:whitespace-nowrap">실제로 사용하는 비밀번호는 입력하지 마세요.</span>
                    </p>
                  )}
                </form>
              </div>
            </section>

            {/* 메인 투표 그리드 영역 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 mb-5">
              {/* 내 가능 시간 칠하기 */}
              <section className="bg-white p-4 sm:p-6 rounded-[18px] border border-[#e0e0e0] relative">
                {!hasActiveParticipantSession && (
                  <div className="absolute inset-0 bg-white/80 backdrop-blur-[1px] z-20 flex cursor-not-allowed flex-col items-center justify-center rounded-[18px]">
                    <AlertCircle className="text-[#7a7a7a] mb-2" size={32} />
                    <p className="text-[#333333] font-semibold">
                      위쪽에 이름과 임시 비밀번호를 입력하고 참여해주세요
                    </p>
                  </div>
                )}
                
                <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-start">
                  <div className="flex-1">
                    <h3 className="font-semibold text-[#1d1d1f]">내 가능 시간</h3>
                    <p className="text-xs text-[#7a7a7a] mt-1">
                      가능한 칸을 눌러 초록색으로 표시하세요.
                    </p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                    <div className="flex w-full flex-col items-center gap-2 sm:w-auto sm:flex-row">
                      {isWorkMeeting && (
                        <button
                          type="button"
                          onClick={handleSyncGoogleCalendar}
                          disabled={!hasActiveParticipantSession || isCalendarAutoFilling}
                          className="flex items-center justify-center gap-1.5 rounded-full bg-[#eaf1eb] px-3 py-2 text-xs font-semibold text-[#1d1d1f] transition-colors hover:bg-[#d6eadc] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Wand2 size={14}/>
                          {isCalendarAutoFilling ? '캘린더 확인 중...' : '구글 캘린더 연결'}
                        </button>
                      )}
                      <div className="lunch-feature-control">
                        {isLunchHintVisible && hasActiveParticipantSession && (
                          <div className="lunch-feature-callout" role="note">
                            <button
                              type="button"
                              className="lunch-feature-callout-close"
                              aria-label="새로운 기능 안내 닫기"
                              onClick={() => setIsLunchHintVisible(false)}
                            >
                              <X size={14} />
                            </button>
                            <span className="mb-1 inline-flex rounded-full bg-[#d6eadc] px-2 py-0.5 font-semibold text-[#19734d]">
                              새로운 기능 구경하기
                            </span>
                            <p>이제 우테코 점심시간을 간편하게 제외할 수 있어요!</p>
                            <span className="lunch-feature-callout-arrow" aria-hidden="true" />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={handleExcludeLunchTime}
                          disabled={!hasActiveParticipantSession || isCalendarAutoFilling || isSavingAvailability || !hasLunchTimeSlots}
                          title={hasLunchTimeSlots ? '11시 30분부터 13시까지의 점심시간을 제외합니다.' : '현재 시간대에 점심시간 슬롯이 없습니다.'}
                          className="flex items-center justify-center gap-1.5 rounded-full bg-[#eaf1eb] px-3 py-2 text-xs font-semibold text-[#19734d] transition-colors hover:bg-[#d6eadc] disabled:cursor-not-allowed disabled:hover:bg-[#eaf1eb]"
                        >
                          <Clock size={14} />
                          점심시간 제외하기
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={handleResetCurrentUserAvailability}
                        disabled={!hasActiveParticipantSession || isCalendarAutoFilling || isSavingAvailability}
                        className="flex items-center justify-center gap-1.5 rounded-full bg-[#f5f5f7] px-3 py-2 text-xs font-semibold text-[#333333] transition-colors hover:bg-[#e9e9eb] disabled:cursor-not-allowed disabled:hover:bg-[#f5f5f7]"
                      >
                        <RotateCcw size={14} />
                        초기화
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3 text-xs text-[#7a7a7a]">
                  <span className="inline-flex items-center gap-1"><MousePointer2 size={12}/> 칸 또는 날짜 클릭/드래그</span>
                  <span className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#19734d]" /> 가능</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-white border border-[#e0e0e0]" /> {isWorkMeeting ? '불가능' : '미선택'}</span>
                  </span>
                </div>

                <div
                  className={`time-grid-scroll overflow-x-auto select-none pb-2 relative ${isDragging ? 'is-selection-active' : ''}`}
                  onPointerMove={hasActiveParticipantSession ? handleAvailabilityPointerMove : undefined}
                >
                  <table className="min-w-max w-full text-center text-sm border-collapse">
                    <thead>
                      <tr>
                        <th className="p-2 border-b border-r border-[#e0e0e0] w-16 bg-[#f5f5f7]"></th>
                        {boardParams.dates.map(date => (
                            <th
                              key={date}
                              data-availability-date={date}
                              aria-disabled={!hasActiveParticipantSession}
                              onPointerDown={hasActiveParticipantSession ? event => handleDateColumnPointerDown(event, date) : undefined}
                              className={`date-column-header p-2 border-b border-[#e0e0e0] font-semibold bg-[#f5f5f7] min-w-[70px] whitespace-nowrap text-xs text-[#333333] transition-colors ${hasActiveParticipantSession ? 'cursor-pointer hover:bg-[#eaf1eb]' : 'cursor-not-allowed'}`}
                            >
                            {formatColumnLabel(date)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {boardHours.map(hour => (
                        <tr key={hour}>
                          <td className="p-1 border-r border-b border-[#e0e0e0] text-xs text-[#7a7a7a] bg-[#f5f5f7] align-top h-6 tabular-nums">
                            {hour}
                          </td>
                          {boardParams.dates.map(date => {
                            const slotKey = `${date}-${hour}`;
                            const isAvailable = hasActiveParticipantSession
                              && (availability[slotKey] || []).includes(currentUser);
                            const waveIndex = waveSlots[slotKey];
                            return (
                              <td 
                                key={slotKey}
                                data-availability-slot={slotKey}
                                aria-disabled={!hasActiveParticipantSession}
                                onPointerDown={hasActiveParticipantSession ? event => handleAvailabilityPointerDown(event, slotKey) : undefined}
                                style={waveIndex !== undefined ? { '--wave-delay': `${waveIndex * 18}ms` } : undefined}
                                className={`availability-cell border border-[#e0e0e0] ${hasActiveParticipantSession ? 'cursor-pointer' : 'cursor-not-allowed'}
                                  ${isAvailable ? 'is-available bg-[#19734d] border-[#2b9668]' : `bg-white ${hasActiveParticipantSession ? 'hover:bg-[#f0f0f0]' : ''}`}
                                  ${waveIndex !== undefined ? 'wave-fill' : ''}`}
                              ></td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 그룹 전체 히트맵 */}
              <section className="bg-white p-4 sm:p-6 rounded-[18px] border border-[#e0e0e0]">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
                  <div className="flex-1">
                    <h3 className="font-semibold text-[#1d1d1f]">{isWorkMeeting ? '그룹 전체 시간' : '전체 가능 시간'}</h3>
                    <p className="text-xs text-[#7a7a7a] mt-1">
                      색이 진할수록 가능한 사람이 많은 시간이에요.
                    </p>
                  </div>
                  <span className="text-xs text-[#7a7a7a] flex items-center gap-1">
                    <Info size={12}/> {participants.length}명 참여
                  </span>
                </div>

                <div className="time-grid-scroll overflow-x-auto relative pb-2">
                  <table className="min-w-max w-full text-center text-sm border-collapse">
                    <thead>
                      <tr>
                        <th className="p-2 border-b border-r border-[#e0e0e0] w-16 bg-[#f5f5f7]"></th>
                        {boardParams.dates.map(date => (
                          <th key={date} className="p-2 border-b border-[#e0e0e0] font-semibold bg-[#f5f5f7] min-w-[70px] whitespace-nowrap text-xs text-[#333333]">
                            {formatColumnLabel(date)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {boardHours.map(hour => (
                        <tr key={hour}>
                          <td className="p-1 border-r border-b border-[#e0e0e0] text-xs text-[#7a7a7a] bg-[#f5f5f7] align-top h-6 tabular-nums">
                            {hour}
                          </td>
                          {boardParams.dates.map(date => {
                            const slotKey = `${date}-${hour}`;
                            const availableCount = (availability[slotKey] || []).length;
                            const cellClass = getHeatmapColor(availableCount, participants.length);
                            const waveIndex = waveSlots[slotKey];
                            
                            return (
                              <td 
                                key={slotKey}
                                onMouseEnter={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setTooltipData({ visible: true, x: rect.left + rect.width/2, y: rect.top, slotKey });
                                }}
                                onMouseLeave={() => setTooltipData({ ...tooltipData, visible: false })}
                                style={waveIndex !== undefined ? { '--wave-delay': `${waveIndex * 18}ms` } : undefined}
                                className={`availability-cell border border-[#f0f0f0] cursor-help ${cellClass} ${waveIndex !== undefined ? 'wave-fill' : ''}`}
                              >
                                {availableCount > 0 && availableCount === participants.length && participants.length > 0 ? (
                                  <span className="text-[10px]">전원: {availableCount}</span>
                                ) : availableCount > 0 ? (
                                  <span className="text-xs opacity-80">{availableCount}</span>
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            {/* 결과 요약 및 공유 */}
            <section className="bg-white p-4 sm:p-6 rounded-[18px] border border-[#e0e0e0]">
	               <div className="flex items-center gap-2 mb-4">
	                  <h3 className="font-semibold text-[#1d1d1f]">{isWorkMeeting ? '겹치는 시간 요약' : '정기 모임 시간 후보'}</h3>
                </div>

                {isJoined && (
                  <div className="mb-6 flex flex-col gap-4 border-y border-[#e0e5e1] py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#edf7f0] text-[#19734d]">
                        <CheckCircle2 size={16} />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-[#1d1d1f]">가능한 시간 다 골랐나요?</p>
                        <p className="mt-1 text-xs leading-relaxed text-[#666666]">
                          링크를 받은 카카오톡이나 Slack 채팅방에 완료 소식을 남겨보세요.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleShareVoteCompletion}
                      disabled={!isVoteCompletionReady}
                      className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-[8px] bg-[#19734d] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2b9668] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2b9668] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-55 sm:w-auto"
                    >
                      <MessageSquare size={15} />
                      완료 소식 보내기
                    </button>
                  </div>
                )}
                
                <div className={`grid grid-cols-1 ${isWorkMeeting ? 'md:grid-cols-2' : 'lg:grid-cols-[0.9fr_1.1fr]'} gap-8`}>
                  {/* Top 결과 카드 */}
                  <div>
                    <h4 className="text-sm font-semibold text-[#7a7a7a] mb-3">겹치는 시간이 많은 순이에요.</h4>
                    {results.length === 0 ? (
	                      <div className="text-sm text-[#7a7a7a] bg-[#f5f5f7] p-5 rounded-[18px] border border-[#f0f0f0] text-center py-8">
                        아직 표시된 가능 시간이 없어요.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {results.map((res, idx) => {
                          const isSelected = selectedResultIndex === idx;
                          return (
                            <div 
                              key={idx} 
                              onClick={() => setSelectedResultIndex(idx)}
                              className={`p-4 rounded-[18px] border flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between cursor-pointer transition-all
	                                ${isSelected ? 'border-[#19734d] bg-[#eaf1eb]' : 'border-[#f0f0f0] bg-white hover:border-[#19734d] hover:bg-[#f5f5f7]'}`}
                            >
                              <div>
	                                {idx === 0 && <span className="text-xs font-semibold text-[#2b9668] bg-white px-2 py-0.5 rounded-full mb-1 inline-block">추천</span>}
	                                {idx !== 0 && isSelected && <span className="text-xs font-semibold text-[#333333] bg-white px-2 py-0.5 rounded-full mb-1 inline-block">선택됨</span>}
	                                <div className={`font-semibold ${isSelected ? 'text-[#2b9668] text-lg' : 'text-[#1d1d1f]'}`}>{res.time}</div>
                                <div className="text-xs text-[#7a7a7a] mt-1">
                                  가능한 사람: {res.available.join(', ')}
                                  {isWorkMeeting && (
                                    <>
                                      <br/>
                                      <span className="text-[#7a7a7a]">불가능한 사람: {res.unavailable.length > 0 ? res.unavailable.join(', ') : '없음'}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className={`w-full sm:w-auto text-center rounded-[14px] px-3 py-2 ${isSelected ? 'bg-white' : 'bg-[#f5f5f7]'}`}>
                                <div className="text-xs text-[#7a7a7a]">가능 인원</div>
	                                <div className={`font-semibold ${isSelected ? 'text-[#2b9668]' : 'text-[#333333]'}`}>{res.availableCount}명</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 공유 텍스트 */}
                  <div className="flex flex-col h-full">
	                    <h4 className="text-sm font-semibold text-[#7a7a7a] mb-3 flex items-center gap-1">
                      <MessageSquare size={14}/> {isWorkMeeting ? '공유 메시지' : '확정 시간 공유하기'}
                    </h4>
                    {!isWorkMeeting && (
                      <p className="mb-3 text-sm text-[#7a7a7a]">
                        선택한 시간을 메시지로 공유할 수 있습니다.
                      </p>
                    )}
                    <textarea 
                      value={shareMessage}
                      onChange={(e) => setShareMessage(e.target.value)}
                      className="w-full flex-1 border-0 rounded-[18px] p-4 text-sm leading-relaxed text-[#333333] bg-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-[#2b9668] resize-none min-h-[160px] font-sans"
                    />
                    <button 
                      onClick={() => copyToClipboard(
                        shareMessage,
                        isWorkMeeting ? '공유 메시지가 복사되었습니다.' : '확정 시간 메시지를 복사했습니다.'
                      )}
	                      className="mt-4 w-full bg-[#19734d] hover:bg-[#2b9668] text-white font-semibold py-3 rounded-full flex items-center justify-center gap-2 transition-colors"
                    >
                      <Copy size={16} />
                      {isWorkMeeting ? '공유 메시지 복사' : '메시지 복사하기'}
                    </button>
                  </div>
                </div>
            </section>

          </div>
          </div>
        )}
      </main>
      
      {/* CSS Animation */}
      <style>{`
        :root {
          font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Noto Sans KR", "Segoe UI", sans-serif;
          color: #1d1d1f;
          letter-spacing: 0;
          font-synthesis: none;
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        body {
          margin: 0;
          font-family: inherit;
          letter-spacing: 0;
          line-height: 1.5;
          word-break: keep-all;
          overflow-wrap: anywhere;
        }
        button,
        input,
        select,
        textarea {
          font: inherit;
          letter-spacing: 0;
        }
        .app-shell {
          font-family: inherit;
          letter-spacing: 0;
        }
        .tabular-nums {
          font-variant-numeric: tabular-nums;
        }
        .availability-cell {
          position: relative;
          height: 24px;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
          -webkit-tap-highlight-color: transparent;
          transform: translateZ(0);
          transition:
            background-color 220ms cubic-bezier(0.2, 0, 0, 1),
            border-color 220ms cubic-bezier(0.2, 0, 0, 1),
            box-shadow 220ms cubic-bezier(0.2, 0, 0, 1),
            transform 220ms cubic-bezier(0.2, 0, 0, 1);
          will-change: background-color, transform;
        }
        @media (max-width: 640px) {
          .availability-cell {
            height: 30px;
          }
          .date-column-header {
            min-width: 62px;
            min-height: 44px;
          }
        }
        .availability-cell:hover {
          transform: scale(1.018);
          z-index: 1;
        }
        .availability-cell.is-available {
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
        }
        .date-column-header {
          touch-action: pan-x;
          user-select: none;
          -webkit-user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
        .availability-cell.wave-fill {
          animation: waveFill 720ms cubic-bezier(0.16, 1, 0.3, 1) both;
          animation-delay: var(--wave-delay, 0ms);
        }
        .availability-cell.wave-fill::after {
          content: "";
          position: absolute;
          inset: 2px;
          border-radius: 6px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent);
          opacity: 0;
          pointer-events: none;
          animation: waveShimmer 720ms cubic-bezier(0.16, 1, 0.3, 1) both;
          animation-delay: var(--wave-delay, 0ms);
        }
        .fade-in { animation: fadeIn 0.3s ease-out; }
        .animate-fade-in { animation: fadeIn 0.6s ease-out both; }
        .animate-fade-up { animation: fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .animate-slide-up { animation: slideUp 0.9s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .animate-slide-in-left { animation: slideInLeft 0.8s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .animate-slide-in-right { animation: slideInRight 0.8s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .animate-word-pop {
          opacity: 0;
          animation: wordPop 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
        .delay-100 { animation-delay: 100ms; }
        .delay-200 { animation-delay: 200ms; }
        .delay-300 { animation-delay: 300ms; }
        .delay-500 { animation-delay: 500ms; }
        .delay-700 { animation-delay: 700ms; }
        .delay-900 { animation-delay: 900ms; }
        @keyframes waveFill {
          0% {
            transform: scale(0.92);
            filter: saturate(0.75);
            box-shadow: inset 0 0 0 1px rgba(25, 115, 77, 0);
          }
          45% {
            transform: scale(1.045);
            filter: saturate(1.2);
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.38), 0 0 0 3px rgba(25, 115, 77, 0.12);
          }
          100% {
            transform: scale(1);
            filter: saturate(1);
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
          }
        }
        @keyframes waveShimmer {
          0% {
            opacity: 0;
            transform: translateX(-35%);
          }
          38% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translateX(35%);
          }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(60px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-40px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(40px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes wordPop {
          0% {
            opacity: 0;
            transform: translateY(60px) scale(0.7) rotate(-4deg);
            filter: blur(8px);
          }
          72% {
            opacity: 1;
            transform: translateY(-4px) scale(1.03) rotate(1deg);
            filter: blur(0);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1) rotate(0);
            filter: blur(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .availability-cell,
          .availability-cell.wave-fill,
          .availability-cell.wave-fill::after,
          .fade-in,
          .animate-fade-in,
          .animate-fade-up,
          .animate-slide-up,
          .animate-slide-in-left,
          .animate-slide-in-right,
          .animate-word-pop {
            animation: none;
            transition-duration: 0ms;
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
