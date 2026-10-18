-- Display text from the browser context, saved at log time: a page token cannot read tickets from Tikki.
ALTER TABLE time_entry ADD COLUMN ticket_title TEXT NOT NULL DEFAULT '';
ALTER TABLE time_entry ADD COLUMN ticket_type TEXT NOT NULL DEFAULT '';
-- The timesheet reads by date, for everyone or for one Agent.
CREATE INDEX time_entry_created ON time_entry (created_at);
CREATE INDEX time_entry_agent ON time_entry (agent_id, created_at);
