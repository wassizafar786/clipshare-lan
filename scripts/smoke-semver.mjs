/** Unit-ish smoke for semver compare used by update-check. */
import assert from "node:assert/strict";

function compareSemver(a, b) {
  const pa = a.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

assert.equal(compareSemver("0.1.0", "0.1.0"), 0);
assert.equal(compareSemver("0.2.0", "0.1.0"), 1);
assert.equal(compareSemver("0.1.0", "0.2.0"), -1);
assert.equal(compareSemver("v1.0.0", "0.9.9"), 1);
assert.equal(compareSemver("1.0", "1.0.0"), 0);
console.log("smoke-semver: OK");
