"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clipboard,
  FileText,
  Gamepad2,
  Image as ImageIcon,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { analyzeEvidence, buildAppeal, questionsByCategory } from "@/lib/analyzer";
import type { AnswerMap, EvidenceItem } from "@/lib/types";

type Step = "evidence" | "analysis" | "questions" | "appeal";

const steps: { id: Step; label: string }[] = [
  { id: "evidence", label: "Evidence" },
  { id: "analysis", label: "Analyze" },
  { id: "questions", label: "Questions" },
  { id: "appeal", label: "Appeal" },
];

const demoText = "Your account has been deleted for disputed charges. Roblox has determined that one or more payments associated with this account were disputed or reported as unauthorized. Contact Support if you believe this decision was made in error.";

function prettyBytes(size?: number) {
  if (!size) return "Text evidence";
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function AppealApp() {
  const [step, setStep] = useState<Step>("evidence");
  const [text, setText] = useState("");
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const analysis = useMemo(() => analyzeEvidence(text), [text]);
  const questions = questionsByCategory[analysis.category] ?? questionsByCategory["Needs Review"];
  const appeal = useMemo(() => buildAppeal(analysis.category, answers, text), [analysis.category, answers, text]);
  const answered = Object.values(answers).filter((value) => value.trim()).length;
  const completeness = Math.min(100, 20 + evidence.length * 13 + (text.trim() ? 25 : 0) + answered * 8);
  const currentIndex = steps.findIndex((item) => item.id === step);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const accepted = Array.from(files).filter((file) => file.type.startsWith("image/") || file.type === "application/pdf");
    const mapped: EvidenceItem[] = accepted.map((file) => ({
      id: crypto.randomUUID(),
      kind: file.type === "application/pdf" ? "pdf" : "image",
      name: file.name,
      size: file.size,
      createdAt: new Date().toISOString(),
    }));
    setEvidence((previous) => [...previous, ...mapped]);
  }

  function analyzeCase() {
    if (text.trim() && !evidence.some((item) => item.kind === "text")) {
      setEvidence((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          kind: "text",
          name: "Pasted moderation/support text",
          text,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
    setStep("analysis");
  }

  async function copyAppeal() {
    await navigator.clipboard.writeText(appeal);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function reset() {
    setStep("evidence");
    setText("");
    setEvidence([]);
    setAnswers({});
    setCopied(false);
  }

  return (
    <main className="shell">
      <div className="ambient ambientOne" />
      <div className="ambient ambientTwo" />

      <header className="topbar">
        <div className="brand">
          <div className="brandMark"><ShieldCheck size={22} /></div>
          <div><strong>AppealAI</strong><span>Gaming Account Appeal Assistant</span></div>
        </div>
        <div className="topActions">
          <span className="privacyPill"><LockKeyhole size={14} /> Demo evidence stays in this session</span>
          <button className="ghostButton" onClick={reset}><RotateCcw size={16} /> Reset</button>
        </div>
      </header>

      <section className="hero">
        <div>
          <div className="eyebrow"><Gamepad2 size={16} /> Roblox-first appeal assistant</div>
          <h1>Turn a ban notice into a <span>clear appeal case.</span></h1>
          <p>Upload screenshots or PDFs, paste the moderation message, organize evidence, and prepare a focused appeal without guessing what support needs.</p>
        </div>
        <div className="missionCard">
          <div className="missionHead"><span>CASE READINESS</span><strong>{completeness}%</strong></div>
          <div className="progressTrack"><div className="progressFill" style={{ width: `${completeness}%` }} /></div>
          <small>{completeness < 60 ? "Add more evidence or the notice text." : completeness < 90 ? "Good progress — answer the case questions." : "Ready for final review."}</small>
        </div>
      </section>

      <section className="workspace">
        <aside className="rail panel">
          <p className="railLabel">CASE FLOW</p>
          {steps.map((item, index) => {
            const active = item.id === step;
            const done = index < currentIndex;
            return (
              <button key={item.id} className={`stepRow ${active ? "active" : ""} ${done ? "done" : ""}`} onClick={() => (done || active) && setStep(item.id)}>
                <span className="stepNumber">{done ? <Check size={14} /> : index + 1}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
          <div className="railDivider" />
          <p className="railLabel">PLATFORM</p>
          <div className="platformCard selected"><span className="platformLogo">R</span><div><strong>Roblox</strong><small>Active MVP</small></div><Check size={16} /></div>
          <div className="platformCard disabled"><span className="platformLogo muted">+</span><div><strong>More later</strong><small>Steam · Discord · Epic</small></div></div>
        </aside>

        <section className="mainPanel panel">
          {step === "evidence" && (
            <div className="stage">
              <div className="stageTitle">
                <div><span className="kicker">MISSION 01</span><h2>Build your evidence pack</h2><p>Add the ban notice and supporting material. You can mix screenshots, PDFs, and pasted text.</p></div>
                <div className="secureChip"><ShieldCheck size={16} /> Truth-first appeals</div>
              </div>

              <div className="uploadGrid">
                <button className="dropCard" onClick={() => fileInput.current?.click()}>
                  <div className="dropIcon"><Upload size={24} /></div>
                  <strong>Upload evidence</strong>
                  <span>Images, screenshots, PDF documents</span>
                  <small>PNG · JPG · HEIC · PDF</small>
                </button>
                <input ref={fileInput} type="file" multiple accept="image/*,.pdf,application/pdf" hidden onChange={(event) => addFiles(event.target.files)} />

                <div className="pasteCard">
                  <div className="pasteHead"><div><FileText size={20} /><strong>Paste notice or support reply</strong></div><button onClick={() => setText(demoText)}>Use demo</button></div>
                  <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste the Roblox moderation notice, support email, or reply here…" />
                </div>
              </div>

              <div className="vault">
                <div className="vaultHead"><div><LockKeyhole size={18} /><strong>Evidence Vault</strong></div><span>{evidence.length} item{evidence.length === 1 ? "" : "s"}</span></div>
                {evidence.length === 0 ? (
                  <div className="emptyVault"><Sparkles size={20} /><span>Your uploaded screenshots and PDFs will appear here.</span></div>
                ) : (
                  <div className="evidenceList">
                    {evidence.map((item) => (
                      <div className="evidenceRow" key={item.id}>
                        <div className="fileIcon">{item.kind === "image" ? <ImageIcon size={18} /> : <FileText size={18} />}</div>
                        <div><strong>{item.name}</strong><small>{prettyBytes(item.size)}</small></div>
                        <button onClick={() => setEvidence((previous) => previous.filter((entry) => entry.id !== item.id))} aria-label="Remove evidence"><X size={16} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="stageFooter">
                <div className="hint"><AlertTriangle size={16} /><span>Do not invent facts or hide a real violation. Strong appeals are specific and evidence-based.</span></div>
                <button className="primaryButton" disabled={!text.trim() && evidence.length === 0} onClick={analyzeCase}>Analyze Case <ArrowRight size={17} /></button>
              </div>
            </div>
          )}

          {step === "analysis" && (
            <div className="stage">
              <div className="stageTitle"><div><span className="kicker">MISSION 02</span><h2>Case analysis</h2><p>The MVP classifier identifies the likely case type from the supplied text while preserving the original evidence.</p></div><div className={`confidence ${analysis.confidence.toLowerCase()}`}>{analysis.confidence} confidence</div></div>
              <div className="analysisCard"><span className="analysisLabel">DETECTED CASE TYPE</span><h3>{analysis.category}</h3><p>{analysis.summary}</p></div>
              <div className="analysisColumns">
                <div className="infoCard good"><h4><Check size={18} /> What we have</h4>{analysis.found.length ? analysis.found.map((item) => <div className="infoRow" key={item}><span>✓</span>{item}</div>) : <div className="infoRow">No structured evidence detected yet.</div>}</div>
                <div className="infoCard warn"><h4><AlertTriangle size={18} /> Helpful next evidence</h4>{analysis.missing.map((item) => <div className="infoRow" key={item}><span>+</span>{item}</div>)}</div>
              </div>
              <div className="stageFooter end"><button className="secondaryButton" onClick={() => setStep("evidence")}>Back</button><button className="primaryButton" onClick={() => setStep("questions")}>Continue Investigation <ArrowRight size={17} /></button></div>
            </div>
          )}

          {step === "questions" && (
            <div className="stage">
              <div className="stageTitle"><div><span className="kicker">MISSION 03</span><h2>Answer only what matters</h2><p>The questionnaire adapts to the detected category so the final appeal stays focused.</p></div></div>
              <div className="questionList">
                {questions.map((question, index) => (
                  <label className="questionCard" key={question}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div><strong>{question}</strong><textarea value={answers[question] ?? ""} onChange={(event) => setAnswers((previous) => ({ ...previous, [question]: event.target.value }))} placeholder="Answer with facts you can support…" /></div>
                  </label>
                ))}
              </div>
              <div className="stageFooter end"><button className="secondaryButton" onClick={() => setStep("analysis")}>Back</button><button className="primaryButton" onClick={() => setStep("appeal")}>Build Appeal <Sparkles size={17} /></button></div>
            </div>
          )}

          {step === "appeal" && (
            <div className="stage">
              <div className="stageTitle"><div><span className="kicker">MISSION 04</span><h2>Review your appeal</h2><p>The user reviews the draft before submitting through Roblox's official support route.</p></div><div className="secureChip"><ShieldCheck size={16} /> No auto-spam</div></div>
              <div className="appealEditor"><div className="editorToolbar"><span>Appeal Draft · {analysis.category}</span><button onClick={copyAppeal}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? "Copied" : "Copy"}</button></div><textarea value={appeal} readOnly /></div>
              <div className="resultNote"><Sparkles size={18} /><div><strong>Next production layer</strong><p>AI vision/PDF analysis, secure persistent storage, authentication, Stripe, and support-response tracking can plug into this flow without changing the case experience.</p></div></div>
              <div className="stageFooter end"><button className="secondaryButton" onClick={() => setStep("questions")}>Edit answers</button><button className="primaryButton" onClick={copyAppeal}>{copied ? "Copied" : "Copy Appeal"} <Clipboard size={17} /></button></div>
            </div>
          )}
        </section>

        <aside className="casePanel panel">
          <div className="caseHead"><span>LIVE CASE</span><strong>#RBX-DEMO</strong></div>
          <div className="caseScore"><span className="scoreRing">{completeness}</span><div><strong>Readiness</strong><small>Evidence + answers</small></div></div>
          <div className="miniStat"><span>Platform</span><strong>Roblox</strong></div>
          <div className="miniStat"><span>Evidence</span><strong>{evidence.length}</strong></div>
          <div className="miniStat"><span>Category</span><strong>{analysis.category}</strong></div>
          <div className="timeline">
            <p>CASE TIMELINE</p>
            <div className="timelineItem active"><span /><div><strong>Case created</strong><small>Current session</small></div></div>
            <div className={`timelineItem ${currentIndex >= 1 ? "active" : ""}`}><span /><div><strong>Evidence analyzed</strong><small>{currentIndex >= 1 ? analysis.category : "Pending"}</small></div></div>
            <div className={`timelineItem ${currentIndex >= 3 ? "active" : ""}`}><span /><div><strong>Appeal ready</strong><small>{currentIndex >= 3 ? "Review draft" : "Pending"}</small></div></div>
          </div>
          <div className="disclaimer">AppealAI is an independent assistant and is not affiliated with Roblox Corporation. Reinstatement is never guaranteed.</div>
        </aside>
      </section>
    </main>
  );
}
