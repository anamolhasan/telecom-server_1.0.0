# Reference → Target Mapping Report

Status: **DRAFT for approval.** No code has been changed for this report.
Reference project: `D:\project\FullStack-Project\PH-Healthcare\PH-Healthcare-server` (abbreviated `REF`).
Target project: `D:\project\FullStack-Project\telecom-app\rizqifybd-server` (abbreviated `TGT`).

This report is source-verified: every REF behavior cites a concrete file/function. Target
equivalents are **inferred** where no telecom requirements doc exists (see §2). All inferred
items and unresolved business decisions are flagged.

---

## 1. Scope & Method

- Goal: reproduce REF's **architecture, execution flow, and cross-cutting patterns** in TGT.
- NOT in scope: copying REF domain models (Doctor/Patient/Appointment/Prescription). Telecom
  domain models are inferred and must be confirmed.
- Method: read-only file inspection of both projects. `tsc`/lint not yet run against REF.
- Abbreviation: `REF/<path>` = file under PH-Healthcare-server; `TGT/<path>` = file under rizqifybd-server.

---

## 2. Assumptions (require confirmation)

No telecom requirements doc exists. TGT only has `README.md` (roles) and `ROLE.md` (statuses).
The following inferred feature set is used for mapping and **must be validated**:

| Inferred Target concept | Evidence |
|---|---|
| Buyers = `USER`; sellers/earners = `AGENT` | `TGT/README.md:24-27` |
| Ops roles = `SUPER_ADMIN`, `ADMIN`, `SUPPORT`, `STAFF` | `TGT/README.md:16-23`, `TGT/prisma/schema/enum.prisma:1-8` |
| Lifecycle statuses = ACTIVE/INACTIVE/PENDING/SUSPENDED/BLOCKED/VERIFIED/DELETED | `TGT/ROLE.md`, `TGT/prisma/schema/enum.prisma:10-18` |
| Wallet/earnings per user (`balance`, `totalEarned`, `canEarn`) | `TGT/prisma/schema/appUser.prisma:14-17` |
| Referral tree (`referredBy`, `referrals`) | `TGT/prisma/schema/appUser.prisma:19-22` |
| Telecom operators GP / Robi / Airtel | `TGT/package.json:19-23` |
| Stripe payments intended | `TGT/package.json:16` (`stripe:webhook`), env keys per audit |
| Software architecture = REF's modular express + better-auth + Prisma | REF structure |

---

## 3. Architecture & Infrastructure Mapping

| Concern | REF source (verified) | Target equivalent | Action |
|---|---|---|---|
| Express app entry | `REF/src/app.ts` | `TGT/src/app.ts` (mounts `/api/v1/`, `/` health) | Adapt |
| Server bootstrap | `REF/src/server.ts` (calls `seedSuperAdmin`) | `TGT/src/server.ts` | Add seed call |
| Router aggregation | `REF/src/app/routes/index.ts` (`IndexRoutes`) | `TGT/src/app/routes/index.ts` (`IndexRouters`, **empty**) | Implement |
| Route prefix | mounted at `/api/v1` | `/api/v1/` (already wired in `TGT/src/app.ts`) | Keep |
| better-auth handler | `REF/src/app/lib/auth.ts` | `TGT/src/app/lib/auth.ts` (mounted at `/api/auth`) | Verify parity |
| Prisma client | `REF/src/app/lib/prisma.ts` | `TGT/src/app/lib/prisma.ts` | Compare |
| Env config | `REF/src/app/config/env.ts` | `TGT/src/app/config/*` | Compare/complete |
| Response helper | `REF/src/app/shared/sendResponse.ts` | `TGT/src/app/shared/sendResponse.ts` | Verify |
| Async wrapper | `REF/src/app/shared/catchAsync.ts` | `TGT/src/app/shared/catchAsync.ts` | Verify |
| Stripe client | `REF/src/app/config/stripe.config.ts` (`new Stripe(envVars.STRIPE.STRIPE_SECRET_KEY)`) | `TGT` has env keys + `stripe:webhook` script but **stripe dep missing** | Add dep + config |
| Cloudinary | `REF/src/app/config/cloudinary.config.ts` (`uploadFileToCloudinary`, `deleteFileFromCloudinary`) | None | Add if file uploads needed |
| Multer | `REF/src/app/config/multer.config.ts` | None | Add if file uploads needed |
| EJS templates | `REF/src/app.ts` view engine; used by `utils/email.ts` | None | Add if templated email needed |
| Cron | `REF/src/app.ts` (scheduled job) | None | Only if TGT needs scheduled jobs |

