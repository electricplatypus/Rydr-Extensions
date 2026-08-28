import { MarketplaceItem } from "./types";

const GITHUB_API = "https://api.github.com";

export class GithubApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function githubConfig() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || "electricplatypus/Rydr-Extensions";
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not configured. Add a repo-scoped GitHub token as an environment variable (locally in .env, or in the Vercel project's Environment Variables) — the marketplace reads and writes this repo directly, so it's required even for local dev."
    );
  }
  const [owner, name] = repo.split("/");
  return { token, owner, name, branch };
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function ghRaw(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const { token } = githubConfig();
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  return { status: res.status, body };
}

async function gh(path: string, init?: RequestInit) {
  const { status, body } = await ghRaw(path, init);
  if (status < 200 || status >= 300) {
    throw new GithubApiError(status, `GitHub API ${path} failed: ${status} ${JSON.stringify(body)}`);
  }
  return body as Record<string, any>;
}

/** Retries a read-modify-write cycle once if the branch moved underneath it (409/422 on ref update). */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GithubApiError && (err.status === 409 || err.status === 422)) {
      return fn();
    }
    throw err;
  }
}

async function fetchJsonFile<T>(path: string, fallback: T): Promise<T> {
  const { owner, name, branch } = githubConfig();
  const { status, body } = await ghRaw(`/repos/${owner}/${name}/contents/${encodePath(path)}?ref=${branch}`);
  if (status === 404) return fallback;
  if (status < 200 || status >= 300) {
    throw new GithubApiError(status, `GitHub API fetch of ${path} failed: ${status} ${JSON.stringify(body)}`);
  }
  const content = Buffer.from((body as { content: string }).content, "base64").toString("utf-8");
  return JSON.parse(content) as T;
}

/** Live download counts, keyed by "<category>/<id>" — see getDownloadCounts. */
export type DownloadCounts = Record<string, number>;

/**
 * Fetches data/downloads.json — download counts live here, separate from
 * data/index.json, specifically so a download doesn't touch the same file
 * a real edit does. vercel.json's ignoreCommand skips a rebuild for a
 * commit that only touches this file, since counts are already read live
 * on every request and never needed a redeploy to show up.
 */
export async function getDownloadCounts(): Promise<DownloadCounts> {
  return fetchJsonFile<DownloadCounts>("data/downloads.json", {});
}

/** Fetches data/index.json — the fast-read aggregate of every item's metadata, with live download counts merged in. Returns [] if it doesn't exist yet. */
export async function getIndex(): Promise<MarketplaceItem[]> {
  const [items, downloads] = await Promise.all([
    fetchJsonFile<MarketplaceItem[]>("data/index.json", []),
    getDownloadCounts(),
  ]);
  return items.map((item) => ({
    ...item,
    downloads: downloads[`${item.category}/${item.id}`] ?? item.downloads,
  }));
}

/** Fetches one file's raw bytes via the Contents API. */
export async function getFileBytes(path: string): Promise<Uint8Array> {
  const { owner, name, branch } = githubConfig();
  const { status, body } = await ghRaw(`/repos/${owner}/${name}/contents/${encodePath(path)}?ref=${branch}`);
  if (status !== 200) {
    throw new GithubApiError(status, `GitHub API file fetch failed for ${path}: ${status}`);
  }
  return new Uint8Array(Buffer.from((body as { content: string }).content, "base64"));
}

export interface TreeEntry {
  path: string;
  size: number;
}

/** Lists every blob path under a prefix via one recursive git-tree call. */
export async function listTreePaths(prefix: string): Promise<TreeEntry[]> {
  const { owner, name, branch } = githubConfig();
  const base = `/repos/${owner}/${name}`;
  const ref = await gh(`${base}/git/ref/heads/${branch}`);
  const tree = await gh(`${base}/git/trees/${ref.object.sha}?recursive=1`);
  return (tree.tree as Array<{ path: string; type: string; size?: number }>)
    .filter((entry) => entry.type === "blob" && entry.path.startsWith(prefix))
    .map((entry) => ({ path: entry.path, size: entry.size || 0 }));
}

export interface CommitFile {
  path: string;
  /** null deletes this path from the tree. */
  content: Uint8Array | string | null;
}

/**
 * Commits multiple file changes in one atomic commit via the Git Data API
 * (blob -> tree -> commit -> ref update) against an arbitrary branch. A file
 * with `content: null` is removed from the tree (GitHub's documented way to
 * delete a path when building a tree from a base_tree).
 */
export async function commitFilesToBranch(
  branch: string,
  message: string,
  files: CommitFile[]
): Promise<{ commitSha: string; commitUrl: string }> {
  const { owner, name } = githubConfig();
  const base = `/repos/${owner}/${name}`;

  const ref = await gh(`${base}/git/ref/heads/${branch}`);
  const baseCommitSha = ref.object.sha;
  const baseCommit = await gh(`${base}/git/commits/${baseCommitSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  const treeEntries = await Promise.all(
    files.map(async (file) => {
      if (file.content === null) {
        return { path: file.path, mode: "100644", type: "blob", sha: null };
      }
      const content =
        typeof file.content === "string" ? Buffer.from(file.content, "utf-8") : Buffer.from(file.content);
      const blob = await gh(`${base}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: content.toString("base64"), encoding: "base64" }),
      });
      return { path: file.path, mode: "100644", type: "blob", sha: blob.sha };
    })
  );

  const tree = await gh(`${base}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });

  const commit = await gh(`${base}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [baseCommitSha] }),
  });

  await gh(`${base}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });

  return {
    commitSha: commit.sha,
    commitUrl: commit.html_url || `https://github.com/${owner}/${name}/commit/${commit.sha}`,
  };
}

/** Commits to the configured branch (main) — the direct-write path every existing admin action uses. */
export async function commitFiles(
  message: string,
  files: CommitFile[]
): Promise<{ commitSha: string; commitUrl: string }> {
  const { branch } = githubConfig();
  return commitFilesToBranch(branch, message, files);
}

/**
 * Creates a new branch pointed at `fromSha`, or at the tip of the configured
 * base branch (main) if omitted. Used for the route-maps PR-based submission
 * flow (see src/lib/routeMaps.ts) — unlike every other write in this app,
 * an untrusted public submission must land on a branch for review, never
 * commit straight to main.
 */
export async function createBranch(branchName: string, fromSha?: string): Promise<string> {
  const { owner, name, branch } = githubConfig();
  const base = `/repos/${owner}/${name}`;
  const sha = fromSha || (await gh(`${base}/git/ref/heads/${branch}`)).object.sha;
  await gh(`${base}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
  });
  return sha;
}

export interface PullRequestParams {
  title: string;
  body: string;
  head: string;
  base?: string;
}

/** Opens a pull request from `head` into `base` (defaults to the configured base branch). */
export async function openPullRequest(params: PullRequestParams): Promise<{ number: number; url: string }> {
  const { owner, name, branch } = githubConfig();
  const pr = await gh(`/repos/${owner}/${name}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base || branch,
    }),
  });
  return { number: pr.number, url: pr.html_url };
}
