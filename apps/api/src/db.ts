import crypto from "node:crypto";
import { Pool } from "pg";
import {
  DEFAULT_PROJECT_SETTINGS,
  type DesignSystemChecklist,
  type DesignSystemStatus,
  type DevicePreset,
  type FlowDocument,
  type Frame,
  type FrameKind,
  type FrameVersion,
  type FrameWithVersions,
  type PipelineEvent,
  type PipelineRun,
  type ProjectDesignSystem,
  type Project,
  type ProjectBundle,
  type ProjectSettings,
  type ReferenceSource,
  type ReferenceStyleContext,
  type RunStatus
} from "@designer/shared";
import { buildDesignSystemVisualBoard } from "./services/designSystemVisualBoard.js";

const FALLBACK_DB_NAME = process.env.PGDATABASE ?? "postgres";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? `postgresql://localhost:5432/${FALLBACK_DB_NAME}`;

export function getDatabaseConnectionInfo() {
  try {
    const parsed = new URL(DATABASE_URL);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return DATABASE_URL;
  }
}

export const pool = new Pool({
  connectionString: DATABASE_URL
});

pool.on("error", (error) => {
  console.error("Postgres pool error", error);
});

function toIso(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  return value as T;
}

function mapProjectRow(row: Record<string, any>): Project {
  return {
    id: row.id,
    name: row.name,
    token: row.token,
    settings: {
      ...DEFAULT_PROJECT_SETTINGS,
      ...parseJson<Partial<ProjectSettings>>(row.settings, DEFAULT_PROJECT_SETTINGS)
    },
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString()
  };
}

function mapProjectDesignSystemRow(row: Record<string, any>): ProjectDesignSystem {
  const fallbackStyleProfile: ProjectDesignSystem["structuredTokens"]["styleProfile"] = {
    sourceType: "manual",
    foundations: {
      toneKeywords: [],
      density: "comfortable",
      contrast: "medium"
    },
    tokens: {
      colors: [],
      typography: {
        headlineFont: "",
        bodyFont: "",
        labelFont: "",
        notes: []
      },
      spacingScale: [4, 8, 12, 16, 20, 24, 32],
      radiusScale: [12],
      borderWidths: [1],
      shadows: ["none"],
      opacityScale: [0.4, 0.8, 1]
    },
    componentRecipes: [],
    extractionEvidence: []
  };
  const fallbackQualityReport: ProjectDesignSystem["structuredTokens"]["qualityReport"] = {
    fidelityScore: 0.62,
    globalConfidence: 0.62,
    status: "medium",
    referenceQuality: "medium",
    detectionCoverage: {
      colorsDetected: 0,
      componentFamiliesDetected: 0
    },
    qualityReasons: [],
    familyConfidence: [],
    recommendations: []
  };

  const fallbackStructuredTokens: ProjectDesignSystem["structuredTokens"] = {
    overview: "",
    colors: [],
    typography: {
      headlineFont: "",
      bodyFont: "",
      labelFont: "",
      notes: []
    },
    elevation: "",
    components: [],
    dos: [],
    donts: [],
    layout: "",
    responsive: "",
    imagery: "",
    styleProfile: fallbackStyleProfile,
    qualityReport: fallbackQualityReport,
    visualBoard: buildDesignSystemVisualBoard({
      styleProfile: fallbackStyleProfile,
      qualityReport: fallbackQualityReport,
      overview: "",
      colors: [],
      typography: {
        headlineFont: "",
        bodyFont: "",
        labelFont: "",
        notes: []
      },
      components: [],
      dos: [],
      donts: []
    })
  };

  const parsedStructured = parseJson<ProjectDesignSystem["structuredTokens"]>(row.structured_tokens, fallbackStructuredTokens);

  return {
    projectId: row.project_id,
    markdown: row.markdown,
    structuredTokens: {
      ...fallbackStructuredTokens,
      ...parsedStructured,
      qualityReport: {
        ...fallbackStructuredTokens.qualityReport,
        ...(parsedStructured?.qualityReport ?? {}),
        detectionCoverage: {
          ...fallbackStructuredTokens.qualityReport.detectionCoverage,
          ...(parsedStructured?.qualityReport?.detectionCoverage ?? {})
        }
      },
      visualBoard:
        parsedStructured?.visualBoard ??
        buildDesignSystemVisualBoard({
          styleProfile: parsedStructured?.styleProfile ?? fallbackStyleProfile,
          qualityReport: parsedStructured?.qualityReport ?? fallbackQualityReport,
          overview: parsedStructured?.overview ?? "",
          colors: parsedStructured?.colors ?? [],
          typography: parsedStructured?.typography ?? {
            headlineFont: "",
            bodyFont: "",
            labelFont: "",
            notes: []
          },
          components: parsedStructured?.components ?? [],
          dos: parsedStructured?.dos ?? [],
          donts: parsedStructured?.donts ?? []
        })
    },
    status: row.status,
    sourceType: row.source_type,
    sourceReferenceId: row.source_reference_id,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString()
  };
}

