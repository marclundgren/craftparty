import type { Metadata } from "next";
import { ADDONS } from "../../lib/addons";

export const metadata: Metadata = {
  title: "Craftparty Marketplace — addons for your world",
  description:
    "Free addons for Craftparty worlds. The host picks them when starting a world — friends join with completely vanilla Minecraft.",
};

export default function Marketplace() {
  return (
    <main>
      <div className="sky sky-short">
        <div className="wrap">
          <nav className="nav" aria-label="Main">
            <a className="logo" href="/">
              Craftparty
            </a>
            <div className="nav-links">
              <a href="/">Home</a>
              <a href="https://github.com/marclundgren/craftparty">GitHub</a>
            </div>
          </nav>
          <section className="hero hero-compact">
            <h1>The Marketplace</h1>
            <p className="lede">
              Free addons that make your world more fun. Pick them in the
              Craftparty app when you start your world — they run on the
              host&apos;s side, so your friends don&apos;t install anything.
              Everyone keeps playing with completely vanilla Minecraft.
            </p>
          </section>
        </div>
        <div className="ground-strip" aria-hidden="true" />
      </div>

      <section className="section">
        <div className="wrap">
          <div className="cards addon-cards">
            {ADDONS.map((addon) => (
              <article className="card addon-card" key={addon.id}>
                <div className="addon-head">
                  <span className="addon-emoji" aria-hidden="true">
                    {addon.emoji}
                  </span>
                  <div>
                    <h3>{addon.name}</h3>
                    <p className="addon-tagline">{addon.tagline}</p>
                  </div>
                </div>
                {addon.description.map((para) => (
                  <p key={para}>{para}</p>
                ))}
                <p className="addon-meta">
                  v{addon.version} · free · works with vanilla Minecraft ·{" "}
                  <a href={addon.jars[0].url}>download the jar</a> for manual
                  installs
                </p>
              </article>
            ))}
          </div>

          <div className="addon-how card">
            <h3>How addons work</h3>
            <p>
              When you host a party, the Craftparty app shows this list under
              <strong> Addons</strong> — tick the ones you want and start your
              world. The app installs them into that world automatically, and
              unticking them removes them next time.
            </p>
            <p>
              Addons run inside the host&apos;s world, so friends who join
              don&apos;t need to install anything at all.
            </p>
            <p className="fineprint">
              Building something fun for parties? The marketplace is young —
              <a href="https://github.com/marclundgren/craftparty"> open an issue on GitHub</a> and
              let&apos;s add your addon.
            </p>
          </div>
        </div>
      </section>

      <footer className="underground">
        <div className="wrap">
          <div className="links">
            <a href="/">Home</a>
            <a href="https://github.com/marclundgren/craftparty">GitHub</a>
          </div>
          <p className="disclaimer">
            NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED
            WITH MOJANG OR MICROSOFT. Minecraft is a trademark of Mojang
            Synergies AB.
          </p>
        </div>
      </footer>
    </main>
  );
}
