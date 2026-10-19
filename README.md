# Rizqiva Server

Rizqiva is a telecom offer marketplace in Bangladesh. Users buy recharge/offer bundles through the platform, and a referral + agent-commission system rewards users who bring in business. This repository is the REST API backend.

## Tech Stack

- **Runtime**: Node.js + TypeScript (Run with `tsx`, built with `tsc`)
- **Framework**: Express 5
- **Database**: PostgreSQL via Prisma 7 (schema-first, generated client in `src/generated/prisma`)
- **Auth**: Better Auth (`better-auth`), JWT access/refresh tokens, cookie sessions
- **Payments**: Stripe (checkout sessions + webhooks) and Bkash/Nagad-style manual wallet top-ups
- **Validation**: Zod v4
- **Testing**: Vitest · **Linting**: ESLint · **Package manager**: pnpm

## Setup

```bash
pnpm install
cp .env.example .env        # then fill in real values
pnpm exec prisma migrate deploy   # apply migrations
pnpm exec prisma generate         # regenerate the Prisma client
```

### Environment variables

Required in `.env`:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (e.g. Neon) |
| `BETTER_AUTH_SECRET` | Better Auth secret |
| `BETTER_AUTH_URL` | Base URL of the auth server |
| `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` | JWT secrets |
| `SUPER_ADMIN_NAME` / `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | Seedable super admin account |
| `EMAIL_SENDER_SMTP_*` | SMTP settings for transactional emails |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | Google OAuth |
| `CLOUDINARY_*` | Cloudinary image uploads |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe payments |

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Run the API with hot reload |
| `pnpm build` | Type-check + compile to `dist/` |
| `pnpm start` | Run the compiled server |
| `pnpm seed` | Create the super admin account from env |
| `pnpm migrate` / `generate` / `studio` | Prisma migrate-dev / generate / studio |
| `pnpm test` | Run the Vitest suite |
| `pnpm lint` | Run ESLint |

## Roles & RBAC

Seven roles exist:

| Role | Description |
| --- | --- |
| `SUPER_ADMIN` | System owner, full control |
| `ADMIN` | Business management |
| `MODERATOR` | Content / community moderation |
| `SUPPORTER` | User help, ticket solving |
| `EMPLOYEE` | Limited internal work (orders, data entry) |
| `AGENT` | Sells offers, earns commission |
| `USER` | Primary registered account (buyer) |

The access matrix is centralized in `src/app/constants/rbac.constant.ts`:

- **Create** (`CREATABLE_ROLES_BY_ROLE`):
  - `SUPER_ADMIN` can create `SUPER_ADMIN`, `ADMIN`, `MODERATOR`, `SUPPORTER`, `EMPLOYEE`.
  - `ADMIN` can create `MODERATOR`, `SUPPORTER`, `EMPLOYEE` — never another `ADMIN`.
  - `AGENT` is **not** directly creatable; AGENT accounts are created only by approving an agent application.
  - Public signup always creates a `USER`, regardless of any role sent by the client.
- **Manage** (`MANAGEABLE_ROLES_BY_ROLE`): view details, update profile/status, delete.
  - `SUPER_ADMIN` manages all roles (including other super admins).
  - `ADMIN` manages `MODERATOR`, `SUPPORTER`, `EMPLOYEE`, `AGENT`, `USER` — never `SUPER_ADMIN`, never another `ADMIN`.
- **Change role** (`canChangeRole`): only a `SUPER_ADMIN` may grant/revoke the `SUPER_ADMIN` role; `ADMIN` may change roles only within its management scope (no promotion to/from `ADMIN`/`SUPER_ADMIN`).
- Self-deletion and other self-modifying operations that would escalate privileges are blocked.

### Agent Application flow

1. A logged-in `USER` submits an application via `POST /api/agent-applications`.
2. `SUPER_ADMIN` / `ADMIN` review it via `PATCH /api/agent-applications/:id/review` (approve or reject; a rejection requires a reason).
3. Approval promotes the account to `AGENT` and enables `canEarn`, which unlocks telecom offer sales commission.

### Income rules

- Referral income follows the existing referral/eligibility rules and is available to both `USER` and `AGENT` (see the referral module).
- **Sales commission** (telecom offers) is earned **only by `AGENT`** — commission is credited only when the buyer's account has `canEarn`, which is set exclusively on the AGENT role.

## API Routes

Mounted under `/api` via `src/app/routes/index.ts`:

- `/auth` — Better Auth handlers (signup, sign-in, Google OAuth, session)
- `/users` — staff account management (create staff, list users, update status, change role, soft-delete) — RBAC-guarded
- `/agent-applications` — submit / list / review agent applications
- `/specialties`, `/operators`, `/products` — catalog management
- `/orders` — order placement & lifecycle
- `/referral` — referral application & eligibility
- `/wallet`, `/withdrawals` — balances, transactions, payouts
- Stripe webhook at `/webhook`

## Database & Migrations

Prisma is schema-first: all models live in `prisma/schema/` (`auth.prisma`, `appUser.prisma`, `referral.prisma`, `telecom.prisma`, `enum.prisma`, `agentApplication.prisma`). Migrations are SQL files under `prisma/migrations/` and are applied with `prisma migrate deploy`. The generated client is output to `src/generated/prisma`.

> Note: Neon pooled connection strings can cause `prisma migrate dev` shadow-database issues. If that happens, run migrations against a direct (non-pooler) connection string instead.

## Seeding a Super Admin

```bash
pnpm seed
```

Reads `SUPER_ADMIN_NAME` / `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` from the environment and creates the super admin if one does not already exist.