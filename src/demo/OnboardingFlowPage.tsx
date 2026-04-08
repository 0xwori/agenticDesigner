import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, LibrarySection, StatusPill, TextArea } from "../design-system";

const STORAGE_KEY = "tapwise:onboarding-state:v1";

const REQUIRED_FIELDS = [
  {
    key: "learningObjective",
    label: "Learning objective",
    question: "What should learners be able to do after this lesson?"
  },
  {
    key: "targetAudience",
    label: "Target audience",
    question: "Which learners is this for (grade, age, or level)?"
  },
  {
    key: "difficulty",
    label: "Difficulty",
    question: "What difficulty should this use (beginner, intermediate, advanced)?"
  },
  {
    key: "lessonLength",
    label: "Lesson length",
    question: "How long should the lesson or activity take?"
  },
  {
    key: "tone",
    label: "Instructional tone",
    question: "What tone should the content use (formal, conversational, playful)?"
  },
  {
    key: "language",
    label: "Language",
    question: "Which language should the generated content use?"
  },
  {
    key: "assessmentMode",
    label: "Assessment mode",
    question: "How should understanding be assessed (quiz, open question, project)?"
  }
] as const;

type CriterionKey = (typeof REQUIRED_FIELDS)[number]["key"];

interface ChatMessage {
  id: string;
  role: "agent" | "user";
  text: string;
  criterion?: CriterionKey;
}

interface OnboardingState {
  prompt: string;
  answers: Partial<Record<CriterionKey, string>>;
  asked: CriterionKey[];
  chat: ChatMessage[];
}

const INTRO_MESSAGE: ChatMessage = {
  id: "intro",
  role: "agent",
  text: "Share your topic prompt. I will only ask for missing information needed for high-quality generation."
};

const READY_TEXT = "All required criteria are complete. This topic is ready for generation.";

function userMessage(id: string, text: string, criterion?: CriterionKey): ChatMessage {
  return {
    id,
    role: "user",
    text,
    criterion
  };
}

function agentMessage(id: string, text: string, criterion?: CriterionKey): ChatMessage {
  return {
    id,
    role: "agent",
    text,
    criterion
  };
}

function fieldLabel(key: CriterionKey) {
  return REQUIRED_FIELDS.find((item) => item.key === key)?.label ?? key;
}

function fieldQuestion(key: CriterionKey) {
  return REQUIRED_FIELDS.find((item) => item.key === key)?.question ?? "Please provide this detail.";
}

function missingKeys(answers: Partial<Record<CriterionKey, string>>) {
  return REQUIRED_FIELDS.map((item) => item.key).filter((key) => !(answers[key] ?? "").trim());
}

function inferFromPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();
  const inferred: Partial<Record<CriterionKey, string>> = {};

  if (prompt.trim().length > 24) {
    inferred.learningObjective = prompt.trim();
  }

  if (normalized.match(/grade\s?\d+|year\s?\d+|middle school|high school|university|primary/i)) {
    inferred.targetAudience = "Specified in prompt";
  }

  if (normalized.match(/beginner|intro|introductory|basic/i)) {
    inferred.difficulty = "Beginner";
  } else if (normalized.match(/advanced|expert|deep dive/i)) {
    inferred.difficulty = "Advanced";
  } else if (normalized.match(/intermediate/i)) {
    inferred.difficulty = "Intermediate";
  }

  const durationMatch = prompt.match(/\b(\d{1,3})\s?(minutes|min|hrs|hours|uur)\b/i);
  if (durationMatch) {
    inferred.lessonLength = `${durationMatch[1]} ${durationMatch[2]}`;
  }

  if (normalized.match(/formal|academic|scholarly/i)) {
    inferred.tone = "Formal";
  } else if (normalized.match(/conversational|friendly|casual/i)) {
    inferred.tone = "Conversational";
  } else if (normalized.match(/playful|fun|engaging/i)) {
    inferred.tone = "Playful";
  }

  if (normalized.match(/nederlands|dutch/i)) {
    inferred.language = "Dutch";
  } else if (normalized.match(/english/i)) {
    inferred.language = "English";
  }

  if (normalized.match(/quiz|mcq|multiple choice/i)) {
    inferred.assessmentMode = "Quiz";
  } else if (normalized.match(/project|assignment/i)) {
    inferred.assessmentMode = "Project";
  } else if (normalized.match(/open question|reflection|essay/i)) {
    inferred.assessmentMode = "Open question";
  }

  return inferred;
}

function ensureAgentProgress(state: OnboardingState) {
  if (!state.prompt.trim()) {
    return state;
  }

  const missing = missingKeys(state.answers);

  if (missing.length === 0) {
    if (state.chat.some((message) => message.text === READY_TEXT)) {
      return state;
    }

    return {
      ...state,
      chat: [...state.chat, agentMessage(`agent-ready-${Date.now()}`, READY_TEXT)]
    };
  }

  const next = missing[0];

  if (state.asked.includes(next)) {
    return state;
  }

  return {
    ...state,
    asked: [...state.asked, next],
    chat: [...state.chat, agentMessage(`agent-${next}-${Date.now()}`, fieldQuestion(next), next)]
  };
}

function parseStoredState() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as OnboardingState;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function createInitialState(): OnboardingState {
  const stored = parseStoredState();
  if (stored) {
    return ensureAgentProgress(stored);
  }

  return ensureAgentProgress({
    prompt: "",
    answers: {},
    asked: [],
    chat: [INTRO_MESSAGE]
  });
}

