package com.when7meet.meeting.api;

import com.when7meet.meeting.application.MeetingException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(MeetingException.class)
    public ProblemDetail handleMeeting(MeetingException exception) {
        HttpStatus status = switch (exception.code()) {
            case "MEETING_NOT_FOUND" -> HttpStatus.NOT_FOUND;
            case "PARTICIPANT_AUTH_FAILED" -> HttpStatus.UNAUTHORIZED;
            default -> HttpStatus.BAD_REQUEST;
        };
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, exception.getMessage());
        problem.setProperty("code", exception.code());
        return problem;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleValidation() {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "입력값을 확인해주세요.");
    }
}
