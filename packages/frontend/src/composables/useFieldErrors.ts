import { nextTick, reactive } from 'vue'
import type { CheckResult } from '../types/config'

/** Inline error messages keyed by the input id they sit under. */
export function useFieldErrors<K extends string>() {
  const errors = reactive<Partial<Record<K, string>>>({}) as Partial<Record<K, string>>

  function clear() {
    for (const k of Object.keys(errors) as K[]) delete errors[k]
  }

  function set(field: K, message: string) {
    errors[field] = message
  }

  function has() {
    return Object.keys(errors).length > 0
  }

  /** Moves focus to the first input that has an error. */
  async function focusFirst(order: readonly K[]) {
    await nextTick()
    const first = order.find(k => errors[k])
    if (first) document.getElementById(first)?.focus()
  }

  /** Puts the reason of each failed step under the field the server blamed. Returns the fields. */
  function applyResult(result: CheckResult | null, idFor: (field: string) => K | undefined): K[] {
    const fields: K[] = []
    for (const step of result?.steps ?? []) {
      if (step.status !== 'fail' || !step.field) continue
      const id = idFor(step.field)
      if (id && !errors[id]) {
        errors[id] = step.detail
        fields.push(id)
      }
    }
    return fields
  }

  return { errors, clear, set, has, focusFirst, applyResult }
}

export function isHttpUrl(u: string) {
  try {
    const p = new URL(u)
    return p.protocol === 'http:' || p.protocol === 'https:'
  } catch {
    return false
  }
}
