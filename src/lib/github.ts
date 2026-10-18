import { BRANCH, CONTENT_ROOT, OWNER, REPO, SLUG } from './config';
import { AppError } from './errors';

export interface Collection { folder: string; name: string; description: string; permalink: string }
export interface Snapshot { head: string; collections: Collection[]; files: Set<string> }
export interface PublishInput { epoch: number; body: string; collection: string; newCollection?: { name: string; description: string; permalink: string }; expectedHead: string; requestId: string }
export interface PublishedCommit { oid: string; url: string; signature: { isValid: boolean; state: string; wasSignedByGitHub: boolean } | null }
const repoPath = `/repos/${OWNER}/${REPO}`;

export async function github<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init, signal: AbortSignal.timeout(20_000),
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'chhotu', 'X-GitHub-Api-Version': '2022-11-28', ...init.headers },
  });
  if (response.status === 401) throw new AppError(401, 'your GitHub session expired. sign in again; your draft is safe.');
  if (response.status === 403 || response.status === 429) throw new AppError(403, 'GitHub refused this request. check app permissions or rate limits, then try again.');
  if (!response.ok) throw new AppError(502, 'GitHub couldn’t complete this request. your draft is safe; please try again.');
  return response.json() as Promise<T>;
}
function fromBase64(value: string) { return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\s/g, '')), c => c.charCodeAt(0))); }
export function toBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export async function getSnapshot(token: string): Promise<Snapshot> {
  const ref = await github<{ object: { sha: string } }>(token, `${repoPath}/git/ref/heads/${BRANCH}`);
  const head = ref.object.sha;
  const tree = await github<{ truncated: boolean; tree: { path: string; type: string; sha: string }[] }>(token, `${repoPath}/git/trees/${head}?recursive=1`);
  if (tree.truncated) throw new AppError(502, 'GitHub returned an incomplete file list. publishing paused to protect your content.');
  const entries = tree.tree.filter(entry => entry.path.startsWith(`${CONTENT_ROOT}/`));
  const metadata = entries.filter(entry => entry.type === 'blob' && new RegExp(`^${CONTENT_ROOT}/[^/]+/_collection\\.json$`).test(entry.path));
  const collections = await Promise.all(metadata.map(async entry => {
    const blob = await github<{ encoding: string; content: string }>(token, `${repoPath}/git/blobs/${entry.sha}`);
    if (blob.encoding !== 'base64') throw new AppError(502, 'couldn’t read collection metadata.');
    const data = JSON.parse(fromBase64(blob.content));
    if (typeof data.name !== 'string' || !data.name.trim() || typeof data.description !== 'string' || !data.description.trim() || typeof data.permalink !== 'string' || !SLUG.test(data.permalink)) throw new AppError(502, 'a collection has invalid metadata. fix it in the main site before publishing.');
    return { folder: entry.path.split('/').at(-2)!, name: data.name, description: data.description, permalink: data.permalink };
  }));
  if (new Set(collections.map(c => c.permalink)).size !== collections.length) throw new AppError(502, 'duplicate collection permalinks found. fix them in the main site first.');
  return { head, collections: collections.sort((a,b) => a.name.localeCompare(b.name)), files: new Set(entries.map(e => e.path)) };
}
export function validatePublish(value: unknown): PublishInput {
  if (!value || typeof value !== 'object') throw new AppError(400, 'invalid snippet.');
  const input = value as PublishInput;
  if (!Number.isInteger(input.epoch) || !/^\d{10}$/.test(String(input.epoch))) throw new AppError(400, 'choose a valid date with a 10-digit epoch timestamp.');
  if (typeof input.body !== 'string' || !input.body.trim() || new TextEncoder().encode(input.body).length > 100_000 || input.body.includes('\0')) throw new AppError(400, 'write something first, using at most 100 KB of Markdown.');
  // Content must remain a Markdown body: Astro's frontmatter may not redefine collection/date.
  if (/^\s*---(?:\r?\n|$)/.test(input.body)) throw new AppError(400, 'start with your words rather than a YAML frontmatter block.');
  if (typeof input.collection !== 'string' || !SLUG.test(input.collection) || input.collection.length > 80) throw new AppError(400, 'choose a valid collection.');
  if (typeof input.expectedHead !== 'string' || !/^[a-f0-9]{40}$/.test(input.expectedHead)) throw new AppError(400, 'refresh your collections before publishing.');
  if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId)) throw new AppError(400, 'invalid publish request. reload and try again.');
  if (input.newCollection !== undefined) {
    const c = input.newCollection;
    if (!c || typeof c.name !== 'string' || !c.name.trim() || c.name.trim().length > 120 || typeof c.description !== 'string' || !c.description.trim() || c.description.trim().length > 500 || typeof c.permalink !== 'string' || !SLUG.test(c.permalink) || c.permalink.length > 80 || input.collection !== c.permalink) throw new AppError(400, 'give your collection a name, description, and lowercase permalink.');
  }
  return input;
}
export function buildAdditions(input: PublishInput, snapshot: Snapshot) {
  const additions: { path: string; contents: string }[] = [];
  if (snapshot.files.has(`${CONTENT_ROOT}/${input.collection}`) && !snapshot.collections.some(c => c.folder === input.collection)) throw new AppError(409, 'that folder already exists. choose another permalink.');
  if ([...snapshot.files].some(path => path.endsWith(`/${input.epoch}.md`))) throw new AppError(409, 'a snippet already uses this timestamp. check it before choosing another time.', `https://github.com/${OWNER}/${REPO}/search?q=${input.epoch}`);
  if (input.newCollection) {
    if (snapshot.collections.some(c => c.folder === input.collection || c.permalink === input.newCollection!.permalink)) throw new AppError(409, 'that collection or permalink already exists. choose it from the list or use another permalink.');
    const { name, description, permalink } = input.newCollection;
    additions.push({ path: `${CONTENT_ROOT}/${input.collection}/_collection.json`, contents: toBase64(JSON.stringify({ name: name.trim(), description: description.trim(), permalink }, null, 2) + '\n') });
  } else if (!snapshot.collections.some(c => c.folder === input.collection)) throw new AppError(400, 'that collection no longer exists. refresh and choose another.');
  additions.push({ path: `${CONTENT_ROOT}/${input.collection}/${input.epoch}.md`, contents: toBase64(input.body.trim() + '\n') });
  return additions;
}
// The UUID lives in the commit body. Retrying a lost response can recover the original commit.
async function recoverPublish(token: string, input: PublishInput): Promise<PublishedCommit | null> {
  const path = `${CONTENT_ROOT}/${input.collection}/${input.epoch}.md`;
  const commits = await github<{ sha: string; html_url: string; commit: { message: string; verification: { verified: boolean; reason: string } } }[]>(token, `${repoPath}/commits?sha=${BRANCH}&path=${encodeURIComponent(path)}&per_page=1`);
  const commit = commits[0];
  if (!commit?.commit.message.endsWith(`Chhotu-Publish-Id: ${input.requestId}`)) return null;
  return { oid: commit.sha, url: commit.html_url, signature: { isValid: commit.commit.verification.verified, state: commit.commit.verification.reason, wasSignedByGitHub: true } };
}
export async function publishSnippet(token: string, input: PublishInput) {
  const snapshot = await getSnapshot(token);
  if (snapshot.files.has(`${CONTENT_ROOT}/${input.collection}/${input.epoch}.md`)) {
    const recovered = await recoverPublish(token, input);
    if (recovered) return { commit: recovered, recovered: true };
  }
  if (snapshot.head !== input.expectedHead) throw new AppError(409, 'the repository changed. collections have been refreshed; review and publish again.');
  const additions = buildAdditions(input, snapshot);
  const result = await github<{ data?: { createCommitOnBranch?: { commit: PublishedCommit } }; errors?: { type?: string; message: string }[] }>(token, '/graphql', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `mutation Publish($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url signature { isValid state wasSignedByGitHub } } } }`, variables: { input: {
      branch: { repositoryNameWithOwner: `${OWNER}/${REPO}`, branchName: BRANCH },
      expectedHeadOid: snapshot.head,
      message: { headline: `content(snippet): #${input.epoch}`, body: `Chhotu-Publish-Id: ${input.requestId}` },
      fileChanges: { additions },
    } } }),
  });
  if (result.errors?.length || !result.data?.createCommitOnBranch?.commit) {
    if (result.errors?.some(e => /expected|head|oid/i.test(e.message))) throw new AppError(409, 'another commit arrived while publishing. review and try again.');
    throw new AppError(422, 'GitHub couldn’t create the commit. check repository permissions and branch rules. your draft is safe.');
  }
  return { commit: result.data.createCommitOnBranch.commit, recovered: false };
}