TGT infrastructure **stubs that are currently empty and must be implemented** (verified):
`middleware/{globalErrorHandler,notFound,validateRequest}.ts`, `utils/{jwt,token,email,seed,QueryBuilder}.ts`,
`errorHelpers/*`.

---

## 4. Cross-Cutting Patterns

### 4.1 Authentication middleware (`checkAuth`)
- REF: `REF/src/app/middleware/checkAuth.ts` — verifies better-auth session, optionally verifies
  `accessToken`, attaches `req.user`, enforces `...authRoles`, calls `next()`.
- TGT: `TGT/src/app/middleware/checkAuth.ts` is **WIP and broken**:
  - Syntax error line 52 → `tsc` reports `TS1109: Expression expected` (verified).
  - Uses `expireAt` field; schema field is `expiresAt` (`TGT/prisma/schema/auth.prisma:30`).
  - Empty `catch {}` swallows all errors; never calls `next()` → requests hang.
- Action: **rewrite** TGT `checkAuth` using REF pattern, adapted to TGT session model. Preserve TGT's
  WIP session-refresh header idea (`X-Session-Refresh`) if desired.

### 4.2 JWT / token / cookie
- REF layers custom JWT on top of better-auth via `REF/src/app/utils/jwt.ts` (`jwtUtils.createToken/
  verifyToken/decodeToken`), `REF/src/app/utils/token.ts` (`tokenUtils.getAccessToken/getRefreshToken/
  setAccessTokenCookie/setRefreshTokenCookie/setBatterAuthSessionCookie`), `REF/src/app/utils/cookie.ts`
  (`CookieUtils`).
- TGT: `utils/jwt.ts` + `utils/token.ts` empty; `utils/cookie.ts` **WIP implemented** this session
  (`setCookie/getCookie/clearCookie`) — matches REF `CookieUtils` shape.
- Decision needed: REF's parallel-JWT layer is redundant with better-auth bearer/session. Recommend
  relying on better-auth session + `checkAuth` unless a concrete requirement needs custom JWT.
  `jsonwebtoken` is already a TGT dependency.

### 4.3 Error handling
- REF: `errorHelpers/AppError.ts`, `handleZodError.ts`, `handlePrismaError.ts`, wired into
  `REF/src/app/middleware/globalErrorHandler.ts`; `notFound.ts` for 404.
- TGT: `AppError` exists; `globalErrorHandler`, `notFound`, Zod/Prisma handlers empty.
- Action: port REF handlers, adjust error codes/messages to TGT.

### 4.4 Request validation
- REF: `REF/src/app/middleware/validateRequest.ts` — **has a bug**: calls `next(parsedResult.error)`
  but does not `return`, so it continues executing after a validation failure. Port the *intent*,
  fix the missing early return.
- TGT: Zod is a dependency; `validateRequest.ts` empty.

### 4.5 Query builder (listing/pagination/filter/sort)
- REF: `REF/src/app/utils/QueryBuilder.ts` + `REF/src/app/interfaces/query.interface.ts`.
- Used by e.g. `REF/src/app/module/doctor/doctor.service.ts` `getAllDoctors`.
- TGT: `QueryBuilder.ts` empty. Action: port, then reuse for all TGT list endpoints.

### 4.6 Transactions, idempotency & status transitions
- REF transaction pattern: `prisma.$transaction(async (tx) => {...})`, e.g.
  `REF/src/app/module/review/review.service.ts:40`, `.../prescription/prescription.service.ts:55`,
  `.../user/user.service.ts`.
- REF idempotency: `REF/src/app/module/payment/payment.service.ts`
  `handleStripeWebhookEvent` guards duplicate events via `stripeEventId`.
- These are the closest analogues to TGT orders/wallet and MUST be reused.

### 4.7 Soft delete & schema conventions
- REF models use `id String @id @default(uuid(7))`, `@db.Text`, `@@index([...])`, `@@map("snake_plural")`,
  `onDelete: Cascade`/`onUpdate: Cascade`, and (per auth/doctor schemas) soft-delete
  `isDeleted`/`deletedAt`. Verified in `REF/prisma/schema/review.prisma`, `prescription.prisma`.