export function OnboardingFlowPage() {
  const [state, setState] = useState<OnboardingState>(createInitialState);
  const [promptDraft, setPromptDraft] = useState(state.prompt);
  const [answerDraft, setAnswerDraft] = useState("");

  const missing = useMemo(() => missingKeys(state.answers), [state.answers]);
  const complete = REQUIRED_FIELDS.length - missing.length;
  const progress = Math.round((complete / REQUIRED_FIELDS.length) * 100);
  const currentCriterion = missing[0];

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  function analyzePrompt() {
    const prompt = promptDraft.trim();
    if (!prompt) {
      return;
    }

    setState((previous) => {
      const inferred = inferFromPrompt(prompt);
      const mergedAnswers = { ...previous.answers };
      const autoFilledLabels: string[] = [];

      for (const field of REQUIRED_FIELDS) {
        const inferredValue = inferred[field.key];
        const existing = mergedAnswers[field.key];

        if (inferredValue && !existing) {
          mergedAnswers[field.key] = inferredValue;
          autoFilledLabels.push(field.label);
        }
      }

      const chat: ChatMessage[] = [
        ...previous.chat,
        userMessage(`user-prompt-${Date.now()}`, prompt),
        agentMessage(
          `agent-summary-${Date.now()}`,
          autoFilledLabels.length > 0
            ? `Captured from prompt: ${autoFilledLabels.join(", ")}. I will now ask only what is still missing.`
            : "I checked your prompt. I will ask only the missing criteria."
        )
      ];

      const nextState: OnboardingState = {
        prompt,
        answers: mergedAnswers,
        asked: previous.asked.filter((key) => !(mergedAnswers[key] ?? "").trim()),
        chat
      };

      return ensureAgentProgress(nextState);
    });
  }

  function submitCurrentAnswer() {
    const response = answerDraft.trim();
    if (!response) {
      return;
    }

    setState((previous) => {
      const nextMissing = missingKeys(previous.answers)[0];
      if (!nextMissing) {
        return previous;
      }

      const nextState: OnboardingState = {
        ...previous,
        answers: {
          ...previous.answers,
          [nextMissing]: response
        },
        chat: [...previous.chat, userMessage(`user-answer-${nextMissing}-${Date.now()}`, response, nextMissing)]
      };

      return ensureAgentProgress(nextState);
    });

    setAnswerDraft("");
  }

  function resetFlow() {
    setState({
      prompt: "",
      answers: {},
      asked: [],
      chat: [INTRO_MESSAGE]
    });
    setPromptDraft("");
    setAnswerDraft("");

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }

  return (
    <div className="app-stage">
      <header className="app-header">
        <h1>Dynamic Onboarding</h1>
        <p>
          Agentic onboarding that validates a prompt against generation criteria, asks only what is missing, and persists progress
          instantly.
        </p>
      </header>

      <LibrarySection
        title="Topic Setup"
        description="Paste your topic prompt. The system extracts known details and starts follow-up questions for missing criteria."
      >
        <div className="onboarding-prompt-row">
          <TextArea
            label="Topic prompt"
            rows={3}
            value={promptDraft}
            onChange={(event) => setPromptDraft(event.target.value)}
            placeholder="Example: Create an introductory World War II module for grade 8 with a 45-minute lesson and quiz."
          />
          <div className="onboarding-prompt-actions">
            <Button variant="accent" onClick={analyzePrompt}>
              Analyze Prompt
            </Button>
            <Button variant="ghost" onClick={resetFlow}>
              Reset
            </Button>
          </div>
        </div>
      </LibrarySection>

      <div className="onboarding-grid">
        <Card className="onboarding-chat-card">
          <div className="onboarding-chat-head">
            <h3>Onboarding Chat</h3>
            {missing.length === 0 ? <StatusPill>Ready for generation</StatusPill> : <Badge tone="warm">{missing.length} missing</Badge>}
          </div>

          <div className="onboarding-progress">
            <div className="onboarding-progress__bar" style={{ width: `${progress}%` }} />
          </div>
          <p className="onboarding-progress__label">
            {complete}/{REQUIRED_FIELDS.length} criteria complete
          </p>

          <div className="onboarding-chat-log">
            {state.chat.map((message) => (
              <article key={message.id} className={`onboarding-message onboarding-message--${message.role}`}>
                <span className="onboarding-message__role">{message.role === "agent" ? "Agent" : "You"}</span>
                <p>{message.text}</p>
              </article>
            ))}
          </div>

          <div className="onboarding-input-row">
            <TextArea
              rows={2}
              value={answerDraft}
              onChange={(event) => setAnswerDraft(event.target.value)}
              placeholder={currentCriterion ? `Answer: ${fieldLabel(currentCriterion)}` : "Everything is complete."}
              disabled={!currentCriterion}
            />
            <Button variant="accent" onClick={submitCurrentAnswer} disabled={!currentCriterion || !answerDraft.trim()}>
              Save Answer
            </Button>
          </div>
        </Card>

        <Card className="onboarding-spec-card" muted>
          <div className="onboarding-spec-head">
            <h3>Topic Spec (auto-saved)</h3>
            {missing.length === 0 ? <Badge tone="neutral">Ready</Badge> : <Badge tone="warm">In progress</Badge>}
          </div>

          <dl className="onboarding-spec-list">
            {REQUIRED_FIELDS.map((field) => {
              const value = state.answers[field.key]?.trim();

              return (
                <div key={field.key} className="onboarding-spec-row">
                  <dt>{field.label}</dt>
                  <dd>{value ? value : <span className="is-missing">Missing</span>}</dd>
                </div>
              );
            })}
          </dl>
        </Card>
      </div>
    </div>
  );
}
