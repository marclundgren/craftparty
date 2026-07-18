// The Craftparty addon registry: single source of truth for the
// marketplace page and the /addons.json feed the desktop app reads.
// Addons are server-side Fabric mods — the host's app installs them into
// the world; friends join with completely vanilla Minecraft.

export interface AddonJar {
  filename: string;
  url: string;
}

export interface Addon {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  description: string[];
  version: string;
  /** Jars the host app drops into the world's mods folder (deps included). */
  jars: AddonJar[];
}

const RELEASE = "https://github.com/marclundgren/craftparty/releases/download/addons-v0.1.0";
const FABRIC_API = {
  filename: "fabric-api-0.155.2+26.2.jar",
  url: "https://cdn.modrinth.com/data/P7dR8mSH/versions/lVXlbH4w/fabric-api-0.155.2%2B26.2.jar",
};

export const ADDONS: Addon[] = [
  {
    id: "stay-hydrated",
    name: "Stay Hydrated",
    emoji: "💧",
    tagline: "A thirst meter for your world — keep a water bottle handy.",
    description: [
      "Adds a thirst meter that appears just above your hunger bar. Everyone starts fully hydrated — but not for long.",
      "Drink by using a water bottle (offhand works great). A bottle survives most sips, but eventually empties and needs refilling at any water source, just like vanilla.",
      "Sprinting makes you thirstier. So does standing in the blazing sun — and the two stack. Expect to drink about as much in a Minecraft day as you would in a real one, more if you're always running.",
      "Let it hit zero and you'll slow down, weaken, and start feeling faint. It'll never kill you — but you'll wish you'd packed water.",
    ],
    version: "0.1.0",
    jars: [
      { filename: "craftparty-stay-hydrated-0.1.0.jar", url: `${RELEASE}/stay-hydrated-0.1.0.jar` },
      FABRIC_API,
    ],
  },
  {
    id: "welcome-party",
    name: "Welcome Party",
    emoji: "🎆",
    tagline: "Fireworks and fanfare every time a friend joins.",
    description: [
      "The moment a friend joins your world, the sky lights up: a six-rocket fireworks show bursts around them in party colors.",
      "Everyone sees a golden banner with the new arrival's name — because walking into the party should feel like walking into a party.",
      "Zero setup, zero commands. Install it and every join becomes an event.",
    ],
    version: "0.1.0",
    jars: [
      { filename: "craftparty-welcome-party-0.1.0.jar", url: `${RELEASE}/welcome-party-0.1.0.jar` },
      FABRIC_API,
    ],
  },
];
