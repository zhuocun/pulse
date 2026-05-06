# Monorepo migration — remaining manual tasks

Everything that can ship in code is in this branch. The items below need
a human on the Vercel / GitHub dashboards (or local CLI auth) that the
in-repo tooling cannot reach.

Delete this file once every task is checked off.

---

## 1. Repoint the backend Vercel project ✅ done

The `jira-python-server` Vercel project has been re-pointed at this
monorepo with `backend/` as its root directory. Project URL, env vars,
secrets, custom domains, and deployment history were preserved.
Pushes to the tracked branch now deploy the backend automatically.

- [x] Vercel dashboard → `jira-python-server` project → **Settings → Git** → disconnect from `zhuocun/jira-python-server`, connect to `zhuocun/jira-react-app`.
- [x] Vercel dashboard → same project → **Settings → General → Root Directory** → `backend/`. Save.
- [x] **Deployments → Redeploy** the latest production deployment.
- [x] Smoke-check: `curl https://pulse-python-server.vercel.app/api/v1/health` returns 200.

---

## 2. Archive `zhuocun/jira-python-server` 🟡 optional, do last

Only flip this **after** the monorepo's BE deploy has been live and
healthy for at least a few days. Archiving is reversible but it
freezes issues, PRs, and pushes.

- [ ] Confirm a production deploy from `backend/` has been running clean
      (Vercel logs and synthetic checks all green for ≥48h).
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
- [x] BE Vercel project, after the Root Directory change, builds and `GET /api/v1/health` returns 200.
- [ ] `Backend CI` workflow runs green on a PR that touches `backend/**`.
- [ ] FE-only and BE-only PRs trigger only the relevant Vercel project (verify in the Vercel deployments tab).
