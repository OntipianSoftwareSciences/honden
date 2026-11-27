export type DeepLink = {
  chatId: string
  from: string
  callFrom: string
  callId: string
  callKind: 'video' | 'voice' | null
  callAction: 'accept' | 'decline' | 'callback' | 'open' | null
  callBack: boolean
}

function clean(value: string | null): string {
  return (value ?? '').trim().replace(/^@/, '').toLowerCase()
}

export function parseDeepLink(search: string): DeepLink {
  const params = new URLSearchParams(search)
  const chat = clean(params.get('chat'))
  const from = clean(params.get('from'))
  const callFrom = clean(params.get('callFrom'))
  const kind = params.get('callKind')
  return {
    chatId: chat || from,
    from,
    callFrom,
    callId: (params.get('callId') ?? '').trim(),
    callKind: kind === 'video' || kind === 'voice' ? kind : null,
    callAction:
      params.get('callAction') === 'accept' ||
      params.get('callAction') === 'decline' ||
      params.get('callAction') === 'callback' ||
      params.get('callAction') === 'open'
        ? (params.get('callAction') as 'accept' | 'decline' | 'callback' | 'open')
        : null,
    callBack: params.get('callBack') === '1',
  }
}
