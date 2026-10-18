import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/lib/errors";
import {
	buildAdditions,
	getSnapshot,
	publishSnippet,
	validatePublish,
	type PublishInput,
	type Snapshot,
} from "../src/lib/github";

const head = "a".repeat(40);
const input: PublishInput = {
	epoch: 1792315800,
	body: "some **words**. नमस्ते 🌱",
	collection: "mine",
	expectedHead: head,
	requestId: "0e8cc16b-5e40-4ba8-830d-328198390038",
};
const collection = {
	folder: "mine",
	name: "my own words",
	description: "words i said.",
	permalink: "thoughts",
};
const snapshot = (): Snapshot => ({
	head,
	collections: [collection],
	files: new Set(["src/content/snippets/mine/_collection.json"]),
});
const decode = (value: string) => Buffer.from(value, "base64").toString("utf8");

test("publishes UTF-8 Markdown under the folder, independently of its public permalink", () => {
	const files = buildAdditions(validatePublish(input), snapshot());
	assert.equal(files.length, 1);
	assert.equal(files[0].path, "src/content/snippets/mine/1792315800.md");
	assert.equal(decode(files[0].contents), input.body + "\n");
});
test("creates collection metadata and first snippet together", () => {
	const newCollection = {
		name: " little things ",
		description: " things i noticed ",
		permalink: "little-things",
	};
	const files = buildAdditions(
		validatePublish({ ...input, collection: "little-things", newCollection }),
		snapshot()
	);
	assert.equal(files.length, 2);
	assert.deepEqual(JSON.parse(decode(files[0].contents)), {
		name: "little things",
		description: "things i noticed",
		permalink: "little-things",
	});
	assert.equal(files[1].path, "src/content/snippets/little-things/1792315800.md");
});
test("rejects traversal, malformed dates, metadata, empty bodies, and frontmatter", () => {
	for (const patch of [
		{ collection: "../blog" },
		{ collection: "/mine" },
		{ collection: "MINE" },
		{ epoch: 1792315800000 },
		{ epoch: NaN },
		{ epoch: 1792315800.5 },
		{ body: "   " },
		{ body: "---\ndate: 2025\n---\nhi" },
		{ body: "\n---\ncollection: bad\n---\nhi" },
		{ body: "x\0x" },
		{ body: "🌱".repeat(30_000) },
		{ expectedHead: "main" },
		{ requestId: "bad" },
		{ newCollection: { name: "", description: "x", permalink: "mine" } },
		{ newCollection: { name: "ok", description: "ok", permalink: "different" } },
	]) {
		assert.throws(
			() => validatePublish({ ...input, ...patch }),
			AppError,
			JSON.stringify(patch).slice(0, 100)
		);
	}
});
test("rejects duplicate epoch IDs across every collection and duplicate permalinks", () => {
	const state = snapshot();
	state.files.add("src/content/snippets/quotes/1792315800.md");
	assert.throws(() => buildAdditions(input, state), /already uses/);
	assert.throws(
		() =>
			buildAdditions(
				{
					...input,
					collection: "thoughts",
					newCollection: { name: "hi", description: "hi", permalink: "thoughts" },
				},
				snapshot()
			),
		/already exists/
	);
	assert.throws(
		() => buildAdditions({ ...input, collection: "missing" }, snapshot()),
		/no longer exists/
	);
});

