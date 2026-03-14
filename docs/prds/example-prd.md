# PRD: User Authentication System

## Overview

Add email/password authentication to the web application, allowing users to register, log in, log out, and access protected routes. This replaces the current unauthenticated access model where all data is public.

## Problem Statement

The application currently has no concept of user identity. All data is globally accessible and anyone can create, edit, or delete content. Users have requested private workspaces, and the business needs to track usage per user for billing purposes.

## Goals

- Users can register with email and password
- Users can log in and receive a session token
- Users can log out, invalidating their session
- Protected routes reject unauthenticated requests with 401
- Existing public routes remain accessible without auth
- Passwords are stored securely (hashed + salted)

## Non-Goals

- No OAuth/social login (future phase)
- No role-based access control (all authenticated users have equal permissions)
- No email verification or password reset flow
- No multi-factor authentication
- No rate limiting on auth endpoints (handled separately)

## Technical Design

### Data Model Changes

**New `users` table:**
```
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
email       VARCHAR(255) UNIQUE NOT NULL
password    VARCHAR(255) NOT NULL  -- bcrypt hash
created_at  TIMESTAMP DEFAULT NOW()
updated_at  TIMESTAMP DEFAULT NOW()
```

**New `sessions` table:**
```
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id     UUID REFERENCES users(id) ON DELETE CASCADE
token       VARCHAR(255) UNIQUE NOT NULL
expires_at  TIMESTAMP NOT NULL
created_at  TIMESTAMP DEFAULT NOW()
```

**Existing tables:** Add `user_id UUID REFERENCES users(id)` foreign key column to all content tables.

### Interface Changes

**New API endpoints:**
- `POST /api/auth/register` — Body: `{ email, password }` → Returns: `{ user, token }`
- `POST /api/auth/login` — Body: `{ email, password }` → Returns: `{ user, token }`
- `POST /api/auth/logout` — Header: `Authorization: Bearer <token>` → Returns: `204`
- `GET /api/auth/me` — Header: `Authorization: Bearer <token>` → Returns: `{ user }`

**Modified middleware:**
- New `authMiddleware` that extracts token from `Authorization` header, validates against sessions table, and attaches `req.user`
- Applied to all routes under `/api/` except `/api/auth/register` and `/api/auth/login`

### Migration Strategy

- Run database migration to create `users` and `sessions` tables
- Add nullable `user_id` column to existing content tables (nullable during transition)
- Create a default "legacy" user account and assign all existing content to it
- After migration, make `user_id` NOT NULL

## Implementation Steps

1. **Create database migration** — Add migration file `migrations/003_add_auth.sql` with the `users` and `sessions` table definitions and the `user_id` column additions to existing tables. Follow the existing migration pattern in `migrations/001_*.sql`.

2. **Add password hashing utility** — Create `src/lib/auth.ts` with `hashPassword(plain)` and `verifyPassword(plain, hash)` functions using bcrypt. Follow the utility pattern in `src/lib/db.ts`.

3. **Create user model** — Add `src/models/user.ts` with `createUser(email, password)`, `findByEmail(email)`, and `findById(id)` functions. Follow the model pattern in `src/models/post.ts`.

4. **Create session model** — Add `src/models/session.ts` with `createSession(userId)`, `findByToken(token)`, and `deleteSession(token)` functions. Sessions expire after 7 days.

5. **Build auth middleware** — Add `src/middleware/auth.ts` that extracts the Bearer token, looks up the session, checks expiry, and attaches `req.user`. Returns 401 if invalid. Follow the middleware pattern in `src/middleware/cors.ts`.

6. **Create auth routes** — Add `src/routes/auth.ts` with register, login, logout, and me endpoints. Register validates email format and password length (8+ chars). Login returns user object without password hash.

7. **Apply middleware to existing routes** — Update `src/routes/index.ts` to apply `authMiddleware` to protected routes. Keep auth routes public.

8. **Add user_id to existing queries** — Update content model queries to filter by `req.user.id`. Ensure users can only see/edit their own content.

9. **Write tests** — Add `tests/auth.test.ts` covering: register with valid/invalid data, login with correct/wrong credentials, logout, accessing protected route with/without token, expired token handling.

10. **Run migration and verify** — Execute migration, run full test suite, manually test the register → login → access → logout flow.

## Validation Criteria

- [ ] Register creates user with hashed password (not plaintext)
- [ ] Login returns valid token that works on subsequent requests
- [ ] Logout invalidates the token (subsequent requests with same token get 401)
- [ ] Expired tokens return 401
- [ ] Protected routes return 401 without token
- [ ] Protected routes return 401 with invalid token
- [ ] Register rejects duplicate emails with 409
- [ ] Register rejects passwords shorter than 8 characters
- [ ] User cannot access another user's content
- [ ] All existing tests still pass
- [ ] Public routes remain accessible without auth

## Anti-Patterns to Avoid

- **Do NOT store plaintext passwords** — Always hash with bcrypt. Never log password values, even in debug mode.
- **Do NOT use JWT for sessions** — This project uses server-side sessions in the database. JWTs cannot be revoked on logout.
- **Do NOT add auth logic in route handlers** — All auth checking goes in middleware. Route handlers assume `req.user` is populated.
- **Do NOT return password hashes in API responses** — Strip the `password` field from user objects before sending to client.
- **Do NOT hardcode session duration** — Use a config constant (`SESSION_TTL_DAYS = 7`) so it can be changed later.

## Patterns to Follow

- **Migration format:** Follow `migrations/001_initial.sql` — plain SQL, one statement per line, comments for sections
- **Model pattern:** Follow `src/models/post.ts` — exported async functions, each takes a db connection parameter
- **Route pattern:** Follow `src/routes/posts.ts` — Express router, try/catch in each handler, consistent error response format `{ error: string }`
- **Middleware pattern:** Follow `src/middleware/cors.ts` — exported function that returns Express middleware
- **Test pattern:** Follow `tests/posts.test.ts` — setup/teardown with test database, descriptive test names
