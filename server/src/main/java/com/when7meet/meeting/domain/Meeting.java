package com.when7meet.meeting.domain;

import java.util.List;
import java.util.UUID;

public record Meeting(UUID id, String title, String type, List<String> dates,
                      int start, int end, Integer expectedParticipants,
                      String notificationChannel) {
}
