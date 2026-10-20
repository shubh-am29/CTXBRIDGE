'use strict'

const {
  EXTENSION_TO_LANGUAGE,
  LANGUAGES,
} = require('./language-registry')
// ─────────────────────────────────────────────────────────────────────────────
// Language detection by extension
// ─────────────────────────────────────────────────────────────────────────────

const EXT_LANG = Object.fromEntries(
  Object.values(LANGUAGES).flatMap(language =>
    language.extensions.map(extension => [
      extension,
      language.name,
    ])
  )
)

// ─────────────────────────────────────────────────────────────────────────────
// Framework / library detection rules
// Each rule: { name, match(files, contents) → boolean }
// ─────────────────────────────────────────────────────────────────────────────

function hasFile(files, name) {
  return files.some(f => f.name === name || f.path === name)
}

function hasDir(files, dirPrefix) {
  return files.some(f => f.path.startsWith(dirPrefix + '/') || f.path.startsWith(dirPrefix + '\\'))
}

function anyContentMatches(files, pattern, exts) {
  return files.some(f => {
    if (exts && !exts.includes(f.ext)) return false
    return pattern.test(f.content || '')
  })
}

function getFileContent(files, name) {
  const f = files.find(f => f.name === name || f.path === name)
  return f ? (f.content || '') : ''
}

// ─────────────────────────────────────────────────────────────────────────────
// Technology detectors
// ─────────────────────────────────────────────────────────────────────────────

