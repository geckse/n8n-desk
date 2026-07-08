import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'

// --- Types (mirrored from src/types/plugin.ts for electron main process isolation) ---

interface LoadedSkill {
  name: string
  description: string
  content: string
  disableModelInvocation: boolean
  userInvocable: boolean
  allowedTools?: string[]
  directory: string
  source: 'user' | 'built-in' | string
  /** True for skills shipped with the app (loaded from skills/plugins/) */
  builtIn?: boolean
}

/** Raw SKILL.md frontmatter fields (kebab-case as written in YAML) */
interface SkillFrontmatter {
  name?: string
  description?: string
  'disable-model-invocation'?: boolean
  'user-invocable'?: boolean
  'allowed-tools'?: string[]
}

// --- Constants ---

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')
const USER_SKILLS_DIR = path.join(BASE_DIR, 'skills')
const PLUGINS_CACHE_DIR = path.join(BASE_DIR, 'plugins', 'cache')

/**
 * Resolve the built-in skills directory (skills shipped with the app).
 *
 * In dev: the skills submodule at project root / skills / plugins
 * In production: bundled into Electron's app resources
 *
 * Uses a lazy import of `electron` so this module can also be used
 * in test environments where Electron is not available.
 */
export function getBuiltinSkillsDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron')
    if (app.isPackaged) {
      // extraResource copies skills/plugins → resources/plugins
      return path.join(process.resourcesPath, 'plugins')
    }
  } catch {
    // Electron not available (e.g., tests) — fall through to dev path
  }
  // Dev: __dirname is electron/dist/ after esbuild bundling → go up two levels to project root
  return path.join(__dirname, '..', '..', 'skills', 'plugins')
}

// --- SKILL.md Parsing ---

/**
 * Parse a SKILL.md file into a LoadedSkill.
 * Uses `gray-matter` to extract YAML frontmatter and markdown body.
 * Returns null if the file is missing required fields (name, description).
 *
 * Frontmatter fields (kebab-case):
 * - name: string (required) — kebab-case skill identifier
 * - description: string (required) — short description for system prompt
 * - disable-model-invocation: boolean (optional, default false)
 * - user-invocable: boolean (optional, default true)
 * - allowed-tools: string[] (optional) — tools the skill may reference
 */
export async function parseSkillMd(
  filePath: string,
  source: 'user' | string,
): Promise<LoadedSkill | null> {
  let fileContents: string
  try {
    fileContents = await fs.readFile(filePath, 'utf-8')
  } catch {
    console.warn(`[n8n-desk] Could not read skill file: ${filePath}`)
    return null
  }

  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(fileContents)
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err)
    console.warn(`[n8n-desk] Invalid YAML frontmatter in ${filePath}: ${errMessage}`)
    return null
  }

  const data = parsed.data as SkillFrontmatter
  const content = parsed.content.trim()

  // name and description are required
  if (!data.name || typeof data.name !== 'string') {
    console.warn(`[n8n-desk] Skipping skill at ${filePath} — missing or invalid 'name' field`)
    return null
  }

  if (!data.description || typeof data.description !== 'string') {
    console.warn(`[n8n-desk] Skipping skill at ${filePath} — missing or invalid 'description' field`)
    return null
  }

  // Parse optional boolean fields with safe defaults
  const disableModelInvocation = data['disable-model-invocation'] === true
  const userInvocable = data['user-invocable'] !== false // default true

  // Parse optional allowed-tools array
  let allowedTools: string[] | undefined
  if (Array.isArray(data['allowed-tools'])) {
    allowedTools = data['allowed-tools'].filter(
      (t): t is string => typeof t === 'string' && t.length > 0,
    )
    if (allowedTools.length === 0) allowedTools = undefined
  }

  return {
    name: data.name,
    description: data.description,
    content,
    disableModelInvocation,
    userInvocable,
    allowedTools,
    directory: path.dirname(filePath),
    source,
  }
}

// --- Skill Loading ---

/**
 * Scan a directory for subdirectories containing SKILL.md files.
 * Each subdirectory with a SKILL.md is treated as a skill.
 * Returns an array of parsed skills, skipping invalid ones.
 */
async function scanSkillDirectory(
  baseDir: string,
  source: 'user' | string,
): Promise<LoadedSkill[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(baseDir)
  } catch {
    // Directory doesn't exist — not an error, just no skills
    return []
  }

  const skills: LoadedSkill[] = []

  for (const entry of entries) {
    // Skip hidden directories (e.g. .archive)
    if (entry.startsWith('.')) continue

    const skillDir = path.join(baseDir, entry)

    // Verify it's a directory
    try {
      const stat = await fs.stat(skillDir)
      if (!stat.isDirectory()) continue
    } catch {
      continue
    }

    const skillMdPath = path.join(skillDir, 'SKILL.md')
    const skill = await parseSkillMd(skillMdPath, source)
    if (skill) {
      skills.push(skill)
    }
  }

  return skills
}

/**
 * Load all skills from three locations in priority order (later overrides earlier):
 * 1. Built-in skills (shipped with the app — lowest priority)
 * 2. Plugin cache directories (installed via marketplace)
 * 3. User-created skills (~/.n8n-desk/skills/ — highest priority)
 *
 * This allows users to override built-in skills by placing a SKILL.md
 * with the same name in their user skills directory.
 *
 * In dev mode, built-in skills are read directly from the skills submodule,
 * so editing them takes effect on the next agent invocation (no restart needed).
 */
