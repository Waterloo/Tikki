# 07 · Admin creates and edits Ticket Types and Fields

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Admins manage Ticket Types and their Fields without breaking old tickets. The screens follow the design canvas ("Ticket types", "New ticket type", "Ticket type fields").

- Types list with prefix, Field count, open tickets, Team, visibility, version, and archived types with Restore.
- One-page creation. Nothing is saved until Create, and Create makes Schema Version 1. The description is required. The icon is suggested from the name. The color is the first one no other type uses. The prefix is suggested from the name (first word if 5 letters or less, else its first 3 letters).
- Field editor: label, data type, required, help text, options. The Field Key is made from the label (`snake_case`) and is locked after creation. Quick-add for Branch, Due date, Screenshot.
- Blocked at input: a duplicate name (a link to Restore when an archived type has it), a duplicate prefix (archived prefixes stay reserved), a duplicate Field Key.
- Live previews: the requester card and "What Claude knows".
- Editing: each save makes a new Schema Version. Allowed: add Field, rename label, add or archive options, archive Field, restore Field, make required (new tickets only). Refused: change a data type, hard-delete a Field.
- Archive a Ticket Type: no new tickets of it, old ones keep it.

## Acceptance criteria

- [x] REST test: create a type makes version 1. Editing Fields makes version 2. An old ticket stays on version 1 and still validates against it.
  Evidence: `test/worker/ticket-type-admin.test.ts`, "makes Schema Version 1 with the Fields, in one save..." and "makes version 2 on a Field change, and an old ticket stays on version 1 and still validates against it" (reads the stored version 1 row and runs `validateFields` on the old ticket's values; both `schema_version` rows exist and version 1 is unchanged).
- [x] REST test: changing a Field's data type or deleting it is refused with a clear error.
  Evidence: same file, "refuses to change a data type..." (422, key `fields.0.type`, "The data type of ... cannot change from single_select. Archive the Field and add a new one.") and "refuses to delete a Field or an option, and tells the Admin to archive". Nothing is saved (version stays 1). The API has no route that deletes a type or a Field.
- [x] REST test: duplicate name, prefix (including an archived type's prefix), and Field Key are refused.
  Evidence: same file, "Ticket Type editor: duplicates are refused" (name in other case, name of an archived type with `restore_type_id`, prefix of an active and of an archived type, rename to a reserved prefix, a duplicate Field Key at create and at edit, and a key of a core attribute).
- [x] REST test: a ticket cannot be created with an archived type.
  Evidence: same file, "refuses a new ticket of an archived type, keeps old tickets, and Restore allows new ones again" (422 on `ticket_type_id`; the old ticket still reads with its type; the type leaves the Requester list and `GET` answers 404; Restore allows tickets again). The MCP test also checks `create_ticket` on an archived type.
- [x] MCP test: `get_ticket_type` returns the newest version after an edit.
  Evidence: same file, "get_ticket_type returns the newest version after an edit, and list_ticket_types leaves out an archived type" (`schema_version` 1, then 2 with the new Field and its help text).
- [x] Playwright flow: an Admin creates "Access request" with two Fields, and a Requester sees it in the web form.
  Evidence: `e2e/ticket-types.spec.ts`, "an Admin creates "Access request" with two Fields, and a Requester sees it in the web form" (also checks the duplicate-name block, the suggested prefix `ACC`, and the live "What Claude knows" line). A second flow adds a Field as version 2, archives the type, and restores it. A third checks 375 px.

Other tests: `test/worker/ticket-type-admin.test.ts` also covers the Admin-only rule (401, 403 for Requester and Agent), defaults (prefix, icon, color), validation of each setting, a stale save (409), the list counts, and "no new version when nothing changes". `test/unit/ticket-type-rules.test.ts` covers the suggestions.

Audit: `test/worker/ticket-type-admin.test.ts`, "writes an audit entry with Principal and channel for each change, in the same write": create, settings change (old and new name), a new Schema Version (`added` Field Keys), archive and restore each write one entry with the Admin as Principal and channel `web`. A refused save writes none.

Run: `pnpm test` 14 files, 139 tests pass. `pnpm typecheck` passes. `E2E_PORT=8812 pnpm e2e` 8 tests pass.

## Not verified

- The canvas has a drag handle to reorder Fields. It is not built: no requirement asks for it, and the order of Fields is the order of creation.
- Seen in a browser on the dev server (port 8802): the list, the new-type page (live duplicate name and prefix errors, suggestions) and the editor with the Field edit form, in light and dark mode. Not seen in a browser: the 375 px layout (checked only by the Playwright scroll-width test), the archived-types section and the toast with "Undo" (the e2e flow clicks Restore in the list).
- The new-type page was not tried with a screen reader. Labels, `aria-pressed` on the icon and color buttons, and `role="alert"` on errors are in place.

## Decisions made here

- **Routes.** Reads for the editor: `GET /api/v1/admin/ticket-types` (all types, archived too, with `field_count`, `open_tickets`, `ticket_count`, `schema_version`, plus `teams` for the "Owning team" select) and `GET /api/v1/admin/ticket-types/{id}` (all Fields of the newest version, archived ones too). Writes: `POST /api/v1/ticket-types` (201) and `PATCH /api/v1/ticket-types/{id}`. All are Admin-only (`adminPrincipal`). The existing reader routes `GET /api/v1/ticket-types[/{id}]` and the MCP tools leave out archived types.
- **One PATCH for everything.** It takes settings (`name`, `description`, `prefix`, `icon`, `color`, `team_id`, `visible_to_all`), `archived` (true archives, false restores), and `fields` with `base_version`. `fields` is the full list: every earlier Field must stay in it. The server compares it with the newest version and refuses a different data type, a missing Field, or a missing option. If the Fields did not change, no version is made. Settings changes never make a version.
- **Optimistic version check.** A save of `fields` needs `base_version` (the `schema_version` the Admin edited). An older one answers 409 `CONFLICT`. The unique index on (type, version) is the backstop: a race answers 409 as well. D1 batch makes the settings update and the new version one write.
- **Create is one batch** (type row and version 1 row). The version row finds the type by its unique prefix, so no interactive transaction is needed.
- **Error format.** Validation is 422 `VALIDATION_FAILED` with `details: [{ key, reason }]`. `key` is the input name, or `fields.<index>.<label|key|type|options|help>` for a Field. A name that an archived type has also carries `restore_type_id`.
- **Rules in `shared/ticket-type-rules.ts`** (used by the form and the server): the icon set (8 Lucide icons, all bundled into the client), the color set (6 colors from the canvas), the prefix pattern, the Field Key pattern (`^[a-z][a-z0-9_]{0,39}$`), the reserved keys (`title`, `description`, `priority`, `ticket_type_id`, `fields`, `status`, `assignee_id`, `body`), and the suggestions (key from label, prefix from name, icon from name, first unused color).
- **Names are unique case-insensitively** (checked in code; the database constraint stays case-sensitive as a backstop). Prefixes are changed to capitals and are unique across all types, archived ones too. The prefix can be changed later; old references still find the ticket by number.
- **Unused color** means a color that no other type uses, archived types included. When all six are used, the first color is suggested.
- **Team default.** `team_id` is optional on create and defaults to the first Team. An unknown `team_id` is refused.
- **Options** can be sent as strings or as `{ value, archived }`. An option is never removed; it is archived. Archived options can be restored.
- **Making a Field not required** is allowed (4.6 only names "make required", and the reverse hides nothing from old tickets).
- **Editor page adds name, description and icon** in a "Details" card above the four settings cards of the canvas, because NewType says everything except Field Keys can change later and the canvas editor has no place for them.
- **Archive** has an Undo in the toast instead of a confirm dialog. The editor page also shows the Restore button on an archived type. The "Archived in version N" text on the canvas is shortened to "Archived", because the API returns only the newest version.
- **Navigation:** "Types and fields" (Admin only, `/admin/types`) is a flat item before Settings. The canvas "Admin" group heading is not built, because other issues add Admin items and a shared heading belongs to the lead's merge.

- **Audit entries for type changes (added by the Admin audit change).** `type_created` (after: name, prefix, `team_id`); `type_settings_changed` (one entry, before/after hold only the changed settings); `schema_version_created` (before: version; after: version plus added, renamed, archived, restored Fields and options by key); `type_archived`; `type_restored`.

## Glossary terms to add

- **Archived (Ticket Type)**: a type that takes no new tickets. Old tickets keep it, its prefix stays reserved, and an Admin can restore it. Not the same as an archived Field or option, which stays in the Schema Version but is not asked for on new tickets.

## Notes for later issues

- **Audit log:** done. Type changes write entries with `subject_type = 'ticket_type'` in `createTicketType` and `updateTicketType`, in the same `db.batch`. Webhook Events (issue 14) have no type events yet.
- **Teams (issue 20).** The "Owning team" select uses `GET /api/v1/admin/ticket-types` → `teams` (id and name from the `team` table). When issue 20 adds a rule that a Team that owns types cannot be removed, it can count `ticket_type.team_id`; archived types count too, because a restore needs a Team.
- **Type change (issue 08)** must refuse an archived target type (use `loadTicketType(...).archived`), and `listTicketTypes` already leaves archived types out for pickers. Moving a ticket to the newest version of the target type uses `currentSchemaVersion` from `server/utils/ticket-types.ts` (now exported).
- **Applications (issue 12, 13)** list allowed Ticket Types: use `listAdminTypes` or `selectTypes`, and decide there whether an archived type can stay in the list (it takes no new tickets either way).
- **Search and filters (issue 10)** on Field values use the Field Key. Keys never change, and old versions keep archived Fields, so a filter on an archived key still works on old tickets.
- Select Field options are not renamed: a rename would be a new option plus an archived old one, and old tickets keep the old value.
- `ticket.status` joins in the admin counts use `Status Category != 'done'` as "open tickets". If Workflows add categories, review `ticketCounts` in `ticket-type-admin.ts`.
- `test/worker/helpers.ts` still says that the editor comes with issue 07 (`createVisibleType`). It still writes rows directly, which is fine because it needs `visible_to_all` quickly; the REST route can replace it.
- Migration `0004_issue_07_type_archive.sql` adds `ticket_type.archived_at` (nullable). The lead renumbers it at merge.

## Blocked by

- [05 · Roles, policy, and the agent queue](05-roles-and-agent-queue.md)
