CREATE TABLE time_entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_ref TEXT NOT NULL,
  -- From the checked context token, so it is trusted.
  agent_id TEXT NOT NULL,
  -- From the browser context. Display only: never used for a permission.
  agent_label TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX time_entry_ticket ON time_entry (ticket_ref, created_at);
