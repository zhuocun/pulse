# Monorepo migration — external follow-up tasks

The repository-side migration work is complete in-tree. The remaining
items below need a human on the Vercel / Fly.io / GitHub dashboards (or
local CLI auth) that the in-repo tooling cannot reach.

Delete this file once every external task is checked off.

---

## 1. Repoint the backend Vercel project ⚠️ required

The existing `jira-python-server` Vercel project must be re-pointed at
this monorepo and told that its source lives under `backend/`. Project
URL, env vars, secrets, custom domains, and deployment history are all
preserved on the same project.

- [ ] Vercel dashboard → `jira-python-server` project → **Settings → Git** → disconnect from `zhuocun/jira-python-server`, connect to `zhuocun/jira-react-app`.
- [ ] Vercel dashboard → same project → **Settings → General → Root Directory** → `backend/`. Save.
- [ ] **Deployments → Redeploy** the latest production deployment.
- [ ] Smoke-check: `curl https://jira-python-server.vercel.app/api/v1/health` returns 200.

CLI alternative (needs a `VERCEL_TOKEN` with access to the project):

```bash
# replace <project-id> with the BE project ID from Vercel dashboard
PROJECT=<project-id>
curl -sS -X PATCH "https://api.vercel.com/v9/projects/$PROJECT" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"rootDirectory":"backend","gitRepository":{"type":"github","repo":"zhuocun/jira-react-app"}}'
```

---

## 2. Enable Fly.io auto-deploy on push 🟡 optional

The workflow file is already configured to deploy on pushes to `main`
when `backend/**` (or the workflow itself) changes. The only remaining
step is adding the GitHub secret that lets GitHub Actions authenticate
to Fly.io.

- [ ] On a machine logged in to both `fly` and `gh`:

    ```bash
    fly tokens create deploy -x 8760h -a jira-python-server \
      | gh secret set FLY_API_TOKEN -R zhuocun/jira-react-app
    ```

- [ ] Open a small PR that touches `backend/**`, merge it, and confirm
      the **Deploy Backend (Fly.io)** workflow runs and succeeds.

---

## 3. Archive `zhuocun/jira-python-server` 🟡 optional, do last

Only flip this **after** the monorepo's BE deploy has been live and
healthy for at least a few days. Archiving is reversible but it
freezes issues, PRs, and pushes.

- [ ] Confirm a production deploy from `backend/` has been running clean
      (Fly logs, Vercel logs, and synthetic checks all green for ≥48h).
- [ ] Confirm nothing is still pulling from the old repo: check
      `git ls-remote https://github.com/zhuocun/jira-python-server.git`
      for recent pushes, plus Slack / docs / notebooks for cached
      `git clone` commands.
- [ ] (Optional, history preservation) Subtree-merge the old repo's
      history into `backend/` so `git blame` keeps working:

    ```bash
    git remote add be-archive https://github.com/zhuocun/jira-python-server.git
    git fetch be-archive
    git subtree add --prefix=backend be-archive/main --squash
    # ...resolve any path collisions, then push
    ```

- [ ] GitHub UI → `zhuocun/jira-python-server` → **Settings → General →
      Archive this repository**. (Or, with a PAT that has `repo`:
      `gh repo archive zhuocun/jira-python-server --yes`.)

---

## Verification checklist (run after each item above)

- [ ] FE Vercel project still builds and serves the app at its existing URL.
- [ ] BE Vercel project, after the Root Directory change, builds and `GET /api/v1/health` returns 200.
- [ ] `npm run deploy:backend` (or the Fly workflow) completes; `fly status -a jira-python-server` shows the new release.
- [ ] `Backend CI` workflow runs green on a PR that touches `backend/**`.
- [ ] FE-only and BE-only PRs trigger only the relevant Vercel project (verify in the Vercel deployments tab).
