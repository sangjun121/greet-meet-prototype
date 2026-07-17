package com.when7meet.meeting.infrastructure;

import com.when7meet.meeting.domain.Meeting;
import com.when7meet.meeting.domain.Participant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Repository;

import java.sql.Array;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
public class MeetingRepository {
    private final JdbcTemplate jdbc;

    public MeetingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public UUID insertMeeting(Meeting meeting) {
        return jdbc.execute((ConnectionCallback<UUID>) connection -> {
            Array dates = connection.createArrayOf("text", meeting.dates().toArray());
            try (PreparedStatement statement = connection.prepareStatement("""
                    insert into meetings (title, meeting_type, dates, start_hour, end_hour,
                                          expected_participants, notification_channel)
                    values (?, ?, ?, ?, ?, ?, ?) returning id
                    """)) {
                statement.setString(1, meeting.title());
                statement.setString(2, meeting.type());
                statement.setArray(3, dates);
                statement.setInt(4, meeting.start());
                statement.setInt(5, meeting.end());
                if (meeting.expectedParticipants() == null) statement.setObject(6, null);
                else statement.setInt(6, meeting.expectedParticipants());
                statement.setString(7, meeting.notificationChannel());
                try (var result = statement.executeQuery()) {
                    if (!result.next()) throw new IllegalStateException("모임 ID를 생성하지 못했습니다.");
                    return result.getObject("id", UUID.class);
                }
            } finally {
                dates.free();
            }
        });
    }

    public Optional<Meeting> findMeeting(UUID meetingId) {
        List<Meeting> rows = jdbc.query("""
                select id, title, meeting_type, dates, start_hour, end_hour,
                       expected_participants, notification_channel
                from meetings where id = ?
                """, this::mapMeeting, meetingId);
        return rows.stream().findFirst();
    }

    public List<Participant> findParticipants(UUID meetingId) {
        return jdbc.query("""
                select id, name from participants
                where meeting_id = ? order by created_at asc
                """, (rs, rowNum) -> new Participant(rs.getObject("id", UUID.class), rs.getString("name")), meetingId);
    }

    public Map<String, List<String>> findAvailability(UUID meetingId) {
        Map<String, List<String>> availability = new LinkedHashMap<>();
        jdbc.query("""
                select r.slot_key, p.name
                from responses r join participants p on p.id = r.participant_id
                where r.meeting_id = ? order by r.created_at asc
                """, (RowCallbackHandler) rs -> availability.computeIfAbsent(rs.getString("slot_key"), ignored -> new ArrayList<>())
                        .add(rs.getString("name")), meetingId);
        return availability;
    }

    public Optional<Participant> findParticipant(UUID meetingId, String name) {
        List<Participant> rows = jdbc.query("""
                select id, name from participants
                where meeting_id = ? and lower(name) = lower(?)
                """, (rs, rowNum) -> new Participant(rs.getObject("id", UUID.class), rs.getString("name")), meetingId, name);
        return rows.stream().findFirst();
    }

    public Optional<String> findPasswordHash(UUID participantId, UUID meetingId) {
        List<String> rows = jdbc.query("""
                select c.password_hash from participant_credentials c
                join participants p on p.id = c.participant_id
                where c.participant_id = ? and p.meeting_id = ?
                """, (rs, rowNum) -> rs.getString("password_hash"), participantId, meetingId);
        return rows.stream().findFirst();
    }

    public Participant insertParticipant(UUID meetingId, String name) {
        return jdbc.queryForObject("""
                insert into participants (meeting_id, name) values (?, ?)
                returning id, name
                """, (rs, rowNum) -> new Participant(rs.getObject("id", UUID.class), rs.getString("name")), meetingId, name);
    }

    public void insertCredential(UUID participantId, String passwordHash) {
        jdbc.update("insert into participant_credentials (participant_id, password_hash) values (?, ?)", participantId, passwordHash);
    }

    public void replaceAvailability(UUID meetingId, UUID participantId, List<String> slotKeys) {
        jdbc.update("delete from responses where meeting_id = ? and participant_id = ?", meetingId, participantId);
        if (slotKeys.isEmpty()) return;
        jdbc.batchUpdate("insert into responses (meeting_id, participant_id, slot_key) values (?, ?, ?)",
                slotKeys, slotKeys.size(), (ps, slotKey) -> {
                    ps.setObject(1, meetingId);
                    ps.setObject(2, participantId);
                    ps.setString(3, slotKey);
                });
    }

    private Meeting mapMeeting(ResultSet rs, int rowNum) throws SQLException {
        Array dates = rs.getArray("dates");
        return new Meeting(
                rs.getObject("id", UUID.class),
                rs.getString("title"),
                rs.getString("meeting_type"),
                dates == null ? List.of() : List.of((String[]) dates.getArray()),
                rs.getInt("start_hour"),
                rs.getInt("end_hour"),
                (Integer) rs.getObject("expected_participants"),
                rs.getString("notification_channel")
        );
    }
}