- TGT already uses `uuid(7)`, soft delete on `User`/`AppUser`, and `@@map`. Keep TGT convention.

### 4.8 Seed
- REF: `REF/src/app/utils/seed.ts` `seedSuperAdmin`, invoked from `server.ts`.
- TGT: `utils/seed.ts` empty. Action: implement `seedSuperAdmin` for TGT roles.

### 4.9 Email
- REF: `REF/src/app/utils/email.ts` (`sendEmail` via nodemailer + EJS templates). Used by
  prescription flow (`prescription.service.ts:94,274`).
- TGT: `utils/email.ts` empty; `nodemailer`/`ejs` not installed. Needed because
  `requireEmailVerification: true` currently has **no sender** (dead flow).

---

## 5. Module-by-Module Mapping

REF uses `src/app/module/<name>/` (singular). TGT uses `src/app/modules/<name>/` (plural). Keep TGT naming.

| REF module | REF verified behavior | Inferred TGT module/feature | Decision |
|---|---|---|---|
| `auth` | register/login/getMe/google/refresh/change-password/logout/verify-email/forget/reset password | `auth` — extend existing `TGT/src/app/modules/auth` | Adapt (core) |
| `user` | `createDoctor`/`createAdmin` via `signUpEmail` + `$transaction` (privileged role creation) | `user` — admin creates ADMIN/STAFF/SUPPORT/AGENT | Reuse pattern |
| `admin` | list/get/update/delete admins; `changeUserStatus`; `changeUserRole` | `admin` (or `user`) — role/status management matching `ROLE.md` | Merge into user/admin |
| `doctor` | `getAllDoctors` (QueryBuilder), `getDoctorById`, `updateDoctor`, soft `deletedDoctor` | `agent` — agent profile + operator/category listing | Re-model |
| `doctorSchedule` | per-doctor availability CRUD | `inventory`/`offer schedule` (if availability applies) | Confirm need |
| `schedule` | `createSchedule` slot generation (date-fns) | offer/service scheduling (only if time-slotted) | Confirm need |
| `specialty` | simple CRUD (taxonomy) | `operator`/`category` (GP/Robi/Airtel) | Adapt |
| `appointment` | `bookAppointment` (pay-now w/ transaction), `bookAppointmentWithPayLater`, `initiatePayment`, `getMyAppointments`, `changeAppointmentStatus`, `getAllAppointments`, `getMySingleAppointment` | `order` — purchase/recharge with status lifecycle | Adapt (core) |
| `payment` | `handleStripeWebhookEvent` with `stripeEventId` idempotency | `payment`/`wallet` — gateway webhook + ledger | Adapt (core) |
| `review` | `giveReview` gated on `PaymentStatus.PAID`, ownership check, duplicate guard (`appointmentId @unique`), avg-rating recompute in `$transaction`; role-based `myReviews`; update/delete | `review` — product/agent ratings | Optional/confirm |
| `prescription` | `givePrescription` ownership + duplicate guard, PDF gen → Cloudinary → DB update → email, all in `$transaction`; CRUD | `invoice`/`receipt` — PDF + email artifact | Confirm need |
| `stats` | `getDashboardStatsData` role switch (SUPER_ADMIN/ADMIN/DOCTOR/PATIENT), `getPieChartData`, `getBarChartData` (`$queryRaw DATE_TRUNC`) | `stats` — dashboard analytics per role | Adapt |
| `payment.utils.ts` | Stripe helper utils | payment utils | Reuse pattern |

### Core flow detail (most important to reproduce)

**Order lifecycle (from `appointment`/`payment`):**
1. Client calls book/checkout → server creates `order` + `payment` in `$transaction`.
2. If pay-now: `initiatePayment` → Stripe Checkout Session → return URL.
3. Stripe webhook → `handleStripeWebhookEvent`:
   - verify signature (raw body via `express.raw` in `REF/src/app.ts`),
   - idempotency guard on `stripeEventId`,
   - update `payment.status = PAID`, transition order status,
   - **`TODO`**: wallet/commission crediting is not present in REF (healthcare has no wallet). This is a
     TGT-specific extension and requires policy decisions (§7).
4. `changeAppointmentStatus` enforces allowed transitions (verify exact allowed set in REF before porting).

**Duplicate-prevention pattern (from review/prescription):**
- DB-level 1:1 uniqueness (`appointmentId String @unique`) **plus** service-level `findFirst` guard
  returning `AppError(BAD_REQUEST, 'already ... update instead')`.

