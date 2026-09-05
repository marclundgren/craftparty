/**
 * The settings a host can choose while a world is being created. Each one
 * is a server.properties key, and this table is the only place that knows
 * a setting's property name and the values Minecraft actually accepts for
 * it (https://minecraft.wiki/w/Server.properties).
 *
 * Everything else is derived from the table: the WorldConfig types below,
 * the runtime check in parseWorldConfig(), and the lines written into
 * server.properties. Adding a setting is one row here — no second list to
 * keep in sync, and no way for a caller to invent a value ("medium") that
 * Minecraft would quietly reject.
 */

interface EnumSetting {
  kind: "enum";
  property: string;
  values: readonly string[];
  fallback: string;
}

interface BooleanSetting {
  kind: "boolean";
  property: string;
  fallback: boolean;
}

interface TextSetting {
  kind: "text";
  property: string;
  fallback: string;
}

type Setting = EnumSetting | BooleanSetting | TextSetting;

export const WORLD_SETTINGS = {
  difficulty: {
    kind: "enum",
    property: "difficulty",
    values: ["peaceful", "easy", "normal", "hard"],
    fallback: "easy",
  },
  hardcore: {
    kind: "boolean",
    property: "hardcore",
    fallback: false,
  },
  seed: {
    kind: "text",
    property: "level-seed",
    // Blank is meaningful: Minecraft generates a random seed for it.
    fallback: "",
  },
} as const satisfies Record<string, Setting>;

export type Difficulty = (typeof WORLD_SETTINGS.difficulty.values)[number];

/** A host's choices, every field settled and defaults already applied. */
export interface WorldConfig {
  difficulty: Difficulty;
  hardcore: boolean;
  seed: string;
}

/** The same choices as they arrive from the UI — unchecked and partial. */
export type WorldConfigInput = Partial<Record<keyof WorldConfig, unknown>>;

/**
 * Check untrusted input against the table and fill in what wasn't chosen.
 * Throws rather than coercing: a value the table doesn't list means the UI
 * and the engine disagree, and silently starting an easy world because
 * someone sent "medium" hides that bug behind a world the host didn't ask
 * for.
 */
export function parseWorldConfig(input: WorldConfigInput = {}): WorldConfig {
  const config: Record<string, string | boolean> = {};
  for (const [key, setting] of Object.entries(WORLD_SETTINGS)) {
    config[key] = parseSetting(key, setting, input[key as keyof WorldConfig]);
  }
  return config as unknown as WorldConfig;
}

function parseSetting(
  key: string,
  setting: Setting,
  value: unknown,
): string | boolean {
  if (value === undefined || value === null) return setting.fallback;
  switch (setting.kind) {
    case "enum":
      if (typeof value === "string" && setting.values.includes(value)) {
        return value;
      }
      throw new Error(
        `${key} must be one of ${setting.values.join(", ")} — got ${JSON.stringify(value)}`,
      );
    case "boolean":
      if (typeof value === "boolean") return value;
      throw new Error(`${key} must be true or false — got ${JSON.stringify(value)}`);
    case "text": {
      if (typeof value !== "string") {
        throw new Error(`${key} must be text — got ${JSON.stringify(value)}`);
      }
      const clean = value.trim();
      // A line break would close the property early and let the rest of
      // the value write server.properties keys of its own.
      if (/[\r\n]/.test(clean)) {
        throw new Error(`${key} can't contain line breaks`);
      }
      return clean;
    }
  }
}

/** The config as server.properties lines, in table order. */
export function worldConfigProperties(config: WorldConfig): string[] {
  return Object.entries(WORLD_SETTINGS).map(
    ([key, setting]) => `${setting.property}=${config[key as keyof WorldConfig]}`,
  );
}
