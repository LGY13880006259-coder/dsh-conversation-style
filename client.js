window.__ModuleLoader__.load({
  id: 'dsh-conversation-style',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** Client locale namespace owned by this plugin. */
    const NS = 'conversation-style'
    /** Same-origin route registered by this plugin's Host half. */
    const API_PATH = '/api/conversation-style'
    const MODE_PROFESSIONAL = 'professional'
    const MODE_FUN = 'fun'
    const DEFAULT_MODE = MODE_PROFESSIONAL
    /** A hung Host request must not leave the control dimmed forever. */
    const REQUEST_TIMEOUT_MS = 10000
    /** How long a failed toggle keeps its retry hint before showing the mode again. */
    const ERROR_RESET_MS = 4000
    /** Cap the Host-provided error text that ends up in the tooltip. */
    const MAX_ERROR_DETAIL = 160

    /** Visible text. English is also the hard fallback when no locale service is present. */
    const messages = {
      en: {
        'control.label': 'Conversation style',
        'mode.professional': 'Professional',
        'mode.fun': 'Fun',
        'control.title.professional': 'Conversation style: professional. Click to switch to fun.',
        'control.title.fun': 'Conversation style: fun. Click to switch to professional.',
        'status.loading': 'Reading the conversation style…',
        'status.saving': 'Saving the conversation style…',
        'action.retry': 'Retry',
        'error.title': 'Could not switch the conversation style. Click to retry.',
        'error.timeout': 'The request timed out.',
      },
      zh: {
        'control.label': '对话风格',
        'mode.professional': '专业',
        'mode.fun': '娱乐',
        'control.title.professional': '当前对话风格：专业。点击切换为娱乐。',
        'control.title.fun': '当前对话风格：娱乐。点击切换为专业。',
        'status.loading': '正在读取对话风格…',
        'status.saving': '正在保存对话风格…',
        'action.retry': '重试',
        'error.title': '切换对话风格失败，点击重试。',
        'error.timeout': '请求超时。',
      },
    }

    /**
     * Only theme tokens from the host are used, so a renamed token can degrade the
     * look but never break rendering. The same markup/copy style as the host
     * sidebar footer actions: a compact row in the expanded sidebar and a 32px
     * square icon button in the collapsed 56px rail.
     */
    const CSS = [
      '.cstyle-action{position:relative;display:inline-flex;align-items:center;justify-content:flex-start;',
      'gap:8px;box-sizing:border-box;width:100%;max-width:100%;min-height:32px;margin:0;padding:4px 8px;',
      'border:1px solid transparent;border-radius:8px;background:transparent;',
      'color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;line-height:1.3;',
      'text-align:left;cursor:pointer;-webkit-user-select:none;user-select:none;',
      '-webkit-tap-highlight-color:transparent;}',
      '.cstyle-action:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.cstyle-action:active{background:var(--dsw-alias-bg-layer-1);}',
      '.cstyle-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
      '.cstyle-action[data-busy="true"]{opacity:.55;cursor:progress;}',
      '.cstyle-action[data-failed="true"]{color:var(--dsw-alias-label-primary);}',
      '.cstyle-action[data-mode="fun"]{color:var(--dsw-alias-label-primary);}',
      '.cstyle-action[data-mode="fun"] .cstyle-icon{color:var(--dsw-alias-brand-primary);}',
      '.cstyle-action[data-wide="false"]{width:32px;height:32px;min-height:32px;flex:none;',
      'justify-content:center;padding:0;margin:0 auto;}',
      '.cstyle-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:18px;height:18px;}',
      '.cstyle-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.cstyle-badge{position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;',
      'background:var(--dsw-alias-brand-primary);}',
    ].join('')

    function isMode(value) {
      return value === MODE_PROFESSIONAL || value === MODE_FUN
    }

    function nextMode(mode) {
      return mode === MODE_FUN ? MODE_PROFESSIONAL : MODE_FUN
    }

    function fallbackTranslate(key) {
      const value = messages.en[key]
      return typeof value === 'string' ? value : key
    }

    async function readJson(response) {
      try {
        return await response.json()
      } catch (error) {
        return null
      }
    }

    /**
     * Call the Host route and resolve with the authoritative mode it reports.
     * GET may omit `mode` from the payload; POST is expected to echo the new mode.
     * Rejects on transport errors, non-2xx statuses and unusable JSON.
     */
    async function requestStyle(method, mode, signal) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const abort = () => {
        if (controller !== null && controller.signal.aborted !== true) controller.abort()
      }
      const timer = controller === null ? null : setTimeout(abort, REQUEST_TIMEOUT_MS)
      const forwardAbort = () => abort()
      if (signal !== undefined && signal !== null && typeof signal.addEventListener === 'function') {
        if (signal.aborted === true) forwardAbort()
        else signal.addEventListener('abort', forwardAbort, { once: true })
      }
      try {
        const headers = { accept: 'application/json' }
        const init = { method, credentials: 'same-origin', cache: 'no-store', headers }
        if (method === 'POST') {
          headers['content-type'] = 'application/json'
          init.body = JSON.stringify({ mode })
        }
        if (controller !== null) init.signal = controller.signal
        const response = await fetch(API_PATH, init)
        const payload = await readJson(response)
        if (response.ok !== true) {
          const detail =
            payload !== null && typeof payload === 'object' && typeof payload.error === 'string' && payload.error !== ''
              ? payload.error
              : 'HTTP ' + response.status
          throw new Error(detail)
        }
        if (payload === null || typeof payload !== 'object') throw new Error('Invalid response')
        return { mode: isMode(payload.mode) ? payload.mode : undefined }
      } finally {
        if (timer !== null) clearTimeout(timer)
        if (signal !== undefined && signal !== null && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', forwardAbort)
        }
      }
    }

    /** Small toggle glyph: knob left = professional, knob right + filled = fun. */
    function ToggleGlyph(props) {
      const active = props !== null && props !== undefined && props.active === true
      return h(
        'svg',
        {
          viewBox: '0 0 20 14',
          width: 18,
          height: 12.6,
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        h('rect', {
          x: 0.75,
          y: 0.75,
          width: 18.5,
          height: 12.5,
          rx: 6.25,
          stroke: 'currentColor',
          strokeWidth: 1.5,
          fill: active ? 'currentColor' : 'none',
          opacity: active ? 0.9 : 0.8,
        }),
        h('circle', {
          cx: active ? 13.25 : 6.75,
          cy: 7,
          r: 4,
          fill: active ? 'var(--dsw-alias-bg-base)' : 'currentColor',
        }),
      )
    }

    /**
     * One sidebar-footer action. It owns its state machine:
     *   loading -> idle -> saving -> idle (or idle + failed)
     * A failed POST reverts the optimistic mode and offers a retry on the next click.
     */
    function ConversationStyleAction(props) {
      const p = props !== null && typeof props === 'object' ? props : {}
      const translate =
        typeof p.translate === 'function' ? p.translate : typeof p.t === 'function' ? p.t : fallbackTranslate
      const wide = p.wide !== false

      const t = useCallback(
        (key) => {
          try {
            const value = translate(key)
            if (typeof value === 'string' && value !== '') return value
          } catch (error) {
            /* fall through to the built-in English dictionary */
          }
          return fallbackTranslate(key)
        },
        [translate],
      )

      const [mode, setMode] = useState(DEFAULT_MODE)
      const [phase, setPhase] = useState('loading')
      const [failed, setFailed] = useState(false)
      const [errorDetail, setErrorDetail] = useState('')

      const mounted = useRef(true)
      /** Synchronous in-flight guard: a second click cannot fire a second POST before React re-renders. */
      const saving = useRef(false)
      /** Monotonic token: any newer request (GET or POST) invalidates older replies. */
      const sequence = useRef(0)
      const saveController = useRef(null)
      const errorTimer = useRef(null)

      const clearErrorTimer = useCallback(() => {
        if (errorTimer.current !== null) {
          clearTimeout(errorTimer.current)
          errorTimer.current = null
        }
      }, [])

      // Unmount safety net for the timer and any in-flight save.
      useEffect(() => {
        mounted.current = true
        return () => {
          mounted.current = false
          clearErrorTimer()
          const controller = saveController.current
          saveController.current = null
          if (controller !== null) controller.abort()
        }
      }, [clearErrorTimer])

      // Initial read of the persisted mode. A failure keeps the default mode and
      // leaves the control usable; the next click POSTs and can recover.
      useEffect(() => {
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        const token = sequence.current + 1
        sequence.current = token
        let active = true
        requestStyle('GET', undefined, controller === null ? undefined : controller.signal)
          .then((result) => {
            if (!active || sequence.current !== token) return
            if (isMode(result.mode)) setMode(result.mode)
            setPhase('idle')
          })
          .catch(() => {
            if (!active || sequence.current !== token) return
            setPhase('idle')
          })
        return () => {
          active = false
          if (controller !== null) controller.abort()
        }
      }, [])

      const toggle = useCallback(() => {
        if (saving.current) return
        clearErrorTimer()
        setFailed(false)
        setErrorDetail('')

        const previous = mode
        const target = nextMode(mode)
        const token = sequence.current + 1
        sequence.current = token
        saving.current = true

        let controller = null
        if (typeof AbortController === 'function') {
          controller = new AbortController()
          saveController.current = controller
        }
        setMode(target)
        setPhase('saving')

        requestStyle('POST', target, controller === null ? undefined : controller.signal)
          .then((result) => {
            if (!mounted.current || sequence.current !== token) return
            saving.current = false
            saveController.current = null
            if (isMode(result.mode)) setMode(result.mode)
            setPhase('idle')
          })
          .catch((error) => {
            if (!mounted.current || sequence.current !== token) return
            saving.current = false
            saveController.current = null
            setMode(previous)
            setPhase('idle')
            setFailed(true)
            const aborted = error !== null && error !== undefined && error.name === 'AbortError'
            const raw =
              aborted === true
                ? t('error.timeout')
                : error !== null && error !== undefined && typeof error.message === 'string'
                  ? error.message
                  : ''
            setErrorDetail(raw.length > MAX_ERROR_DETAIL ? raw.slice(0, MAX_ERROR_DETAIL) + '…' : raw)
            errorTimer.current = setTimeout(() => {
              errorTimer.current = null
              if (mounted.current) setFailed(false)
            }, ERROR_RESET_MS)
          })
      }, [clearErrorTimer, mode, t])

      const busy = phase === 'saving'
      const loading = phase === 'loading'
      const isFun = mode === MODE_FUN
      const modeLabel = t(isFun ? 'mode.fun' : 'mode.professional')

      let labelText = modeLabel
      let title
      if (failed) {
        labelText = t('action.retry')
        title = t('error.title')
        if (errorDetail !== '') title = title + ' (' + errorDetail + ')'
      } else if (busy) {
        title = t('status.saving')
      } else if (loading) {
        title = t('status.loading')
      } else {
        title = t(isFun ? 'control.title.fun' : 'control.title.professional')
      }

      const children = [
        h('span', { key: 'icon', className: 'cstyle-icon', 'aria-hidden': 'true' }, h(ToggleGlyph, { active: isFun })),
      ]
      if (wide) children.push(h('span', { key: 'label', className: 'cstyle-label' }, labelText))
      if (failed && !wide) children.push(h('span', { key: 'badge', className: 'cstyle-badge', 'aria-hidden': 'true' }))

      return h(
        React.Fragment,
        null,
        h('style', { key: 'style' }, CSS),
        h(
          'button',
          {
            key: 'action',
            type: 'button',
            className: 'cstyle-action',
            'data-testid': 'conversation-style-toggle',
            'data-mode': mode,
            'data-wide': wide ? 'true' : 'false',
            'data-busy': busy ? 'true' : 'false',
            'data-failed': failed ? 'true' : 'false',
            'aria-label': title,
            'aria-pressed': isFun,
            'aria-busy': busy,
            title,
            disabled: busy,
            onClick: toggle,
          },
          children,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const locale = ctx.get('locale')
        const hasLocale = locale !== undefined && locale !== null && typeof locale.register === 'function'
        if (hasLocale) {
          ctx.effect(() => locale.register(NS, 'en', messages.en))
          ctx.effect(() => locale.register(NS, 'zh', messages.zh))
          ctx.effect(() => locale.register(NS, 'zh-CN', messages.zh))
        }
        const bound = hasLocale && typeof locale.bind === 'function' ? locale.bind(NS) : undefined

        const translate = (key) => {
          if (typeof bound === 'function') {
            try {
              const value = bound(key)
              if (typeof value === 'string' && value !== '' && value !== key) return value
            } catch (error) {
              /* fall back to English */
            }
          }
          return fallbackTranslate(key)
        }

        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'conversation-style',
              order: 20,
              locale: NS,
              label: () => translate('control.label'),
              inject: () => ({ translate }),
            },
            ConversationStyleAction,
          ),
        )
      },
    }
  },
})
