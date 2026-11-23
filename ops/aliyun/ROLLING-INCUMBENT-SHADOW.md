# Rolling incumbent shadow check

ECS must independently establish the exact persisted receipt digest, operation, journal and pinned backend/frontend/config/DB pair, and source ancestry under the existing shared lock. Only explicitly approved exact 7a is valid as a no-receipt bootstrap. Neither this local comparator nor a candidate-controlled assertion can act as installed host approval.

Prefer external candidate verification before lifting the write fence. After an open, failure is not authorization to retry or roll back. A reviewed recovery path must relock, verify the exact failed opened operation is still current, refuse if superseded, fence writes, and verify retained predecessor plus unchanged database compatibility before any separately authorized recovery. Otherwise report uncertainty or leave writes held under approved policy. No second state store or release protocol changes are introduced here.
