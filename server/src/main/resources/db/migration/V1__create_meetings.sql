create extension if not exists pgcrypto;

create table if not exists meetings (
    id uuid primary key default gen_random_uuid(),
    title varchar(120) not null default '모임',
    meeting_type varchar(20) not null check (meeting_type in ('work', 'regular')),
    dates text[] not null check (cardinality(dates) > 0),
    start_hour smallint not null check (start_hour between 0 and 23),
    end_hour smallint not null check (end_hour between 0 and 23),
    expected_participants smallint check (expected_participants is null or expected_participants > 0),
    notification_channel varchar(30) not null default '받지 않음',
    created_at timestamptz not null default now(),
    constraint meetings_valid_hours check (start_hour <= end_hour)
);

create table if not exists participants (
    id uuid primary key default gen_random_uuid(),
    meeting_id uuid not null references meetings(id) on delete cascade,
    name varchar(80) not null check (char_length(trim(name)) between 1 and 80),
    created_at timestamptz not null default now()
);

create unique index if not exists participants_meeting_lower_name_idx
    on participants (meeting_id, lower(name));

create table if not exists participant_credentials (
    participant_id uuid primary key references participants(id) on delete cascade,
    password_hash varchar(100) not null,
    created_at timestamptz not null default now()
);

create table if not exists responses (
    meeting_id uuid not null references meetings(id) on delete cascade,
    participant_id uuid not null references participants(id) on delete cascade,
    slot_key varchar(100) not null,
    created_at timestamptz not null default now(),
    primary key (participant_id, slot_key)
);

create index if not exists responses_meeting_idx on responses (meeting_id);