const TECH_DETECTORS = [
  // Python frameworks
  {
    name: 'FastAPI',
    detect: (files) =>
      anyContentMatches(files, /from\s+fastapi\s+import|import\s+fastapi|FastAPI\s*\(/i, ['.py']) ||
      /fastapi/i.test(getFileContent(files, 'requirements.txt')) ||
      /fastapi/i.test(getFileContent(files, 'pyproject.toml'))
  },
  {
    name: 'Django',
    detect: (files) =>
      hasFile(files, 'manage.py') ||
      anyContentMatches(files, /from\s+django\.|import\s+django/i, ['.py']) ||
      /django/i.test(getFileContent(files, 'requirements.txt'))
  },
  {
    name: 'Flask',
    detect: (files) =>
      anyContentMatches(files, /from\s+flask\s+import|Flask\s*\(__name__\)/i, ['.py']) ||
      /flask/i.test(getFileContent(files, 'requirements.txt'))
  },
  {
    name: 'SQLAlchemy',
    detect: (files) =>
      anyContentMatches(files, /from\s+sqlalchemy|import\s+sqlalchemy/i, ['.py']) ||
      /sqlalchemy/i.test(getFileContent(files, 'requirements.txt'))
  },
  {
    name: 'Pydantic',
    detect: (files) =>
      anyContentMatches(files, /from\s+pydantic|import\s+pydantic/i, ['.py']) ||
      /pydantic/i.test(getFileContent(files, 'requirements.txt'))
  },
  {
    name: 'Uvicorn',
    detect: (files) =>
      /uvicorn/i.test(getFileContent(files, 'requirements.txt')) ||
      anyContentMatches(files, /uvicorn/i, ['.py', '.sh', '.yml', '.yaml'])
  },
  {
    name: 'Celery',
    detect: (files) =>
      /celery/i.test(getFileContent(files, 'requirements.txt')) ||
      anyContentMatches(files, /from\s+celery|import\s+celery/i, ['.py'])
  },
  {
    name: 'pytest',
    detect: (files) =>
      hasFile(files, 'pytest.ini') || hasFile(files, 'conftest.py') ||
      /pytest/i.test(getFileContent(files, 'requirements.txt'))
  },
  // JS / TS frameworks
  {
    name: 'React',
    detect: (files) => {
      const pkg = safeParseJson(getFileContent(files, 'package.json'))
      if (pkg) {
        const all = { ...pkg.dependencies, ...pkg.devDependencies }
        if (all.react) return true
      }
      return anyContentMatches(files, /from\s+['"]react['"]/i, ['.js', '.jsx', '.ts', '.tsx'])
    }
  },
  {
    name: 'Next.js',
    detect: (files) => {
      const pkg = safeParseJson(getFileContent(files, 'package.json'))
      if (pkg) {
        const all = { ...pkg.dependencies, ...pkg.devDependencies }
        if (all.next) return true
      }
      return hasFile(files, 'next.config.js') || hasFile(files, 'next.config.ts') || hasFile(files, 'next.config.mjs')
    }
  },
  {
    name: 'Vue.js',
    detect: (files) => {
      const pkg = safeParseJson(getFileContent(files, 'package.json'))
      if (pkg) {
        const all = { ...pkg.dependencies, ...pkg.devDependencies }
        if (all.vue) return true
      }
      return false
    }
  },
  {
    name: 'Express',
    detect: (files) => {
      const pkg = safeParseJson(getFileContent(files, 'package.json'))
      if (pkg) {
        const all = { ...pkg.dependencies, ...pkg.devDependencies }
        if (all.express) return true
      }
      return anyContentMatches(files, /require\s*\(\s*['"]express['"]\s*\)|from\s+['"]express['"]/i, ['.js', '.ts'])
    }
  },
  {
    name: 'Vite',
    detect: (files) =>
      hasFile(files, 'vite.config.js') || hasFile(files, 'vite.config.ts') ||
      (() => {
        const pkg = safeParseJson(getFileContent(files, 'package.json'))
        if (pkg) {
          const all = { ...pkg.dependencies, ...pkg.devDependencies }
          return Boolean(all.vite)
        }
        return false
      })()
  },
  {
    name: 'TypeScript',
    detect: (files) =>
      hasFile(files, 'tsconfig.json') ||
      files.some(f => ['.ts', '.tsx'].includes(f.ext))
  },
  {
    name: 'Tailwind CSS',
    detect: (files) => {
      const pkg = safeParseJson(getFileContent(files, 'package.json'))
      if (pkg) {
        const all = { ...pkg.dependencies, ...pkg.devDependencies }
        if (all.tailwindcss) return true
      }
      return hasFile(files, 'tailwind.config.js') || hasFile(files, 'tailwind.config.ts')
    }
  },
  // Databases / ORMs
  {
    name: 'Supabase',
    detect: (files) => {
      const pkg = safeParseJson(getFileContent(files, 'package.json'))
      if (pkg) {
        const all = { ...pkg.dependencies, ...pkg.devDependencies }
        if (all['@supabase/supabase-js'] || all.supabase) return true
      }
      return /supabase/i.test(getFileContent(files, 'requirements.txt')) ||
             anyContentMatches(files, /supabase/i, ['.py', '.js', '.ts'])
    }
  },
  {
    name: 'Prisma',
    detect: (files) => {
      const pkg = safeParseJson(getFileContent(files, 'package.json'))
      if (pkg) {
        const all = { ...pkg.dependencies, ...pkg.devDependencies }
        if (all.prisma || all['@prisma/client']) return true
      }
      return hasFile(files, 'schema.prisma') ||
             files.some(f => f.ext === '.prisma')
    }
  },
  {
    name: 'PostgreSQL',
    detect: (files) =>
      /psycopg2|asyncpg|pg|postgres/i.test(getFileContent(files, 'requirements.txt')) ||
      anyContentMatches(files, /postgresql:\/\/|postgres:\/\//i, ['.py', '.js', '.ts', '.yml', '.yaml', '.env.example'])
  },
  {
    name: 'MongoDB',
    detect: (files) => {
      const pkg = safeParseJson(getFileContent(files, 'package.json'))
      if (pkg) {
        const all = { ...pkg.dependencies, ...pkg.devDependencies }
        if (all.mongoose || all.mongodb) return true
      }
      return /pymongo|motor/i.test(getFileContent(files, 'requirements.txt'))
    }
  },
  {
    name: 'Redis',
    detect: (files) =>
      /redis/i.test(getFileContent(files, 'requirements.txt')) ||
      (() => {
        const pkg = safeParseJson(getFileContent(files, 'package.json'))
        if (pkg) {
          const all = { ...pkg.dependencies, ...pkg.devDependencies }
          return Boolean(all.redis || all.ioredis)
        }
        return false
      })()
  },
  // Infrastructure
  {
    name: 'Docker',
    detect: (files) =>
      hasFile(files, 'Dockerfile') || hasFile(files, 'docker-compose.yml') || hasFile(files, 'docker-compose.yaml')
  },
  {
    name: 'GitHub Actions',
    detect: (files) =>
      files.some(f => f.path.startsWith('.github/workflows/'))
  },
  // Testing
  {
    name: 'Jest',
    detect: (files) => {
      const pkg = safeParseJson(getFileContent(files, 'package.json'))
      if (pkg) {
        const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.scripts }
        if (all.jest) return true
      }
      return hasFile(files, 'jest.config.js') || hasFile(files, 'jest.config.ts')
    }
  },
  {
    name: 'Vitest',
    detect: (files) =>
      hasFile(files, 'vitest.config.js') || hasFile(files, 'vitest.config.ts') ||
      (() => {
        const pkg = safeParseJson(getFileContent(files, 'package.json'))
        if (pkg) {
          const all = { ...pkg.dependencies, ...pkg.devDependencies }
          return Boolean(all.vitest)
        }
        return false
      })()
  },
  // ML / LLM
  {
    name: 'LangChain',
    detect: (files) =>
      /langchain/i.test(getFileContent(files, 'requirements.txt')) ||
      anyContentMatches(files, /from\s+langchain|import\s+langchain/i, ['.py'])
  },
  {
    name: 'OpenAI',
    detect: (files) =>
      /openai/i.test(getFileContent(files, 'requirements.txt')) ||
      anyContentMatches(files, /from\s+openai|import\s+openai/i, ['.py', '.js', '.ts'])
  },
  {
    name: 'Commander.js',
    detect: (files) => {
      const pkg = safeParseJson(getFileContent(files, 'package.json'))
      if (pkg) {
        const all = { ...pkg.dependencies, ...pkg.devDependencies }
        if (all.commander) return true
      }
      return anyContentMatches(files, /require\s*\(\s*['"]commander['"]\s*\)|from\s+['"]commander['"]/i, ['.js', '.ts'])
    }
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function safeParseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

function detectLanguages(files) {
  const counts = {}
  for (const f of files) {
    const lang = EXT_LANG[f.ext]
    if (lang) counts[lang] = (counts[lang] || 0) + 1
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang)
}

function detectTechnologies(files) {
  const found = []
  for (const detector of TECH_DETECTORS) {
    try {
      if (detector.detect(files)) found.push(detector.name)
    } catch { /* never crash */ }
  }
  return found
}

function detectImportantFiles(files) {
  const important = []
  const patterns = [
    // Entry points
    { re: /^(app|src)\/(main|index|app)\.(py|js|ts|jsx|tsx)$/i, label: null },
    // API layers
    { re: /\/(api|routes|router|controllers?)\//i, label: null },
    // Service layers
    { re: /\/(services?|handlers?)\//i, label: null },
    // Models and schemas
    { re: /\/(models?|schemas?|entities)\//i, label: null },
    // Database
    { re: /\/(database|db|migrations?)\//i, label: null },
    // Config
    { re: /\/(core|config|settings)\//i, label: null },
    // Tests
    { re: /\/(tests?|__tests?__|spec)\//i, label: null },
    // Dependency files
    { re: /^(requirements.*\.txt|package\.json|Cargo\.toml|go\.mod|pyproject\.toml)$/i, label: null },
    // Dockerfile
    { re: /^Dockerfile$/i, label: null },
    // Main docs
    { re: /^(README|CLAUDE|AGENTS|ARCHITECTURE)\.md$/i, label: null },
  ]

  for (const f of files) {
    for (const { re } of patterns) {
      if (re.test(f.path)) {
        important.push(f.path)
        break
      }
    }
  }

  // Deduplicate and limit
  return [...new Set(important)].slice(0, 20)
}

function detectProjectType(files, languages, technologies) {
  const hasPython = languages.includes('Python')
  const hasJS     = languages.includes('JavaScript') || languages.includes('TypeScript')

  const hasFastAPI = technologies.includes('FastAPI')
  const hasDjango  = technologies.includes('Django')
  const hasFlask   = technologies.includes('Flask')
  const hasReact   = technologies.includes('React')
  const hasNext    = technologies.includes('Next.js')
  const hasExpress = technologies.includes('Express')
  const hasVue     = technologies.includes('Vue.js')

  const hasFE = hasReact || hasNext || hasVue
  const hasBE = hasFastAPI || hasDjango || hasFlask || hasExpress

  if (hasFE && hasBE)   return 'Full-stack web application'
  if (hasNext)          return 'Next.js web application'
  if (hasReact)         return 'React frontend application'
  if (hasFastAPI)       return 'FastAPI backend service'
  if (hasDjango)        return 'Django web application'
  if (hasFlask)         return 'Flask web application'
  if (hasExpress)       return 'Express.js backend service'
  if (hasVue)           return 'Vue.js frontend application'
  if (hasPython && hasJS) return 'Full-stack application (Python + JavaScript)'
  if (hasPython)        return 'Python application'
  if (hasJS)            return 'JavaScript/Node.js application'

  const hasGo   = languages.includes('Go')
  const hasRust  = languages.includes('Rust')
  const hasJava  = languages.includes('Java')
  if (hasGo)   return 'Go application'
  if (hasRust) return 'Rust application'
  if (hasJava) return 'Java application'

  return 'Software project'
}

function buildArchitectureDescription(files, languages, technologies) {
  const parts = []

  // Detect directories that exist
  const dirs = new Set()
  for (const f of files) {
    const segments = f.path.split('/')
    if (segments.length > 1) dirs.add(segments[0])
    if (segments.length > 2) dirs.add(segments.slice(0, 2).join('/'))
  }

  const hasBackend  = dirs.has('backend')  || dirs.has('api')
  const hasFrontend = dirs.has('frontend') || dirs.has('client') || dirs.has('web')
  const hasSrc      = dirs.has('src')
  const hasCli      = dirs.has('cli')
  const hasTests    = dirs.has('tests') || dirs.has('test') || dirs.has('__tests__')
  const hasDocs     = dirs.has('docs') || dirs.has('doc')

  if (hasBackend && hasFrontend) {
    parts.push('The project is organized as a monorepo with separate frontend and backend directories.')
  }

  if (technologies.includes('FastAPI')) {
    const apiDirs = files
      .filter(f => /\/api\//i.test(f.path))
      .map(f => f.path.split('/').slice(0, 3).join('/'))
    const uniqueDirs = [...new Set(apiDirs)].slice(0, 4)
    parts.push(
      'The backend is built with FastAPI.' +
      (uniqueDirs.length ? ` API routes are organized under ${uniqueDirs.join(', ')}.` : '')
    )
  }

  if (technologies.includes('React') || technologies.includes('Next.js')) {
    const fw = technologies.includes('Next.js') ? 'Next.js' : 'React'
    const hasVite = technologies.includes('Vite')
    parts.push(
      `The frontend uses ${fw}${hasVite ? ' with Vite' : ''}.`
    )
  }

  if (technologies.includes('Supabase')) {
    parts.push('Supabase is used for the database and authentication layer.')
  }

  if (technologies.includes('Docker')) {
    parts.push('The project is containerized using Docker.')
  }

  if (hasCli) {
    parts.push('A CLI client is included in the cli/ directory.')
  }

  if (technologies.includes('GitHub Actions')) {
    parts.push('GitHub Actions is configured for CI/CD.')
  }

  if (hasTests) {
    parts.push('Tests are organized in a dedicated tests/ or __tests__/ directory.')
  }

  if (hasDocs) {
    parts.push('Documentation is maintained in the docs/ directory.')
  }

  return parts.join(' ').trim()
}

function buildProjectOverview(files, projectType, technologies, packageName) {
  const techList = technologies.slice(0, 5).join(', ')

  let overview = ''
  if (packageName) {
    overview = `${packageName} is a ${projectType.toLowerCase()}`
  } else {
    overview = `This is a ${projectType.toLowerCase()}`
  }

  if (techList) {
    overview += ` built with ${techList}.`
  } else {
    overview += '.'
  }

  // Enrich from README
  const readmeContent = getFileContent(files, 'README.md')
  if (readmeContent) {
    const lines = readmeContent.split('\n').map(l => l.trim()).filter(Boolean)
    for (const line of lines) {
      if (!line.startsWith('#') && line.length > 30) {
        overview += ' ' + line.slice(0, 200)
        break
      }
    }
  }

  return overview.trim()
}

function buildRequirements(files, technologies) {
  const requirements = []

  if (technologies.includes('FastAPI')) {
    requirements.push('FastAPI backend API server')
  }
  if (technologies.includes('React') || technologies.includes('Next.js')) {
    requirements.push(`${technologies.includes('Next.js') ? 'Next.js' : 'React'} frontend interface`)
  }
  if (technologies.includes('Supabase')) {
    requirements.push('Supabase database and authentication')
  }
  if (technologies.includes('PostgreSQL')) {
    requirements.push('PostgreSQL database')
  }
  if (technologies.includes('Redis')) {
    requirements.push('Redis for caching or queues')
  }
  if (technologies.includes('Docker')) {
    requirements.push('Docker containerization')
  }
  if (technologies.includes('Celery')) {
    requirements.push('Celery for background task processing')
  }
  if (technologies.includes('pytest') || technologies.includes('Jest') || technologies.includes('Vitest')) {
    requirements.push('Automated test suite')
  }
  if (technologies.includes('GitHub Actions')) {
    requirements.push('CI/CD via GitHub Actions')
  }

  return requirements
}

function detectCurrentProgress(files, technologies) {
  const progress = []

  // Check what's implemented based on file presence
  if (files.some(f => /\/api\//i.test(f.path)))        progress.push('API routing layer implemented')
  if (files.some(f => /\/services?\//i.test(f.path)))  progress.push('Service layer implemented')
  if (files.some(f => /\/models?\//i.test(f.path)))    progress.push('Data models defined')
  if (files.some(f => /\/schemas?\//i.test(f.path)))   progress.push('Schemas / validation defined')
  if (files.some(f => /\/migrations?\//i.test(f.path))) progress.push('Database migrations present')
  if (files.some(f => /\/(tests?|__tests?__|spec)\//i.test(f.path))) progress.push('Test suite established')
  if (files.some(f => /Dockerfile/i.test(f.name)))     progress.push('Docker configuration added')
  if (files.some(f => f.path.startsWith('.github/workflows'))) progress.push('CI/CD pipeline configured')
  if (files.some(f => /README\.md/i.test(f.name)))     progress.push('README documentation written')
  if (technologies.includes('Supabase'))                progress.push('Supabase integration configured')
  if (technologies.includes('Prisma'))                  progress.push('Prisma ORM configured')

  return progress
}

function getPackageName(files) {
  // From package.json
  const pkgContent = getFileContent(files, 'package.json')
  if (pkgContent) {
    const pkg = safeParseJson(pkgContent)
    if (pkg && pkg.name) return pkg.name
  }
  // From pyproject.toml
  const pyContent = getFileContent(files, 'pyproject.toml')
  if (pyContent) {
    const match = pyContent.match(/^name\s*=\s*["'](.+?)["']/m)
    if (match) return match[1]
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Main analyser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyse scanned files and produce structured memory.
 *
 * @param {Array}  files   - from scanner: [{ path, content, ext, name }]
 * @param {Object} options - { existingMemory }
 * @returns {Object} detected_memory
 */
function analyseProject(files, options = {}) {
  if (!files || files.length === 0) {
    return {
      project_overview: 'No source files were found to analyse.',
      technologies: [],
      architecture: '',
      requirements: [],
      current_progress: [],
      important_code: [],
    }
  }

  const languages    = detectLanguages(files)
  const technologies = detectTechnologies(files)
  const projectType  = detectProjectType(files, languages, technologies)
  const packageName  = getPackageName(files)

  // Add languages to technologies if not already present
  const allTech = [...technologies]
  for (const lang of languages.slice(0, 3)) {
    if (!allTech.includes(lang)) allTech.unshift(lang)
  }

  const importantCode  = detectImportantFiles(files)
  const architecture   = buildArchitectureDescription(files, languages, technologies)
  const projectOverview = buildProjectOverview(files, projectType, allTech, packageName)
  const requirements   = buildRequirements(files, technologies)
  const currentProgress = detectCurrentProgress(files, technologies)

  // Source references — list of key file paths
  const sourceReferences = importantCode.slice(0, 10)

  return {
    project_overview:   projectOverview,
    architecture:       architecture,
    technologies:       allTech,
    requirements:       requirements,
    current_progress:   currentProgress,
    important_code:     importantCode,
    source_references:  sourceReferences,
    // Leave these empty — they need human input
    key_decisions:      [],
    pending_tasks:      [],
    known_issues:       [],
    agent_instructions: [],
    decisions:          [],
    constraints:        [],
    errors_and_solutions: [],
  }
}

module.exports = { analyseProject, detectLanguages, detectTechnologies, detectImportantFiles }