# CLAUDE.md — Project Orbit

## Project Overview

**Project Orbit** is a personalized project management web app inspired by Trello and Microsoft Planner, with tailored features for task tracking and risk management. It includes both a frontend and a backend (server-side).

---

## Architecture

- **Frontend**: Web app (SPA) with a Trello-like kanban UI using vertical buckets
- **Backend**: REST API server handling auth, data persistence, and business logic
- **Database**: Stores users, projects, buckets, tasks, risks, and tags

---

## Core Domain Models

### User
- `id`, `email` (hashed SHA-512), `password` (hashed SHA-512)
- `profile_picture`
- `created_at`
- Email validation required on registration
- Forgot password via emailed reset link

### Project
- `id`, `user_id`, `title`, `description`, `picture`
- `tags[]` (unlimited)
- `created_at`
- Contains Buckets
- Has search (keywords + tags)

### Bucket
- `id`, `project_id`, `title`, `description`, `picture`
- `created_at`
- Contains Tasks and Risks
- No limit on number of buckets per project

### Task
- `id`, `bucket_id`, `description`, `picture`
- `priority` (e.g., Low / Medium / High)
- `due_date`
- `tags[]` (unlimited)
- `created_at` (auto-timestamp)

### Risk
- `id`, `bucket_id`, `description`, `photos[]`
- `severity` (1–10), `probability` (1–10), `detectability` (1–10)
- `rpn` = severity × probability × detectability (computed field)
- `solution_description`, `solution_photos[]`
- `status`: `"Open"` | `"Resolved"`
- `tags[]` (unlimited)
- `created_at` (auto-timestamp)

---

## Authentication & Security

- Login via **email + password**
- Passwords stored as **SHA-512 hash** (server-side)
- **Email validation** on registration (abuse protection)
- **Forgot password** flow: send reset link via email
- Future: 2-step verification (not yet implemented)

---

## Key Features

### Project Page
- Vertical bucket layout (kanban-style)
- Add/remove buckets (no limit)
- Add/remove tasks and risks per bucket
- Search within a project by keyword or tag

### Profile Page
- Update profile picture
- Manage account settings

### Tagging System
- Tags can be applied to projects and risks
- No limit on tags per entity

---

## UI Reference

See [Orbit UI Mockups](https://docs.google.com/presentation/d/1YA0EKW7zYAHA08ngRJwE1g2oFy0s4WDU2tBHlBPzDoc/edit?usp=sharing) for design guidance.

The visual style should feel similar to **Trello** and **Microsoft Planner** — clean, column-based, drag-and-drop-friendly.

---

## Coding Guidelines

- All timestamps (`created_at`) are set **automatically on the server** — never trust client-supplied timestamps
- RPN is a **computed/derived field** — always calculate server-side: `rpn = severity * probability * detectability`
- Never store plain-text passwords — always SHA-512 hash before persisting
- Validate email format and uniqueness on registration
- Tag arrays should support unlimited entries with no enforced schema beyond a string label
- Use consistent REST conventions: `GET /projects`, `POST /projects/:id/buckets`, etc.

---

## Folder Structure Suggestion

```
/client          # Frontend SPA
  /components
  /pages
  /store

/server          # Backend API
  /routes
  /controllers
  /models
  /middleware
  /utils

/shared          # Shared types/constants (if applicable)
```

---

## Future Roadmap (Not Yet Implemented)

These features are planned but **out of scope for the current build**:

- [ ] 2-step verification
- [ ] Project sharing (viewer/commenter via link)
- [ ] User assignment to tasks
- [ ] Email reminders
- [ ] AI-based intelligence
- [ ] Calendar integration (Google / Outlook)
- [ ] Mobile app

Do **not** build or scaffold these unless explicitly instructed.

---

## Notes for Claude Code

- When generating API routes, follow the domain model above strictly
- When generating UI components, reference the Trello-like bucket/column layout
- Prioritize security: hash passwords, validate emails, sanitize inputs
- RPN calculation must always be enforced server-side
- Keep tags as a flexible string array — no rigid taxonomy
- Ask before introducing any new third-party libraries not implied by the PRD
