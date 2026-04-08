import {
  ArrowRightIcon,
  Badge,
  BookmarkIcon,
  Breadcrumb,
  Button,
  Card,
  GridIcon,
  KebabIcon,
  LibrarySection,
  LinkIcon,
  MenuDotsIcon,
  PlusIcon,
  RailButton,
  SegmentedControl,
  SparkleIcon,
  StatusPill,
  TextArea,
  TextInput
} from "../design-system";

const lectureBlocks = [
  "Duitse en Sovjet inval",
  "Poolse bijdrage aan de geallieerde strijd",
  "Bezetting en de Holocaust",
  "Opstand van Warschau en het laatste oorlogsjaar",
  "Verzet",
  "Collaboratie",
  "Na afloop van de oorlog"
];

const quizzes = [
  { title: "Quiz", subtitle: "Eerste les", status: "Ready" },
  { title: "Adaptieve quiz", subtitle: "Entite lesson", status: "Ready" }
];

const navRows = [GridIcon, PlusIcon, BookmarkIcon, SparkleIcon, LinkIcon, MenuDotsIcon];

function Sidebar() {
  return (
    <aside className="tapwise-sidebar">
      <div className="tapwise-sidebar__logo">t</div>
      <div className="tapwise-sidebar__nav">
        {navRows.map((Icon, index) => (
          <RailButton key={index} className={index === 1 ? "is-active" : undefined}>
            <Icon width={18} height={18} />
          </RailButton>
        ))}
      </div>
      <button type="button" className="tapwise-sidebar__avatar" aria-label="Profile" />
    </aside>
  );
}

function LessonCard() {
  return (
    <Card className="tapwise-lesson">
      <div className="tapwise-lesson__preview" />
      <div className="tapwise-lesson__content">
        <Badge tone="neutral">Learning set</Badge>
        <h3>Tweede wereldoorlog</h3>
        <p>Simpel uitgelegd</p>
        <div className="tapwise-lesson__meta">
          <Badge tone="neutral" icon={<LinkIcon width={12} height={12} />}>
            Resources (1)
          </Badge>
          <StatusPill />
        </div>
      </div>
    </Card>
  );
}

function LectureList() {
  return (
    <Card className="tapwise-list-card" muted>
      <div className="tapwise-list-card__header">
        <span>2 tracks</span>
        <span>7 lessons</span>
      </div>
      <div className="tapwise-lecture-list">
        {lectureBlocks.map((item, index) => (
          <article key={item} className="tapwise-lecture-row">
            <div className="tapwise-lecture-row__main">
              <span className="tapwise-lecture-row__index">{index + 1}.</span>
              <h4>{item}</h4>
            </div>
            <div className="tapwise-lecture-row__actions">
              <Button size="icon" variant="ghost" aria-label="Add">
                <PlusIcon width={14} height={14} />
              </Button>
              <Button size="icon" variant="ghost" aria-label="Options">
                <KebabIcon width={14} height={14} />
              </Button>
            </div>
          </article>
        ))}
      </div>
      <div className="tapwise-quiz-list">
        {quizzes.map((quiz) => (
          <article key={quiz.title} className="tapwise-quiz-row">
            <div className="tapwise-quiz-row__icon">
              <ArrowRightIcon width={13} height={13} />
            </div>
            <div className="tapwise-quiz-row__copy">
              <strong>{quiz.title}</strong>
              <span>{quiz.subtitle}</span>
            </div>
            <StatusPill>{quiz.status}</StatusPill>
            <Button size="icon" variant="ghost" aria-label="Quiz options">
              <KebabIcon width={14} height={14} />
            </Button>
          </article>
        ))}
      </div>
      <Button variant="accent" size="sm" iconLeft={<PlusIcon width={14} height={14} />}>
        New lecture container
      </Button>
    </Card>
  );
}

function OutcomeEditor() {
  return (
    <Card className="tapwise-editor">
      <div className="tapwise-editor__title">
        <span>Outcome editor</span>
        <p>Na afloop van de oorlog · Entire lesson</p>
      </div>
      <TextInput label="Title" defaultValue="Quiz" />
      <TextArea
        label="Focus"
        rows={4}
        defaultValue="Learn about the evacuation of the Polish government and military, their reorganization in France and the UK, and their early contributions to the war effort."
      />
      <Button size="sm">Add sources</Button>
      <div className="tapwise-editor__grid">
        <TextInput label="Type" placeholder="" />
        <TextInput label="Status" placeholder="" />
      </div>
      <TextArea label="Description" rows={4} />
      <div className="tapwise-editor__grid">
        <TextInput label="URL" defaultValue="/app/topics/b43cb70" />
        <TextInput label="Duration" placeholder="" />
      </div>
    </Card>
  );
}

function TapwiseScreen() {
  return (
    <div className="tapwise-shell">
      <Sidebar />
      <main className="tapwise-main">
        <div className="tapwise-header">
          <div>
            <h1>Tweede wereldoorlog</h1>
            <Breadcrumb items={["topics", "b43cb707-6596-4551-a6fe-d", "overview"]} />
          </div>
          <div className="tapwise-header__actions">
            <Button size="sm">Debug</Button>
            <Button size="sm">Share</Button>
            <Button size="icon" aria-label="Notes">
              <LinkIcon width={14} height={14} />
            </Button>
            <Button size="icon" aria-label="Edit">
              <SparkleIcon width={14} height={14} />
            </Button>
          </div>
        </div>

        <div className="tapwise-toolbar">
          <Badge tone="neutral" icon={<SparkleIcon width={12} height={12} />}>
            Structure-first
          </Badge>
          <div className="tapwise-toolbar__controls">
            <SegmentedControl options={[{ label: "v2", value: "v2" }, { label: "v1", value: "v1" }]} value="v2" />
            <SegmentedControl
              options={[
                { label: "View", value: "view" },
                { label: "Edit", value: "edit", icon: <SparkleIcon width={12} height={12} /> }
              ]}
              value="edit"
            />
          </div>
        </div>

        <div className="tapwise-banner">Frontend preview mode: changes are local to this session and reset on refresh.</div>

        <LessonCard />

        <div className="tapwise-workspace-grid">
          <LectureList />
          <OutcomeEditor />
        </div>
      </main>
    </div>
  );
}

export function DesignSystemShowcase() {
  return (
    <div className="app-stage">
      <header className="app-header">
        <h1>Tapwise Component Library</h1>
        <p>
          Tokens and reusable UI primitives extracted from Figma node <code>1896:86</code>, then composed into a canonical page
          shell.
        </p>
      </header>

      <LibrarySection title="Primitives" description="Core controls that map to buttons, badges, segmented controls, and status pills.">
        <div className="library-row">
          <Button size="sm">Surface</Button>
          <Button size="sm" variant="accent" iconLeft={<PlusIcon width={14} height={14} />}>
            Accent
          </Button>
          <Button size="sm" variant="ghost">
            Ghost
          </Button>
          <Badge tone="neutral">Neutral Badge</Badge>
          <StatusPill />
        </div>
      </LibrarySection>

      <LibrarySection title="Composed Screen" description="Tapwise topic overview assembled from the design-system pieces.">
        <TapwiseScreen />
      </LibrarySection>
    </div>
  );
}
