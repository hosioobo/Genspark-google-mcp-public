# Remote Google Drive MCP Server

Streamable HTTP MCP server for Google Drive/Docs/Sheets/Slides with per-user OAuth, Firestore token storage, and KMS envelope encryption. Deploys to Cloud Run.

## Entry Points

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | none | Health check |
| POST | `/admin/session/login` | Admin key in JSON body | Start admin session |
| POST | `/admin/session/logout` | Admin session cookie | End admin session |
| GET | `/admin/session/me` | optional | Check admin session |
| POST | `/admin/issue-token` | Admin session cookie | Issue bearer token for user |
| POST | `/admin/rotate-token` | Admin session cookie | Rotate bearer token |
| POST | `/admin/revoke` | Admin session cookie | Revoke user access |
| POST | `/oauth/link` | Admin session cookie | Mint a one-time user OAuth start link |
| GET | `/oauth/short` | one-time ticket query | Short redirect URL for Google OAuth |
| GET | `/oauth/callback` | none | OAuth callback |
| GET/POST | `/mcp` | User token + x-user-id | MCP endpoint |

## MCP Tools

**Auth**: `google_auth.status`, `google_auth.begin`

**Drive**: `drive.search`, `drive.get_metadata`, `drive.read`, `drive.write`, `drive.rename`, `drive.move`, `drive.copy`, `drive.create_folder`, `drive.list_folder_children`

**Workspace**: `docs.read`, `docs.write`, `sheets.read`, `sheets.write`, `slides.read`, `slides.write`

Google Drive/Docs/Sheets/Slides tools require prior Google authorization. If a user has not connected Google yet, tool calls now return a short plain-text auth URL (`/oauth/short`) backed by a one-time start ticket instead of exposing the bearer token in the URL. Uploaded Office spreadsheets are previewed only within a conservative size limit.

## User ID Policy

`x-user-id` header must be lowercase a-z only (e.g. `alice`, `bob`). No numbers, spaces, hyphens, or special characters.

## Setup

```bash
cp .env.example .env   # edit values
npm install
npm run build
npm start
```

## Environment Variables

See `.env.example` for all required variables: `PORT`, `BASE_URL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `KMS_KEY_NAME`, `TOKEN_HASH_PEPPER`, `ADMIN_KEY`, etc.

## Admin UI

- Open `/admin/ui` after startup.
- This public repo does not include the previous private `docs/admin-guide.md`.
- Debug capture routes are disabled by default. Set `ENABLE_DEBUG_UI=true` only for local/internal troubleshooting.

## OAuth Flow

- The admin issues a user bearer token from the manager UI.
- The manager requests a one-time OAuth start link and shares it with the end user.
- The end user completes Google OAuth in their own browser, outside GenSpark.
- Shared OAuth URLs use a one-time ticket; they do not embed the bearer token in the query string.
- The legacy `/oauth/start` route has been retired from the public app surface.

## Data Architecture

- **Firestore**: `users/{userId}`, `users/{userId}/bearers/current`, `users/{userId}/{tokens}/current`
- **Bearer tokens**: Argon2id hashed, never stored in plaintext
- **Refresh tokens**: AES-256-GCM + per-record DEK + Cloud KMS KEK wrapping

## Auth Flow Notes

1. Ask the agent to run `google_auth.status` or directly request `구글 auth 시작`.
2. The server returns a short plain-text Google auth link that can be shown directly in chat.
3. After the user completes OAuth in the browser, retry the original MCP tool call.

## Example

```bash
# Issue token
curl -X POST http://localhost:3000/admin/issue-token \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice"}'

# Call MCP tool
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-user-id: alice" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drive.search","arguments":{"query":"budget"}}}'
```

## Project Structure

```
src/
  index.ts              # Entry point
  config.ts             # Env config loader
  logger.ts             # Structured JSON logger with redaction
  http.ts               # Crypto utilities (argon2, tokens, nonce)
  middleware.ts          # Request context, auth, rate limiting
  types.ts              # All TypeScript interfaces
  clientFactory.ts      # Google API client factory
  mcp/server.ts         # MCP server manager
  repositories/firestoreUserRepository.ts
  services/encryptionService.ts
  services/oauthService.ts
  services/tokenService.ts
  routes/admin.ts
  tools/helpers.ts      # Shared tool utilities
  tools/driveTools.ts
  tools/workspaceTools.ts
```

## Acknowledgements

- This project started from ideas/code in [piotr-agier/google-drive-mcp](https://github.com/piotr-agier/google-drive-mcp), then diverged into a Genspark-focused Streamable HTTP deployment.
- See [`NOTICE`](NOTICE) for third-party attribution details for upstream-derived portions.
