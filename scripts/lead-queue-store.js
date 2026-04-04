const fs = require('node:fs/promises');
const path = require('node:path');

const READ_ONLY_FS_ERROR_CODES = new Set(['EROFS', 'EPERM', 'EACCES']);

function resolveGithubConfig() {
  const token = process.env.LEAD_QUEUE_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
  const repo = process.env.LEAD_QUEUE_GITHUB_REPO || process.env.GITHUB_REPOSITORY || '';
  const branch = process.env.LEAD_QUEUE_GITHUB_BRANCH || 'main';
  return { token, repo, branch };
}

function toGithubApiPath(relativePath) {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function isReadonlyFsError(error) {
  return Boolean(error?.code && READ_ONLY_FS_ERROR_CODES.has(error.code));
}

async function readLocalQueue(relativePath) {
  const fullPath = path.resolve(process.cwd(), relativePath);
  try {
    const raw = await fs.readFile(fullPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function appendToLocalQueue(relativePath, lead) {
  const fullPath = path.resolve(process.cwd(), relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const queuedLeads = await readLocalQueue(relativePath);
  queuedLeads.push(lead);
  await fs.writeFile(fullPath, `${JSON.stringify(queuedLeads, null, 2)}\n`, 'utf8');
}

async function githubRequest(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`GitHub API error (${response.status}): ${text}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

async function readGithubQueue(relativePath, githubConfig) {
  const [owner, repoName] = githubConfig.repo.split('/');
  if (!owner || !repoName) {
    throw new Error('Invalid LEAD_QUEUE_GITHUB_REPO. Expected format: owner/repo');
  }

  const filePath = encodeURIComponent(toGithubApiPath(relativePath));
  const ref = encodeURIComponent(githubConfig.branch);
  const url = `https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}?ref=${ref}`;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${githubConfig.token}`,
      'User-Agent': 'shelters-realty-lead-queue'
    }
  });

  if (response.status === 404) {
    return { queue: [], sha: undefined, owner, repoName, filePath };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub read failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const decoded = Buffer.from(payload.content || '', 'base64').toString('utf8');
  const queue = decoded.trim() ? JSON.parse(decoded) : [];
  return {
    queue: Array.isArray(queue) ? queue : [],
    sha: payload.sha,
    owner,
    repoName,
    filePath
  };
}

async function writeGithubQueue(relativePath, lead, commitMessage, githubConfig) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const file = await readGithubQueue(relativePath, githubConfig);
    file.queue.push(lead);

    const url = `https://api.github.com/repos/${file.owner}/${file.repoName}/contents/${file.filePath}`;
    const body = {
      message: commitMessage || `chore: queue lead into ${toGithubApiPath(relativePath)}`,
      branch: githubConfig.branch,
      content: Buffer.from(`${JSON.stringify(file.queue, null, 2)}\n`, 'utf8').toString('base64')
    };
    if (file.sha) body.sha = file.sha;

    try {
      await githubRequest(url, {
        method: 'PUT',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${githubConfig.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'shelters-realty-lead-queue'
        },
        body: JSON.stringify(body)
      });
      return;
    } catch (error) {
      if (attempt < maxAttempts && (error.status === 409 || error.status === 422)) {
        continue;
      }
      throw error;
    }
  }
}

async function appendLeadToQueue({ queueFile, lead, commitMessage }) {
  const forceGithub = (process.env.LEAD_QUEUE_FORCE_GITHUB || '').toLowerCase() === 'true';
  const githubConfig = resolveGithubConfig();
  const hasGithubConfig = Boolean(githubConfig.token && githubConfig.repo);

  if (forceGithub) {
    if (!hasGithubConfig) {
      throw new Error(
        'LEAD_QUEUE_FORCE_GITHUB=true but GitHub config is missing (LEAD_QUEUE_GITHUB_TOKEN/LEAD_QUEUE_GITHUB_REPO).'
      );
    }
    await writeGithubQueue(queueFile, lead, commitMessage, githubConfig);
    return;
  }

  try {
    await appendToLocalQueue(queueFile, lead);
  } catch (error) {
    if (!isReadonlyFsError(error) || !hasGithubConfig) {
      throw error;
    }
    await writeGithubQueue(queueFile, lead, commitMessage, githubConfig);
  }
}

module.exports = {
  appendLeadToQueue
};