function mapReferenceRow(row: Record<string, any>): ReferenceSource {
  return {
    id: row.id,
    projectId: row.project_id,
    figmaUrl: row.figma_url,
    fileKey: row.file_key,
    nodeId: row.node_id,
    scope: row.scope,
    syncStatus: row.sync_status,
    syncError: row.sync_error,
    extractedStyleContext: parseJson<ReferenceStyleContext | null>(row.extracted_style_context, null),
    designSystemStatus: row.design_system_status,
    designSystemChecklist: parseJson<DesignSystemChecklist | null>(row.design_system_checklist, null),
    designSystemNotes: row.design_system_notes,
    designSystemUpdatedAt: toIso(row.design_system_updated_at),
    lastSyncedAt: toIso(row.last_synced_at),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString()
  };
}

function mapFrameRow(row: Record<string, any>): Frame {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    devicePreset: row.device_preset,
    mode: row.mode,
    selected: row.selected,
    position: parseJson<{ x: number; y: number }>(row.position, { x: 120, y: 120 }),
    size: parseJson<{ width: number; height: number }>(row.size, { width: 1024, height: 720 }),
    currentVersionId: row.current_version_id,
    status: row.status,
    frameKind: (row.frame_kind as FrameKind) ?? "design",
    flowDocument: row.flow_document ? parseJson<FlowDocument>(row.flow_document, undefined as any) : undefined,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString()
  };
}

function mapFrameVersionRow(row: Record<string, any>): FrameVersion {
  return {
    id: row.id,
    frameId: row.frame_id,
    sourceCode: row.source_code,
    cssCode: row.css_code,
    exportHtml: row.export_html,
    tailwindEnabled: row.tailwind_enabled,
    passOutputs: parseJson<Record<string, unknown>>(row.pass_outputs, {}),
    diffFromPrevious: parseJson<{ addedLines: number; removedLines: number; changedLines: number }>(
      row.diff_from_previous,
      { addedLines: 0, removedLines: 0, changedLines: 0 }
    ),
    createdAt: toIso(row.created_at) ?? new Date().toISOString()
  };
}

function mapRunRow(row: Record<string, any>): PipelineRun {
  return {
    id: row.id,
    projectId: row.project_id,
    frameId: row.frame_id,
    prompt: row.prompt,
    status: row.status,
    provider: row.provider,
    model: row.model,
    passStatusMap: parseJson<Record<string, RunStatus | "idle">>(row.pass_status_map, {}),
    passOutputs: parseJson<Record<string, unknown>>(row.pass_outputs, {}),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at)
  };
}

