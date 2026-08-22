const GITHUB_API = "https://api.github.com";

function githubConfig() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || "electricplatypus/Rydr-Extensions";
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not configured. Add a repo-scoped GitHub token as an environment variable (locally in .env, or in the Vercel project's Environment Variables) to enable committing uploads to GitHub."
    );
  }
  const [owner, name] = repo.split("/");
  return { token, owner, name, branch };
}

async function gh(path: string, init?: RequestInit) {
  const { token } = githubConfig();
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

export interface CommitFile {
  path: string;
  content: Uint8Array | string;
}

/**
 * Commits multiple files in one atomic commit via the Git Data API
 * (blob -> tree -> commit -> ref update), so an upload with several
 * extracted files lands as a single commit rather than one per file.
 */
export async function commitFiles(
  message: string,
  files: CommitFile[]
): Promise<{ commitSha: string; commitUrl: string }> {
  const { owner, name, branch } = githubConfig();
  const base = `/repos/${owner}/${name}`;

  const ref = await gh(`${base}/git/ref/heads/${branch}`);
  const baseCommitSha = ref.object.sha;
  const baseCommit = await gh(`${base}/git/commits/${baseCommitSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  const blobs = await Promise.all(
    files.map(async (file) => {
      const content = typeof file.content === "string" ? Buffer.from(file.content, "utf-8") : Buffer.from(file.content);
      const blob = await gh(`${base}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: content.toString("base64"), encoding: "base64" }),
      });
      return { path: file.path, sha: blob.sha };
    })
  );

  const tree = await gh(`${base}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: blobs.map((b) => ({ path: b.path, mode: "100644", type: "blob", sha: b.sha })),
    }),
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
