/**
 * Filters out ElevenLabs Scribe hallucinations — stock outro/subscribe
 * boilerplate it sometimes emits for near-silent or noisy audio instead of
 * failing outright. Shared by every mic-to-text path (see
 * useVoiceConversation.ts) so a hallucinated transcript never gets treated
 * as something the user actually said.
 */
export function isBoilerplateTranscript(text: string): boolean {
  return /点赞|订阅|转发|打赏|明镜|点点栏目/.test(text);
}
