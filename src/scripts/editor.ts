import DOMPurify from "dompurify";
import { marked } from "marked";
import { epochFromLocal, localDateTime, slugify } from "../lib/editor-utils";
import type { Collection, PublishedCommit } from "../lib/github";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>("snippet-form");
const collection = $<HTMLSelectElement>("collection");
const body = $<HTMLTextAreaElement>("body");
const datetime = $<HTMLInputElement>("datetime");
const newFields = $<HTMLFieldSetElement>("new-collection");
const name = $<HTMLInputElement>("collection-name");
const permalink = $<HTMLInputElement>("collection-permalink");
const description = $<HTMLTextAreaElement>("collection-description-input");
const publish = $<HTMLButtonElement>("publish");
const preview = $("preview");
const errorBox = $("publish-error");
const draftStatus = $("draft-status");
const status = $("connection-status");
const success = $("success");
const DRAFT_KEY = "chhotu:snippet-draft:v1";
const COLLECTIONS_KEY = "chhotu:collections:v1";
let authenticated = false;
let busy = false;
let head = "";
let collections: Collection[] = [];
let requestId: string = crypto.randomUUID();
let slugEdited = false;
let previousCollection = "";
let saveTimer: ReturnType<typeof setTimeout>;
type Draft = {
	collection: string;
	body: string;
	datetime: string;
	name: string;
	permalink: string;
	description: string;
	requestId: string;
	slugEdited: boolean;
};

function readLocal<T>(key: string): T | null {
	try {
		const value = localStorage.getItem(key);
		return value ? (JSON.parse(value) as T) : null;
	} catch {
		return null;
	}
}
function writeLocal(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}
function removeLocal(key: string) {
	try {
		localStorage.removeItem(key);
	} catch {
		/* Storage can be disabled. */
	}
}
function draft(): Draft {
	return {
		collection: collection.value,
		body: body.value,
		datetime: datetime.value,
		name: name.value,
		permalink: permalink.value,
		description: description.value,
		requestId,
		slugEdited,
	};
}
function saveDraft() {
	clearTimeout(saveTimer);
	draftStatus.textContent = writeLocal(DRAFT_KEY, draft())
		? "draft saved on this device."
		: "storage is unavailable — keep this page open.";
}
function showError(message: string, link?: string) {
	errorBox.replaceChildren(document.createTextNode(message));
	if (link && link.startsWith("https://github.com/abhigyantrips/abhi.now/")) {
		const a = document.createElement("a");
		a.href = link;
		a.textContent = " check on GitHub ↗";
		a.target = "_blank";
		a.rel = "noopener noreferrer";
		errorBox.append(a);
	}
	errorBox.hidden = false;
}
function updateState() {
	publish.disabled = busy || !authenticated || !navigator.onLine || !head;
	$("sign-out").hidden = !authenticated;
	$("auth-notice").hidden = authenticated;
	status.hidden = navigator.onLine;
	status.textContent = navigator.onLine ? "" : "offline. keep writing; publish when you’re back.";
}
function updateNewFields() {
	const isNew = collection.value === "__new__";
	newFields.hidden = !isNew;
	newFields.disabled = !isNew;
	name.required = permalink.required = description.required = isNew;
	$("add-collection").textContent = isNew ? "cancel new collection" : "+ new collection";
	$("collection-description").textContent = isNew
		? "created together with your first snippet."
		: (collections.find((c) => c.folder === collection.value)?.description ?? "");
}
function fillCollections(selected = collection.value) {
	collection.replaceChildren(new Option("choose a collection…", ""));
	for (const c of collections) collection.add(new Option(c.name, c.folder));
	collection.add(new Option("+ new collection", "__new__"));
	collection.value = [...collection.options].some((o) => o.value === selected) ? selected : "";
	updateNewFields();
}
function updateDetails() {
	const count = body.value.trim() ? body.value.trim().split(/\s+/u).length : 0;
	$("word-count").textContent = `${count} ${count === 1 ? "word" : "words"}`;
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	$("timezone").textContent = `it's in your local time (${zone}).`;
	$("permalink-preview").textContent = permalink.value || "little-observations";
	datetime.setCustomValidity(
		epochFromLocal(datetime.value) === null ? "choose a valid local date and time (2001–2286)." : ""
	);
}
function renderPreview() {
	preview.innerHTML = DOMPurify.sanitize(marked.parse(body.value, { async: false, gfm: true }), {
		USE_PROFILES: { html: true },
		FORBID_TAGS: [
			"style",
			"form",
			"input",
			"button",
			"textarea",
			"select",
			"iframe",
			"object",
			"embed",
			"video",
			"audio",
		],
		FORBID_ATTR: ["style", "id", "name"],
	});
	if (!body.value.trim()) {
		const p = document.createElement("p");
		p.className = "text-(--color-text-muted)";
		p.textContent = "your words will appear here.";
		preview.append(p);
	}
}
function switchView(showPreview: boolean) {
	body.hidden = showPreview;
	preview.hidden = !showPreview;
	for (const [id, active] of [
		["write-tab", !showPreview],
		["preview-tab", showPreview],
	] as const) {
		$(id).classList.toggle("active", active);
		$(id).setAttribute("aria-pressed", String(active));
	}
	if (showPreview) renderPreview();
}
class RequestError extends Error {
	constructor(
		message: string,
		public status: number,
		public link?: string
	) {
		super(message);
	}
}
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(path, {
		...init,
		credentials: "same-origin",
		cache: "no-store",
		signal: AbortSignal.timeout(60_000),
	});
	const data = await response.json();
	if (!response.ok)
		throw new RequestError(
			data.error ?? "something went wrong. please try again.",
			response.status,
			data.link
		);
	return data as T;
}
function sessionStatus() {
	const renew = () =>
		api<{ authenticated: boolean; configured: boolean }>("/api/session", { method: "POST" });
	// Refresh tokens rotate on use; serialize renewal across tabs/PWA windows.
	return navigator.locks ? navigator.locks.request("chhotu:github-session", renew) : renew();
}
async function loadCollections() {
	const selected = collection.value;
	const result = await api<{ head: string; collections: Collection[] }>("/api/collections");
	collections = result.collections;
	head = result.head;
	writeLocal(COLLECTIONS_KEY, collections);
	fillCollections(selected);
	$("refresh-collections").hidden = true;
	updateState();
}
async function connect() {
	if (!navigator.onLine) {
		updateState();
		return;
	}
	try {
		const session = await sessionStatus();
		authenticated = session.authenticated;
		if (authenticated) await loadCollections();
	} catch (error) {
		head = "";
		if (error instanceof RequestError && error.status === 401) authenticated = false;
		showError(error instanceof Error ? error.message : "couldn’t connect. your draft is safe.");
		$("refresh-collections").hidden = false;
	}
	updateState();
}
function changed() {
	requestId = crypto.randomUUID();
	errorBox.hidden = true;
	success.hidden = true;
	updateDetails();
	if (!preview.hidden) renderPreview();
	clearTimeout(saveTimer);
	saveTimer = setTimeout(saveDraft, 250);
}

