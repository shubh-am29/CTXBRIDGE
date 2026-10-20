import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./Landing.css";

// Reveals a section with a class once it scrolls into view.
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-visible");
          obs.unobserve(el);
        }
      },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

// Counts up to a target number once its wrapper is visible.
function Counter({ to, suffix = "", duration = 1200 }) {
  const ref = useRef(null);
  const [value, setValue] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        obs.unobserve(el);
        const start = performance.now();
        const step = (now) => {
          const p = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          setValue(Math.round(to * eased));
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      },
      { threshold: 0.4 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [to, duration]);
  return (
    <span ref={ref}>
      {value}
      {suffix}
    </span>
  );
}

const PIPELINE = [
  { key: "scan", title: "Scan", desc: "Walks your project and reads every file without you lifting a finger." },
  { key: "understand", title: "Understand", desc: "Parses files, symbols, functions, classes, and routes into a structured model." },
  { key: "remember", title: "Remember", desc: "Versions that understanding as project memory that updates as your code evolves." },
  { key: "handoff", title: "Handoff", desc: "Packages exactly what the next agent needs to pick up where the last one left off." },
];

const INTEL = [
  { title: "Files", desc: "Full project structure, tracked as it grows and changes." },
  { title: "Symbols", desc: "Named entities linked to where they're defined and used." },
  { title: "Functions", desc: "Signatures and call relationships across the codebase." },
  { title: "Classes", desc: "Structure and inheritance, mapped instead of guessed at." },
  { title: "Routes", desc: "API and page routes, so an agent understands how the app is reached." },
];

const WHY = [
  { title: "AI-assisted development", desc: "More of your codebase is written alongside an agent than ever — but it starts cold every time." },
  { title: "Context fragmentation", desc: "Decisions live scattered across chats and comments, nowhere the next session can reach them." },
  { title: "Repeated explanations", desc: "Teams burn real time restating the same architecture to every new session." },
  { title: "Loss of project knowledge", desc: "When a person or a session ends, the reasoning behind the code often leaves with it." },
];

