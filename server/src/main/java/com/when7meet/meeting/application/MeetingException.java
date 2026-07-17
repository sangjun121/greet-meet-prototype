package com.when7meet.meeting.application;

public class MeetingException extends RuntimeException {
    private final String code;

    public MeetingException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
