import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import nbt from 'prismarine-nbt'
import { hideModal, showModal } from '../globalState'
import MessageFormattedString from './MessageFormattedString'

type AnyRecord = Record<string, any>

const toPlain = (value: any): any => {
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(toPlain)
  if (typeof value.type === 'string' && 'value' in value && Object.keys(value).every(key => ['type', 'value', 'name'].includes(key))) {
    if (value.type === 'compound') return Object.fromEntries(Object.entries(value.value ?? {}).map(([key, child]) => [key, toPlain(child)]))
    if (value.type === 'list') return (value.value?.value ?? []).map(toPlain)
    return toPlain(value.value)
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toPlain(child)]))
}

const toTag = (value: any): any => {
  if (typeof value === 'string') return nbt.string(value)
  if (typeof value === 'boolean') return nbt.byte(value ? 1 : 0)
  if (typeof value === 'number') return Number.isInteger(value) ? nbt.int(value) : nbt.double(value)
  if (Array.isArray(value)) return nbt.list(value.map(toTag), 'compound')
  if (value && typeof value === 'object') return nbt.comp(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toTag(child)])))
  return nbt.string('')
}

const asText = (value: any) => {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return value
}

const DialogBody = ({ body }: { body: any }) => {
  const entries = Array.isArray(body) ? body : body ? [body] : []
  return <div style={{ display: 'grid', gap: 10, margin: '16px 0', maxHeight: '45vh', overflowY: 'auto' }}>
    {entries.map((entry, index) => {
      const type = String(entry?.type ?? 'minecraft:plain_message').replace('minecraft:', '')
      const contents = entry?.contents ?? entry?.text ?? entry
      if (type === 'plain_message' || type === 'text' || typeof contents === 'string' || contents?.text) {
        return <div key={index} style={{ lineHeight: 1.5, overflowWrap: 'anywhere' }}><MessageFormattedString message={contents} fallbackColor="white" /></div>
      }
      if (type === 'item') {
        return <div key={index} style={{ opacity: 0.9 }}><MessageFormattedString message={entry.description ?? entry.name ?? 'Item'} fallbackColor="white" /></div>
      }
      return <div key={index} style={{ opacity: 0.9, lineHeight: 1.5 }}><MessageFormattedString message={contents?.text ? contents : JSON.stringify(contents)} fallbackColor="white" /></div>
    })}
  </div>
}

