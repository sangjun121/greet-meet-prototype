# when7meet API

Spring Boot API for meeting creation, participant authentication, and availability responses.

## Run locally

1. Start PostgreSQL from the project root: `docker compose up -d postgres`
2. Install Java 21 and Gradle 8.14+ (or use the generated Gradle wrapper).
3. Run: `./gradlew bootRun`

Flyway applies the database schema from `src/main/resources/db/migration` on startup.

## Supabase PostgreSQL

The production API uses Supabase as a managed PostgreSQL database. Set the `DATABASE_URL`,
`DATABASE_USERNAME`, and `DATABASE_PASSWORD` variables only in the server hosting provider.
Never add them to the Vite `.env.local` file or expose them to the browser.

For a persistent Spring server, use the Supabase direct connection when the hosting network
supports IPv6. Otherwise use the Supavisor session pooler connection. Add `?sslmode=require`
to the JDBC URL when required by the connection settings.

The repository includes `../render.yaml` and this directory's `Dockerfile` for Render deployment.
After deployment, set `APP_ALLOWED_ORIGIN` to the exact GitHub Pages origin and set the frontend's
`VITE_API_BASE_URL` to the deployed API URL ending in `/api`.

## API

- `POST /api/meetings`
- `GET /api/meetings/{meetingId}`
- `POST /api/meetings/{meetingId}/participants`
- `PUT /api/meetings/{meetingId}/participants/{participantId}/availability`
- `GET /actuator/health`

Participant passwords are stored as BCrypt hashes. The API never returns credentials.
