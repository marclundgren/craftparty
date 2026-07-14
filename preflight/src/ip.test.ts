import test from "node:test";
import assert from "node:assert/strict";
import { classifyIpv4 } from "./ip.ts";

test("classifyIpv4", () => {
  assert.equal(classifyIpv4("8.8.8.8"), "public");
  assert.equal(classifyIpv4("162.196.83.203"), "public");
  assert.equal(classifyIpv4("10.0.0.19"), "private");
  assert.equal(classifyIpv4("172.16.0.1"), "private");
  assert.equal(classifyIpv4("172.31.255.255"), "private");
  assert.equal(classifyIpv4("172.32.0.1"), "public");
  assert.equal(classifyIpv4("192.168.1.1"), "private");
  // RFC 6598 shared address space (CGNAT / tailnet range)
  assert.equal(classifyIpv4("100.64.0.0"), "cgnat");
  assert.equal(classifyIpv4("100.98.135.9"), "cgnat");
  assert.equal(classifyIpv4("100.127.255.255"), "cgnat");
  assert.equal(classifyIpv4("100.128.0.0"), "public");
  assert.equal(classifyIpv4("100.63.255.255"), "public");
  assert.equal(classifyIpv4("127.0.0.1"), "loopback");
  assert.equal(classifyIpv4("169.254.10.10"), "link-local");
  assert.equal(classifyIpv4("999.1.1.1"), "invalid");
  assert.equal(classifyIpv4("1.2.3"), "invalid");
  assert.equal(classifyIpv4("01.2.3.4"), "invalid");
});