export default function DialogProvider () {
  const [dialog, setDialog] = useState<AnyRecord | null>(null)
  const [inputValues, setInputValues] = useState<Record<string, any>>({})

  const openDialog = (raw: any) => {
    const parsed = toPlain(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.type) {
      console.warn('[dialogs] Unsupported dialog packet', raw)
      return
    }
    setDialog(parsed)
    const initial: Record<string, any> = {}
    for (const input of parsed.inputs ?? []) {
      const type = String(input.type ?? '').replace('minecraft:', '')
      if (type === 'boolean') initial[input.key] = !!input.initial
      else if (type === 'number_range') initial[input.key] = input.initial ?? ((Number(input.start) + Number(input.end)) / 2)
      else if (type === 'single_option') initial[input.key] = input.initial ?? input.options?.[0]?.id ?? ''
      else initial[input.key] = input.initial ?? ''
    }
    setInputValues(initial)
    showModal({ reactType: 'minecraft-dialog' })
  }

  useEffect(() => {
    let attachedClient: any
    const onShow = (packet: any) => {
      // In 26.1, configuration dialogs are inline NBT. Play dialogs use a holder:
      // inline definitions are carried as the holder's value; registry references
      // require a registry lookup and are intentionally not guessed here.
      const value = packet?.dialog
      if (value?.data && typeof value.data === 'object') openDialog(value.data)
      else if (value?.type && String(value.type).startsWith('minecraft:')) openDialog(value)
      else if (value?.type === 'value' && value.value) openDialog(value.value)
      else console.warn('[dialogs] Unsupported or registry-referenced dialog packet', packet)
    }
    const onClear = () => {
      setDialog(null)
      setInputValues({})
      hideModal({ reactType: 'minecraft-dialog' }, undefined, { force: true })
    }
    const attach = () => {
      if (!bot?._client || attachedClient === bot._client) return
      attachedClient?.removeListener('show_dialog', onShow)
      attachedClient?.removeListener('clear_dialog', onClear)
      attachedClient = bot._client
      attachedClient.on('show_dialog', onShow)
      attachedClient.on('clear_dialog', onClear)
    }
    customEvents.on('mineflayerBotCreated', attach)
    attach()
    return () => {
      customEvents.removeListener?.('mineflayerBotCreated', attach)
      attachedClient?.removeListener('show_dialog', onShow)
      attachedClient?.removeListener('clear_dialog', onClear)
    }
  }, [])

  const close = () => {
    setDialog(null)
    setInputValues({})
    hideModal({ reactType: 'minecraft-dialog' }, undefined, { force: true })
  }

  const performAction = (action: AnyRecord | undefined) => {
    if (!action) {
      if (dialog?.after_action !== 'none') close()
      return
    }
    const type = String(action.type ?? '').replace('minecraft:', '')
    const values = { ...inputValues }
    if (type === 'run_command') {
      bot.chat(String(action.command ?? ''))
    } else if (type === 'dynamic/run_command') {
      const command = String(action.template ?? '').replace(/\$\(([a-zA-Z0-9_]+)\)/g, (_, key) => String(values[key] ?? ''))
      bot.chat(command)
    } else if (type === 'suggest_command') {
      const command = String(action.command ?? '')
      window.dispatchEvent(new CustomEvent('openChat', { detail: command }))
    } else if (type === 'open_url') {
      const url = String(action.url ?? '')
      if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
    } else if (type === 'copy_to_clipboard') {
      void navigator.clipboard?.writeText(String(action.value ?? ''))
    } else if (type === 'show_dialog') {
      if (typeof action.dialog === 'object') openDialog(action.dialog)
    } else if (type === 'custom' || type === 'dynamic/custom') {
      const payload = type === 'dynamic/custom'
        ? { ...(action.additions ?? {}), ...values }
        : (action.payload ?? {})
      bot._client.write('custom_click_action', {
        id: String(action.id ?? ''),
        nbt: payload && Object.keys(payload).length ? toTag(payload) : undefined
      })
    }
    if (dialog?.after_action !== 'none' && type !== 'show_dialog') close()
  }

  const title = dialog?.title ?? 'Server dialog'
  const type = String(dialog?.type ?? '').replace('minecraft:', '')
  const actions = useMemo(() => {
    if (!dialog) return []
    if (type === 'notice') return [dialog.action ?? { label: { text: 'OK' } }]
    if (type === 'confirmation') return [dialog.yes, dialog.no].filter(Boolean)
    if (type === 'multi_action') return dialog.actions ?? []
    if (type === 'server_links') return dialog.links ?? []
    if (type === 'dialog_list') return dialog.dialogs ?? []
    return []
  }, [dialog, type])

  if (!dialog) return null

  const buttonStyle: CSSProperties = {
    border: '1px solid #777',
    borderRadius: 4,
    background: '#555',
    color: 'white',
    padding: '9px 16px',
    minWidth: 110,
    cursor: 'pointer',
    font: 'inherit',
    boxShadow: 'inset 0 1px #888, inset 0 -2px #333'
  }

  return <div role="dialog" aria-modal="true" aria-label="Minecraft server dialog" style={{
    position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16, background: 'rgba(0,0,0,.68)', color: 'white', fontFamily: 'minecraft, mojangles, monospace'
  }} onKeyDown={event => {
    if (event.key === 'Escape' && dialog.can_close_with_escape !== false) close()
  }}>
    <div style={{
      width: 'min(560px, 100%)', maxHeight: 'min(85vh, 760px)', overflow: 'auto',
      padding: '22px 24px', background: '#292929', border: '2px solid #aaa',
      boxShadow: '0 8px 32px #000', color: '#fff'
    }}>
      <div style={{ textAlign: 'center', fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
        <MessageFormattedString message={title} fallbackColor="white" />
      </div>
      <DialogBody body={dialog.body} />
      {!!dialog.inputs?.length && <div style={{ display: 'grid', gap: 14, margin: '14px 0' }}>
        {dialog.inputs.map((input: AnyRecord) => {
          const inputType = String(input.type ?? 'text').replace('minecraft:', '')
          const label = input.label ?? input.key
          return <label key={input.key} style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            <span><MessageFormattedString message={label} fallbackColor="white" /></span>
            {inputType === 'boolean'
              ? <input type="checkbox" checked={!!inputValues[input.key]} onChange={e => setInputValues(v => ({ ...v, [input.key]: e.target.checked }))} />
              : inputType === 'single_option'
                ? <select value={String(inputValues[input.key] ?? '')} onChange={e => setInputValues(v => ({ ...v, [input.key]: e.target.value }))} style={{ padding: 8 }}>
                  {(input.options ?? []).map((option: AnyRecord) => <option key={option.id} value={option.id}>{asText(option.display?.text ?? option.id)}</option>)}
                </select>
                : inputType === 'number_range'
                  ? <input type="range" min={input.start} max={input.end} step={input.step ?? 'any'} value={Number(inputValues[input.key])} onChange={e => setInputValues(v => ({ ...v, [input.key]: Number(e.target.value) }))} />
                  : <input type="text" maxLength={input.max_length ?? 1024} value={String(inputValues[input.key] ?? '')} onChange={e => setInputValues(v => ({ ...v, [input.key]: e.target.value }))} style={{ padding: 8, width: '100%', boxSizing: 'border-box' }} />
            }
          </label>
        })}
      </div>}
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
        {actions.map((item: AnyRecord, index: number) => {
          const label = item.label ?? item.title ?? item.name ?? { text: type === 'dialog_list' ? 'Open' : 'Continue' }
          const action = item.action ?? (type === 'dialog_list' ? { type: 'show_dialog', dialog: item.dialog } : undefined)
          return <button key={index} type="button" style={buttonStyle} onClick={() => {
            if (type === 'server_links') {
              const url = String(item.url ?? '')
              if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
              return
            }
            performAction(action)
          }}>
            <MessageFormattedString message={label} fallbackColor="white" />
          </button>
        })}
        {dialog.can_close_with_escape !== false && <button type="button" style={{ ...buttonStyle, background: '#3d3d3d' }} onClick={close}>Close</button>}
      </div>
    </div>
  </div>
}
