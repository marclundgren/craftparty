import DownloadButton, { RELEASES_URL } from "./download-button";

export default function Home() {
  return (
    <main>
      {/* ---- sky ---- */}
      <div className="sky">
        <div aria-hidden="true" className="cloud cloud-1" style={{ top: "4rem" }} />
        <div aria-hidden="true" className="cloud cloud-2" style={{ top: "11rem" }} />
        <div aria-hidden="true" className="cloud cloud-3" style={{ top: "17rem" }} />

        <div className="wrap">
          <nav className="nav" aria-label="Main">
            <a className="logo" href="#">
              Craftparty
            </a>
            <div className="nav-links">
              <a href="#host">How it works</a>
              <a href="#join">Got an invite?</a>
              <a href="#faq">FAQ</a>
              <a href="https://github.com/marclundgren/craftparty-kit">GitHub</a>
            </div>
          </nav>

          <section className="hero">
            <h1>
              Your own Minecraft world.
              <br />
              Just for your friends.
            </h1>
            <p className="lede">
              Craftparty turns your computer into a private Minecraft server.
              One download — no public servers, no port forwarding, no tech
              skills needed. Your world stays on your machine, and only people
              you invite can get in.
            </p>
            <div className="cta-row">
              <DownloadButton />
              <a className="btn btn-secondary" href="#join">
                I got an invite
              </a>
            </div>
            <p className="fineprint">
              Free &amp; open source · Windows &amp; Mac · Everyone needs their
              own Minecraft Java Edition
            </p>
          </section>
        </div>
        <div className="ground-strip" aria-hidden="true" />
      </div>

      {/* ---- hosting: 3 real steps ---- */}
      <section className="section" id="host">
        <div className="wrap">
          <p className="eyebrow">Hosting</p>
          <h2>Three steps to your first party</h2>
          <p className="intro">
            If you can install a game, you can host one. Craftparty handles the
            server, the networking, and the security behind the scenes.
          </p>
          <div className="cards">
            <div className="card">
              <span className="step-tag">Step 1</span>
              <h3>Download Craftparty</h3>
              <p>
                Get the app for Windows or Mac. It sets up everything it needs
                on its own — nothing else to install, nothing to configure.
              </p>
            </div>
            <div className="card">
              <span className="step-tag">Step 2</span>
              <h3>Start your world</h3>
              <p>
                Name your world and press Start. Craftparty checks your
                internet connection and picks the best way for friends to
                reach you.
              </p>
            </div>
            <div className="card">
              <span className="step-tag">Step 3</span>
              <h3>Invite your friends</h3>
              <p>
                Send them your party link over Discord or text. They click it,
                join, and appear in your world. That&apos;s the whole thing.
              </p>
            </div>
          </div>
          <div className="download-block">
            <DownloadButton />
            <p className="fineprint" style={{ margin: 0 }}>
              Early beta — things may still be rough around the edges.
            </p>
          </div>
        </div>
      </section>

      {/* ---- friends ---- */}
      <section className="section section-alt" id="join">
        <div className="wrap">
          <p className="eyebrow">Joining</p>
          <h2>Got an invite?</h2>
          <p className="intro">
            Someone sent you a party link? You&apos;re two minutes from their
            world. Click the link, grab the tiny joiner app, and it connects
            you automatically — nothing to configure, no server address to
            type. Then open Minecraft and the party shows up like a local
            game.
          </p>
        </div>
      </section>

      {/* ---- two ways to connect ---- */}
      <section className="section">
        <div className="wrap">
          <p className="eyebrow">Under the hood</p>
          <h2>Two ways to connect</h2>
          <p className="intro">
            Some home internet providers quietly block hosting anything. So
            Craftparty comes with two connection modes — the app tests your
            network and recommends one, and you can switch anytime.
          </p>
          <div className="cards">
            <div className="card">
              <span className="mode-tag mode-free">Independent</span>
              <h3>Everything on your computer</h3>
              <p>
                Your machine does it all, with nothing in the middle. Free
                forever and fully yours. Works on most home internet
                connections.
              </p>
            </div>
            <div className="card">
              <span className="mode-tag mode-assist">Assisted</span>
              <h3>Our relay lends a hand</h3>
              <p>
                If your provider blocks hosting, the Craftparty relay helps
                your friends find you. It only coordinates the connection —
                your world and everything in it still lives on your machine.
              </p>
            </div>
          </div>
          <p className="mode-note">
            Either way, gameplay runs between you and your friends — the world
            is yours, the saves are yours, and turning it off is as simple as
            closing the app.
          </p>
        </div>
      </section>

      {/* ---- safety ---- */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="hearts" aria-hidden="true">
            <span className="heart" />
            <span className="heart" />
            <span className="heart" />
          </div>
          <p className="eyebrow">Safety</p>
          <h2>No strangers. Ever.</h2>
          <p className="intro">
            Your world isn&apos;t listed anywhere and has no public address to
            find. Friends connect through a private, encrypted network that
            only your invites can join — to the rest of the internet, your
            party doesn&apos;t exist.
          </p>
        </div>
      </section>

      {/* ---- FAQ ---- */}
      <section className="section" id="faq">
        <div className="wrap">
          <p className="eyebrow">Questions</p>
          <h2>Fair questions</h2>
          <div className="faq">
            <details>
              <summary>Is it really free?</summary>
              <p>
                Yes — Craftparty is free and open source. Everyone still needs
                their own copy of Minecraft Java Edition to play.
              </p>
            </details>
            <details>
              <summary>Do I need to know what a server is?</summary>
              <p>
                No. If you can install a game and send a link to a friend, you
                have every skill this requires.
              </p>
            </details>
            <details>
              <summary>Does my computer need to stay on?</summary>
              <p>
                While people are playing, yes — the world runs on your
                machine. Close the app and the party pauses until next time;
                your world is saved locally.
              </p>
            </details>
            <details>
              <summary>Can we use mods?</summary>
              <p>
                Craftparty runs a Fabric server under the hood, so yes —
                mod support is on the roadmap.
              </p>
            </details>
            <details>
              <summary>Is this an official Minecraft thing?</summary>
              <p>
                No. Craftparty is an independent open source project, not
                affiliated with Mojang or Microsoft.
              </p>
            </details>
          </div>
        </div>
      </section>

      {/* ---- underground ---- */}
      <footer className="underground">
        <div className="wrap">
          <div className="links">
            <a href={RELEASES_URL}>Download</a>
            <a href="https://github.com/marclundgren/craftparty-kit">GitHub</a>
            <a href="#faq">FAQ</a>
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
