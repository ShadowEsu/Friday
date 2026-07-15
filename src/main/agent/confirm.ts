/**
 * Tools listed here always require an explicit user confirmation before they run,
 * regardless of what the tool's own `sensitive` flag says - this is the single source
 * of truth referenced by the safety rules in the product spec.
 */
export const SENSITIVE_TOOLS = new Set([
  'linkedin_send_message',
  'linkedin_accept_request',
  'browser_submit_form',
  'browser_send_email',
  'browser_publish_post',
  'calendar_create_event',
  'browser_delete_item',
  'browser_purchase',
  'browser_upload_file',
  'browser_change_settings'
])

export function isSensitiveTool(toolName: string): boolean {
  return SENSITIVE_TOOLS.has(toolName)
}
