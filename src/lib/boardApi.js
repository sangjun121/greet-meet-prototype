import { requireSupabase, supabase } from './supabase';

const firstRow = value => (Array.isArray(value) ? value[0] : value);

const throwIfError = (error, fallbackMessage) => {
  if (!error) return;

  if (error.message?.includes('participant_auth_failed')) {
    throw new Error('이름 또는 임시 비밀번호가 맞지 않습니다.');
  }

  throw new Error(error.message || fallbackMessage);
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
  const client = requireSupabase();
  const { data, error } = await client
    .from('meetings')
    .insert({
      title,
      meeting_type: type,
      dates,
      start_hour: Number(start),
      end_hour: Number(end),
      expected_participants: expectedParticipants || null,
      notification_channel: notificationChannel || '받지 않음',
    })
    .select('id')
    .single();

  throwIfError(error, '모임을 만들지 못했습니다.');
  return data.id;
};

export const getMeetingCount = async () => {
  const client = requireSupabase();
  const { count, error } = await client
    .from('meetings')
    .select('*', { count: 'exact', head: true });

  throwIfError(error, '생성된 모임 수를 불러오지 못했습니다.');
  return count ?? 0;
};

export const loadMeeting = async meetingId => {
  const client = requireSupabase();
  const { data: meeting, error: meetingError } = await client
    .from('meetings')
    .select('id,title,meeting_type,dates,start_hour,end_hour,expected_participants,notification_channel')
    .eq('id', meetingId)
    .maybeSingle();

  throwIfError(meetingError, '모임 정보를 불러오지 못했습니다.');
  if (!meeting) throw new Error('존재하지 않거나 삭제된 모임 링크입니다.');

  const [{ data: participantRows, error: participantsError }, { data: responseRows, error: responsesError }] = await Promise.all([
    client
      .from('participants')
      .select('id,name')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: true }),
    client
      .from('responses')
      .select('participant_id,slot_key')
      .eq('meeting_id', meetingId),
  ]);

  throwIfError(participantsError, '참여자 목록을 불러오지 못했습니다.');
  throwIfError(responsesError, '응답 목록을 불러오지 못했습니다.');

  const participantNameById = new Map((participantRows || []).map(participant => [participant.id, participant.name]));
  const participants = (participantRows || []).map(participant => participant.name);
  const participantIds = Object.fromEntries((participantRows || []).map(participant => [participant.name, participant.id]));
  const availability = {};

  (responseRows || []).forEach(response => {
    const participantName = participantNameById.get(response.participant_id);
    if (!participantName) return;

    availability[response.slot_key] = [
      ...(availability[response.slot_key] || []),
      participantName,
    ];
  });

  return {
    boardParams: {
      id: meeting.id,
      title: meeting.title,
      type: meeting.meeting_type,
      dates: meeting.dates || [],
      start: meeting.start_hour,
      end: meeting.end_hour,
      expectedParticipants: meeting.expected_participants,
      notificationChannel: meeting.notification_channel,
    },
    participants,
    participantIds,
    availability,
  };
};

export const joinMeeting = async ({ meetingId, name, password }) => {
  const client = requireSupabase();
  const { data, error } = await client.rpc('join_meeting', {
    p_meeting_id: meetingId,
    p_name: name,
    p_password: password,
  });

  throwIfError(error, '모임 참여에 실패했습니다.');
  const participant = firstRow(data);
  if (!participant?.participant_id) throw new Error('모임 참여에 실패했습니다.');

  return {
    id: participant.participant_id,
    name: participant.participant_name,
  };
};

export const saveParticipantAvailability = async ({ meetingId, participantId, password, slotKeys }) => {
  const client = requireSupabase();
  const { error } = await client.rpc('save_participant_availability', {
    p_meeting_id: meetingId,
    p_participant_id: participantId,
    p_password: password,
    p_slot_keys: slotKeys,
  });

  throwIfError(error, '가능 시간을 저장하지 못했습니다.');
};

export const subscribeToMeeting = (meetingId, onChange) => {
  if (!supabase) return () => {};

  let refreshTimer = null;
  const scheduleRefresh = () => {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      onChange();
    }, 120);
  };

  const channel = supabase
    .channel(`meeting:${meetingId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'participants',
      filter: `meeting_id=eq.${meetingId}`,
    }, scheduleRefresh)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'responses',
      filter: `meeting_id=eq.${meetingId}`,
    }, scheduleRefresh)
    .subscribe();

  return () => {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    supabase.removeChannel(channel);
  };
};
