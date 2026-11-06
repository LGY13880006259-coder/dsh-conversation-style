/**
 * Host half of the `dsh-conversation-style` bundle.
 *
 * Two responsibilities, both owned by effects on the plugin context:
 *
 * 1. A late system-prompt section whose text resolves the *current* style on
 *    every assembly, so flipping the mode changes the next model request.
 * 2. A tiny HTTP API the Web Client half uses to read and flip the mode:
 *
 *      GET  /api/conversation-style -> 200 {"mode":"professional"|"fun","promptText":"..."}
 *      POST /api/conversation-style -> body {"mode":"professional"|"fun"}
 *                                      200 {"mode":"<new mode>"} / 400 {"error":"..."}
 *      any other method             -> 405 {"error":"..."}
 *
 * The mode is profile-wide plugin state, persisted in a small JSON file under
 * `DSH_HOME` (atomic temp-file + rename, with a direct-write fallback) so it
 * survives Harness restarts without touching the profile's `cordis.patch.yml`.
 *
 * `systemPrompt` is a hard dependency (it is the whole point of the plugin);
 * `webServer` is optional, so profiles without a Web server still get the
 * prompt section and a broken/missing Web carrier cannot deactivate the plugin.
 *
 * @module dsh-conversation-style
 */

import { readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** The two supported conversation styles; the first entry is the default. */
const MODES = Object.freeze(['professional', 'fun'])
/** Default style used when nothing has been persisted yet. */
const DEFAULT_MODE = MODES[0]

/**
 * Prompt section placement. The shipped pool allocates first-party sections up
 * to `DEPLOYMENT_PERSONA_SUFFIX = 10200` (see `SECTION_ORDERS` in
 * `@deepseek-ai/dsh-system-prompt`), so 10300 places the style directive last
 * in the assembled system prompt while leaving room for future pool additions.
 */
const SECTION_ORDER = 10300
/** Unique global section name (a duplicate name would throw at registration). */
const SECTION_NAME = 'conversation-style:style'

/** Exact route path shared with the Client half. */
const ROUTE_PATH = '/api/conversation-style'
/** Refuse request bodies larger than this many bytes. */
const MAX_BODY_BYTES = 4096

/** Default name of the persisted state file inside `DSH_HOME`. */
const STATE_FILE_NAME = '.conversation-style.json'
/** Version tag stored next to the mode so a future format can be distinguished. */
const STATE_VERSION = 1

/**
 * Model-facing directive for the rigorous, no-nonsense register.
 * Bilingual (English + Chinese) so it steers replies in either user language.
 * Contains no `$` or `{{...}}` sequences; the section is registered with
 * `interpolate: false` for the same reason.
 */
const PROFESSIONAL_PROMPT_TEXT = [
  'Professional mode: reply with full rigor and a serious, professional register — direct, precise, well structured, high information density.',
  'Do not use jokes, emoji, memes, slang, role-play, or exaggerated rhetoric.',
  'Separate verified facts from uncertainty and state assumptions explicitly.',
  'Do not reduce task quality, completeness, or tool discipline.',
  '',
  '专业模式：以严谨、认真的专业语气回复，直接、精确、条理清晰、信息密度高。',
  '不使用玩笑、表情符号、梗、俚语、角色扮演或夸张修辞；明确区分已核实的事实与不确定之处并说明假设；不降低任务质量、完整性和工具规范。',
].join('\n')

/**
 * Model-facing directive for the relaxed, humorous register, with hard
 * accuracy/safety guardrails so "fun" can never degrade the work.
 */
const FUN_PROMPT_TEXT = [
  'Fun mode: reply in a relaxed, warm, and humorous register — playful phrasing, light jokes, and mild meme references are welcome when they fit naturally.',
  'Never sacrifice factual accuracy, task quality, completeness, or tool and security rules; humor must never mislead.',
  'For a serious, urgent, or dangerous topic, give the accurate answer first and drop the joking.',
  '',
  '娱乐模式：以轻松、亲切、幽默的语气回复，可自然使用俏皮措辞、适度玩笑和轻度梗。',
  '绝不牺牲事实准确性、任务质量、完整性和工具与安全规则，玩笑不得误导；遇到严肃、紧急或危险的话题时，先给出准确回答并收敛玩笑。',
].join('\n')

/** Exact prompt text per style; also what GET returns as `promptText`. */
const PROMPT_TEXTS = Object.freeze({
  professional: PROFESSIONAL_PROMPT_TEXT,
  fun: FUN_PROMPT_TEXT,
})

/** @param {unknown} value @returns {boolean} whether value is a supported mode string. */
function isMode(value) {
  return typeof value === 'string' && MODES.includes(value)
}

/**
 * The exact prompt text injected for one style (unknown values fall back to the
 * default style so the section can never render undefined).
 * @param {string} mode
 * @returns {string}
 */
function promptTextFor(mode) {
  return PROMPT_TEXTS[mode] ?? PROMPT_TEXTS[DEFAULT_MODE]
}

/**
 * Resolve the persisted-state path: `DSH_HOME` when the Harness provides it,
 * otherwise the conventional per-user `~/.dsh` directory.
 * @returns {string} absolute path of the state file.
 */
function resolveStateFilePath() {
  const fromEnvironment = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  const home = fromEnvironment !== '' ? fromEnvironment : join(homedir(), '.dsh')
  return join(home, STATE_FILE_NAME)
}

/**
 * Read the persisted mode synchronously at activation time. Any missing,
 * unreadable, or malformed file degrades to the default instead of failing the
 * plugin (a bad state file must not take the whole profile down).
 * @param {string} stateFile
 * @returns {string} a valid mode.
 */
function readPersistedMode(stateFile) {
  let raw
  try {
    raw = readFileSync(stateFile, 'utf8')
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code !== 'ENOENT') {
      console.warn(`[conversation-style] cannot read state file ${stateFile}; using the default mode`, error)
    }
    return DEFAULT_MODE
  }
  try {
    const parsed = JSON.parse(raw)
    const stored = parsed !== null && typeof parsed === 'object' ? parsed.mode : undefined
    if (isMode(stored)) return stored
    console.warn(`[conversation-style] state file ${stateFile} holds no valid mode; using the default mode`)
  } catch (error) {
    console.warn(`[conversation-style] state file ${stateFile} is not valid JSON; using the default mode`, error)
  }
  return DEFAULT_MODE
}

