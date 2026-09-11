# ZKB AI — professional redesign

## What changed

**Bugs fixed**
- `signup.html` had two `name` attributes on the password field (`name="password5"` *and* `name="password"`), which silently broke signup in some browsers. Fixed.
- `SECRET_KEY` was hardcoded in `app.py`. It now reads from the `SECRET_KEY` environment variable (falls back to a dev value locally).
- The app no longer crashes if `GEMINI_API_KEY` is missing — it starts normally and shows a clear in-chat message instead.
- Uploaded files now get a unique name (`uuid` + original extension) instead of the raw filename, so two people uploading `photo.jpg` can't overwrite each other.
- File uploads are now restricted to a safe extension allowlist and capped at 15 MB.
- Messages now have real timestamps stored in the database (`created_at`), instead of only showing whatever time the browser happened to render.
- Removed the unused legacy `index.html` / `/get_response` route that didn't match the rest of the app.

**New / improved**
- Full visual redesign: dark workspace theme, Inter typeface, a distinct amber accent color, and a layout where AI replies read like text (not a chat bubble) similar to how Claude presents responses, while your own messages stay in a bordered bubble.
- Markdown rendering for AI replies (bold, lists, code blocks) via `marked.js`, sanitized with `DOMPurify`.
- Auto-resizing message box, Enter to send / Shift+Enter for a new line.
- A "typing" indicator while the AI is generating a reply.
- Drag-and-drop file upload, plus a removable file chip before sending.
- Toast notifications for errors instead of silent failures.
- A "Clear history" button (deletes your own saved messages).
- Mobile layout: sidebar becomes a slide-out drawer with a top bar toggle.
- Basic account rules: first account created becomes admin, signups are capped at 5 accounts (matching your 5-slot plan), minimum username/password length.

## Running it

1. Copy `.env.example` to `.env` and fill in your real `GEMINI_API_KEY` and a random `SECRET_KEY`.
2. `pip install -r requirements.txt`
3. `python app.py` (or `gunicorn app:app` for production, matching the `Procfile`).

## Still to decide (not built yet)

- Per-user admin powers (resetting another user's password / forcing logout) — the `is_admin` flag now exists on the `User` model as groundwork, but the admin actions themselves aren't wired up yet.
- Auto-logout after 15 minutes of inactivity for non-admin users.
- Multiple separate conversations ("New chat" currently just reloads the same single history — there's no conversation-switching yet).
