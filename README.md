# @sabbour/adaptive-ui-github-pack

[![CI](https://github.com/sabbour/adaptive-ui-github-pack/actions/workflows/ci.yml/badge.svg)](https://github.com/sabbour/adaptive-ui-github-pack/actions/workflows/ci.yml)

An [Adaptive UI](https://github.com/sabbour/adaptive-ui-framework) component pack for **GitHub** integration. Provides authentication via OAuth Device Flow, repository management, and pull request creation with generated artifacts.

## Components

| Component | Props | Description |
|-----------|-------|-------------|
| `githubLogin` | `title?`, `description?` | OAuth Device Flow sign-in. Sets `__githubToken` and `__githubUser`. Shows confirmation if already signed in. |
| `githubPicker` | `api`, `bind`, `label?`, `labelKey?`, `valueKey?`, `descriptionKey?`, `includePersonal?`, ... | Dropdown that fetches options from the GitHub API. Auto-paginates up to 300 items. Use for orgs, repos, branches. |
| `githubQuery` | `api`, `bind`, `method?`, `body?`, `confirm?`, `loadingLabel?`, `showResult?` | GitHub API caller for write operations (POST/PUT/PATCH/DELETE) with user confirmation. |
| `githubRepoInfo` | `repo` | Rich repository card showing name, description, language, stars, forks, and issues. |
| `githubCreatePR` | `title?`, `baseBranch?`, `owner?`, `repo?`, `commitToSameBranch?` | Creates a PR with all generated artifacts. Handles branch creation, commits, and opening the PR URL. Auto-initializes empty repos. |

## Tools

| Tool | Description |
|------|-------------|
| `github_api_get` | Read-only GitHub REST API queries with auto-pagination (up to 200 items). Slims down responses to essential fields. |

## Intent Resolvers

| Resolver | Description |
|----------|-------------|
| `github-orgs` | Pre-configured `githubPicker` for GitHub organizations (includes personal account) |
| `github-repos` | Pre-configured `githubPicker` for repositories under a selected org/account |

## Installation

```bash
npm install @sabbour/adaptive-ui-github-pack
```

```typescript
import { createGitHubPack } from '@sabbour/adaptive-ui-github-pack';

const githubPack = createGitHubPack();
// Register with your AdaptiveApp
```

## Prerequisites

- User must sign in via the `githubLogin` component (sets `__githubToken` in state)
- A GitHub OAuth App or PAT for Device Flow authentication
- OAuth Device Flow uses `/api/github-oauth/*` paths routed through the Azure Functions proxy (handles CORS for github.com)
- The `githubPicker` tracks `__githubOrgIsPersonal` when a personal account is selected
- The `githubQuery` auto-rewrites `POST /orgs/<user>/repos` → `POST /user/repos` for personal accounts

## License

MIT
