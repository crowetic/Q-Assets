
export const tempQAssetEscrowAccountAddress: string = "QXaqF42Uzbkoq7NBvRNiNNW5bsToDaDBAS"
export const qAssetsRevenueAddress: string = 'QWZDZBKafP19Hin4HivuV6WXgWaBaWUMrN'

export const getQAssetsRevenueAddress = async():Promise<string> => {
  const nameData = await qortalRequest({
    action: 'GET_NAME_DATA',
    name: 'Q-Assets'
  })

  const address = nameData.owner
  return address
}

export const getAddressByOwnerName = async (boardOwnerName: string):Promise<string> => {
  const nameData = await qortalRequest({
    action: 'GET_NAME_DATA',
    name: boardOwnerName
  })
  const address = nameData.owner
  return address
}

export const PRIVATE_MAGIC_B64 = 'cW9ydGFsR3JvdXBFbmNyeXB0ZWREYXRh';

export function addPrivateMagic(b64: string): string {
  return b64.startsWith(PRIVATE_MAGIC_B64) ? b64 : PRIVATE_MAGIC_B64 + b64;
}

export function stripPrivateMagic(b64: string): string {
  return b64.startsWith(PRIVATE_MAGIC_B64)
    ? b64.slice(PRIVATE_MAGIC_B64.length)
    : b64; // backward-compat if old items lack the marker
}


export function boardPrivateIdentV2(
  boardId: string,
  mode: 'group' | 'direct',
  opts?: { groupId?: number; isAdmins?: boolean }
) {
  if (mode === 'direct') return `qdeck_priv__bdv2__${boardId}__m-d`;
  const gid = opts?.groupId;
  if (gid == null) throw new Error('group mode requires groupId');
  const a = opts?.isAdmins ? '1' : '0';
  return `qdeck_priv__bdv2__${boardId}__m-g__gid-${gid}__a-${a}`;
}


export function parsePrivateBoardIdentV2(ident: string): {
  boardId: string;
  mode: 'group' | 'direct';
  groupId?: number;
  isAdmins?: boolean;
} | null {
  // group
  {
    const m = ident.match(/^qdeck_priv__bdv2__([^_]+)__m-g__gid-(\d+)__a-(0|1)$/);
    if (m) {
      const [, boardId, gid, a] = m;
      return { boardId, mode: 'group', groupId: Number(gid), isAdmins: a === '1' };
    }
  }
  // direct
  {
    const m = ident.match(/^qdeck_priv__bdv2__([^_]+)__m-d$/);
    if (m) return { boardId: m[1], mode: 'direct' };
  }
  return null;
}



export const QDeckId = {
  boardPublic:  (boardId: string) => `qdeck_pub__board__${boardId}`,
  boardPrivate: (boardId: string, mode: 'group'|'direct', isAdmins?: boolean, groupId?: number) =>
    mode === 'group'
      ? boardPrivateIdentV2(boardId, 'group', { groupId: groupId!, isAdmins })
      : boardPrivateIdentV2(boardId, 'direct'),
  // boardPrivate: (boardId: string) => `qdeck_priv__board__${boardId}`,
  // boardPrivate: (boardId: string) => `qd_pr__bd__${boardId}_${grpNum}_${isAdminsOrDirect}`,
  cardPublic:   (boardId: string, cardId: string) => `qdeck_pub__card__${boardId}__${cardId}`,
  cardPrivate:  (boardId: string, cardId: string) => `qdeck_priv__card__${boardId}__${cardId}`,
  commentsPublic: (boardId: string, cardId: string) =>
    QDeckCommentsId.publicV2(boardId, cardId),

  commentsPrivate:(boardId: string,
    cardId: string,
    mode: 'group'|'direct',
    isAdmins?: boolean,
    groupId?: number
  ) => QDeckCommentsId.privateV2(boardId, cardId, mode, groupId, isAdmins ),

  // Owner-managed local index (per issuer)
  ownerBoardsIndex: () => `qdeck__boards_index`,

  // Board-based index for all cards
  cardsIndex: (boardId: string) => `qdeck__cards_index__${boardId}`,

  // Card-based 'primary images'
  cardPrimaryImagePublic: (boardId: string, cardId: string) => `qdeck__pubcimg__${boardId}__${cardId}`,
  cardPrimaryImagePrivate: (boardId: string, cardId: string) => `qdeck__privcimg__${boardId}__${cardId}`,

  // Card-based file attachments
  cardFilePublic: (boardId: string, cardId: string) => `qdeck__pubfile__${boardId}__${cardId}`,
  cardFilePrivate: (boardId: string, cardId: string) => `qdeck__privfile__${boardId}__${cardId}`,

  // PAYMENT tracking
  boardPaymentsDoc: (boardId: string, ) => `qdeck__payments__${boardId}`,

  // PREFIXES

  prefixPublicCards: (boardId: string) => `qdeck_pub__card__${boardId}__`,
  prefixPrivateCards: (boardId: string) => `qdeck_priv__card__${boardId}__`,

  // Prefixes for scans
  prefixPublicBoards:  `qdeck_pub__board__`,
  // prefixPrivateBoards: `qdeck_priv__board__`,
  prefixPrivateBoards:    "qdeck_priv__bdv2__",   // v2
};



export const QDeckCommentsId = {
  // Public comments (V2)
  publicV2: (boardId: string, cardId: string) =>
    `qdeck_pub__cmv2__${boardId}__${cardId}`,

  // Private comments (V2) — mirror boardPrivateIdentV2’s modes
  privateV2: (
    boardId: string,
    cardId: string,
    mode: 'group' | 'direct',
    groupId?: number,
    isAdmins?: boolean,
  ) => {
    if (mode === 'direct') return `qdeck_priv__cmv2__${boardId}__${cardId}__m-d`;
    const gid = groupId;
    if (gid == null) throw new Error('group mode requires groupId');
    const a = isAdmins ? '1' : '0';
    return `qdeck_priv__cmv2__${boardId}__${cardId}__m-g__gid-${gid}__a-${a}`;
  },

  // Parse private comments ident (V2)
  parsePrivateV2(ident: string): {
    boardId: string;
    cardId: string;
    mode: 'group' | 'direct';
    groupId?: number;
    isAdmins?: boolean;
  } | null {
    // group
    {
      const m = ident.match(/^qdeck_priv__cmv2__([^_]+)__([^_]+)__m-g__gid-(\d+)__a-(0|1)$/);
      if (m) {
        const [, boardId, cardId, gid, a] = m;
        return { boardId, cardId, mode: 'group', groupId: Number(gid), isAdmins: a === '1' };
      }
    }
    // direct
    {
      const m = ident.match(/^qdeck_priv__cmv2__([^_]+)__([^_]+)__m-d$/);
      if (m) return { boardId: m[1], cardId: m[2], mode: 'direct' };
    }
    return null;
  },

  // Search token (exact identifier string)
  searchToken: (ident: string) => ident,

};