export async function initDatabase() {
  const client = await pool.connect();
  const setupLockId = 98_177_421;

  try {
    await client.query("SELECT pg_advisory_lock($1)", [setupLockId]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        settings JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS reference_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        figma_url TEXT NOT NULL,
        file_key TEXT NOT NULL,
        node_id TEXT,
        scope TEXT NOT NULL,
        sync_status TEXT NOT NULL,
        sync_error TEXT,
        extracted_style_context JSONB,
        design_system_status TEXT,
        design_system_checklist JSONB,
        design_system_notes TEXT,
        design_system_updated_at TIMESTAMPTZ,
        last_synced_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS project_design_systems (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        markdown TEXT NOT NULL,
        structured_tokens JSONB NOT NULL,
        status TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_reference_id TEXT REFERENCES reference_sources(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS frames (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        device_preset TEXT NOT NULL,
        mode TEXT NOT NULL,
        selected BOOLEAN NOT NULL DEFAULT FALSE,
        position JSONB NOT NULL,
        size JSONB NOT NULL,
        current_version_id TEXT,
        status TEXT NOT NULL DEFAULT 'ready',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS frame_versions (
        id TEXT PRIMARY KEY,
        frame_id TEXT NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
        source_code TEXT NOT NULL,
        css_code TEXT NOT NULL,
        export_html TEXT NOT NULL,
        tailwind_enabled BOOLEAN NOT NULL,
        pass_outputs JSONB NOT NULL,
        diff_from_previous JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        frame_id TEXT REFERENCES frames(id) ON DELETE SET NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        pass_status_map JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS pipeline_events (
        id BIGSERIAL PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        payload JSONB
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id BIGSERIAL PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES pipeline_runs(id) ON DELETE SET NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_reference_project ON reference_sources(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_design_system_source_ref ON project_design_systems(source_reference_id);
      CREATE INDEX IF NOT EXISTS idx_frames_project ON frames(project_id);
      CREATE INDEX IF NOT EXISTS idx_frame_versions_frame ON frame_versions(frame_id);
      CREATE INDEX IF NOT EXISTS idx_runs_project ON pipeline_runs(project_id);
      CREATE INDEX IF NOT EXISTS idx_events_run ON pipeline_events(run_id);
    `);

    await client.query(`
      ALTER TABLE reference_sources ADD COLUMN IF NOT EXISTS design_system_status TEXT;
      ALTER TABLE reference_sources ADD COLUMN IF NOT EXISTS design_system_checklist JSONB;
      ALTER TABLE reference_sources ADD COLUMN IF NOT EXISTS design_system_notes TEXT;
      ALTER TABLE reference_sources ADD COLUMN IF NOT EXISTS design_system_updated_at TIMESTAMPTZ;
    `);

    await client.query(`
      ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS pass_outputs JSONB NOT NULL DEFAULT '{}';
    `);

    await client.query(`
      ALTER TABLE frames ADD COLUMN IF NOT EXISTS frame_kind TEXT NOT NULL DEFAULT 'design';
      ALTER TABLE frames ADD COLUMN IF NOT EXISTS flow_document JSONB;
    `);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [setupLockId]).catch(() => {
      // Best effort unlock when startup fails.
    });
    client.release();
  }
}

function randomToken() {
  return crypto.randomBytes(18).toString("hex");
}

export async function createProject(name: string): Promise<ProjectBundle> {
  const id = crypto.randomUUID();
  const token = randomToken();

  await pool.query(
    `
      INSERT INTO projects (id, name, token, settings)
      VALUES ($1, $2, $3, $4::jsonb)
    `,
    [id, name, token, JSON.stringify(DEFAULT_PROJECT_SETTINGS)]
  );

  const bundle = await getProjectBundle(id);
  if (!bundle) {
    throw new Error("Failed to load project after creation.");
  }

  return bundle;
}

export async function getProjectBundle(projectId: string): Promise<ProjectBundle | null> {
  const projectResult = await pool.query(`SELECT * FROM projects WHERE id = $1`, [projectId]);
  if (projectResult.rowCount === 0) {
    return null;
  }

  const project = mapProjectRow(projectResult.rows[0]);
  const projectDesignSystemResult = await pool.query(
    `SELECT * FROM project_design_systems WHERE project_id = $1`,
    [projectId]
  );
  const designSystem =
    (projectDesignSystemResult.rowCount ?? 0) > 0 ? mapProjectDesignSystemRow(projectDesignSystemResult.rows[0]) : null;

  const referencesResult = await pool.query(
    `SELECT * FROM reference_sources WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
  const references = referencesResult.rows.map(mapReferenceRow);

  const framesResult = await pool.query(`SELECT * FROM frames WHERE project_id = $1 ORDER BY created_at ASC`, [projectId]);
  const frames = framesResult.rows.map(mapFrameRow);

  const frameIds = frames.map((frame) => frame.id);
  const versionsByFrame = new Map<string, FrameVersion[]>();

  if (frameIds.length > 0) {
    const versionsResult = await pool.query(
      `
        SELECT *
        FROM frame_versions
        WHERE frame_id = ANY($1::text[])
        ORDER BY created_at ASC
      `,
      [frameIds]
    );

    for (const row of versionsResult.rows) {
      const version = mapFrameVersionRow(row);
      const existing = versionsByFrame.get(version.frameId);
      if (existing) {
        existing.push(version);
      } else {
        versionsByFrame.set(version.frameId, [version]);
      }
    }
  }

  const frameWithVersions: FrameWithVersions[] = frames.map((frame) => ({
    ...frame,
    versions: versionsByFrame.get(frame.id) ?? []
  }));

  return {
    project,
    references,
    frames: frameWithVersions,
    designSystem
  };
}

export async function updateProjectSettings(projectId: string, patch: Partial<ProjectSettings>): Promise<Project | null> {
  const existing = await pool.query(`SELECT * FROM projects WHERE id = $1`, [projectId]);
  if (existing.rowCount === 0) {
    return null;
  }

  const project = mapProjectRow(existing.rows[0]);
  const merged = {
    ...project.settings,
    ...patch
  };

  const result = await pool.query(
    `
      UPDATE projects
      SET settings = $2::jsonb,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [projectId, JSON.stringify(merged)]
  );

  return mapProjectRow(result.rows[0]);
}

export async function getProjectDesignSystem(projectId: string): Promise<ProjectDesignSystem | null> {
  const result = await pool.query(`SELECT * FROM project_design_systems WHERE project_id = $1`, [projectId]);
  if (result.rowCount === 0) {
    return null;
  }
  return mapProjectDesignSystemRow(result.rows[0]);
}

export async function upsertProjectDesignSystem(input: {
  projectId: string;
  markdown: string;
  structuredTokens: ProjectDesignSystem["structuredTokens"];
  status: ProjectDesignSystem["status"];
  sourceType: ProjectDesignSystem["sourceType"];
  sourceReferenceId?: string | null;
}): Promise<ProjectDesignSystem> {
  let safeSourceReferenceId = input.sourceReferenceId ?? null;
  if (safeSourceReferenceId) {
    const sourceExists = await pool.query(`SELECT 1 FROM reference_sources WHERE id = $1 LIMIT 1`, [safeSourceReferenceId]);
    if (sourceExists.rowCount === 0) {
      safeSourceReferenceId = null;
    }
  }

  const result = await pool.query(
    `
      INSERT INTO project_design_systems (
        project_id,
        markdown,
        structured_tokens,
        status,
        source_type,
        source_reference_id
      )
      VALUES ($1, $2, $3::jsonb, $4, $5, $6)
      ON CONFLICT (project_id)
      DO UPDATE
      SET markdown = EXCLUDED.markdown,
          structured_tokens = EXCLUDED.structured_tokens,
          status = EXCLUDED.status,
          source_type = EXCLUDED.source_type,
          source_reference_id = EXCLUDED.source_reference_id,
          updated_at = NOW()
      RETURNING *
    `,
    [
      input.projectId,
      input.markdown,
      JSON.stringify(input.structuredTokens),
      input.status,
      input.sourceType,
      safeSourceReferenceId
    ]
  );
  return mapProjectDesignSystemRow(result.rows[0]);
}

export async function clearProjectBoard(projectId: string): Promise<void> {
  await pool.query("BEGIN");
  try {
    await pool.query(`DELETE FROM project_design_systems WHERE project_id = $1`, [projectId]);
    await pool.query(`DELETE FROM reference_sources WHERE project_id = $1`, [projectId]);
    await pool.query(`DELETE FROM frames WHERE project_id = $1`, [projectId]);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

export async function clearProjectDesignSystem(projectId: string): Promise<void> {
  await pool.query(`DELETE FROM project_design_systems WHERE project_id = $1`, [projectId]);
}

export async function resetReferenceDesignSystemMetadata(projectId: string): Promise<void> {
  await pool.query(
    `
      UPDATE reference_sources
      SET design_system_status = NULL,
          design_system_checklist = NULL,
          design_system_notes = NULL,
          design_system_updated_at = NULL,
          updated_at = NOW()
      WHERE project_id = $1
    `,
    [projectId]
  );
}

export async function createReferenceSource(input: {
  projectId: string;
  figmaUrl: string;
  fileKey: string;
  nodeId: string | null;
  scope: "frame" | "page";
}): Promise<ReferenceSource> {
  const id = crypto.randomUUID();

  const result = await pool.query(
    `
      INSERT INTO reference_sources (
        id, project_id, figma_url, file_key, node_id, scope, sync_status, sync_error, extracted_style_context,
        design_system_status, design_system_checklist, design_system_notes, design_system_updated_at, last_synced_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'syncing', NULL, NULL, NULL, NULL, NULL, NULL, NULL)
      RETURNING *
    `,
    [id, input.projectId, input.figmaUrl, input.fileKey, input.nodeId, input.scope]
  );

  return mapReferenceRow(result.rows[0]);
}

export async function updateReferenceSource(
  referenceId: string,
  patch: {
    syncStatus?: "syncing" | "synced" | "failed";
    syncError?: string | null;
    extractedStyleContext?: ReferenceStyleContext | null;
    designSystemStatus?: DesignSystemStatus | null;
    designSystemChecklist?: DesignSystemChecklist | null;
    designSystemNotes?: string | null;
    updateDesignSystemAt?: boolean;
    updateSyncedAt?: boolean;
  }
): Promise<ReferenceSource | null> {
  const current = await pool.query(`SELECT * FROM reference_sources WHERE id = $1`, [referenceId]);
  if (current.rowCount === 0) {
    return null;
  }

  const existing = mapReferenceRow(current.rows[0]);
  const nextStatus = patch.syncStatus ?? existing.syncStatus;
  const nextError = patch.syncError === undefined ? existing.syncError ?? null : patch.syncError;
  const nextContext = patch.extractedStyleContext === undefined
    ? existing.extractedStyleContext
    : patch.extractedStyleContext;
  const nextDesignSystemStatus = patch.designSystemStatus === undefined
    ? existing.designSystemStatus
    : patch.designSystemStatus;
  const nextDesignSystemChecklist = patch.designSystemChecklist === undefined
    ? existing.designSystemChecklist
    : patch.designSystemChecklist;
  const nextDesignSystemNotes = patch.designSystemNotes === undefined
    ? existing.designSystemNotes
    : patch.designSystemNotes;

  const result = await pool.query(
    `
      UPDATE reference_sources
      SET sync_status = $2,
          sync_error = $3,
          extracted_style_context = $4::jsonb,
          design_system_status = $5,
          design_system_checklist = $6::jsonb,
          design_system_notes = $7,
          design_system_updated_at = CASE WHEN $8 THEN NOW() ELSE design_system_updated_at END,
          last_synced_at = CASE WHEN $9 THEN NOW() ELSE last_synced_at END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      referenceId,
      nextStatus,
      nextError,
      JSON.stringify(nextContext),
      nextDesignSystemStatus,
      JSON.stringify(nextDesignSystemChecklist),
      nextDesignSystemNotes,
      Boolean(patch.updateDesignSystemAt),
      Boolean(patch.updateSyncedAt)
    ]
  );

  return mapReferenceRow(result.rows[0]);
}

export async function getReferenceSource(referenceId: string): Promise<ReferenceSource | null> {
  const result = await pool.query(`SELECT * FROM reference_sources WHERE id = $1`, [referenceId]);
  if (result.rowCount === 0) {
    return null;
  }

  return mapReferenceRow(result.rows[0]);
}

export async function getProjectStyleContexts(projectId: string): Promise<ReferenceStyleContext[]> {
  const result = await pool.query(
    `
      SELECT extracted_style_context
      FROM reference_sources
      WHERE project_id = $1
        AND sync_status = 'synced'
        AND extracted_style_context IS NOT NULL
      ORDER BY last_synced_at DESC NULLS LAST
    `,
    [projectId]
  );

  return result.rows
    .map((row) => parseJson<ReferenceStyleContext | null>(row.extracted_style_context, null))
    .filter((context): context is ReferenceStyleContext => Boolean(context));
}

export async function getLatestSyncedReference(projectId: string): Promise<ReferenceSource | null> {
  const result = await pool.query(
    `
      SELECT *
      FROM reference_sources
      WHERE project_id = $1
        AND sync_status = 'synced'
      ORDER BY last_synced_at DESC NULLS LAST, created_at DESC
      LIMIT 1
    `,
    [projectId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapReferenceRow(result.rows[0]);
}

export async function createFrameRecord(input: {
  projectId: string;
  name: string;
  devicePreset: DevicePreset;
  mode: "wireframe" | "high-fidelity";
  position: { x: number; y: number };
  size: { width: number; height: number };
  status: "building" | "ready";
  selected?: boolean;
  frameKind?: FrameKind;
  flowDocument?: FlowDocument;
}): Promise<Frame> {
  if (input.selected) {
    await pool.query(`UPDATE frames SET selected = FALSE WHERE project_id = $1`, [input.projectId]);
  }

  const id = crypto.randomUUID();
  const result = await pool.query(
    `
      INSERT INTO frames (
        id, project_id, name, device_preset, mode, selected, position, size, status, frame_kind, flow_document
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11::jsonb)
      RETURNING *
    `,
    [
      id,
      input.projectId,
      input.name,
      input.devicePreset,
      input.mode,
      Boolean(input.selected),
      JSON.stringify(input.position),
      JSON.stringify(input.size),
      input.status,
      input.frameKind ?? "design",
      input.flowDocument ? JSON.stringify(input.flowDocument) : null
    ]
  );

  return mapFrameRow(result.rows[0]);
}

export async function updateFrameLayout(
  frameId: string,
  patch: {
    position?: { x: number; y: number };
    size?: { width: number; height: number };
    selected?: boolean;
  }
): Promise<Frame | null> {
  const currentResult = await pool.query(`SELECT * FROM frames WHERE id = $1`, [frameId]);
  if (currentResult.rowCount === 0) {
    return null;
  }

  const current = mapFrameRow(currentResult.rows[0]);
  if (patch.selected) {
    await pool.query(`UPDATE frames SET selected = FALSE WHERE project_id = $1`, [current.projectId]);
  }

  const result = await pool.query(
    `
      UPDATE frames
      SET position = $2::jsonb,
          size = $3::jsonb,
          selected = $4,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      frameId,
      JSON.stringify(patch.position ?? current.position),
      JSON.stringify(patch.size ?? current.size),
      patch.selected ?? current.selected
    ]
  );

  return mapFrameRow(result.rows[0]);
}

export async function updateFlowDocument(frameId: string, flowDocument: FlowDocument): Promise<Frame | null> {
  const result = await pool.query(
    `
      UPDATE frames
      SET flow_document = $2::jsonb,
          updated_at = NOW()
      WHERE id = $1 AND frame_kind = 'flow'
      RETURNING *
    `,
    [frameId, JSON.stringify(flowDocument)]
  );
  if (result.rowCount === 0) {
    return null;
  }
  return mapFrameRow(result.rows[0]);
}

export async function updateFrameStatus(frameId: string, status: "building" | "ready") {
  await pool.query(`UPDATE frames SET status = $2, updated_at = NOW() WHERE id = $1`, [frameId, status]);
}

export async function getFrame(frameId: string): Promise<Frame | null> {
  const result = await pool.query(`SELECT * FROM frames WHERE id = $1`, [frameId]);
  if (result.rowCount === 0) {
    return null;
  }

  return mapFrameRow(result.rows[0]);
}

export async function deleteFrame(frameId: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM frame_versions WHERE frame_id = $1`, [frameId]);
  const frameResult = await pool.query(`DELETE FROM frames WHERE id = $1`, [frameId]);
  return (frameResult.rowCount ?? 0) > 0;
}

export async function getFrameVersions(frameId: string): Promise<FrameVersion[]> {
  const result = await pool.query(`SELECT * FROM frame_versions WHERE frame_id = $1 ORDER BY created_at ASC`, [frameId]);
  return result.rows.map(mapFrameVersionRow);
}

export async function getLatestFrameVersion(frameId: string): Promise<FrameVersion | null> {
  const result = await pool.query(
    `SELECT * FROM frame_versions WHERE frame_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [frameId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapFrameVersionRow(result.rows[0]);
}

export async function getFrameWithVersions(frameId: string): Promise<FrameWithVersions | null> {
  const frame = await getFrame(frameId);
  if (!frame) {
    return null;
  }

  const versions = await getFrameVersions(frameId);
  return {
    ...frame,
    versions
  };
}

export async function createFrameVersionRecord(input: {
  frameId: string;
  sourceCode: string;
  cssCode: string;
  exportHtml: string;
  tailwindEnabled: boolean;
  passOutputs: Record<string, unknown>;
  diffFromPrevious: {
    addedLines: number;
    removedLines: number;
    changedLines: number;
  };
}): Promise<FrameVersion> {
  const id = crypto.randomUUID();

  const result = await pool.query(
    `
      INSERT INTO frame_versions (
        id, frame_id, source_code, css_code, export_html, tailwind_enabled, pass_outputs, diff_from_previous
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
      RETURNING *
    `,
    [
      id,
      input.frameId,
      input.sourceCode,
      input.cssCode,
      input.exportHtml,
      input.tailwindEnabled,
      JSON.stringify(input.passOutputs),
      JSON.stringify(input.diffFromPrevious)
    ]
  );

  await pool.query(
    `
      UPDATE frames
      SET current_version_id = $2,
          status = 'ready',
          updated_at = NOW()
      WHERE id = $1
    `,
    [input.frameId, id]
  );

  return mapFrameVersionRow(result.rows[0]);
}

export async function createPipelineRun(input: {
  projectId: string;
  frameId: string | null;
  prompt: string;
  provider: "openai" | "anthropic" | "google";
  model: string;
}): Promise<PipelineRun> {
  const id = crypto.randomUUID();
  const passStatusMap = {
    enhance: "idle",
    plan: "idle",
    generate: "idle",
    repair: "idle",
    "diff-repair": "idle"
  };

  const result = await pool.query(
    `
      INSERT INTO pipeline_runs (
        id, project_id, frame_id, prompt, status, provider, model, pass_status_map, started_at
      )
      VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7::jsonb, NOW())
      RETURNING *
    `,
    [id, input.projectId, input.frameId, input.prompt, input.provider, input.model, JSON.stringify(passStatusMap)]
  );

  return mapRunRow(result.rows[0]);
}

export async function updatePipelineRun(
  runId: string,
  patch: {
    status?: RunStatus;
    passStatusMap?: Record<string, RunStatus | "idle">;
    frameId?: string | null;
    finished?: boolean;
  }
): Promise<PipelineRun | null> {
  const currentResult = await pool.query(`SELECT * FROM pipeline_runs WHERE id = $1`, [runId]);
  if (currentResult.rowCount === 0) {
    return null;
  }

  const current = mapRunRow(currentResult.rows[0]);
  const nextStatus = patch.status ?? current.status;
  const nextPassStatusMap = patch.passStatusMap ?? current.passStatusMap;
  const nextFrameId = patch.frameId === undefined ? current.frameId : patch.frameId;

  const result = await pool.query(
    `
      UPDATE pipeline_runs
      SET status = $2,
          pass_status_map = $3::jsonb,
          frame_id = $4,
          finished_at = CASE WHEN $5 THEN NOW() ELSE finished_at END
      WHERE id = $1
      RETURNING *
    `,
    [runId, nextStatus, JSON.stringify(nextPassStatusMap), nextFrameId, Boolean(patch.finished)]
  );

  return mapRunRow(result.rows[0]);
}

export async function updateRunPassOutputs(
  runId: string,
  key: string,
  value: unknown
): Promise<void> {
  await pool.query(
    `
      UPDATE pipeline_runs
      SET pass_outputs = pass_outputs || jsonb_build_object($2::text, $3::jsonb)
      WHERE id = $1
    `,
    [runId, key, JSON.stringify(value)]
  );
}

export async function getRunPassOutputs(runId: string): Promise<Record<string, unknown>> {
  const result = await pool.query(`SELECT pass_outputs FROM pipeline_runs WHERE id = $1`, [runId]);
  if (!result.rows[0]) return {};
  return parseJson<Record<string, unknown>>(result.rows[0].pass_outputs, {});
}

export async function appendPipelineEvent(event: PipelineEvent): Promise<PipelineEvent> {
  const result = await pool.query(
    `
      INSERT INTO pipeline_events (
        run_id, stage, status, kind, message, payload
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING *
    `,
    [event.runId, event.stage, event.status, event.kind, event.message, JSON.stringify(event.payload ?? null)]
  );

  const row = result.rows[0];
  return {
    id: Number(row.id),
    runId: row.run_id,
    timestamp: toIso(row.timestamp) ?? new Date().toISOString(),
    stage: row.stage,
    status: row.status,
    kind: row.kind,
    message: row.message,
    payload: parseJson<Record<string, unknown> | undefined>(row.payload, undefined)
  };
}

export async function getPipelineEvents(runId: string): Promise<PipelineEvent[]> {
  const result = await pool.query(
    `SELECT * FROM pipeline_events WHERE run_id = $1 ORDER BY id ASC`,
    [runId]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    runId: row.run_id,
    timestamp: toIso(row.timestamp) ?? new Date().toISOString(),
    stage: row.stage,
    status: row.status,
    kind: row.kind,
    message: row.message,
    payload: parseJson<Record<string, unknown> | undefined>(row.payload, undefined)
  }));
}

export async function appendChatMessage(input: {
  projectId: string;
  runId: string | null;
  role: "user" | "agent";
  content: string;
}) {
  await pool.query(
    `
      INSERT INTO chat_messages (project_id, run_id, role, content)
      VALUES ($1, $2, $3, $4)
    `,
    [input.projectId, input.runId, input.role, input.content]
  );
}

export async function closeDatabase() {
  await pool.end();
}
