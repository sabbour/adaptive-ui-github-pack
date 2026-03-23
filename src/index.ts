import type { ComponentPack } from '@sabbour/adaptive-ui-core';
import { GitHubLogin, GitHubQuery, GitHubRepoInfo, GitHubPicker, GitHubCreatePR } from './components';
import { GitHubSettings } from './GitHubSettings';
import { getStoredToken } from './auth';
import { trackedFetch } from '@sabbour/adaptive-ui-core';

/** Parse the GitHub Link header to extract the "next" page URL */
function parseLinkNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

// ─── GitHub Component Pack ───
// Provides GitHub API integration: authentication, repo queries, and issue/PR management.
//
// Prerequisites:
// - Set `__githubToken` in state with a valid GitHub Personal Access Token (PAT)
//   (the githubLogin component handles this)

const GITHUB_SYSTEM_PROMPT = `
GITHUB PACK:

RUNTIME BEHAVIOR:
- Past turns render as read-only snapshots in disabled context. Component side effects are suppressed there.
- If you need fresh API-loaded UI (pickers/repo cards/PR actions), emit those components in the CURRENT active turn.

TOOLS (inference-time, LLM sees results):
- github_api_get: Read-only GitHub API. Use ONLY when you need data to reason about (check files, read configs). NOT for selection lists. Requires sign-in.

COMPONENTS (use in "ask" as {type:"component",component:"name",props:{}}):

githubLogin — {title?,description?}
  Sign-in via OAuth Device Flow. Sets __githubToken + __githubUser. Shows green confirmation if already signed in. Self-managed — omit "next". Show FIRST when GitHub needed.

githubQuery — {api,bind,method?,body?,loadingLabel?,showResult?,confirm?}
  GitHub API caller for WRITES (POST/PUT/PATCH/DELETE) with user confirmation. NOT for reads.
  IMPORTANT: Place githubQuery as a DIRECT child node in the layout. Do NOT wrap it inside a button onClick — buttons only support sendPrompt/setState actions, not component rendering.
  The component renders its own confirmation UI with an "Execute" button when confirm is true or a string.
  Set confirm to a string to customize the button label (e.g. confirm:"Create Repository").
  Examples:
  - Create repo: {type:"githubQuery", api:"/user/repos", method:"POST", body:"{\\\"name\\\":\\\"{{state.githubRepo}}\\\",\\\"private\\\":true}", bind:"repoCreateResult", confirm:"Create Repository", loadingLabel:"Creating repository..."}
  - Create org repo: {type:"githubQuery", api:"/orgs/{{state.githubOrg}}/repos", method:"POST", body:"{\\\"name\\\":\\\"{{state.githubRepo}}\\\",\\\"private\\\":true}", bind:"repoCreateResult", confirm:"Create Repository"}
  IMPORTANT: For personal accounts (when githubOrg equals the logged-in username), use api:"/user/repos" instead of "/orgs/...". The org picker marks personal accounts with "(personal)" in the label.
  - Set default branch: {type:"githubQuery", api:"/repos/{{state.githubOrg}}/{{state.githubRepo}}", method:"PATCH", body:"{\\\"default_branch\\\":\\\"{{state.branch}}\\\"}", bind:"branchResult", confirm:"Set Default Branch"}

githubPicker — {api,bind,label?,labelKey?,valueKey?,descriptionKey?,labelBind?,loadingLabel?,includePersonal?}
  Dropdown fetching from GitHub API at render time. Auto-paginates (up to 300). ALWAYS use for orgs/repos/branches — never use github_api_get for selection lists.
  Examples:
  - Orgs: {type:"githubPicker", api:"/user/orgs", bind:"githubOrg", label:"GitHub account", labelKey:"login", valueKey:"login", includePersonal:true}
  - Repos: {type:"githubPicker", api:"/users/{{state.githubOrg}}/repos?sort=updated&type=owner", bind:"githubRepo", label:"Repository", labelKey:"name", valueKey:"name", descriptionKey:"description"}
  NOTE: Use /users/ (not /orgs/) — it works for both personal accounts and organization members.
  - Personal repos: {type:"githubPicker", api:"/user/repos?sort=updated&type=owner", bind:"githubRepo", label:"Repository", labelKey:"name", valueKey:"name"}
  - Branches: {type:"githubPicker", api:"/repos/{{state.githubOrg}}/{{state.githubRepo}}/branches", bind:"branch", label:"Branch", labelKey:"name", valueKey:"name"}

githubRepoInfo — {repo:"owner/repo"}
  Rich repo card (name, description, language, stars, forks, issues). Supports {{state.key}} in repo prop.

githubCreatePR — {title?,baseBranch?,owner?,repo?,commitToSameBranch?}
  Creates PR with all generated artifacts. Shows file list, confirms, creates branch, commits, opens PR URL. Reads owner/repo from props → state (githubOrg/githubRepo) → __githubUser.
  If commitToSameBranch:true, commits directly to baseBranch and skips PR creation.
  IMPORTANT: githubCreatePR automatically initializes empty repos (creates a README + main branch) if needed. Do NOT manually initialize repos with githubQuery — just use githubCreatePR directly after repo selection/creation.

RULES:
- NEVER put githubQuery inside a button onClick. Buttons only support actions (sendPrompt, setState), not components.
- For write operations, place githubQuery directly in the layout with confirm set to a descriptive label string.
- Do NOT create custom components for specific operations — use githubQuery with the appropriate API path, method, and body.

Flow: 1) githubLogin if no token → 2) githubPicker for org/repo/branch → 3) github_api_get tool for reads LLM needs → 4) githubQuery for writes → 5) githubCreatePR for committing files`;

