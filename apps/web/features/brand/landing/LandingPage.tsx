import Image from "next/image";
import Link from "next/link";
import { IntentLink } from "@/features/brand/IntentLink";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { scenes } from "@/features/brand/scenes";
import { BrandMark } from "./BrandMark";
import { LandingNav } from "./LandingNav";
import { HeroGallery } from "./HeroGallery";
import { Statement } from "./Statement";
import { WorkflowReel } from "./WorkflowReel";
import { LandingFaq } from "./LandingFaq";
import { Reveal } from "./Reveal";
import { SectionJump } from "./SectionJump";
import { PillNavCTA } from "./PillNavCTA";
import "./landing.css";
import { LandingAuthProvider } from "./LandingAuth";

/** Original ZImage brand layout, rendered as semantic React rather than a DOM shell. */
export function LandingPage() {
  return (
    <LandingAuthProvider><div className="zl-root" data-glass-theme="light">
      <a href="#landing-main" className="skip-link">
        跳至主要内容
      </a>
      <LandingNav />
      <main id="landing-main" tabIndex={-1}>
        <section className="zl-hero" aria-labelledby="landing-title">
          <div className="zl-hero-grid" aria-hidden="true" />
          <div className="zl-orbit zl-orbit-one" aria-hidden="true" />
          <div className="zl-orbit zl-orbit-two" aria-hidden="true" />
          <div className="zl-hero-copy zl-container">
            <span className="zl-eyebrow zl-hero-intro">
              <span className="zl-status-dot" /> AN OPEN SPACE FOR YOUR
              IMAGINATION
            </span>
            <h1 id="landing-title">
              <span className="zl-title-line">让灵感，</span>
              <span className="zl-title-line zl-title-accent">
                成为下一张好图。
              </span>
            </h1>
            <p className="zl-hero-description">
              从一句想法，到一组有风格的画面。
              <br />在 ZImage，让每一次创作都有新的可能。
            </p>
            <div className="zl-hero-actions">
              <PillNavCTA />
              <SectionJump
                className="zl-button zl-button-glass liquid-glass"
                target="landing-scenes"
              >
                探索创作场景 <ArrowRight aria-hidden="true" />
              </SectionJump>
            </div>
          </div>
          <HeroGallery />
          <div className="zl-hero-bottom">
            <span>想法不设限 · 创作有章法</span>
            <SectionJump
              target="landing-workflow"
              aria-label="向下探索创作方式"
            >
              向下探索<span aria-hidden="true">↓</span>
            </SectionJump>
            <span>IMAGINE. CREATE. REFINE.</span>
          </div>
        </section>
        <Statement />
        <WorkflowReel />
        <section
          className="zl-scenes zl-container"
          id="landing-scenes"
          aria-labelledby="landing-scenes-title"
        >
          <Reveal>
            <div className="zl-section-heading">
              <div>
                <span className="zl-eyebrow">A SCENE FOR EVERY IDEA</span>
                <h2 id="landing-scenes-title">
                  为你的商品，
                  <br />
                  找到合适的出场方式。
                </h2>
              </div>
              <div>
                <p className="zl-section-description">
                  五种专注的创作场景，
                  <br />
                  让好产品的每一面，都被看见。
                </p>
                <Link href="/create" className="zl-text-link">
                  查看全部场景 <ArrowRight aria-hidden="true" />
                </Link>
              </div>
            </div>
          </Reveal>
          <div className="zl-scene-grid">
            {scenes.map((scene, index) => (
              <Reveal
                key={scene.id}
                className={`zl-scene-card zl-scene-card-${index + 1}`}
                delay={Math.min(index, 2) * 80}
              >
                <IntentLink
                  href={`/create/${scene.id}`}
                  className="zl-scene-link"
                >
                  <div className="zl-scene-photo">
                    <Image
                      src={scene.image}
                      alt={`${scene.name}创作示例`}
                      loading="lazy"
                      decoding="async"
                      sizes="(max-width: 760px) 90vw, 420px"
                      width="800"
                      height="800"
                    />
                    <span className="zl-scene-tag">{scene.tag}</span>
                    <span className="zl-scene-open">
                      <ArrowUpRight aria-hidden="true" />
                    </span>
                  </div>
                  <div className="zl-scene-copy">
                    <span className="zl-scene-index">0{index + 1}</span>
                    <div>
                      <h3>{scene.name}</h3>
                      <p>{scene.description}</p>
                    </div>
                  </div>
                </IntentLink>
              </Reveal>
            ))}
          </div>
        </section>
        <section
          className="zl-faq zl-container"
          id="landing-faq"
          aria-labelledby="landing-faq-title"
        >
          <Reveal>
            <span className="zl-eyebrow">A LITTLE MORE CLARITY</span>
            <h2 id="landing-faq-title">
              开始之前，
              <br />
              你可能想知道。
            </h2>
          </Reveal>
          <Reveal>
            <LandingFaq />
          </Reveal>
        </section>
        <Reveal>
          <section
            className="zl-final zl-container"
            aria-labelledby="landing-final-title"
          >
            <div className="zl-final-grid" aria-hidden="true" />
            <span className="zl-final-mark" aria-hidden="true">
              <BrandMark />
            </span>
            <span className="zl-eyebrow">YOUR NEXT IDEA STARTS HERE</span>
            <h2 id="landing-final-title">
              下一张好图，
              <br />
              从你的想法开始。
            </h2>
            <div>
              <PillNavCTA />
              <Link href="/assets" className="zl-final-secondary">
                先看看资产库
              </Link>
            </div>
            <p>留一点空间，给想象。</p>
          </section>
        </Reveal>
      </main>
      <footer className="zl-footer zl-container">
        <div>
          <Link href="/" className="zl-brand">
            <span className="zl-brand-icon">
              <BrandMark />
            </span>
            <span>ZImage</span>
          </Link>
          <span>让灵感成为画面。</span>
        </div>
        <nav aria-label="页脚导航">
          <Link href="/workspace">创作工作台</Link>
          <Link href="/create">电商生图</Link>
          <Link href="/assets">资产库</Link>
          <Link href="/account">账号</Link>
        </nav>
        <p>
          © {new Date().getUTCFullYear()} ZImage{" "}
          <span>IMAGINE. CREATE. REFINE.</span>
        </p>
      </footer>
    </div></LandingAuthProvider>
  );
}
