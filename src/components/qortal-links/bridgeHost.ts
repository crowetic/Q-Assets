// bridgeHost.ts
type BridgeReq = {
  __qortalBridge: true;
  id: string;
  body: any; // the qortalRequest payload
};

type BridgeRes = {
  __qortalBridgeRes: true;
  id: string;
  ok: boolean;
  value?: any;
  error?: string;
};


function isBridgeReq(x: any): x is BridgeReq {
  return !!x && x.__qortalBridge === true && typeof x.id === 'string';
}

const ALLOW_ORIGINS = new Set<string>([
  window.location.origin,            
  'http://127.0.0.1:12393', 
  'http://127.0.0.1:12391',         
  'https://appnode.qortal.org', 
  'https://ext-node.qortal.link',
  // add others you trust
]);

function originAllowed(origin: string) {
  return ALLOW_ORIGINS.has(origin);
}

export function installQortalBridgeHost() {
  const handler = async (ev: MessageEvent) => {
    const data = ev.data;
    if (!isBridgeReq(data)) return;
    if (!originAllowed(ev.origin)) return;

    // Get the reply port the client sent us
    const port: MessagePort | undefined = ev.ports?.[0];
    if (!port) {
      console.warn('[bridgeHost] no reply port provided; cannot respond');
      return;
    }

    // Do the real call in the host context
    try {
      // @ts-ignore
      const value = await window.qortalRequest(data.body);
      const res: BridgeRes = { __qortalBridgeRes: true, id: data.id, ok: true, value };
      port.postMessage(res);
      port.close();
    } catch (err: any) {
      const res: BridgeRes = {
        __qortalBridgeRes: true, id: data.id, ok: false,
        error: String(err?.message ?? err),
      };
      try { port.postMessage(res); } finally { port.close(); }
    }
  };

  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}


// bridgeClient.ts
function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function installQortalBridgeClient() {
  if (typeof window === 'undefined') return;
  // If Hub injected it, do nothing
  // @ts-ignore
  if (typeof window.qortalRequest === 'function') return;
  if (window === window.top) return; // not iframed

  // @ts-ignore
  window.qortalRequest = function qortalRequest(body: any) {
    const id = uuid();
    const channel = new MessageChannel();

    const p = new Promise((resolve, reject) => {
      // Handle single reply on port1
      channel.port1.onmessage = (ev: MessageEvent<BridgeRes>) => {
        const data = ev.data;
        if (!data || data.__qortalBridgeRes !== true || data.id !== id) return;
        channel.port1.onmessage = null;
        channel.port1.close();
        if (data.ok) resolve(data.value);
        else reject(new Error(data.error || 'qortal bridge error'));
      };
    });

    // Send request to parent, attaching port2
    const msg = { __qortalBridge: true, id, body };
    // Use options form to keep TS happy
    window.parent.postMessage(msg, { targetOrigin: '*', transfer: [channel.port2] });

    // Optional timeout
    const TIMEOUT = 15000;
    return Promise.race([
      p,
      new Promise((_, rej) =>
        setTimeout(() => {
          try { channel.port1.close(); } catch {}
          rej(new Error('qortal bridge timeout'));
        }, TIMEOUT)
      ),
    ]);
  };
}