export function createGitHubPack(): ComponentPack {
  return {
    name: 'github',
    displayName: 'GitHub',
    components: {
      githubLogin: GitHubLogin,
      githubQuery: GitHubQuery,
      githubRepoInfo: GitHubRepoInfo,
      githubPicker: GitHubPicker,
      githubCreatePR: GitHubCreatePR,
    },
    systemPrompt: GITHUB_SYSTEM_PROMPT,
    settingsComponent: GitHubSettings,
    tools: [
      {
        definition: {
          type: 'function' as const,
          function: {
            name: 'github_api_get',
            description: 'Call the GitHub REST API (GET only). Use ONLY when you need to read data to make decisions (check file existence, read configs, verify structure). Do NOT use for listing repos/orgs/branches for selection — use the githubPicker component instead. Requires the user to have signed in via githubLogin first.',
            parameters: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'GitHub API path starting with /. Example: /repos/owner/repo/issues?state=open&per_page=10',
                },
              },
              required: ['path'],
            },
          },
        },
        handler: async (args: Record<string, unknown>) => {
          const token = getStoredToken();
          if (!token) return 'Error: User is not signed in to GitHub. Show the githubLogin component first.';
          const path = String(args.path);
          const baseUrl = `https://api.github.com${path.startsWith('/') ? '' : '/'}${path}`;
          const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };

          try {
            // Auto-paginate list endpoints (arrays) up to 200 items
            let allData: unknown;
            const firstRes = await trackedFetch(baseUrl, { headers });
            const firstData = await firstRes.json();
            if (!firstRes.ok) return `GitHub API error (${firstRes.status}): ${(firstData as any)?.message ?? JSON.stringify(firstData)}`;

            if (Array.isArray(firstData)) {
              allData = [...firstData];
              let nextUrl = parseLinkNext(firstRes.headers.get('link'));
              while (nextUrl && (allData as unknown[]).length < 200) {
                const pageRes = await trackedFetch(nextUrl, { headers });
                if (!pageRes.ok) break;
                const pageData = await pageRes.json();
                if (!Array.isArray(pageData) || pageData.length === 0) break;
                (allData as unknown[]).push(...pageData);
                nextUrl = parseLinkNext(pageRes.headers.get('link'));
              }
            } else {
              allData = firstData;
            }

            // Slim down array responses to essential fields (GitHub API returns ~5KB per item)
            if (Array.isArray(allData)) {
              allData = (allData as any[]).map(item => {
                // Repos
                if (item.full_name && item.html_url) {
                  return { full_name: item.full_name, name: item.name, description: item.description, language: item.language, visibility: item.visibility, default_branch: item.default_branch, updated_at: item.updated_at };
                }
                // Orgs
                if (item.login && item.url && !item.full_name) {
                  return { login: item.login, description: item.description, avatar_url: item.avatar_url };
                }
                // Issues/PRs
                if (item.number !== undefined && item.title) {
                  return { number: item.number, title: item.title, state: item.state, user: item.user?.login, labels: item.labels?.map((l: any) => l.name), created_at: item.created_at, html_url: item.html_url };
                }
                // Fallback: return as-is
                return item;
              });
            }

            const text = JSON.stringify(allData, null, 2);
            let result = text.length > 30000 ? text.slice(0, 30000) + '\n[truncated]' : text;

            // When listing orgs, remind the LLM to show an org picker before fetching repos
            if (path.match(/^\/user\/orgs\b/i)) {
              result += '\n\nIMPORTANT: Show an org/account picker to the user NOW. Do NOT call github_api_get again for repos in this turn. Wait for the user to select an org first.';
            }

            return result;
          } catch (err) {
            return `Failed to call GitHub API: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      },
    ],
  };
}
