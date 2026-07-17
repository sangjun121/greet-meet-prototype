package com.when7meet.meeting.application;

import com.when7meet.meeting.domain.Meeting;
import com.when7meet.meeting.domain.Participant;
import com.when7meet.meeting.infrastructure.MeetingRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class MeetingService {
    private final MeetingRepository repository;
    private final PasswordEncoder passwordEncoder;

    public MeetingService(MeetingRepository repository, PasswordEncoder passwordEncoder) {
        this.repository = repository;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public UUID createMeeting(Meeting meeting) {
        validateMeeting(meeting);
        return repository.insertMeeting(meeting);
    }

    @Transactional(readOnly = true)
    public BoardView getBoard(UUID meetingId) {
        Meeting meeting = repository.findMeeting(meetingId)
                .orElseThrow(() -> new MeetingException("MEETING_NOT_FOUND", "존재하지 않거나 삭제된 모임 링크입니다."));
        List<Participant> participants = repository.findParticipants(meetingId);
        Map<String, UUID> participantIds = new LinkedHashMap<>();
        participants.forEach(participant -> participantIds.put(participant.name(), participant.id()));
        return new BoardView(
                new BoardParams(meeting.id(), meeting.title(), meeting.type(), meeting.dates(), meeting.start(),
                        meeting.end(), meeting.expectedParticipants(), meeting.notificationChannel()),
                participants.stream().map(Participant::name).toList(), participantIds, repository.findAvailability(meetingId)
        );
    }

    @Transactional
    public Participant join(UUID meetingId, String name, String password) {
        if (repository.findMeeting(meetingId).isEmpty()) {
            throw new MeetingException("MEETING_NOT_FOUND", "존재하지 않거나 삭제된 모임 링크입니다.");
        }
        String normalizedName = name == null ? "" : name.trim();
        validateCredentials(normalizedName, password);

        var existing = repository.findParticipant(meetingId, normalizedName);
        if (existing.isPresent()) {
            String hash = repository.findPasswordHash(existing.get().id(), meetingId).orElse("");
            if (!passwordEncoder.matches(password, hash)) authFailed();
            return existing.get();
        }

        try {
            Participant participant = repository.insertParticipant(meetingId, normalizedName);
            repository.insertCredential(participant.id(), passwordEncoder.encode(password));
            return participant;
        } catch (DataIntegrityViolationException exception) {
            authFailed();
            return null;
        }
    }

    @Transactional
    public void saveAvailability(UUID meetingId, UUID participantId, String password, List<String> slotKeys) {
        Meeting meeting = repository.findMeeting(meetingId)
                .orElseThrow(() -> new MeetingException("MEETING_NOT_FOUND", "존재하지 않거나 삭제된 모임 링크입니다."));
        String hash = repository.findPasswordHash(participantId, meetingId).orElse("");
        if (!passwordEncoder.matches(password, hash)) authFailed();

        List<String> validSlots = (slotKeys == null ? List.<String>of() : slotKeys).stream()
                .filter(slot -> isValidSlot(meeting, slot))
                .distinct()
                .toList();
        repository.replaceAvailability(meetingId, participantId, validSlots);
    }

    private boolean isValidSlot(Meeting meeting, String slot) {
        if (slot == null || !slot.matches(".+-[0-9]{2}:[03]0")) return false;
        int separator = slot.lastIndexOf('-');
        String date = slot.substring(0, separator);
        String time = slot.substring(separator + 1);
        int hour = Integer.parseInt(time.substring(0, 2));
        return meeting.dates().contains(date) && hour >= meeting.start() && hour <= meeting.end()
                && !(hour == meeting.end() && time.endsWith(":30"));
    }

    private void validateMeeting(Meeting meeting) {
        if (meeting.title() == null || meeting.title().isBlank() || meeting.dates().isEmpty()
                || !(meeting.type().equals("work") || meeting.type().equals("regular"))
                || meeting.start() < 0 || meeting.start() > 23 || meeting.end() < 0 || meeting.end() > 23
                || meeting.start() > meeting.end()
                || (meeting.expectedParticipants() != null && meeting.expectedParticipants() < 1)) {
            throw new MeetingException("INVALID_MEETING", "모임 설정을 확인해주세요.");
        }
    }

    private void validateCredentials(String name, String password) {
        if (name.length() < 1 || name.length() > 80 || password == null || password.length() < 4) authFailed();
    }

    private void authFailed() {
        throw new MeetingException("PARTICIPANT_AUTH_FAILED", "이름 또는 임시 비밀번호가 맞지 않습니다.");
    }

    public record BoardParams(UUID id, String title, String type, List<String> dates, int start, int end,
                              Integer expectedParticipants, String notificationChannel) {
    }

    public record BoardView(BoardParams boardParams, List<String> participants,
                            Map<String, UUID> participantIds, Map<String, List<String>> availability) {
    }
}