function mockGitHub(
	options: {
		head?: string;
		existing?: boolean;
		recovered?: boolean;
		truncated?: boolean;
		race?: boolean;
		verified?: boolean;
	} = {}
) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		const path = String(url);
		calls.push({ url: path, init });
		let data: unknown;
		if (path.includes("/git/ref/")) data = { object: { sha: options.head ?? head } };
		else if (path.includes("/git/trees/"))
			data = {
				truncated: options.truncated ?? false,
				tree: [
					{ type: "tree", path: "src/content/snippets/mine", sha: "folder" },
					{ type: "blob", path: "src/content/snippets/mine/_collection.json", sha: "metadata" },
					...(options.existing
						? [
								{
									type: "blob",
									path: `src/content/snippets/mine/${input.epoch}.md`,
									sha: "snippet",
								},
							]
						: []),
				],
			};
		else if (path.includes("/git/blobs/"))
			data = {
				encoding: "base64",
				content: Buffer.from(JSON.stringify(collection)).toString("base64"),
			};
		else if (path.includes("/commits?"))
			data = [
				{
					sha: "b".repeat(40),
					html_url: "https://github.com/abhigyantrips/abhi.now/commit/b",
					commit: {
						message: `content(snippet): #${input.epoch}\n\nChhotu-Publish-Id: ${options.recovered ? input.requestId : "somebody-else"}`,
						verification: { verified: true, reason: "valid" },
					},
				},
			];
		else if (path.endsWith("/graphql"))
			data = options.race
				? { errors: [{ message: "expected head oid mismatch" }] }
				: {
						data: {
							createCommitOnBranch: {
								commit: {
									oid: "b".repeat(40),
									url: "https://github.com/abhigyantrips/abhi.now/commit/b",
									signature: {
										isValid: options.verified ?? true,
										state: "VALID",
										wasSignedByGitHub: true,
									},
								},
							},
						},
					};
		else throw new Error(`unexpected request: ${path}`);
		return Response.json(data);
	};
	return {
		calls,
		restore: () => {
			globalThis.fetch = original;
		},
	};
}
test("uses a single atomic GraphQL commit with the exact headline and expected head", async () => {
	const mock = mockGitHub();
	try {
		const result = await publishSnippet("test-token", input);
		assert.equal(result.commit.signature?.isValid, true);
		const commits = mock.calls.filter((c) => c.url.endsWith("/graphql"));
		assert.equal(commits.length, 1);
		const payload = JSON.parse(String(commits[0].init?.body)).variables.input;
		assert.deepEqual(payload.branch, {
			repositoryNameWithOwner: "abhigyantrips/abhi.now",
			branchName: "main",
		});
		assert.equal(payload.message.headline, `content(snippet): #${input.epoch}`);
		assert.equal(payload.expectedHeadOid, head);
		assert.equal(payload.fileChanges.additions.length, 1);
		assert.match(payload.message.body, new RegExp(input.requestId));
	} finally {
		mock.restore();
	}
});
test("refuses stale repository state without sending a commit", async () => {
	const mock = mockGitHub({ head: "c".repeat(40) });
	try {
		await assert.rejects(publishSnippet("test-token", input), /repository changed/);
		assert.equal(
			mock.calls.some((c) => c.url.endsWith("/graphql")),
			false
		);
	} finally {
		mock.restore();
	}
});
test("stops safely if the branch moves during commit creation", async () => {
	const mock = mockGitHub({ race: true });
	try {
		await assert.rejects(publishSnippet("test-token", input), /another commit arrived/);
	} finally {
		mock.restore();
	}
});
test("recovers a successful commit after a lost response, even after the branch moved", async () => {
	const mock = mockGitHub({ existing: true, recovered: true, head: "c".repeat(40) });
	try {
		const result = await publishSnippet("test-token", input);
		assert.equal(result.recovered, true);
		assert.equal(
			mock.calls.some((c) => c.url.endsWith("/graphql")),
			false
		);
	} finally {
		mock.restore();
	}
});
test("does not treat a different request’s snippet as a successful retry", async () => {
	const mock = mockGitHub({ existing: true });
	try {
		await assert.rejects(publishSnippet("test-token", input), /already uses/);
		assert.equal(
			mock.calls.some((c) => c.url.endsWith("/graphql")),
			false
		);
	} finally {
		mock.restore();
	}
});
test("rejects truncated repository trees instead of risking an overwrite", async () => {
	const mock = mockGitHub({ truncated: true });
	try {
		await assert.rejects(getSnapshot("test-token"), /incomplete file list/);
	} finally {
		mock.restore();
	}
});
test("reports the real signature status if GitHub returns an unverified commit", async () => {
	const mock = mockGitHub({ verified: false });
	try {
		const result = await publishSnippet("test-token", input);
		assert.equal(result.commit.signature?.isValid, false);
	} finally {
		mock.restore();
	}
});