// The only stored data is your draft and collection metadata, never OAuth tokens.
const cached = readLocal<Collection[]>(COLLECTIONS_KEY);
if (Array.isArray(cached))
	collections = cached.filter(
		(c) =>
			c &&
			typeof c.folder === "string" &&
			typeof c.name === "string" &&
			typeof c.permalink === "string" &&
			typeof c.description === "string"
	);
const saved = readLocal<Draft>(DRAFT_KEY);
fillCollections(saved?.collection);
datetime.value = localDateTime();
if (saved && typeof saved.body === "string") {
	body.value = saved.body;
	datetime.value = saved.datetime || localDateTime();
	name.value = saved.name ?? "";
	permalink.value = saved.permalink ?? "";
	description.value = saved.description ?? "";
	if (typeof saved.requestId === "string" && /^[a-f0-9-]{36}$/.test(saved.requestId))
		requestId = saved.requestId;
	slugEdited = !!saved.slugEdited;
	draftStatus.textContent = "picked up where you left off.";
}
updateNewFields();
updateDetails();
updateState();
void connect();

form.addEventListener("input", changed);
form.addEventListener("change", () => {
	updateNewFields();
	changed();
});
name.addEventListener("input", () => {
	if (!slugEdited) {
		permalink.value = slugify(name.value);
		updateDetails();
	}
});
permalink.addEventListener("input", () => {
	slugEdited = true;
});
collection.addEventListener("change", () => {
	if (collection.value !== "__new__") previousCollection = collection.value;
});
$("add-collection").addEventListener("click", () => {
	if (collection.value === "__new__") collection.value = previousCollection;
	else {
		previousCollection = collection.value;
		collection.value = "__new__";
	}
	updateNewFields();
	changed();
	if (!newFields.hidden) name.focus();
});
$("use-now").addEventListener("click", () => {
	datetime.value = localDateTime();
	changed();
});
$("write-tab").addEventListener("click", () => switchView(false));
$("preview-tab").addEventListener("click", () => switchView(true));
$("refresh-collections").addEventListener("click", () => {
	errorBox.hidden = true;
	void connect();
});
body.addEventListener("invalid", () => switchView(false));
form.addEventListener("submit", async (event) => {
	event.preventDefault();
	if (busy || !authenticated || !head || !navigator.onLine) return;
	if (!body.value.trim()) {
		switchView(false);
		body.focus();
		showError("write a little something first.");
		return;
	}
	const epoch = epochFromLocal(datetime.value);
	if (epoch === null) {
		datetime.reportValidity();
		return;
	}
	const creating = collection.value === "__new__";
	const folder = creating ? permalink.value : collection.value;
	if (new TextEncoder().encode(body.value).length > 100_000) {
		showError("this snippet is too large. use at most 100 KB of Markdown.");
		return;
	}
	const payload = {
		epoch,
		body: body.value,
		collection: folder,
		expectedHead: head,
		requestId,
		...(creating
			? {
					newCollection: {
						name: name.value,
						description: description.value,
						permalink: permalink.value,
					},
				}
			: {}),
	};
	saveDraft();
	busy = true;
	form.inert = true;
	form.setAttribute("aria-busy", "true");
	$("publish-label").textContent = "publishing…";
	updateState();
	errorBox.hidden = true;
	try {
		const session = await sessionStatus();
		if (!session.authenticated)
			throw new RequestError(
				"sign in with GitHub to publish. your draft is saved on this device.",
				401
			);
		const result = await api<{ commit: PublishedCommit; recovered: boolean }>("/api/publish", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		const verified = !!result.commit.signature?.isValid;
		success.replaceChildren(
			document.createTextNode(
				verified
					? "out in the world. ✓ verified commit. "
					: "published. check the commit’s signature on GitHub. "
			)
		);
		const commitLink = document.createElement("a");
		commitLink.href = result.commit.url;
		commitLink.textContent = "view commit ↗";
		commitLink.target = "_blank";
		commitLink.rel = "noopener noreferrer";
		success.append(commitLink);
		const liveLink = document.createElement("a");
		liveLink.href = `https://abhi.now/snippets/${creating ? permalink.value : collections.find((c) => c.folder === folder)!.permalink}#${epoch}`;
		liveLink.textContent = "view snippet ↗";
		liveLink.target = "_blank";
		liveLink.rel = "noopener noreferrer";
		liveLink.className = "ml-3";
		success.append(liveLink);
		const note = document.createElement("p");
		note.className = "mt-2 text-sm";
		note.textContent = "it’ll appear on abhi.now after the site finishes deploying.";
		success.append(note);
		success.hidden = false;
		removeLocal(DRAFT_KEY);
		body.value = "";
		name.value = "";
		permalink.value = "";
		description.value = "";
		slugEdited = false;
		datetime.value = localDateTime();
		requestId = crypto.randomUUID();
		switchView(false);
		updateDetails();
		draftStatus.textContent = "a fresh page. what’s next?";
		try {
			await loadCollections();
			collection.value = folder;
			updateNewFields();
		} catch {
			head = "";
			$("refresh-collections").hidden = false;
		}
		success.scrollIntoView({ behavior: "smooth", block: "nearest" });
	} catch (error) {
		if (error instanceof RequestError) {
			showError(error.message, error.link);
			if (error.status === 401) authenticated = false;
			if (error.status === 409) {
				try {
					await loadCollections();
				} catch {
					head = "";
					$("refresh-collections").hidden = false;
				}
			}
		} else
			showError(
				"couldn’t confirm the publish. your draft is saved. retry without changing it to check for the original commit."
			);
	} finally {
		busy = false;
		form.inert = false;
		form.removeAttribute("aria-busy");
		$("publish-label").textContent = "publish";
		updateState();
	}
});
$("clear-draft").addEventListener("click", () => {
	const dialog = $<HTMLDialogElement>("clear-dialog");
	dialog.returnValue = "cancel";
	dialog.showModal();
});
$("clear-dialog").addEventListener("close", () => {
	if ($<HTMLDialogElement>("clear-dialog").returnValue !== "clear") return;
	clearTimeout(saveTimer);
	removeLocal(DRAFT_KEY);
	body.value = "";
	name.value = "";
	permalink.value = "";
	description.value = "";
	datetime.value = localDateTime();
	slugEdited = false;
	requestId = crypto.randomUUID();
	if (collection.value === "__new__") collection.value = previousCollection;
	errorBox.hidden = true;
	success.hidden = true;
	switchView(false);
	updateNewFields();
	updateDetails();
	draftStatus.textContent = "a fresh page.";
	body.focus();
});
$("sign-out").addEventListener("click", async () => {
	if (busy) return;
	saveDraft();
	try {
		await api("/auth/logout", { method: "POST" });
		authenticated = false;
		head = "";
		updateState();
		location.href = "/";
	} catch {
		showError("couldn’t sign out. check your connection and try again.");
	}
});
window.addEventListener("online", () => {
	void connect();
});
window.addEventListener("offline", updateState);
window.addEventListener("pagehide", () => {
	if (body.value || name.value) saveDraft();
});
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "hidden" && (body.value || name.value)) saveDraft();
});
window.addEventListener("beforeunload", (event) => {
	if (busy) event.preventDefault();
});