/**
 * Persist one mode atomically: write a sibling temp file, then rename it over
 * the state file. Some Windows setups refuse the rename (antivirus / file
 * lock); a direct write is attempted before reporting the failure so a toggle
 * still survives a restart whenever the directory is writable at all.
 * @param {string} stateFile
 * @param {string} mode
 * @returns {Promise<void>} resolves once the mode is on disk.
 */
async function writeModeFile(stateFile, mode) {
  const document = `${JSON.stringify({ version: STATE_VERSION, mode })}\n`
  const directory = dirname(stateFile)
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `.conversation-style.${process.pid}.${Date.now()}.tmp`)
  try {
    await writeFile(temporary, document, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, stateFile)
    return
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    try {
      await writeFile(stateFile, document, { encoding: 'utf8', mode: 0o600 })
    } catch {
      throw error
    }
  }
}

/** Headers shared by every JSON response; the contract forbids caching state. */
const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
})

/**
 * Write one JSON response with a matching content length.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 * @param {Record<string, string>} [extraHeaders]
 */
function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    ...JSON_HEADERS,
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  })
  res.end(body)
}

/**
 * Read and parse a request body, refusing anything larger than `limit`.
 * Resolves (rather than rejects) for bad input so the handler owns the status
 * code; only a transport error on the request rejects.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<{ok: true, value: unknown} | {ok: false, status: number, message: string}>}
 */
function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (outcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    req.on('data', (chunk) => {
      if (settled) return
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buffer.length
      if (size > limit) {
        finish({ ok: false, status: 413, message: 'request body is too large' })
        req.resume()
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => {
      if (settled) return
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        finish({ ok: true, value: text.trim() === '' ? undefined : JSON.parse(text) })
      } catch {
        finish({ ok: false, status: 400, message: 'request body is not valid JSON' })
      }
    })
    req.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

/**
 * Build the raw Node HTTP handler for the shared route.
 * @param {() => string} readMode returns the current mode.
 * @param {(mode: string) => Promise<void>} writeMode applies and persists a new mode.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
function createRouteHandler(readMode, writeMode) {
  return async function conversationStyleHandler(req, res) {
    try {
      if (req.method === 'GET') {
        const mode = readMode()
        sendJson(res, 200, { mode, promptText: promptTextFor(mode) })
        return
      }
      if (req.method === 'POST') {
        const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
        if (contentType !== '' && !contentType.includes('application/json')) {
          sendJson(res, 400, { error: 'content-type must be application/json' })
          return
        }
        const body = await readJsonBody(req, MAX_BODY_BYTES)
        if (!body.ok) {
          sendJson(res, body.status, { error: body.message })
          return
        }
        const candidate = body.value !== null && typeof body.value === 'object' && !Array.isArray(body.value)
          ? body.value.mode
          : undefined
        if (!isMode(candidate)) {
          sendJson(res, 400, { error: 'mode must be "professional" or "fun"' })
          return
        }
        await writeMode(candidate)
        sendJson(res, 200, { mode: candidate })
        return
      }
      sendJson(res, 405, { error: 'method not allowed' }, { allow: 'GET, POST' })
    } catch (error) {
      console.warn('[conversation-style] request failed', error)
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' })
      else res.end()
    }
  }
}

/** Hard dependency: without the prompt registry there is no prompt section to add. */
export const inject = ['systemPrompt']

/**
 * Cordis plugin entry point.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context.
 */
export function apply(ctx) {
  const stateFile = resolveStateFilePath()
  let mode = readPersistedMode(stateFile)

  // Serialize persistence writes so two quick toggles cannot interleave temp files.
  let persistChain = Promise.resolve()
  /** @param {string} nextMode */
  function persistMode(nextMode) {
    const write = () => writeModeFile(stateFile, nextMode).catch((error) => {
      console.warn(`[conversation-style] failed to persist mode to ${stateFile}; the mode still applies for this process`, error)
    })
    persistChain = persistChain.then(write, write)
    return persistChain
  }

  // The text is a per-assembly function, so a toggle reaches the next request.
  // `interpolate: false` keeps the bilingual prose literal (no `{{...}}` scan).
  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: () => promptTextFor(mode),
    interpolate: false,
  }), 'conversation-style: style prompt section')

  // `webServer` is optional: ctx.inject keeps the plugin active when the
  // service is absent (or not yet mounted) and installs the route as soon as it
  // appears; the route registration itself is an effect with its disposer.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const webServer = webCtx.get('webServer')
      if (webServer === undefined) return undefined
      return webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: createRouteHandler(
          () => mode,
          async (nextMode) => {
            mode = nextMode
            await persistMode(nextMode)
          },
        ),
      })
    }, 'conversation-style: HTTP route')
  })
}
