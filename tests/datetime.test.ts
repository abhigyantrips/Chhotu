import assert from "node:assert/strict";
import test from "node:test";
import { epochFromLocal, localDateTime, slugify } from "../src/lib/editor-utils";
test("converts phone-local datetime to epoch seconds and preserves seconds", () => {
	const previous = process.env.TZ;
	process.env.TZ = "Asia/Kolkata";
	try {
		assert.equal(
			epochFromLocal("2026-10-18T14:00:37"),
			Math.floor(Date.parse("2026-10-18T08:30:37Z") / 1000)
		);
		assert.equal(localDateTime(new Date("2026-10-18T08:30:37Z")), "2026-10-18T14:00:37");
		assert.equal(
			epochFromLocal("2026-10-18T14:00"),
			Math.floor(Date.parse("2026-10-18T08:30:00Z") / 1000)
		);
		for (const invalid of ["", "2026-02-30T14:00", "2000-01-01T00:00", "not a date", "2026-10-18"])
			assert.equal(epochFromLocal(invalid), null);
	} finally {
		if (previous) process.env.TZ = previous;
		else delete process.env.TZ;
	}
});
test("does not silently shift a time skipped by daylight saving", () => {
	const previous = process.env.TZ;
	process.env.TZ = "America/New_York";
	try {
		assert.equal(epochFromLocal("2026-03-08T02:30"), null);
	} finally {
		if (previous) process.env.TZ = previous;
		else delete process.env.TZ;
	}
});
test("suggests safe readable collection permalinks", () => {
	assert.equal(slugify("  Café, little things!  "), "cafe-little-things");
	assert.equal(slugify("../../blog"), "blog");
	assert.equal(slugify("a".repeat(79) + " b"), "a".repeat(79));
});
