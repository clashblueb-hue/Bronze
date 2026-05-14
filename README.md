# Bronze Banner on Cloudflare

This version of Bronze Banner is set up to run as a Cloudflare Worker with a D1 database.

## Project layout

- `public/` contains the game frontend.
- `worker.js` contains the Cloudflare API backend.
- `migrations/0001_init.sql` creates the `users` and `sessions` tables.
- `wrangler.jsonc` wires the Worker, static assets, and D1 binding together.
- `data/` is left in place only as a legacy local backup from the old Node version. The Cloudflare deployment does not use it.

## First-time Cloudflare setup

1. Create the D1 database:

```bash
npx wrangler d1 create bronze-banner-db
```

2. Copy the returned database ID into `wrangler.jsonc` and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

3. Apply the schema to the remote database:

```bash
npm run db:migrate:remote
```

4. Start local development:

```bash
npm run dev
```

Wrangler local dev serves the app at `http://127.0.0.1:8787`.

## Deploy through GitHub + Cloudflare

1. Commit and push this project to the GitHub repo connected to Cloudflare.
2. In Cloudflare, keep the deploy command as `npx wrangler deploy`.
3. Make sure the Worker project is using the repo root as the working directory.
4. If Cloudflare still has an old `JWT_SECRET` secret from the Node version, you can remove it. This Worker no longer uses it.
5. After the deploy finishes, open your custom domain and test:
   - sign up
   - log in
   - save/load progress

## Useful commands

```bash
npm run dev
npm run deploy
npm run db:migrate:local
npm run db:migrate:remote
```

## Notes

- Local D1 data and remote D1 data are separate by default.
- The old `server.js` command path is intentionally disabled so the repo does not accidentally run the outdated file-based backend.
- If you want to migrate old accounts from `data/users.json` into D1 later, that can be done as a one-time import script.