export async function loadAllSkills(): Promise<LoadedSkill[]> {
  const skillsByName = new Map<string, LoadedSkill>()

  // 1. Built-in skills (lowest priority — overridable by plugins and user)
  const builtinDir = getBuiltinSkillsDir()
  const builtinSkills = await scanSkillDirectory(builtinDir, 'built-in')
  for (const skill of builtinSkills) {
    skill.builtIn = true
    skillsByName.set(skill.name, skill)
  }

  // 2. Scan plugin cache directories for skills/ subdirectories
  try {
    const pluginDirs = await fs.readdir(PLUGINS_CACHE_DIR)
    for (const pluginDir of pluginDirs) {
      if (pluginDir.startsWith('.')) continue

      const pluginSkillsDir = path.join(PLUGINS_CACHE_DIR, pluginDir, 'skills')
      const pluginSkills = await scanSkillDirectory(pluginSkillsDir, pluginDir)
      for (const skill of pluginSkills) {
        skillsByName.set(skill.name, skill)
      }
    }
  } catch {
    // plugins/cache/ doesn't exist yet — no plugin skills
  }

  // 3. Scan user skills directory — user skills override everything
  const userSkills = await scanSkillDirectory(USER_SKILLS_DIR, 'user')
  for (const skill of userSkills) {
    skillsByName.set(skill.name, skill)
  }

  return Array.from(skillsByName.values())
}

// --- Skill Description Builder ---

/**
 * Build a compact description block for injection into the system prompt.
 * Contains ONLY skill names and short descriptions — NOT full content.
 * This ensures lazy loading: the agent sees what skills exist and can
 * invoke them by name, but full content is only expanded on invocation.
 *
 * The block explicitly teaches the invocation mechanism (invoke_skill /
 * read_skill_file) — lazy loading must not depend on the model inferring it
 * (audit #58).
 *
 * Returns null if no skills are provided.
 */
export function buildSkillDescriptions(skills: LoadedSkill[]): string | null {
  if (skills.length === 0) return null

  const lines = skills.map((s) => `- ${s.name}: ${s.description}`)
  return [
    '## Available Skills',
    '',
    'Skills are packaged step-by-step instructions for specific tasks. Only the',
    'names and descriptions below are loaded — when a task matches a skill, call',
    'the **invoke_skill** tool with its `skillName` (and optional `arguments`)',
    'BEFORE attempting the task on your own, then follow the returned',
    'instructions. If the returned content references supporting files (for',
    'example PATTERNS.md), load them with **read_skill_file**.',
    '',
    ...lines,
  ].join('\n')
}

// --- Argument Substitution ---

/**
 * Replace argument placeholders in skill content.
 *
 * Placeholders:
 * - `$ARGUMENTS` — replaced with the full arguments string
 * - `$0`, `$1`, `$2`, ... — replaced with positional arguments (space-split)
 *
 * Positional arguments are extracted by splitting the args string on whitespace.
 * Unreferenced positional placeholders (e.g. `$3` when only 2 args) are left intact.
 */
export function substituteArguments(content: string, args: string): string {
  // Replace $ARGUMENTS with the full arguments string
  let result = content.replace(/\$ARGUMENTS/g, args)

  // Split args into positional arguments
  const positional = args.trim().length > 0
    ? args.trim().split(/\s+/)
    : []

  // Replace positional placeholders $0, $1, $2, etc.
  // Only replace placeholders that have corresponding arguments
  for (let i = 0; i < positional.length; i++) {
    const placeholder = new RegExp(`\\$${i}(?![0-9])`, 'g')
    result = result.replace(placeholder, positional[i])
  }

  return result
}

// --- Supporting File Reader ---

/**
 * Read a supporting file referenced from a skill's directory.
 * Resolves the relative path against the skill's directory.
 * Returns the file contents as a string, or null if the file doesn't exist.
 *
 * Security: the resolved path must be within the skill's directory
 * to prevent directory traversal attacks.
 */
export async function readSupportingFile(
  skill: LoadedSkill,
  relativePath: string,
): Promise<string | null> {
  const resolvedPath = path.resolve(skill.directory, relativePath)

  // Security: ensure the resolved path is within the skill directory
  const normalizedSkillDir = path.resolve(skill.directory) + path.sep
  const normalizedResolved = path.resolve(resolvedPath)
  if (!normalizedResolved.startsWith(normalizedSkillDir) && normalizedResolved !== path.resolve(skill.directory)) {
    console.warn(
      `[n8n-desk] Refusing to read file outside skill directory: ${relativePath} (resolved to ${resolvedPath})`,
    )
    return null
  }

  try {
    return await fs.readFile(resolvedPath, 'utf-8')
  } catch {
    return null
  }
}

// --- User Skill CRUD (for IPC handlers) ---

/**
 * Save a user-created skill as a SKILL.md file.
 * Creates the skill directory at ~/.n8n-desk/skills/{name}/SKILL.md.
 *
 * The caller provides pre-formatted SKILL.md content (YAML frontmatter + markdown body).
 * If a skill with the same name already exists, it is overwritten.
 */
export async function saveUserSkill(
  name: string,
  skillMdContent: string,
): Promise<void> {
  // Sanitize name to prevent directory traversal
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '-')
  const skillDir = path.join(USER_SKILLS_DIR, safeName)
  await fs.mkdir(skillDir, { recursive: true, mode: 0o700 })
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMdContent, {
    encoding: 'utf-8',
    mode: 0o600,
  })
}

/**
 * Delete a user-created skill by removing its directory.
 * Only deletes from the user skills directory — plugin skills cannot be deleted this way.
 */
export async function deleteUserSkill(name: string): Promise<void> {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '-')
  const skillDir = path.join(USER_SKILLS_DIR, safeName)

  try {
    await fs.rm(skillDir, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup — directory may not exist
  }
}
