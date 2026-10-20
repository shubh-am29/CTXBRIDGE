'use strict'

const fs           = require('fs')
const path         = require('path')
const { execSync } = require('child_process')

const {
  EXTENSION_TO_LANGUAGE: EXT_LANG,
  LANGUAGES,
} = require('./language-registry')

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn',
  'venv', '.venv', 'env',
  '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  'dist', 'build', 'out', 'target', 'bin', 'obj',
  '.next', '.nuxt', '.svelte-kit', '.turbo',
  'vendor', 'coverage', '.coverage',
  '.contextbridge', '.cache', 'tmp', 'temp',
])

const MAX_SOURCE_FILES = 400
const MAX_READ_BYTES   = 10000
const MAX_DEPTH        = 5
const MAX_PATTERN_FILES = 60  // per language, for source scanning

const LANG_DISPLAY = Object.fromEntries(
  Object.values(LANGUAGES).map(language => [
    language.id,
    language.name,
  ])
)

// Files whose text content we always want cached in the snapshot
const ALWAYS_READ = new Set([
  'package.json', 'requirements.txt', 'pyproject.toml', 'Pipfile',
  'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile',
  'vite.config.js', 'vite.config.ts',
  'next.config.js', 'next.config.ts', 'next.config.mjs',
  'angular.json', 'svelte.config.js', 'svelte.config.ts',
  'nuxt.config.js', 'nuxt.config.ts',
  'tsconfig.json', 'jsconfig.json',
  'jest.config.js', 'jest.config.ts',
  'vitest.config.js', 'vitest.config.ts',
  'playwright.config.js', 'playwright.config.ts',
  'cypress.config.js', 'cypress.config.ts',
  'vercel.json', 'netlify.toml', 'render.yaml', 'fly.toml',
  'serverless.yml', 'serverless.yaml',
  'docker-compose.yml', 'docker-compose.yaml',
  'pnpm-workspace.yaml', 'lerna.json', 'turbo.json', 'nx.json',
  'manage.py', 'app.py', 'wsgi.py', 'asgi.py',
  'Program.cs', 'Dockerfile',
  'README.md', 'readme.md',
  'CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md',
  '.env', '.env.example',
  'eslint.config.js', '.eslintrc', '.eslintrc.js', '.eslintrc.json',
  'prettier.config.js', '.prettierrc',
  'pytest.ini', 'setup.cfg',
  'pytest.ini',
])

const MIN_CONFIDENCE = 35

// ─────────────────────────────────────────────────────────────────────────────
// Safe I/O primitives  (used only inside collectProjectSnapshot)
// ─────────────────────────────────────────────────────────────────────────────

function safeReadBytes(filePath, maxBytes) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size === 0) return ''
    const size = Math.min(stat.size, maxBytes)
    const buf  = Buffer.alloc(size)
    const fd   = fs.openSync(filePath, 'r')
    fs.readSync(fd, buf, 0, size, 0)
    fs.closeSync(fd)
    return buf.toString('utf8')
  } catch { return '' }
}

function safeStat(p) {
  try { return fs.statSync(p) } catch { return null }
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }) }
  catch { return [] }
}

function safeExec(cmd, cwd) {
  try {
    return execSync(cmd, {
      cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000
    }).toString().trim()
  } catch { return null }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT SNAPSHOT  — single pass over the filesystem
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk the project once and build a shared snapshot.
 * Every subsequent analyser reads from this — no duplicate fs calls.
 *
 * snapshot shape:
 * {
 *   cwd           : string
 *   files         : string[]          — all source file abs paths
 *   fileSet       : Set<string>       — abs paths for O(1) existence check
 *   relSet        : Set<string>       — rel paths (e.g. 'src/App.jsx')
 *   fileContents  : Map<rel, string>  — cached text of ALWAYS_READ files
 *   jsonFiles     : Map<rel, object>  — parsed JSON for JSON files
 *   byLanguage    : Map<lang, string[]> — source files grouped by language
 *   dirs          : Set<string>       — all directory rel paths seen
 * }
 */
function collectProjectSnapshot(cwd) {
  const snapshot = {
    cwd,
    files:        [],      // source files (abs)
    fileSet:      new Set(),
    relSet:       new Set(),
    fileContents: new Map(),
    jsonFiles:    new Map(),
    byLanguage:   new Map(),
    dirs:         new Set(),
  }

  let sourceCount = 0

  function walk(dir, depth, relBase) {
    if (depth > MAX_DEPTH) return
    const entries = safeReaddir(dir)

    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) {
          snapshot.dirs.add(rel)
          walk(abs, depth + 1, rel)
        }
        continue
      }

      if (!entry.isFile()) continue

      // Track every file we see (for config / doc existence checks)
      snapshot.fileSet.add(abs)
      snapshot.relSet.add(rel)

      // Cache content for known config / doc files
      if (ALWAYS_READ.has(entry.name)) {
        const content = safeReadBytes(abs, MAX_READ_BYTES)
        snapshot.fileContents.set(rel, content)

        if (entry.name.endsWith('.json')) {
          try { snapshot.jsonFiles.set(rel, JSON.parse(content)) }
          catch { /* malformed JSON — skip */ }
        }
      }

      // Collect source files (by language)
      if (sourceCount < MAX_SOURCE_FILES) {
        const ext  = path.extname(entry.name).toLowerCase()
        const lang = EXT_LANG[ext]
        if (lang) {
          snapshot.files.push(abs)
          sourceCount++
          if (!snapshot.byLanguage.has(lang)) snapshot.byLanguage.set(lang, [])
          snapshot.byLanguage.get(lang).push(abs)
        }
      }
    }
  }

  walk(cwd, 0, '')
  return snapshot
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot helpers  (replace all the old exists / safeRead calls)
// ─────────────────────────────────────────────────────────────────────────────