**Rating recompute pattern (from `review.service.ts:49-65`):**
- `aggregate({ _avg: { rating } })` then update parent entity's `averageRating` inside the same
  `$transaction`.

---

## 6. Dependency Gaps (TGT `package.json`)

Present: `better-auth`, `cookie-parser`, `cors`, `dotenv`, `express@5`, `http-status`,
`jsonwebtoken`, `pg`, `uuid`, `zod`, `@prisma/adapter-pg`, `@prisma/client`.

Missing but needed by mapped patterns (install only after approval):
- `stripe` (payments) — env/scripts already reference it.
- `nodemailer` + `@types/nodemailer` + `ejs` (email/verification).
- `multer` + `@types/multer` (uploads, if required).
- `cloudinary` (uploads, if required).
- `date-fns` (slot generation, if schedules required).
- `node-cron` (scheduled jobs, if required).
- `ms` (token expiry, if custom JWT used).
- `qs` (advanced query parsing for QueryBuilder, if REF uses it — verify).

---

## 7. Unresolved Business Decisions (BLOCKERS — need approval)

These have **no analogue in REF** (healthcare) and must be decided before designing TGT schemas:

1. **Commission model**: how/when `AGENT.totalEarned` increases; flat vs percentage; per operator/offer.
2. **Wallet credits/debits**: what increases/decreases `AppUser.balance`; who can top-up (admin manual vs
   gateway); is `balance` spendable on orders or only withdrawable.
3. **Withdrawal flow**: request/approve/payout states, minimums, KYC gating (`VERIFIED` status).
4. **Refund / failed-payment reversal**: does a refund debit agent commission and user wallet? REF has no
   reversal logic to copy.
5. **Referral rewards**: reward trigger (signup? first purchase?), amount, and relation to `referredBy`.
6. **Order types**: single order model vs recharge/bill/voucher variants; status enum set.
7. **Pricing/operator catalog**: is `specialty` the right analogue for operator/category taxonomy?
8. **Email verification**: enable/disable `requireEmailVerification`; required templates.

---

## 8. Risks & Security Findings Carried Forward

- `TGT/prisma/schema/auth.prisma:5` `phone String @unique` is NOT NULL, but signup
  (`auth.api.signUpEmail` in `TGT/src/app/modules/auth/auth.service.ts:17`) never supplies `phone`
  → registration can fail. Needs schema default/optional or signup change.
- `TGT/src/app/modules/auth/auth.service.ts:32-37` writes `name`/`email` into `AppUser`, but
  `TGT/prisma/schema/appUser.prisma` has **no** `name`/`email` → guaranteed failure. Fix before use.
- `TGT/src/app/modules/auth/auth.controller.ts:45-47` does not export `loginUser`; `auth.route.ts`
  is empty → login endpoint unreachable.
- `requireEmailVerification: true` with no email sender (dead flow).
- WIP `checkAuth.ts` swallows errors / never `next()` (see §4.1).
- `validateRequest.ts` REF bug (missing early return) must not be copied verbatim.
- Stripe webhook requires raw body middleware; ensure TGT registers it before `express.json()`.

---

## 9. Proposed Implementation Order (post-approval)

1. Fix TGT auth correctness blockers (§8 items 1–4) so login/register work.
2. Port infrastructure: `globalErrorHandler`, `notFound`, `validateRequest` (fixed), `sendResponse`.
3. Implement `checkAuth` (REF pattern) + `IndexRouters` wiring; export `loginUser`.
4. Port `QueryBuilder` + query interfaces; port error helpers; implement `seedSuperAdmin`.
5. Confirm §7 decisions → design Prisma schemas (order/payment/wallet/commission).
6. Implement core modules in order: `user`/`admin` → `operator`/`category` → `agent` → `order`/`payment`
   → `wallet`/`withdrawal` → `stats` → optional `review`/`invoice`.
7. Add missing dependencies (§6) only as each feature requires.
8. Verify: `pnpm build` (tsc) + `pnpm lint`, then targeted manual flow tests.

---

## 10. Verification Checklist (for reviewer)

- [ ] §2 inferred features confirmed or corrected.
- [ ] §7 business decisions answered.
- [ ] Whether to adopt REF's parallel JWT layer or rely solely on better-auth (§4.2).
- [ ] Whether review/invoice/schedule modules are needed for TGT.
- [ ] Approval to install missing dependencies (§6).
