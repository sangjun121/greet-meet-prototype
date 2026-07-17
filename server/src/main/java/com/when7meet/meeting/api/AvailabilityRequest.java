package com.when7meet.meeting.api;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

public record AvailabilityRequest(@NotBlank String password, List<String> slotKeys) {
}