export default function Landing() {
  const heroRef = useRef(null);
  const [activeStep, setActiveStep] = useState(0);

  // Cursor-tracked ember glow in the hero.
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const onMove = (e) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
      el.style.setProperty("--my", `${e.clientY - rect.top}px`);
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, []);

  // Auto-cycle the pipeline steps.
  useEffect(() => {
    const id = setInterval(() => setActiveStep((s) => (s + 1) % PIPELINE.length), 2200);
    return () => clearInterval(id);
  }, []);

  const problemRef = useReveal();
  const ideaRef = useReveal();
  const howRef = useReveal();
  const intelRef = useReveal();
  const memoryRef = useReveal();
  const whyRef = useReveal();
  const archRef = useReveal();
  const visionRef = useReveal();
  const ctaRef = useReveal();

  return (
    <div className="cb-landing">
      <header className="cb-nav">
        <div className="cb-wrap cb-nav-inner">
          <Link to="/" className="cb-logo">
            <span className="cb-logo-mark">CB</span>
            CtxBridge
          </Link>
          <nav className="cb-nav-links">
            <a href="#product">Product</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#why-it-matters">Why Context Matters</a>
            <a href="#architecture">Architecture</a>
          </nav>
          <div className="cb-nav-actions">
            <Link to="/login" className="cb-btn cb-btn-ghost">Log In</Link>
            <Link to="/login" className="cb-btn cb-btn-primary">Get Started</Link>
          </div>
        </div>
      </header>

      <section className="cb-hero" id="product" ref={heroRef}>
        <div className="cb-hero-glow" />
        <div className="cb-wrap cb-hero-grid">
          <div>
            <h1>
              Your AI coding agent forgets everything.
              <br />
              <span className="cb-accent">CtxBridge</span> doesn't.
            </h1>
            <p className="cb-hero-sub">
              Scan your codebase, capture how it actually works, and hand every new AI
              session the context it needs — instead of re-explaining your project from
              scratch.
            </p>
            <div className="cb-hero-ctas">
              <Link to="/login" className="cb-btn cb-btn-primary cb-btn-lg">Get Started</Link>
              <a href="#how-it-works" className="cb-btn cb-btn-outline cb-btn-lg">Explore How It Works</a>
            </div>
            <div className="cb-hero-meta">
              <span>$ npm i @shu_bham_61/ctxbridge</span>
              <span>FastAPI · React · Supabase</span>
            </div>
          </div>

          <div className="cb-pipeline-card">
            <div className="cb-pipeline-bar">
              <span className="cb-dot r" /><span className="cb-dot y" /><span className="cb-dot g" />
              <span className="cb-pipeline-title">ctxbridge — live pipeline</span>
            </div>
            <div className="cb-pipeline-body">
              {PIPELINE.map((step, i) => (
                <div key={step.key} className={`cb-pipeline-row ${i === activeStep ? "is-active" : ""}`}>
                  <span className="cb-pipeline-index">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <div className="cb-pipeline-step-title">{step.title}</div>
                    <div className="cb-pipeline-step-desc">{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="cb-section" ref={problemRef}>
        <div className="cb-wrap cb-two-col">
          <div>
            <div className="cb-tag">the problem</div>
            <h2>AI coding agents lose the plot the moment the session ends.</h2>
          </div>
          <div>
            <p className="cb-lede">
              Every new chat starts from zero. The agent doesn't know your architecture
              decisions or what the last five sessions already ruled out — so you end up
              re-explaining the same project again and again.
            </p>
            <div className="cb-stat-row">
              <div className="cb-stat"><b><Counter to={0} /></b><span>memory between sessions</span></div>
              <div className="cb-stat"><b><Counter to={30} suffix="%+" /></b><span>of a session spent re-explaining context</span></div>
              <div className="cb-stat"><b><Counter to={1} /></b><span>codebase, endless re-onboarding</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="cb-section" ref={ideaRef}>
        <div className="cb-wrap cb-two-col">
          <div>
            <div className="cb-tag">the idea</div>
            <h2>Give every agent a memory of the project, not just the prompt.</h2>
          </div>
          <div className="cb-idea-stack">
            <div className="cb-idea-card">
              <span className="cb-idea-key">01 — capture</span>
              <p>ContextBridge reads your codebase and past sessions, turning both into structured, versioned project memory.</p>
            </div>
            <div className="cb-idea-card">
              <span className="cb-idea-key">02 — carry forward</span>
              <p>That memory travels with the project — across sessions, agents, and the people working on it.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="cb-section" id="how-it-works" ref={howRef}>
        <div className="cb-wrap">
          <div className="cb-tag">how it works</div>
          <h2>From raw codebase to agent-ready context, in four steps.</h2>
          <div className="cb-steps">
            {PIPELINE.map((step, i) => (
              <div className="cb-step" key={step.key}>
                <div className="cb-step-index">{String(i + 1).padStart(2, "0")}</div>
                <h3>{step.title}</h3>
                <p>{step.desc}</p>
                {i < PIPELINE.length - 1 && (
                  <div className="cb-step-arrow">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cb-section" ref={intelRef}>
        <div className="cb-wrap">
          <div className="cb-tag">code intelligence</div>
          <h2>ContextBridge reads code the way a senior engineer would.</h2>
          <div className="cb-intel-grid">
            <div className="cb-intel-list">
              {INTEL.map((item) => (
                <div className="cb-intel-item" key={item.title}>
                  <div className="cb-intel-dot" />
                  <div>
                    <h4>{item.title}</h4>
                    <p>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="cb-code-panel">
              <div><span className="ln">1</span><span className="cm">// resolved by ContextBridge</span></div>
              <div><span className="ln">2</span><span className="kw">router</span>.post(<span className="str">'/projects/:id/handoff'</span>,</div>
              <div><span className="ln">3</span>&nbsp;&nbsp;<span className="fn">generateHandoff</span>) <span className="cm">→ services/handoff.ts</span></div>
              <div><span className="ln">4</span></div>
              <div><span className="ln">5</span><span className="cm">// referenced by 3 modules, 1 CLI command</span></div>
              <div><span className="ln">6</span><span className="kw">class</span> <span className="fn">MemoryVersion</span> {"{"}</div>
              <div><span className="ln">7</span>&nbsp;&nbsp;<span className="fn">diffAgainst</span>(previous) {"{ … }"}</div>
              <div><span className="ln">8</span>{"}"}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="cb-section" ref={memoryRef}>
        <div className="cb-wrap">
          <div className="cb-tag">memory &amp; handoff</div>
          <h2>Project knowledge that outlives any single chat.</h2>
          <div className="cb-split-row">
            <div className="cb-feature-card">
              <h3>Persistent memory</h3>
              <p>Every session and architectural change is captured as structured, versioned project memory — nothing gets lost when a chat window closes.</p>
              <div className="cb-diagram">
                <span className="cb-node is-active">session 1</span>
                <span className="cb-link" />
                <span className="cb-node is-active">session 2</span>
                <span className="cb-link" />
                <span className="cb-node">memory v12</span>
              </div>
            </div>
            <div className="cb-feature-card">
              <h3>Agent handoff</h3>
              <p>When it's time to bring in a new agent, ContextBridge packages exactly what it needs to pick up where the last one left off.</p>
              <div className="cb-diagram">
                <span className="cb-node">memory v12</span>
                <span className="cb-link" />
                <span className="cb-node is-active">handoff package</span>
                <span className="cb-link" />
                <span className="cb-node is-active">next agent</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="cb-section" id="why-it-matters" ref={whyRef}>
        <div className="cb-wrap">
          <div className="cb-tag">why it matters</div>
          <h2>AI-assisted development is only as good as its memory.</h2>
          <div className="cb-why-grid">
            {WHY.map((item) => (
              <div className="cb-why-cell" key={item.title}>
                <h4>{item.title}</h4>
                <p>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cb-section" id="architecture" ref={archRef}>
        <div className="cb-wrap">
          <div className="cb-tag">architecture</div>
          <h2>One pipeline, from browser to database.</h2>
          <p className="cb-lede">
            A React frontend, a FastAPI backend, and a CLI that all read and write the same
            project memory in Supabase.
          </p>
          <div className="cb-arch-wrap">
            <svg viewBox="0 0 1000 220" width="100%" role="img" aria-label="Architecture diagram">
              <defs>
                <marker id="cb-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#6b5140" />
                </marker>
              </defs>
              <rect className="cb-box" x="20" y="70" width="150" height="70" rx="10" />
              <text className="cb-boxlbl" x="95" y="100" textAnchor="middle">Browser</text>
              <text className="cb-boxsub" x="95" y="118" textAnchor="middle">user interface</text>

              <rect className="cb-box" x="230" y="70" width="180" height="70" rx="10" />
              <text className="cb-boxlbl" x="320" y="98" textAnchor="middle">React + Vite</text>
              <text className="cb-boxsub" x="320" y="116" textAnchor="middle">/api proxy</text>

              <rect className="cb-box" x="470" y="70" width="180" height="70" rx="10" />
              <text className="cb-boxlbl" x="560" y="98" textAnchor="middle">FastAPI backend</text>
              <text className="cb-boxsub" x="560" y="116" textAnchor="middle">memory · sessions · handoff</text>

              <rect className="cb-box" x="710" y="70" width="150" height="70" rx="10" />
              <text className="cb-boxlbl" x="785" y="100" textAnchor="middle">Supabase</text>
              <text className="cb-boxsub" x="785" y="118" textAnchor="middle">project memory</text>

              <rect className="cb-box cb-box-dashed" x="470" y="10" width="180" height="40" rx="10" />
              <text className="cb-boxsub" x="560" y="34" textAnchor="middle">ctxbridge CLI</text>

              <path className="cb-edge" markerEnd="url(#cb-arrow)" d="M170,105 L228,105" />
              <path className="cb-edge" markerEnd="url(#cb-arrow)" d="M410,105 L468,105" />
              <path className="cb-edge cb-edge-hot" markerEnd="url(#cb-arrow)" d="M650,105 L708,105" />
              <path className="cb-edge" markerEnd="url(#cb-arrow)" d="M560,50 L560,68" />
            </svg>
          </div>
        </div>
      </section>

      <section className="cb-section" ref={visionRef}>
        <div className="cb-wrap">
          <div className="cb-tag">future vision</div>
          <h2>From memory tool to project memory layer.</h2>
          <div className="cb-vision">
            <p>
              ContextBridge today captures and hands off context. Next: an{" "}
              <span className="cb-accent">intelligent memory layer</span> that any agent,
              tool, or teammate can query directly — the shared source of truth for how
              your project actually works.
            </p>
          </div>
        </div>
      </section>

      <section className="cb-final-cta" ref={ctaRef}>
        <div className="cb-wrap">
          <h2>Give your AI the context your code deserves.</h2>
          <p className="cb-lede">
            Set up ContextBridge on your project in minutes — no more re-explaining what
            your codebase already knows.
          </p>
          <Link to="/login" className="cb-btn cb-btn-primary cb-btn-lg">Get Started</Link>
        </div>
      </section>

      <footer className="cb-footer">
        <div className="cb-wrap cb-footer-top">
          <div className="cb-logo">
            <span className="cb-logo-mark">CB</span>
            ContextBridge
          </div>
          <div className="cb-footer-cols">
            <div className="cb-footer-col">
              <h5>PRODUCT</h5>
              <a href="#product">Product</a>
              <a href="#how-it-works">How It Works</a>
              <a href="#architecture">Architecture</a>
            </div>
            <div className="cb-footer-col">
              <h5>ACCOUNT</h5>
              <Link to="/login">Log In</Link>
              <Link to="/login">Get Started</Link>
            </div>
          </div>
        </div>
        <div className="cb-wrap cb-footer-bottom">
          <span>© 2026 ContextBridge. Project memory for AI coding agents.</span>
          <span>Built with React · FastAPI · Supabase</span>
        </div>
      </footer>
    </div>
  );
}