/** Check file existence using the snapshot (O(1), no fs call) */
function has(snapshot, ...relParts) {
  return snapshot.relSet.has(relParts.join('/'))
}

/** Return cached text content (or '' if not found / not read) */
function content(snapshot, ...relParts) {
  return snapshot.fileContents.get(relParts.join('/')) || ''
}

/** Return cached parsed JSON (or null) */
function json(snapshot, ...relParts) {
  return snapshot.jsonFiles.get(relParts.join('/')) || null
}

/** Check whether a directory rel path exists */
function hasDir(snapshot, ...relParts) {
  return snapshot.dirs.has(relParts.join('/'))
}

/** Read a source file — uses snapshot for ALWAYS_READ, raw read otherwise */
function readSource(snapshot, absPath) {
  const rel = path.relative(snapshot.cwd, absPath)
  if (snapshot.fileContents.has(rel)) return snapshot.fileContents.get(rel)
  // Source files not in ALWAYS_READ: read on demand, cache result
  const text = safeReadBytes(absPath, MAX_READ_BYTES)
  snapshot.fileContents.set(rel, text)
  return text
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSER 1 — Languages
// ─────────────────────────────────────────────────────────────────────────────

function analyseLanguages(snapshot) {
  const summary = {}
  for (const [lang, files] of snapshot.byLanguage) {
    summary[lang] = files.length
  }
  const dominant = [...snapshot.byLanguage.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([lang]) => lang)

  return { summary, dominant }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSER 2 — Config files
// ─────────────────────────────────────────────────────────────────────────────

function analyseConfigs(snapshot) {
  const h = (...parts) => has(snapshot, ...parts)
  const hd = (...parts) => hasDir(snapshot, ...parts)

  return {
    // JS frameworks
    hasViteConfig:      h('vite.config.js')    || h('vite.config.ts'),
    hasNextConfig:      h('next.config.js')    || h('next.config.ts') || h('next.config.mjs'),
    hasAngularJson:     h('angular.json'),
    hasSvelteConfig:    h('svelte.config.js')  || h('svelte.config.ts'),
    hasNuxtConfig:      h('nuxt.config.js')    || h('nuxt.config.ts'),
    hasTsConfig:        h('tsconfig.json'),
    hasJsConfig:        h('jsconfig.json'),
    hasEslint:          h('eslint.config.js')  || h('.eslintrc') || h('.eslintrc.js') || h('.eslintrc.json'),
    hasPrettier:        h('prettier.config.js') || h('.prettierrc'),
    // React entry signals
    hasSrcAppJsx:       h('src', 'App.jsx')    || h('src', 'App.tsx'),
    hasSrcMainJsx:      h('src', 'main.jsx')   || h('src', 'main.tsx'),
    hasIndexHtml:       h('index.html'),
    // Python
    hasManagePy:        h('manage.py'),
    hasAppPy:           h('app.py'),
    hasWsgiPy:          h('wsgi.py'),
    hasAsgiPy:          h('asgi.py'),
    // Java / JVM
    hasPomXml:          h('pom.xml'),
    hasBuildGradle:     h('build.gradle'),
    hasProgramCs:       h('Program.cs'),
    // Systems
    hasCargoToml:       h('Cargo.toml'),
    hasGoMod:           h('go.mod'),
    hasComposerJson:    h('composer.json'),
    hasGemfile:         h('Gemfile'),
    // DevOps / infra
    hasDockerfile:      h('Dockerfile'),
    hasDockerCompose:   h('docker-compose.yml') || h('docker-compose.yaml'),
    hasVercelJson:      h('vercel.json'),
    hasNetlifyToml:     h('netlify.toml'),
    hasRenderYaml:      h('render.yaml'),
    hasFlyToml:         h('fly.toml'),
    hasServerlessYml:   h('serverless.yml')    || h('serverless.yaml'),
    hasTerraformDir:    hd('terraform'),
    hasK8sDir:          hd('k8s')              || hd('kubernetes'),
    hasGithubWorkflows: hd('.github', 'workflows'),
    // Monorepo
    hasPnpmWorkspace:   h('pnpm-workspace.yaml'),
    hasLernaJson:       h('lerna.json'),
    hasTurboJson:       h('turbo.json'),
    hasNxJson:          h('nx.json'),
    // Testing
    hasJestConfig:      h('jest.config.js')    || h('jest.config.ts'),
    hasVitestConfig:    h('vitest.config.js')  || h('vitest.config.ts'),
    hasPytestIni:       h('pytest.ini')        || h('setup.cfg'),
    hasPlaywright:      h('playwright.config.js') || h('playwright.config.ts'),
    hasCypress:         h('cypress.config.js') || h('cypress.config.ts'),
    // Dep manifests
    hasPackageJson:     h('package.json'),
    hasRequirementsTxt: h('requirements.txt'),
    hasPyprojectToml:   h('pyproject.toml'),
    hasPipfile:         h('Pipfile'),
    // Docs / agent files
    hasReadme:          h('README.md')         || h('readme.md'),
    hasClaudeMd:        h('CLAUDE.md'),
    hasAgentsMd:        h('AGENTS.md'),
    hasCopilotInstr:    h('.github', 'copilot-instructions.md'),
    hasContributing:    h('CONTRIBUTING.md'),
    hasArchitectureMd:  h('ARCHITECTURE.md'),
    hasDotEnv:          h('.env'),
    hasDotEnvExample:   h('.env.example'),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSER 3 — Dependencies
// ─────────────────────────────────────────────────────────────────────────────

function analyseDependencies(snapshot) {
  const deps = {
    // JS
    react: false, 'react-dom': false,
    next: false, vue: false, angular: false, svelte: false, nuxt: false,
    express: false, fastify: false, koa: false,
    vite: false, webpack: false, esbuild: false, rollup: false,
    jest: false, vitest: false, mocha: false,
    typescript: false, tailwindcss: false,
    prisma: false, mongoose: false, sequelize: false,
    supabase: false, firebase: false, redis: false,
    openai: false, langchain: false,
    commander: false, yargs: false, inquirer: false,
    axios: false, graphql: false,
    // Python
    fastapi: false, flask: false, django: false, starlette: false,
    uvicorn: false, gunicorn: false, celery: false,
    sqlalchemy: false, alembic: false,
    pydantic: false, httpx: false, requests: false, aiohttp: false,
    tensorflow: false, torch: false, keras: false,
    sklearn: false, pandas: false, numpy: false, scipy: false,
    langchain_py: false, openai_py: false,
    pytest: false, click: false, typer: false,
    // Rust
    actix: false, axum: false, tokio: false, serde: false,
    // Go
    gin: false, echo: false, fiber: false,
    // Java
    spring: false, quarkus: false, micronaut: false,
  }

  // ── package.json ───────────────────────────────────────────────────────────
  const pkg = json(snapshot, 'package.json')
  if (pkg) {
    const all = {
      ...(pkg.dependencies     || {}),
      ...(pkg.devDependencies  || {}),
      ...(pkg.peerDependencies || {}),
    }
    for (const key of Object.keys(deps)) {
      if (key in all) deps[key] = true
    }
    if ('@supabase/supabase-js' in all) deps.supabase = true
    if ('@prisma/client'        in all) deps.prisma    = true
    if ('@angular/core'         in all) deps.angular   = true
  }

  // ── requirements.txt ──────────────────────────────────────────────────────
  const req = content(snapshot, 'requirements.txt').toLowerCase()
  if (req) {
    const pyMap = [
      'fastapi', 'flask', 'django', 'uvicorn', 'gunicorn', 'celery',
      'sqlalchemy', 'alembic', 'pydantic', 'pytest', 'click', 'typer',
      'httpx', 'requests', 'aiohttp', 'starlette',
      'tensorflow', 'pandas', 'numpy', 'scipy',
    ]
    for (const k of pyMap) { if (req.includes(k)) deps[k] = true }
    if (req.includes('scikit-learn') || req.includes('sklearn')) deps.sklearn      = true
    if (req.includes('torch'))       deps.torch        = true
    if (req.includes('langchain'))   deps.langchain_py = true
    if (req.includes('openai'))      deps.openai_py    = true
  }

  // ── pyproject.toml / Pipfile ───────────────────────────────────────────────
  for (const rel of ['pyproject.toml', 'Pipfile']) {
    const txt = content(snapshot, rel).toLowerCase()
    if (!txt) continue
    const pyMap2 = ['fastapi','flask','django','pytest','pandas','torch','langchain','openai','sqlalchemy','click','uvicorn']
    for (const k of pyMap2) { if (txt.includes(k)) deps[k] = true }
    if (txt.includes('langchain')) deps.langchain_py = true
    if (txt.includes('openai'))    deps.openai_py    = true
  }

  // ── Cargo.toml ─────────────────────────────────────────────────────────────
  const cargo = content(snapshot, 'Cargo.toml').toLowerCase()
  if (cargo) {
    if (cargo.includes('actix')) deps.actix = true
    if (cargo.includes('axum'))  deps.axum  = true
    if (cargo.includes('tokio')) deps.tokio = true
    if (cargo.includes('serde')) deps.serde = true
  }

  // ── go.mod ─────────────────────────────────────────────────────────────────
  const gomod = content(snapshot, 'go.mod').toLowerCase()
  if (gomod) {
    if (gomod.includes('gin-gonic'))     deps.gin   = true
    if (gomod.includes('labstack/echo')) deps.echo  = true
    if (gomod.includes('gofiber'))       deps.fiber = true
  }

  // ── pom.xml / build.gradle ─────────────────────────────────────────────────
  for (const rel of ['pom.xml', 'build.gradle']) {
    const txt = content(snapshot, rel).toLowerCase()
    if (!txt) continue
    if (txt.includes('spring'))    deps.spring    = true
    if (txt.includes('quarkus'))   deps.quarkus   = true
    if (txt.includes('micronaut')) deps.micronaut = true
  }

  return { deps, pkg }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSER 4 — Folder structure
// ─────────────────────────────────────────────────────────────────────────────

function analyseStructure(snapshot) {
  const d = (...parts) => hasDir(snapshot, ...parts)
  return {
    hasSrc:          d('src'),
    hasApp:          d('app'),
    hasPages:        d('pages'),
    hasComponents:   d('components')  || d('src', 'components'),
    hasRoutes:       d('routes')      || d('src', 'routes'),
    hasControllers:  d('controllers'),
    hasModels:       d('models'),
    hasServices:     d('services'),
    hasApi:          d('api')         || d('src', 'api'),
    hasBackend:      d('backend'),
    hasFrontend:     d('frontend'),
    hasPublic:       d('public'),
    hasTests:        d('tests')       || d('test') || d('__tests__') || d('spec'),
    hasDocs:         d('docs')        || d('doc'),
    hasNotebooks:    d('notebooks')   || d('notebook'),
    hasDatasets:     d('data')        || d('dataset') || d('datasets'),
    hasScripts:      d('scripts'),
    hasConfig:       d('config'),
    hasInfra:        d('infra')       || d('infrastructure'),
    hasK8s:          d('k8s')         || d('kubernetes'),
    // Monorepo
    hasApps:         d('apps'),
    hasPackages:     d('packages'),
    hasClient:       d('client'),
    hasServer:       d('server'),
    hasMicroservices: d('services')   && (d('apps') || d('packages')),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSER 5 — Source-code patterns
// ─────────────────────────────────────────────────────────────────────────────

function analysePatterns(snapshot) {
  const pat = {
    reactImport: 0,   jsxComponent: 0, useHook: 0,   createRoot: 0,
    expressImport: 0, expressApp: 0,
    nextImport: 0,    getServerSideProps: 0,          useRouter: 0,
    fastapiImport: 0, fastapiInstance: 0,             fastapiRoute: 0,
    flaskImport: 0,   flaskInstance: 0,
    djangoImport: 0,
    sqlalchemyUse: 0, prismaClient: 0, mongooseUse: 0, supabaseUse: 0,
    modelFit: 0,      modelPredict: 0, torchNN: 0,
    tensorflowUse: 0, sklearnUse: 0,
    processArgv: 0,   commanderUse: 0,
    argparseUse: 0,   clickUse: 0,
    sqlQuery: 0,
  }

  // JS / TS files
  const jsFiles = [
    ...(snapshot.byLanguage.get('javascript') || []),
    ...(snapshot.byLanguage.get('typescript') || []),
  ].slice(0, MAX_PATTERN_FILES)

  for (const f of jsFiles) {
    const src = readSource(snapshot, f)
    if (!src) continue

    if (/from\s+['"]react['"]/i.test(src))                                      pat.reactImport++
    if (/return\s*\(\s*<[A-Z]|return\s*<[A-Z]/m.test(src))                     pat.jsxComponent++
    if (/\buse(State|Effect|Ref|Memo|Callback|Context|Reducer)\s*\(/i.test(src)) pat.useHook++
    if (/createRoot\s*\(/i.test(src))                                            pat.createRoot++
    if (/require\s*\(\s*['"]express['"]\s*\)|from\s+['"]express['"]/i.test(src)) pat.expressImport++
    if (/=\s*express\s*\(\s*\)/i.test(src))                                     pat.expressApp++
    if (/from\s+['"]next\//i.test(src))                                          pat.nextImport++
    if (/export.*getServerSideProps|export.*getStaticProps/i.test(src))          pat.getServerSideProps++
    if (/useRouter\s*\(\s*\)/i.test(src))                                        pat.useRouter++
    if (/new\s+PrismaClient\b/i.test(src))                                       pat.prismaClient++
    if (/mongoose\.(connect|model|Schema)/i.test(src))                           pat.mongooseUse++
    if (/supabase\.(from|auth|storage|rpc)/i.test(src))                         pat.supabaseUse++
    if (/process\.argv/i.test(src))                                              pat.processArgv++
    if (/require\s*\(\s*['"]commander['"]\s*\)|from\s+['"]commander['"]/i.test(src)) pat.commanderUse++
    if (/SELECT\s+|INSERT\s+INTO\s+|UPDATE\s+.*SET\s+/i.test(src))             pat.sqlQuery++
  }

  // Python files
  const pyFiles = (snapshot.byLanguage.get('python') || [])
    .slice(0, MAX_PATTERN_FILES)

  for (const f of pyFiles) {
    const src = readSource(snapshot, f)
    if (!src) continue

    if (/from\s+fastapi\s+import|import\s+fastapi/i.test(src))                 pat.fastapiImport++
    if (/=\s*FastAPI\s*\(/i.test(src))                                           pat.fastapiInstance++
    if (/@(app|router)\.(get|post|put|patch|delete|websocket)\s*\(/i.test(src)) pat.fastapiRoute++
    if (/from\s+flask\s+import|import\s+flask/i.test(src))                     pat.flaskImport++
    if (/=\s*Flask\s*\(__name__\)/i.test(src))                                  pat.flaskInstance++
    if (/from\s+django\.|import\s+django/i.test(src))                          pat.djangoImport++
    if (/from\s+sqlalchemy|import\s+sqlalchemy/i.test(src))                    pat.sqlalchemyUse++
    if (/model\.(fit|train)\s*\(/i.test(src))                                   pat.modelFit++
    if (/model\.predict\s*\(/i.test(src))                                        pat.modelPredict++
    if (/torch\.nn|nn\.Module/i.test(src))                                      pat.torchNN++
    if (/import\s+tensorflow|from\s+tensorflow/i.test(src))                    pat.tensorflowUse++
    if (/from\s+sklearn|import\s+sklearn/i.test(src))                          pat.sklearnUse++
    if (/import\s+argparse|from\s+argparse/i.test(src))                        pat.argparseUse++
    if (/@click\.(command|option|argument)/i.test(src))                         pat.clickUse++
    if (/SELECT\s+|INSERT\s+INTO\s+/i.test(src))                               pat.sqlQuery++
  }

  return pat
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSER 6 — Documentation
// ─────────────────────────────────────────────────────────────────────────────

function analyseDocumentation(snapshot) {
  const readme = content(snapshot, 'README.md') || content(snapshot, 'readme.md')

  const result = {
    readmeSummary:  null,
    installCommand: null,
    runCommand:     null,
    techMentions:   [],
  }

  if (!readme) return result

  const lines = readme.split('\n').map(l => l.trim()).filter(Boolean)

  for (const line of lines) {
    if (!result.readmeSummary && !line.startsWith('#') && line.length > 20) {
      result.readmeSummary = line.slice(0, 250)
    }
    if (!result.installCommand &&
        /npm install|pip install|yarn install|pnpm install|go mod download|cargo build/i.test(line)) {
      result.installCommand = line.slice(0, 120)
    }
    if (!result.runCommand &&
        /npm (run|start)|uvicorn|python |node |go run|cargo run|yarn dev|pnpm dev/i.test(line)) {
      result.runCommand = line.slice(0, 120)
    }
    if (result.readmeSummary && result.installCommand && result.runCommand) break
  }

  const techKeywords = [
    'React', 'Next.js', 'Vue', 'Angular', 'Svelte',
    'FastAPI', 'Flask', 'Django', 'Express', 'Node',
    'Python', 'TypeScript', 'JavaScript',
    'PostgreSQL', 'MongoDB', 'Redis', 'SQLite',
    'Supabase', 'Firebase', 'AWS', 'Docker',
    'GraphQL', 'REST', 'gRPC',
    'TensorFlow', 'PyTorch', 'scikit-learn',
    'LangChain', 'OpenAI',
  ]
  for (const kw of techKeywords) {
    if (readme.includes(kw)) result.techMentions.push(kw)
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSER 7 — Build scripts & test framework
// ─────────────────────────────────────────────────────────────────────────────

function analyseBuildScripts(snapshot, pkg, cf) {
  const result = {
    devCommand:    null,
    buildCommand:  null,
    startCommand:  null,
    testCommand:   null,
    testFramework: null,
  }

  if (pkg && pkg.scripts) {
    result.devCommand   = pkg.scripts.dev    || pkg.scripts.develop || null
    result.buildCommand = pkg.scripts.build  || null
    result.startCommand = pkg.scripts.start  || null
    result.testCommand  = pkg.scripts.test   || null

    const all = Object.values(pkg.scripts).join(' ')
    if (/vitest/i.test(all))     result.testFramework = 'vitest'
    else if (/jest/i.test(all))  result.testFramework = 'jest'
    else if (/mocha/i.test(all)) result.testFramework = 'mocha'
    else if (/pytest/i.test(all)) result.testFramework = 'pytest'
  }

  if (!result.testFramework) {
    if (cf.hasJestConfig)    result.testFramework = 'jest'
    if (cf.hasVitestConfig)  result.testFramework = 'vitest'
    if (cf.hasPytestIni)     result.testFramework = 'pytest'
    if (cf.hasPlaywright)    result.testFramework = 'playwright'
    if (cf.hasCypress)       result.testFramework = 'cypress'
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSER 8 — Monorepo
// ─────────────────────────────────────────────────────────────────────────────

function analyseMonorepo(cf, struct) {
  const signals = []
  if (cf.hasPnpmWorkspace) signals.push('pnpm-workspace.yaml')
  if (cf.hasLernaJson)     signals.push('lerna.json')
  if (cf.hasTurboJson)     signals.push('turbo.json')
  if (cf.hasNxJson)        signals.push('nx.json')
  if (struct.hasApps)      signals.push('apps/ directory')
  if (struct.hasPackages)  signals.push('packages/ directory')

  const isMonorepo = signals.length >= 1 ||
    (struct.hasFrontend && struct.hasBackend) ||
    (struct.hasClient   && struct.hasServer)

  let style = null
  if (struct.hasFrontend && struct.hasBackend)  style = 'frontend + backend'
  else if (struct.hasClient && struct.hasServer) style = 'client + server'
  else if (struct.hasApps && struct.hasPackages) style = 'multiple applications'
  else if (struct.hasMicroservices)              style = 'microservices'
  else if (isMonorepo)                           style = 'monorepo'

  return { isMonorepo, style, signals }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSER 9 — Size & maturity
// ─────────────────────────────────────────────────────────────────────────────

function analyseSize(snapshot, cf, struct, pkg) {
  let testFiles = 0
  for (const f of snapshot.files) {
    const base = path.basename(f)
    if (/\.(test|spec)\.[jt]sx?$|test_.*\.py$/.test(base)) testFiles++
  }

  const depCount = pkg
    ? Object.keys(pkg.dependencies    || {}).length +
      Object.keys(pkg.devDependencies || {}).length
    : 0

  return {
    totalSourceFiles: snapshot.files.length,
    testFiles,
    dependencyCount:  depCount,
    hasTests:         testFiles > 0 || struct.hasTests,
    hasCI:            cf.hasGithubWorkflows,
    hasDocker:        cf.hasDockerfile || cf.hasDockerCompose,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSER 10 — Git
// ─────────────────────────────────────────────────────────────────────────────

function analyseGit(cwd) {
  const result = {
    is_git_repo:       false, git_root:        null,
    branch:            null,  remote_url:      null,
    has_uncommitted:   false, commit_count:    null,
    last_commit:       null,  git_not_installed: false,
    recent_messages:   [],
  }

  if (!safeExec('git --version', cwd)) return { ...result, git_not_installed: true }

  const root = safeExec('git rev-parse --show-toplevel', cwd)
  if (!root) return result

  result.is_git_repo  = true
  result.git_root     = root
  result.branch       = safeExec('git rev-parse --abbrev-ref HEAD', cwd)
  result.remote_url   = safeExec('git remote get-url origin', cwd)

  const statusOut = safeExec('git status --porcelain', cwd)
  result.has_uncommitted = Boolean(statusOut && statusOut.length > 0)

  const countStr = safeExec('git rev-list --count HEAD', cwd)
  result.commit_count = countStr ? parseInt(countStr, 10) : 0

  result.last_commit = safeExec('git log -1 --format="%s (%cr)" HEAD', cwd)

  const msgs = safeExec('git log -5 --format="%s" HEAD', cwd)
  result.recent_messages = msgs ? msgs.split('\n').filter(Boolean) : []

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// FRAMEWORK SCORER
// ─────────────────────────────────────────────────────────────────────────────

function scoreFrameworks(snapshot, cf, struct, deps, pat, doc) {
  const frameworks = []
  const add = (id, label, score, evidence) => {
    if (score >= MIN_CONFIDENCE) frameworks.push({ id, label, score, evidence })
  }

  // ── Next.js ───────────────────────────────────────────────────────────────
  {
    let s = 0; const ev = []
    if (cf.hasNextConfig)            { s += 30; ev.push('next.config file') }
    if (deps.next)                   { s += 25; ev.push('next in package.json') }
    if (pat.nextImport > 0)          { s += 20; ev.push(`Next.js import (${pat.nextImport} file(s))`) }
    if (pat.getServerSideProps > 0)  { s += 15; ev.push('getServerSideProps / getStaticProps') }
    if (struct.hasPages || struct.hasApp) { s += 10; ev.push('pages/ or app/ dir') }
    if (doc.techMentions.includes('Next.js')) { s += 10; ev.push('Next.js in README') }
    add('nextjs', 'Next.js', s, ev)
  }

  // ── React ─────────────────────────────────────────────────────────────────
  {
    let s = 0; const ev = []
    if (deps.react)                  { s += 25; ev.push('react in package.json') }
    if (cf.hasViteConfig)            { s += 20; ev.push('vite.config present') }
    if (cf.hasSrcAppJsx)             { s += 20; ev.push('src/App.jsx or .tsx') }
    if (cf.hasSrcMainJsx)            { s += 15; ev.push('src/main.jsx or .tsx') }
    if (pat.reactImport > 0)         { s += 20; ev.push(`React import (${pat.reactImport} file(s))`) }
    if (pat.jsxComponent > 0)        { s += 15; ev.push(`JSX components (${pat.jsxComponent})`) }
    if (pat.useHook > 0)             { s += 10; ev.push(`React hooks (${pat.useHook} usage(s))`) }
    if (pat.createRoot > 0)          { s += 10; ev.push('createRoot detected') }
    if (deps.vite)                   { s +=  5; ev.push('vite in package.json') }
    if (doc.techMentions.includes('React')) { s += 10; ev.push('React in README') }
    add('react', 'React', s, ev)
  }

  // ── FastAPI ───────────────────────────────────────────────────────────────
  {
    let s = 0; const ev = []
    if (deps.fastapi)                { s += 30; ev.push('fastapi in requirements') }
    if (pat.fastapiImport > 0)       { s += 35; ev.push(`FastAPI import (${pat.fastapiImport} file(s))`) }
    if (pat.fastapiInstance > 0)     { s += 25; ev.push(`FastAPI() instance (${pat.fastapiInstance})`) }
    if (pat.fastapiRoute > 0)        { s += 15; ev.push(`route decorators (${pat.fastapiRoute})`) }
    if (cf.hasAsgiPy || deps.uvicorn){ s += 10; ev.push('ASGI / uvicorn signal') }
    if (doc.techMentions.includes('FastAPI')) { s += 10; ev.push('FastAPI in README') }
    add('fastapi', 'FastAPI (Python)', s, ev)
  }

  // ── Django ────────────────────────────────────────────────────────────────
  {
    let s = 0; const ev = []
    if (deps.django)                 { s += 30; ev.push('django in requirements') }
    if (cf.hasManagePy)              { s += 30; ev.push('manage.py found') }
    if (pat.djangoImport > 0)        { s += 35; ev.push(`Django import (${pat.djangoImport} file(s))`) }
    if (cf.hasWsgiPy || cf.hasAsgiPy){ s += 10; ev.push('wsgi.py / asgi.py found') }
    if (doc.techMentions.includes('Django')) { s += 10; ev.push('Django in README') }
    add('django', 'Django', s, ev)
  }

  // ── Flask ─────────────────────────────────────────────────────────────────
  {
    let s = 0; const ev = []
    if (deps.flask)                  { s += 30; ev.push('flask in requirements') }
    if (pat.flaskImport > 0)         { s += 35; ev.push(`Flask import (${pat.flaskImport} file(s))`) }
    if (pat.flaskInstance > 0)       { s += 25; ev.push(`Flask() instance (${pat.flaskInstance})`) }
    if (cf.hasAppPy && !deps.fastapi){ s += 10; ev.push('app.py present') }
    add('flask', 'Flask (Python)', s, ev)
  }

  // ── Express ───────────────────────────────────────────────────────────────
  {
    let s = 0; const ev = []
    if (deps.express)                { s += 35; ev.push('express in package.json') }
    if (pat.expressImport > 0)       { s += 35; ev.push(`Express import (${pat.expressImport} file(s))`) }
    if (pat.expressApp > 0)          { s += 20; ev.push(`express() instance (${pat.expressApp})`) }
    if (struct.hasRoutes || struct.hasControllers) { s += 10; ev.push('routes / controllers dir') }
    add('express', 'Express (Node.js)', s, ev)
  }

  // ── Vue / Nuxt ────────────────────────────────────────────────────────────
  {
    let s = 0; const ev = []
    if (deps.vue)                    { s += 40; ev.push('vue in package.json') }
    if (deps.nuxt || cf.hasNuxtConfig){ s += 25; ev.push('Nuxt detected') }
    const vueFiles = (snapshot.byLanguage.get('javascript') || [])
      .filter(f => f.endsWith('.vue'))
    if (vueFiles.length > 0)         { s += 30; ev.push('.vue files found') }
    add('vue', 'Vue.js', s, ev)
  }

  // ── Angular ───────────────────────────────────────────────────────────────
  {
    let s = 0; const ev = []
    if (cf.hasAngularJson)           { s += 50; ev.push('angular.json found') }
    if (deps.angular)                { s += 40; ev.push('@angular/core in package.json') }
    add('angular', 'Angular', s, ev)
  }

  // ── ML / Data Science ─────────────────────────────────────────────────────
  {
    let s = 0; const ev = []
    if (deps.tensorflow || pat.tensorflowUse > 0) { s += 30; ev.push('TensorFlow') }
    if (deps.torch       || pat.torchNN > 0)       { s += 30; ev.push('PyTorch') }
    if (deps.sklearn     || pat.sklearnUse > 0)    { s += 25; ev.push('scikit-learn') }
    if (deps.pandas)                               { s += 15; ev.push('pandas') }
    if (deps.numpy)                                { s += 10; ev.push('numpy') }
    if (struct.hasNotebooks || struct.hasDatasets) { s += 20; ev.push('notebooks / data dir') }
    if (pat.modelFit > 0 || pat.modelPredict > 0) { s += 15; ev.push('model.fit / predict') }
    add('ml', 'Machine Learning (Python)', s, ev)
  }

  // ── LLM Application ───────────────────────────────────────────────────────
  {
    let s = 0; const ev = []
    if (deps.langchain || deps.langchain_py) { s += 35; ev.push('LangChain') }
    if (deps.openai    || deps.openai_py)    { s += 30; ev.push('OpenAI SDK') }
    add('llm-app', 'LLM Application', s, ev)
  }

  // ── CLI Tool ──────────────────────────────────────────────────────────────
  {
    let s = 0; const ev = []
    if (deps.commander)              { s += 35; ev.push('commander in package.json') }
    if (deps.yargs)                  { s += 35; ev.push('yargs in package.json') }
    if (pat.commanderUse > 0)        { s += 25; ev.push('commander usage') }
    if (pat.processArgv > 0)         { s += 15; ev.push('process.argv usage') }
    if (pat.argparseUse > 0)         { s += 25; ev.push('argparse (Python)') }
    if (pat.clickUse > 0)            { s += 25; ev.push('Click decorators') }
    if (deps.click)                  { s += 20; ev.push('click in requirements') }
    add('cli', 'CLI Tool', s, ev)
  }

  // ── Rust backend ──────────────────────────────────────────────────────────
  {
    let s = 0; const ev = []
    if (cf.hasCargoToml)             { s += 30; ev.push('Cargo.toml') }
    if (deps.actix)                  { s += 35; ev.push('actix-web') }
    if (deps.axum)                   { s += 35; ev.push('axum') }
    if (deps.tokio)                  { s += 15; ev.push('tokio') }
    add('rust-backend', 'Rust Backend', s, ev)
  }

  // ── Go backend ────────────────────────────────────────────────────────────
  {
    let s = 0; const ev = []
    if (cf.hasGoMod)                 { s += 30; ev.push('go.mod') }
    if (deps.gin)                    { s += 35; ev.push('Gin framework') }
    if (deps.echo)                   { s += 35; ev.push('Echo framework') }
    if (deps.fiber)                  { s += 35; ev.push('Fiber framework') }
    const goCount = (snapshot.byLanguage.get('go') || []).length
    if (goCount > 0)                 { s += 15; ev.push(`${goCount} .go file(s)`) }
    add('go-backend', 'Go Backend', s, ev)
  }

  // ── Java backend ──────────────────────────────────────────────────────────
  {
    let s = 0; const ev = []
    if (cf.hasPomXml)                { s += 25; ev.push('pom.xml') }
    if (cf.hasBuildGradle)           { s += 25; ev.push('build.gradle') }
    if (deps.spring)                 { s += 35; ev.push('Spring') }
    const javaCount = (snapshot.byLanguage.get('java') || []).length
    if (javaCount > 0)               { s += 15; ev.push(`${javaCount} .java file(s)`) }
    add('java-backend', 'Java Backend', s, ev)
  }

  return frameworks.sort((a, b) => b.score - a.score)
}

// ─────────────────────────────────────────────────────────────────────────────
// Full-stack resolution
// ─────────────────────────────────────────────────────────────────────────────

function resolveProjectType(frameworks, struct, mono) {
  if (frameworks.length === 0) return null

  const ids = frameworks.map(f => f.id)
  const hasFE = ids.some(id => ['react','nextjs','vue','angular'].includes(id))
  const havBE = ids.some(id => ['fastapi','flask','django','express','go-backend','java-backend','rust-backend'].includes(id))

  if (hasFE && havBE) {
    const fe = frameworks.find(f => ['react','nextjs','vue','angular'].includes(f.id))
    const be = frameworks.find(f => ['fastapi','flask','django','express','go-backend','java-backend','rust-backend'].includes(f.id))
    return {
      id:       'fullstack',
      label:    `Full-Stack (${fe.label} + ${be.label})`,
      score:    Math.round((fe.score + be.score) / 2),
      evidence: [...fe.evidence, ...be.evidence],
    }
  }

  if (mono.isMonorepo && mono.style) {
    return { ...frameworks[0], label: `${frameworks[0].label} (${mono.style})` }
  }

  return frameworks[0]
}

// ─────────────────────────────────────────────────────────────────────────────
// Instruction files
// ─────────────────────────────────────────────────────────────────────────────

function getInstructionFiles(cf) {
  const found = []
  if (cf.hasReadme)       found.push('README.md')
  if (cf.hasClaudeMd)     found.push('CLAUDE.md')
  if (cf.hasAgentsMd)     found.push('AGENTS.md')
  if (cf.hasCopilotInstr) found.push('.github/copilot-instructions.md')
  if (cf.hasContributing) found.push('CONTRIBUTING.md')
  return found
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — detect(cwd)
// ─────────────────────────────────────────────────────────────────────────────

function detect(cwd) {
  cwd = cwd || process.cwd()

  const base = {
    cwd,
    folder_name:         path.basename(cwd),
    project_name:        path.basename(cwd),
    project_type:        'unknown',
    project_type_label:  'Unknown',
    confidence:          0,
    detection_method:    'none',
    evidence:            [],
    all_candidates:      [],
    languages:           [],
    language_summary:    {},
    frameworks:          [],
    database:            [],
    tools:               [],
    has_tests:           false,
    has_ci:              false,
    has_docker:          false,
    is_monorepo:         false,
    monorepo_style:      null,
    needs_llm_review:    false,
    build_scripts:       {},
    deployment_tools:    [],
    instruction_files:   [],
    readme_summary:      null,
    install_command:     null,
    run_command:         null,
    git:                 {},
    size:                {},
    detected_at:         new Date().toISOString(),
  }

  try {
    // ── Single filesystem pass ──────────────────────────────────────────────
    const snapshot = collectProjectSnapshot(cwd)

    // ── All analysers read from snapshot only ───────────────────────────────
    const langResult  = analyseLanguages(snapshot)
    const cf          = analyseConfigs(snapshot)
    const { deps, pkg } = analyseDependencies(snapshot)
    const struct      = analyseStructure(snapshot)
    const pat         = analysePatterns(snapshot)
    const doc         = analyseDocumentation(snapshot)
    const buildInfo   = analyseBuildScripts(snapshot, pkg, cf)
    const mono        = analyseMonorepo(cf, struct)
    const size        = analyseSize(snapshot, cf, struct, pkg)
    const git         = analyseGit(cwd)   // git: exec-only, no fs reads

    // ── Languages ───────────────────────────────────────────────────────────
    base.language_summary = langResult.summary
    base.languages = langResult.dominant
      .map(l => LANG_DISPLAY[l] || l)
      .slice(0, 5)

    // ── Framework scoring ───────────────────────────────────────────────────
    const ranked   = scoreFrameworks(snapshot, cf, struct, deps, pat, doc)
    const resolved = resolveProjectType(ranked, struct, mono)

    base.all_candidates = ranked.map(f => ({
      id: f.id, label: f.label, confidence: f.score, evidence: f.evidence
    }))

    if (resolved) {
      base.project_type       = resolved.id
      base.project_type_label = resolved.label
      base.confidence         = Math.min(resolved.score, 100)
      base.detection_method   = 'multi-signal'
      base.evidence           = resolved.evidence || []
    } else {
      const lang = langResult.dominant[0]
      if (lang) {
        base.project_type       = lang
        base.project_type_label = LANG_DISPLAY[lang] || lang
        base.confidence         = 25
        base.detection_method   = 'language-fallback'
        base.evidence           = [`${snapshot.files.length} source file(s) — dominant: ${LANG_DISPLAY[lang] || lang}`]
      }
    }

    // ── Database ────────────────────────────────────────────────────────────
    const db = []
    if (deps.supabase   || pat.supabaseUse > 0)  db.push('Supabase')
    if (deps.prisma     || pat.prismaClient > 0)  db.push('Prisma')
    if (deps.mongoose   || pat.mongooseUse > 0)   db.push('MongoDB')
    if (deps.sqlalchemy || pat.sqlalchemyUse > 0) db.push('SQLAlchemy')
    if (deps.firebase)                            db.push('Firebase')
    if (deps.redis)                               db.push('Redis')
    if (pat.sqlQuery > 0 && db.length === 0)      db.push('SQL (raw)')
    base.database = db

    // ── Tools ───────────────────────────────────────────────────────────────
    const tools = []
    if (cf.hasViteConfig)          tools.push('Vite')
    if (cf.hasTsConfig)            tools.push('TypeScript')
    if (cf.hasEslint)              tools.push('ESLint')
    if (cf.hasPrettier)            tools.push('Prettier')
    if (buildInfo.testFramework)   tools.push(buildInfo.testFramework)

    const deploy = []
    if (cf.hasDockerfile || cf.hasDockerCompose) deploy.push('Docker')
    if (cf.hasVercelJson)    deploy.push('Vercel')
    if (cf.hasNetlifyToml)   deploy.push('Netlify')
    if (cf.hasRenderYaml)    deploy.push('Render')
    if (cf.hasFlyToml)       deploy.push('Fly.io')
    if (cf.hasServerlessYml) deploy.push('Serverless')
    if (cf.hasTerraformDir)  deploy.push('Terraform')
    if (cf.hasK8sDir)        deploy.push('Kubernetes')
    if (cf.hasGithubWorkflows) deploy.push('GitHub Actions')

    base.tools            = [...tools, ...deploy]
    base.deployment_tools = deploy

    // ── Remaining fields ────────────────────────────────────────────────────
    base.build_scripts      = buildInfo
    base.is_monorepo        = mono.isMonorepo
    base.monorepo_style     = mono.style
    base.has_tests          = size.hasTests
    base.has_ci             = size.hasCI
    base.has_docker         = size.hasDocker
    base.size               = size
    base.git                = git
    base.instruction_files  = getInstructionFiles(cf)
    base.readme_summary     = doc.readmeSummary
    base.install_command    = doc.installCommand
    base.run_command        = doc.runCommand
    base.needs_llm_review   = base.confidence < 50

    // ── Project name ────────────────────────────────────────────────────────
    if (pkg && pkg.name) {
      base.project_name = pkg.name
    } else if (git.remote_url) {
      const m = git.remote_url.match(/\/([^/]+?)(?:\.git)?$/)
      if (m) base.project_name = m[1]
    }

  } catch {
    // Return best partial result — never crash
  }

  return base
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  detect,
  collectProjectSnapshot,
  analyseLanguages,
  analyseConfigs,
  analyseDependencies,
  analyseStructure,
  analysePatterns,
  analyseDocumentation,
  analyseBuildScripts,
  analyseMonorepo,
  analyseSize,
  analyseGit,
  scoreFrameworks,
  getInstructionFiles,
  IGNORE_DIRS,
  EXT_LANG,
  LANG_DISPLAY,
}