/** Known web destinations Friday can open directly in the controlled browser. */
export const KNOWN_SITES: Record<string, string> = {
  youtube: 'https://www.youtube.com',
  linkedin: 'https://www.linkedin.com',
  chatgpt: 'https://chatgpt.com',
  claude: 'https://claude.ai',
  gmail: 'https://mail.google.com',
  'google calendar': 'https://calendar.google.com',
  calendar: 'https://calendar.google.com',
  'google mail': 'https://mail.google.com',
  google: 'https://www.google.com',
  'google docs': 'https://docs.google.com',
  github: 'https://github.com',
  twitter: 'https://twitter.com',
  x: 'https://x.com'
}

/** Known native macOS applications Friday can launch with `open -a`. */
export const KNOWN_APPS: Record<string, string> = {
  chrome: 'Google Chrome',
  'google chrome': 'Google Chrome',
  safari: 'Safari',
  finder: 'Finder',
  notes: 'Notes',
  mail: 'Mail',
  slack: 'Slack',
  spotify: 'Spotify',
  terminal: 'Terminal',
  calculator: 'Calculator',
  messages: 'Messages',
  photos: 'Photos',
  music: 'Music',
  calendar: 'Calendar',
  reminders: 'Reminders',
  preview: 'Preview'
}

export function resolveSiteUrl(name: string): string | undefined {
  const key = name.trim().toLowerCase()
  return KNOWN_SITES[key]
}

export function resolveAppName(name: string): string | undefined {
  const key = name.trim().toLowerCase()
  return KNOWN_APPS[key]
}
