import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

// Determine database path based on environment
// In production (Coolify), use /app/data for persistent volume
// In development, use project root
const getDbPath = (): string => {
    const dataDir = process.env.NODE_ENV === "production"
        ? "/app/data"
        : path.join(process.cwd(), "data");

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    return path.join(dataDir, "codegem.db");
};

let db: Database.Database | null = null;

export function getDb(): Database.Database {
    if (!db) {
        const dbPath = getDbPath();
        db = new Database(dbPath);

        // Enable WAL mode for better concurrent read performance
        db.pragma("journal_mode = WAL");

        // Improve write performance
        db.pragma("synchronous = NORMAL");

        // Initialize schema
        initSchema(db);

        // Run migrations for existing databases
        runMigrations(db);
    }
    return db;
}

function initSchema(database: Database.Database): void {
    database.exec(`
    -- repos: Stores parsed repository files (from GitHub imports)
    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      repo_id TEXT NOT NULL,
      project_id TEXT,
      url TEXT,
      owner TEXT,
      name TEXT,
      path TEXT NOT NULL,
      language TEXT,
      extension TEXT,
      source_code TEXT,
      ast TEXT,
      parse_status TEXT DEFAULT 'success',
      parse_error TEXT,
      size INTEGER,
      is_dir INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_repos_repo_id ON repos(repo_id);
    CREATE INDEX IF NOT EXISTS idx_repos_user_id ON repos(user_id);
    CREATE INDEX IF NOT EXISTS idx_repos_path ON repos(path);
    -- Composite index for hot query pattern (improvement C)
    CREATE INDEX IF NOT EXISTS idx_repos_user_repo_path ON repos(user_id, repo_id, path);

    -- files: Stores user-created files and project files
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      repo_id TEXT,
      project_id TEXT,
      project_name TEXT,
      path TEXT NOT NULL,
      is_dir INTEGER DEFAULT 0,
      language TEXT,
      extension TEXT,
      source_code TEXT,
      ast TEXT,
      size INTEGER,
      parse_status TEXT DEFAULT 'success',
      parse_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);
    CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
    CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
    CREATE INDEX IF NOT EXISTS idx_files_repo_id ON files(repo_id);
    -- Composite index for hot query pattern (improvement C)
    CREATE INDEX IF NOT EXISTS idx_files_user_project_path ON files(user_id, project_id, path);

    -- quizzes: Stores quiz definitions
    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      origin TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      root_node TEXT NOT NULL,
      profile TEXT,
      is_canonical INTEGER DEFAULT 0,
      cards TEXT NOT NULL,
      section_markers TEXT,
      section_names TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_quizzes_user_id ON quizzes(user_id);
    CREATE INDEX IF NOT EXISTS idx_quizzes_file_id ON quizzes(file_id);
    CREATE INDEX IF NOT EXISTS idx_quizzes_canonical ON quizzes(is_canonical);

    -- quiz_attempts: Stores quiz attempt records
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      quiz_id TEXT NOT NULL,
      section_index INTEGER NOT NULL,
      attempted_at TEXT NOT NULL,
      total_questions INTEGER NOT NULL,
      correct_answers INTEGER NOT NULL,
      score REAL NOT NULL,
      medal_earned TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_attempts_user_quiz ON quiz_attempts(user_id, quiz_id);
    CREATE INDEX IF NOT EXISTS idx_attempts_section ON quiz_attempts(quiz_id, section_index);

    -- distractor_runs: Stores background distractor generation runs
    CREATE TABLE IF NOT EXISTS distractor_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      quiz_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      total INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      updated_cards TEXT,
      failures TEXT,
      skipped INTEGER NOT NULL DEFAULT 0,
      provider TEXT,
      model TEXT,
      batch_size INTEGER,
      missing_only INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_runs_user_quiz ON distractor_runs(user_id, quiz_id);
  `);
}

// Improvement A: Schema migrations for existing databases
function runMigrations(database: Database.Database): void {
    // Helper to safely add columns if they don't exist
    const ensureColumn = (table: string, column: string, ddl: string) => {
        const info = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (!info.some(r => r.name === column)) {
            database.exec(ddl);
        }
    };

    // Helper to safely create index (catches errors if duplicates exist)
    const ensureIndex = (ddl: string) => {
        try {
            database.exec(ddl);
        } catch (e) {
            // Index creation may fail if duplicates exist - log but don't crash
            console.warn("Index creation skipped (may have duplicates):", ddl, e);
        }
    };

    // Add parse_status and parse_error to files if missing (for existing databases)
    ensureColumn("files", "parse_status",
        `ALTER TABLE files ADD COLUMN parse_status TEXT DEFAULT 'success'`);
    ensureColumn("files", "parse_error",
        `ALTER TABLE files ADD COLUMN parse_error TEXT`);

    // Fix #5: Also migrate repos table (if created before these columns existed)
    ensureColumn("repos", "parse_status",
        `ALTER TABLE repos ADD COLUMN parse_status TEXT DEFAULT 'success'`);
    ensureColumn("repos", "parse_error",
        `ALTER TABLE repos ADD COLUMN parse_error TEXT`);

    // Unique indexes to prevent duplicate paths (with safe try/catch)
    // These may fail if duplicates already exist in the database
    ensureIndex(`CREATE UNIQUE INDEX IF NOT EXISTS uq_repos_user_repo_path ON repos(user_id, repo_id, path)`);
    ensureIndex(`CREATE UNIQUE INDEX IF NOT EXISTS uq_files_user_project_path ON files(user_id, project_id, path)`);
}

// Helper to generate UUID-like IDs (using explicit crypto import - improvement E)
export function generateId(): string {
    return crypto.randomUUID();
}

// Helper to convert dates to ISO strings for storage
export function toDbDate(date: Date | string | undefined): string {
    if (!date) return new Date().toISOString();
    if (typeof date === "string") return date;
    return date.toISOString();
}

// Helper to parse dates from storage
export function fromDbDate(dateStr: string | null | undefined): Date | null {
    if (!dateStr) return null;
    return new Date(dateStr);
}

// Helper to safely JSON stringify
export function toJson(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
}

// Helper to safely JSON parse
export function fromJson<T>(value: string | null | undefined): T | null {
    if (!value) return null;
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
}

// Close database connection (for cleanup)
export function closeDb(): void {
    if (db) {
        db.close();
        db = null;
    }
}
