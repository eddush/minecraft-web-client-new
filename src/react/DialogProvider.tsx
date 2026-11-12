import { useEffect, useMemo, useState } from 'react'
import nbt from 'prismarine-nbt'
import { hideCurrentModal, showModal } from '../globalState'
import { useIsModalActive } from './utilsApp'

type DialogAction = {
  type?: string
  command?: string
  id?: string
  nbt?: any
  url?: string
  value?: string
}

const textOf = (value: any): string => {
  if (value == null || typeof value === 'boolean') return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (typeof value !== 'object') return ''
  if (typeof value.text === 'string') return value.text + textOf(value.extra)
  if (typeof value.translate === 'string') {
    const args = Array.isArray(value.with) ? value.with.map(textOf) : []
    return args.length ? value.translate + ': ' + args.join(', ') : value.translate
  }
  if (value.contents !== undefined) return textOf(value.contents)
  if (value.value !== undefined && Object.keys(value).length <= 2) return textOf(value.value)
  return textOf(value.extra)
}

const unwrap = (value: any): any => {
  if (value && typeof value === 'object' && value.type && Object.prototype.hasOwnProperty.call(value, 'value')) {
    if (value.type === 'compound') return Object.fromEntries(Object.entries(value.value ?? {}).map(([key, item]) => [key, unwrap(item)]))
    if (value.type === 'list') return (value.value?.value ?? []).map(unwrap)
    return unwrap(value.value)
  }
  if (Array.isArray(value)) return value.map(unwrap)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrap(item)]))
  return value
}

const getDialogButtons = (dialog: any) => {
  const type = String(dialog?.type ?? '').replace('minecraft:', '')
  if (Array.isArray(dialog?.actions)) return dialog.actions
  if (type === 'confirmation') return [dialog.yes, dialog.no].filter(Boolean)
  if (type === 'notice') return dialog.button ? [dialog.button] : []
  if (Array.isArray(dialog?.buttons)) return dialog.buttons
  return []
}

const getAction = (button: any): DialogAction | undefined => button?.action ?? button?.on_click ?? button?.onClick

export default () => {
  const isActive = useIsModalActive('minecraft-dialog')
  const [dialog, setDialog] = useState<any>(null)

  useEffect(() => {
    const onBotCreated = () => {
      const client = bot?._client
      if (!client) return
      const onShow = (packet: any) => {
        try {
          const raw = packet?.dialog ?? packet
          const simplified = typeof nbt.simplify === 'function' ? nbt.simplify(raw) : raw
          const parsed = unwrap(simplified)
          setDialog(parsed)
          showModal({ reactType: 'minecraft-dialog' })
        } catch (error) {
          console.error('Failed to read Minecraft dialog packet', error, packet)
        }
      }
      const onClear = () => {
        setDialog(null)
        hideCurrentModal()
      }
      client.on('show_dialog', onShow)
      client.on('clear_dialog', onClear)
      client.on('end', onClear)
    }
    customEvents.on('mineflayerBotCreated', onBotCreated)
  }, [])

  const close = () => {
    setDialog(null)
    hideCurrentModal()
  }

  const runAction = (button: any) => {
    const action = getAction(button)
    const type = String(action?.type ?? '').replace('minecraft:', '')
    try {
      if (type === 'run_command' && action?.command) {
        bot.chat(action.command)
      } else if (type === 'custom' && action?.id) {
        bot._client.write('custom_click_action', { id: action.id, nbt: action.nbt ?? undefined })
      } else if (type === 'open_url' && action?.url) {
        const url = new URL(action.url)
        if (url.protocol === 'https:' || url.protocol === 'http:') window.open(url.href, '_blank', 'noopener,noreferrer')
      } else if (type === 'copy_to_clipboard' && action?.value) {
        void navigator.clipboard?.writeText(action.value)
      }
    } catch (error) {
      console.error('Failed to execute Minecraft dialog action', error)
    }
    if (button?.close !== false) close()
  }

  if (!isActive || !dialog) return null

  const title = textOf(dialog.title ?? dialog.external_title) || 'Server dialog'
  const body = Array.isArray(dialog.body) ? dialog.body : dialog.body ? [dialog.body] : []
  const buttons = getDialogButtons(dialog)

  return <div style={{
    position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: 20, background: 'rgba(0,0,0,.72)', fontFamily: 'Minecraft, sans-serif'
  }}>
    <section role='dialog' aria-modal='true' aria-label={title} style={{
      width: 'min(560px, 100%)', maxHeight: '85vh', overflowY: 'auto', boxSizing: 'border-box',
      padding: 24, color: '#fff', background: '#242424', border: '2px solid #777',
      boxShadow: '0 8px 0 rgba(0,0,0,.35)', imageRendering: 'pixelated'
    }}>
      <h2 style={{ margin: '0 0 18px', textAlign: 'center', fontSize: 22, lineHeight: 1.35 }}>{title}</h2>
      <div style={{ display: 'grid', gap: 12, marginBottom: 22, lineHeight: 1.55, overflowWrap: 'anywhere' }}>
        {body.map((part: any, index: number) => {
          const kind = String(part?.type ?? '').replace('minecraft:', '')
          const content = textOf(part?.contents ?? part?.text ?? part)
          if (!content) return null
          return <p key={index} style={{ margin: 0, textAlign: kind.includes('message') ? 'center' : 'left' }}>{content}</p>
        })}
      </div>
      {Array.isArray(dialog.inputs) && dialog.inputs.length > 0 && <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
        {dialog.inputs.map((input: any, index: number) => <label key={index} style={{ display: 'grid', gap: 6 }}>
          <span>{textOf(input?.label ?? input?.key ?? 'Input')}</span>
          <input aria-label={textOf(input?.label ?? input?.key ?? 'Input')} type='text' placeholder={textOf(input?.label)} style={{ padding: 10, background: '#111', color: '#fff', border: '1px solid #888' }} />
        </label>)}
      </div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
        {buttons.map((button: any, index: number) => {
          const label = textOf(button?.label ?? button?.title) || 'Continue'
          return <button key={index} type='button' onClick={() => runAction(button)} style={{
            minWidth: 120, maxWidth: '100%', padding: '11px 16px', color: '#fff', background: '#555',
            border: '2px solid #aaa', boxShadow: 'inset 0 -3px rgba(0,0,0,.35)', cursor: 'pointer',
            font: 'inherit', overflowWrap: 'anywhere'
          }}>{label}</button>
        })}
        {buttons.length === 0 && <button type='button' onClick={close} style={{
          minWidth: 120, padding: '11px 16px', color: '#fff', background: '#555',
          border: '2px solid #aaa', cursor: 'pointer', font: 'inherit'
        }}>OK</button>}
      </div>
    </section>
  </div>
}
