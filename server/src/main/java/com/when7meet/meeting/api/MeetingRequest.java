package com.when7meet.meeting.api;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

public record MeetingRequest(
        @NotBlank String title,
        @NotBlank String type,
        @NotEmpty List<String> dates,
        @Min(0) @Max(23) int start,
        @Min(0) @Max(23) int end,
        Integer expectedParticipants,
        String notificationChannel
) {
}
