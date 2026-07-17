package com.when7meet.meeting.api;

import jakarta.validation.constraints.NotBlank;

public record JoinRequest(@NotBlank String name, @NotBlank String password) {
}
