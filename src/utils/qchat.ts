type ChatContent = string | Record<string, any>;

export interface SendChatMessageRequest {
  action: 'SEND_CHAT_MESSAGE';
  groupId?: number;
  recipient?: string;
  fullContent: ChatContent;
  chatReference?: string;
}

export type SendChatMessageResponse = {
  type: 'CHAT';
  timestamp: number;
  reference: string;
  fee: string;
  signature: string;
  txGroupId: number;
  recipient?: string;
  approvalStatus: string;
  creatorAddress: string;
  senderPublicKey: string;
  sender: string;
  nonce: number;
  data: string;
  isText: boolean;
  isEncrypted: boolean;
};

export async function sendChatMessage(
  req: Omit<SendChatMessageRequest, 'action'>
): Promise<SendChatMessageResponse> {
  if (!req) throw new Error('sendChatMessage: request payload is required.');
  const hasGroup = typeof req.groupId === 'number';
  const hasRecipient = typeof req.recipient === 'string' && req.recipient.trim().length > 0;
  if (!hasGroup && !hasRecipient) {
    throw new Error('sendChatMessage: provide groupId or recipient.');
  }
  if (hasGroup && hasRecipient) {
    throw new Error('sendChatMessage: specify only groupId or recipient.');
  }
  if (typeof req.fullContent !== 'string' && typeof req.fullContent !== 'object') {
    throw new Error('sendChatMessage: fullContent must be string or object.');
  }

  if (hasGroup) {
    return qortalRequest({
      action: 'SEND_CHAT_MESSAGE',
      groupId: req.groupId!,
      fullContent: req.fullContent,
      ...(req.chatReference ? { chatReference: req.chatReference } : {}),
    } as any);
  }
  return qortalRequest({
    action: 'SEND_CHAT_MESSAGE',
    recipient: req.recipient!.trim(),
    fullContent: req.fullContent,
    ...(req.chatReference ? { chatReference: req.chatReference } : {}),
  });
}
