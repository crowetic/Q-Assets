export interface SendChatMessageRequest {
  action: 'SEND_CHAT_MESSAGE';
  groupId: number;
  fullContent: string | object; // string, object, or base64 string
  chatReference?: string; // previous msg signature: edits/reactions/threads
}

export type SendChatMessageResponse = true; // per docs

// If you're already exporting qortalRequest elsewhere, import it instead.
declare function qortalRequest<T = any>(req: any): Promise<T>;

export async function sendChatMessage(
  req: Omit<SendChatMessageRequest, 'action'>
): Promise<SendChatMessageResponse> {
  // Validate early to get nicer dev errors
  if (!req || typeof req.groupId !== 'number') {
    throw new Error('sendChatMessage: groupId is required (number).');
  }
  if (typeof req.fullContent !== 'string' && typeof req.fullContent !== 'object') {
    throw new Error('sendChatMessage: fullContent must be string|object.');
  }

  const payload: SendChatMessageRequest = {
    action: 'SEND_CHAT_MESSAGE',
    groupId: req.groupId,
    fullContent: req.fullContent,
    ...(req.chatReference ? { chatReference: req.chatReference } : {}),
  };

  // Needs user approval — will surface the UI
  return qortalRequest<SendChatMessageResponse>(payload);
}
