package com.when7meet.meeting.api;

import com.when7meet.meeting.application.MeetingService;
import com.when7meet.meeting.domain.Meeting;
import com.when7meet.meeting.domain.Participant;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/meetings")
public class MeetingController {
    private final MeetingService service;

    public MeetingController(MeetingService service) {
        this.service = service;
    }

    @PostMapping
    public Map<String, UUID> create(@Valid @RequestBody MeetingRequest request) {
        UUID id = service.createMeeting(new Meeting(
                null, request.title().trim(), request.type(), request.dates(), request.start(), request.end(),
                request.expectedParticipants(), request.notificationChannel() == null ? "받지 않음" : request.notificationChannel()
        ));
        return Map.of("id", id);
    }

    @GetMapping("/{meetingId}")
    public MeetingService.BoardView get(@PathVariable UUID meetingId) {
        return service.getBoard(meetingId);
    }

    @PostMapping("/{meetingId}/participants")
    public Participant join(@PathVariable UUID meetingId, @Valid @RequestBody JoinRequest request) {
        return service.join(meetingId, request.name(), request.password());
    }

    @PutMapping("/{meetingId}/participants/{participantId}/availability")
    public void saveAvailability(@PathVariable UUID meetingId, @PathVariable UUID participantId,
                                 @Valid @RequestBody AvailabilityRequest request) {
        service.saveAvailability(meetingId, participantId, request.password(), request.slotKeys());
    }
}
