const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '');

export const isBackendConfigured = Boolean(apiBaseUrl);

const request = async (path, options = {}) => {
  if (!apiBaseUrl) {
    throw new Error('VITE_API_BASE_URL이 설정되지 않았습니다. .env.local에 Spring API 주소를 추가해주세요.');
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(body?.message || body?.detail || '서버 요청에 실패했습니다.');
  }

  return body;
};

export const createMeeting = async ({
  title,
  type,
  dates,
  start,
  end,
  expectedParticipants,
  notificationChannel,
}) => {
  const data = await request('/meetings', {
    method: 'POST',
    body: JSON.stringify({
      title,
      type,
      dates,
      start: Number(start),
      end: Number(end),
      expectedParticipants: expectedParticipants || null,
      notificationChannel: notificationChannel || '받지 않음',
    }),
  });

  return data.id;
};

export const loadMeeting = meetingId => request(`/meetings/${encodeURIComponent(meetingId)}`);

export const joinMeeting = ({ meetingId, name, password }) => request(
  `/meetings/${encodeURIComponent(meetingId)}/participants`,
  {
    method: 'POST',
    body: JSON.stringify({ name, password }),
  },
);

export const saveParticipantAvailability = ({ meetingId, participantId, password, slotKeys }) => request(
  `/meetings/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(participantId)}/availability`,
  {
    method: 'PUT',
    body: JSON.stringify({ password, slotKeys }),
  },
);

export const subscribeToMeeting = (meetingId, onChange) => {
  let isActive = true;
  let timerId;

  const poll = async () => {
    try {
      await onChange();
    } finally {
      if (isActive) timerId = window.setTimeout(poll, 5000);
    }
  };

  timerId = window.setTimeout(poll, 5000);

  return () => {
    isActive = false;
    window.clearTimeout(timerId);
  };
};
