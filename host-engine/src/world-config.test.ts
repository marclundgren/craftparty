import test from "node:test";
import assert from "node:assert/strict";
import {
  WORLD_SETTINGS,
  parseWorldConfig,
  worldConfigProperties,
} from "./world-config.ts";

test("an empty config is the vanilla default world", () => {
  const config = parseWorldConfig();
  assert.deepEqual(config, { difficulty: "easy", hardcore: false, seed: "" });
  // Blank seed = Minecraft picks its own, which is what a host who didn't
  // type one expects.
  assert.deepEqual(worldConfigProperties(config), [
    "difficulty=easy",
    "hardcore=false",
    "level-seed=",
  ]);
});

test("every difficulty Minecraft accepts survives a round trip", () => {
  for (const difficulty of WORLD_SETTINGS.difficulty.values) {
    const config = parseWorldConfig({ difficulty });
    assert.equal(config.difficulty, difficulty);
    assert.ok(worldConfigProperties(config).includes(`difficulty=${difficulty}`));
  }
});

test("a difficulty Minecraft doesn't know is refused, not coerced", () => {
  // "medium" is the word people reach for; the property wants "normal".
  assert.throws(
    () => parseWorldConfig({ difficulty: "medium" }),
    /difficulty must be one of peaceful, easy, normal, hard/,
  );
  assert.throws(() => parseWorldConfig({ difficulty: "EASY" }), /must be one of/);
  assert.throws(() => parseWorldConfig({ difficulty: 2 }), /must be one of/);
});

test("hardcore only takes a real boolean", () => {
  assert.equal(parseWorldConfig({ hardcore: true }).hardcore, true);
  assert.ok(
    worldConfigProperties(parseWorldConfig({ hardcore: true })).includes(
      "hardcore=true",
    ),
  );
  // "false" as a string is the classic way to turn hardcore on by accident.
  assert.throws(() => parseWorldConfig({ hardcore: "false" }), /true or false/);
});

test("a seed is kept verbatim apart from surrounding whitespace", () => {
  assert.equal(parseWorldConfig({ seed: "  glacier  " }).seed, "glacier");
  assert.equal(parseWorldConfig({ seed: "-8913466909937400889" }).seed, "-8913466909937400889");
  assert.equal(parseWorldConfig({ seed: "" }).seed, "");
});

test("a seed can't smuggle extra properties into the file", () => {
  assert.throws(
    () => parseWorldConfig({ seed: "x\nonline-mode=false" }),
    /line breaks/,
  );
  assert.throws(() => parseWorldConfig({ seed: "x\r\npvp=false" }), /line breaks/);
});

test("settings map to the property names server.properties uses", () => {
  const properties = worldConfigProperties(
    parseWorldConfig({ difficulty: "hard", hardcore: true, seed: "abc" }),
  );
  assert.deepEqual(properties, [
    "difficulty=hard",
    "hardcore=true",
    // The setting is called "seed" everywhere a human reads it, but the
    // property is level-seed — the table is what bridges the two.
    "level-seed=abc",
  ]);
});
