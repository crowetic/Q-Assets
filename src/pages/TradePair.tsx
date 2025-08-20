import { useEffect, useMemo, useState, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  Divider,
  TextField,
  Button,
  ToggleButtonGroup,
  ToggleButton,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import { useParams } from 'react-router-dom';
import {
  ensureAssetsIndexLoaded,
  ensureAssetMini,
  readAssetsIndexSync,
} from '../bootstrap/assetsBootstrap';
import { colorFromAssetId, formatPrice, formatQty } from '../utils/marketUI';
import { useAuth } from 'qapp-core';
import {
  fetchAsks,
  fetchBids,
  createOrderAndBroadcast,
  cancelOrderAndBroadcast,
  getAddressOrdersByPair,
  fetchQortToAssetTrades,
  type BookOrder,
  NormalizedOrder,
} from '../utils/markets';
import { VolumeBars, DepthChart } from '../components/trade/PairCharts';
import { buildOhlc, buildDepth, buildOhlcStrict } from '../utils/chartTransforms';
// import SuccessButton from '../components/buttons/SuccessButton'; // +++
import SellButton from '../components/buttons/SellButton';
import BuyButton from '../components/buttons/BuyButton';
import { getAssetBalances } from '../utils/qortalAssetRequests';
import PairMyFills from '../components/trade/PairMyFills';
import { getTrades, envelopesToFills } from '../utils/markets';
import type { FillEvent } from '../utils/markets';
import CandleChart from '../components/trade/CandleCharts';

// ---- Types for adapter data (adjust when wiring real endpoints)
// type Order = { price: number; quantity: number }; // in human QORT/asset units
type Trade = { price: number; quantity: number; side: 'buy' | 'sell'; ts: number };
// type SparkPoint = { x: number; y: number };

export default function TradePair() {
  const { assetId } = useParams<{ assetId: string }>();
  const id = Number(assetId);
  const [name, setName] = useState<string>('');
  const [divisible, setDivisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [myOrders, setMyOrders] = useState<NormalizedOrder[]>([]);
  const [myFills, setMyFills] = useState<FillEvent[]>([]);

  // Order book + trades
  const [bids, setBids] = useState<BookOrder[]>([]);
  const [asks, setAsks] = useState<BookOrder[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [chartTrades, setChartTrades] = useState<Trade[]>([]);
  const [sweptTotalQort, setSweptTotalQort] = useState<number | null>(null);
  const [sweptAvgPrice, setSweptAvgPrice] = useState<number | null>(null);
  const [issuerAddr, setIssuerAddr] = useState<string | null>(null);
  const [balAsset, setBalAsset] = useState<number | null>(null);
  const [balQort, setBalQort] = useState<number | null>(null);
  // ---- controls for chart window & bucket
  const [rangeHours, setRangeHours] = useState<number>(24); // 1h, 24h, 7d etc.
  const [bucketMinutes, setBucketMinutes] = useState<number>(5); // 1, 5, 15, 60 etc.
  const [allTrades, setAllTrades] = useState<Trade[]>([]);
  const [tradesPage, setTradesPage] = useState(0);
  const TRADES_PAGE_SIZE = 50;

  const { address: authAddress, publicKey: authPublicKey } = useAuth() as any;
  const c = colorFromAssetId(id);
  const ohlc = useMemo(
    () =>
      buildOhlc(chartTrades, {
        intervalMs: bucketMinutes * 60 * 1000,
        lookbackMs: rangeHours * 60 * 60 * 1000,
        // optional: anchor “now” to the last trade so empty future buckets don’t dominate
        now: chartTrades.length ? chartTrades[chartTrades.length - 1].ts : Date.now(),
      }),
    [chartTrades, bucketMinutes, rangeHours]
  );

  const depth = useMemo(() => buildDepth(bids, asks, { maxLevels: 60 }), [bids, asks]);

  const pagedTrades = useMemo(() => {
    const start = tradesPage * TRADES_PAGE_SIZE;
    const end = start + TRADES_PAGE_SIZE;
    return allTrades.slice(start, end);
  }, [allTrades, tradesPage]);

  useEffect(() => {
    setTrades(pagedTrades);
  }, [pagedTrades]);

  function fmt(n: number | null | undefined, dp = 8) {
    if (n == null || !Number.isFinite(n)) return '—';
    const f = Math.pow(10, dp);
    return (Math.trunc(n * f) / f).toString();
  }

  async function refreshBalances() {
    if (!authAddress) {
      setBalAsset(null);
      setBalQort(null);
      return;
    }
    try {
      const bals = await getAssetBalances({ addresses: [authAddress] });
      const qort = (bals ?? []).find((b: any) => b.assetId === 0);
      const asset = (bals ?? []).find((b: any) => b.assetId === id);
      // assume balances are in human units; if base units, convert with fromBaseUnits()
      setBalQort(qort ? Number(qort.balance) : 0);
      setBalAsset(asset ? Number(asset.balance) : 0);
    } catch {
      setBalQort(null);
      setBalAsset(null);
    }
  }

  // floors toward zero at 'dp' decimals (avoid binary fp surprises)
  function quant(n: number, dp: number) {
    if (!Number.isFinite(n)) return 0;
    const f = Math.pow(10, dp);
    return Math.trunc(n * f) / f;
  }

  const QORT_DP = 8;
  function quantPrice(p: number) {
    // price is QORT/ASSET — keep it at QORT precision
    return quant(p, QORT_DP);
  }
  function quantQtyAsset(q: number, divisible: boolean) {
    return divisible ? quant(q, 8) : Math.floor(q);
  }
  function quantQort(n: number) {
    return quant(n, QORT_DP);
  }

  function normAddr(a?: string | null) {
    return (a || '').trim();
  }
  function isIssuerAddress(a?: string | null) {
    if (!a || !issuerAddr) return false;
    return normAddr(a) === normAddr(issuerAddr);
  }

  const IssuerTag = () => (
    <Box
      component="span"
      sx={{
        fontSize: 10,
        fontWeight: 700,
        px: 0.75,
        py: 0.1,
        lineHeight: 1.6,
        borderRadius: 1,
        bgcolor: 'warning.main',
        color: 'warning.contrastText',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        ml: 0.5,
        whiteSpace: 'nowrap',
      }}
    >
      Issuer
    </Box>
  );

  const getOrderCreator = (o: BookOrder | NormalizedOrder) =>
    (o as any).creatorAddress ?? (o as any).creator ?? (o as any).address ?? null;

  // Sum cheapest asks up to <= target price (for BUY), returning {qty, cost}
  function sweepAsksTo(priceLevel: number) {
    let qty = 0; // asset units
    let cost = 0; // QORT
    for (const a of asks) {
      if (a.priceQortPerAsset <= priceLevel && a.qtyAsset > 0) {
        qty += a.qtyAsset;
        cost += a.qtyAsset * a.priceQortPerAsset;
      } else {
        break; // asks are sorted cheapest-first in your fetch
      }
    }
    return { qty, cost };
  }

  // Sum highest bids down to >= target price (for SELL), returning {qty, proceeds}
  function sweepBidsTo(priceLevel: number) {
    let qty = 0; // asset units (max you can sell into the book)
    let proceeds = 0; // QORT
    for (const b of bids) {
      if (b.priceQortPerAsset >= priceLevel && b.qtyAsset > 0) {
        qty += b.qtyAsset;
        proceeds += b.qtyAsset * b.priceQortPerAsset;
      } else {
        break; // bids are sorted best-first in your fetch (desc)
      }
    }
    return { qty, proceeds };
  }

  function orderAssetQty(o: NormalizedOrder): number {
    const haveAmnt = Number(o.haveAmount) || 0;
    const price = Number(o.price) || 0;
    // In this screen, pair is ASSET/QORT; so:
    // - SELL = haveAssetId === id  -> qtyAsset = haveAmount
    // - BUY  = haveAssetId === 0   -> qtyAsset = haveAmount / price
    if (o.haveAssetId === id) return haveAmnt / price;
    else return haveAmnt;
    // Fallback (weird edge): try wantAmount if want is the asset
    // const want = Number(o.wantAmount) || 0;
    // if (o.wantAssetId === id) return want;
    // return 0;
  }

  function orderSideLabel(o: NormalizedOrder): 'buy' | 'sell' {
    return o.haveAssetId === 0 ? 'buy' : 'sell';
  }

  useEffect(() => {
    let cancel = false;
    let timer: number | null = null;

    (async () => {
      await refreshBalances();
      if (!cancel) {
        timer = window.setInterval(() => {
          void refreshBalances();
        }, 15000);
      }
    })();

    return () => {
      cancel = true;
      if (timer) window.clearInterval(timer);
    };
  }, [authAddress, id]);

  // ---- Load pair meta and initial book/trades
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const refresh = async () => {
      try {
        setLoading(true);

        let mini = readAssetsIndexSync()?.[id] ?? null;
        if (!mini) {
          const idx = await ensureAssetsIndexLoaded();
          mini = idx[id] ?? null;
        }
        if (!mini) mini = await ensureAssetMini(id);

        if (!cancelled) {
          if (mini) {
            setName(mini.name);
            setDivisible(mini.isDivisible);
            setIssuerAddr(mini.owner || null);
          } else {
            setName(`Asset #${id}`);
            setDivisible(true);
            setIssuerAddr(null);
          }
        }

        const now = Date.now();
        const windowStart = now - rangeHours * 60 * 60 * 1000;

        const [realBidsRaw, realAsksRaw] = await Promise.all([
          fetchBids(id, { limit: 50 /*, reverse: true*/ }),
          fetchAsks(id, { limit: 50 }), // expected cheapest-first
        ]);

        // Ensure correct sort locally (defensive)
        const realBids = [...realBidsRaw].sort((a, b) => b.priceQortPerAsset - a.priceQortPerAsset); // high->low
        const realAsks = [...realAsksRaw].sort((a, b) => a.priceQortPerAsset - b.priceQortPerAsset); // low->high

        const bestBid = realBids[0]?.priceQortPerAsset ?? 0;
        const bestAsk = realAsks[0]?.priceQortPerAsset ?? 0;

        const envAll = await fetchQortToAssetTrades(id, windowStart, 500, 20000);

        type Side = 'buy' | 'sell';
        const decideSide = (price: number): Side => {
          if (bestBid === 0 && bestAsk === 0) return 'buy';
          if (bestBid === 0) return 'sell';
          if (bestAsk === 0) return 'buy';
          return Math.abs(price - bestAsk) < Math.abs(price - bestBid) ? 'sell' : 'buy';
        };

        function classifySideFromEnvelope(env: any, pairAssetId: number): 'buy' | 'sell' {
          const io = env?.initiatingOrder;
          if (io && typeof io.haveAssetId === 'number') {
            return io.haveAssetId === 0 ? 'buy' : 'sell';
          }

          // Fallbacks for older/partial nodes (best-effort):
          // - If env has "haveAssetId"/"wantAssetId" at top level
          if (typeof env?.haveAssetId === 'number') {
            return env.haveAssetId === 0 ? 'buy' : 'sell';
          }

          // - Last-resort heuristic (kept just in case), but you can delete if you prefer to show 'unknown'
          return 'buy';
        }

        const rows: Trade[] = (envAll ?? [])
          .map((env: any) => {
            const io = env.initiatingOrder;
            const t = env.trade;

            const qtyAsset = Number(t?.targetAmount ?? io?.amount ?? 0); // asset-side fills
            const price =
              io?.price != null
                ? Number(io.price)
                : Number(t?.initiatorAmount ?? 0) / Math.max(1e-12, qtyAsset);
            const ts = Number(t?.timestamp ?? io?.timestamp ?? 0); // ms in your sample
            const side = classifySideFromEnvelope(env, id); // <-- authoritative

            return Number.isFinite(price) && qtyAsset > 0 && ts > 0
              ? ({ price, quantity: qtyAsset, side, ts } as Trade)
              : null;
          })
          .filter(Boolean) as Trade[];

        // sort newest-first for the list
        const fullNewestFirst = rows.sort((a, b) => b.ts - a.ts);

        const MIN_POINTS_SHOW_ALL = 200;
        const chartSource =
          fullNewestFirst.length <= MIN_POINTS_SHOW_ALL
            ? [...fullNewestFirst]
            : fullNewestFirst.filter((t) => t.ts >= windowStart);

        const chartPts: Trade[] = [...chartSource].sort((a, b) => a.ts - b.ts);
        const newest = fullNewestFirst[0];
        const oldest = fullNewestFirst.length
          ? fullNewestFirst[fullNewestFirst.length - 1]
          : undefined;

        if (!cancelled) {
          setBids(realBids);
          setAsks(realAsks);
          setAllTrades(fullNewestFirst);
          setTradesPage(0);
          setTrades(fullNewestFirst.slice(0, TRADES_PAGE_SIZE));
          setChartTrades(chartPts);
        }

        console.log(
          '[fetched]',
          envAll.length,
          'range:',
          oldest ? new Date(oldest.ts).toISOString() : 'n/a',
          '→',
          newest ? new Date(newest.ts).toISOString() : 'n/a',
          'windowStart:',
          new Date(windowStart).toISOString()
        );
        console.log('[chart points]', chartSource.length);

        // ---- my orders
        const isOpenOrder = (o: any) => {
          const openByFlags = !(o?.isClosed || o?.isFulfilled);
          const okStatus = o?.status ? String(o.status).toUpperCase() !== 'CANCELLED' : true;
          return openByFlags && okStatus;
        };

        if (!cancelled) {
          if (authAddress) {
            try {
              // NOTE: pair is always (0, id) for this endpoint
              const mine = await getAddressOrdersByPair(authAddress, 0, id, {
                isClosed: false,
                isFulfilled: false,
                limit: 200,
              });
              setMyOrders((mine ?? []).filter(isOpenOrder));
            } catch {
              setMyOrders([]);
            }
          } else {
            setMyOrders([]);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // initial run
    void refresh();

    // timer (if you still want it)
    timer = window.setInterval(() => {
      void refresh();
    }, 120000);

    // cleanup lives in the effect, not inside refresh()
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [id, authAddress, rangeHours]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function refreshFills() {
      if (!authAddress) {
        setMyFills([]);
        return;
      }
      try {
        // Pull both directions; some nodes only return one orientation
        const [envA, envB] = await Promise.all([
          getTrades(0, id, { limit: 80, reverse: true }),
          getTrades(id, 0, { limit: 80, reverse: true }),
        ]);

        const fills = envelopesToFills(
          ([] as any[]).concat(Array.isArray(envA) ? envA : [], Array.isArray(envB) ? envB : []),
          authAddress,
          authPublicKey,
          id
        );

        if (!cancelled) setMyFills(fills);
      } catch (e) {
        console.debug('[fills] error', e);
        if (!cancelled) setMyFills([]);
      }
    }

    void refreshFills();
    timer = window.setInterval(() => void refreshFills(), 20000);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [authAddress, authPublicKey, id]);

  // ----- Place order state
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState<string>('');
  const [qty, setQty] = useState<string>('');
  const total = useMemo(() => {
    if (sweptTotalQort != null) return sweptTotalQort; // blended across book
    const p = Number(price);
    const q = Number(qty);
    return Number.isFinite(p) && Number.isFinite(q) ? p * q : 0;
  }, [price, qty, sweptTotalQort]);

  const placeOrder = async () => {
    if (!authAddress) return alert('Sign in first.');

    let p = quantPrice(Number(price));
    let q = quantQtyAsset(Number(qty), divisible);

    if (!(p > 0)) return alert('Invalid price.');
    if (!(q > 0)) return alert('Invalid quantity.');

    // Enforce whole units for non-divisible
    if (!divisible && !Number.isInteger(q)) {
      q = Math.floor(q);
      if (!(q > 0)) return alert('This asset must be traded in whole units.');
    }

    // BALANCE SAFETY (especially for click-sweep BUYs)
    try {
      if (side === 'buy') {
        // how much QORT is needed
        let needQort = quantQort(p * q);

        // get my QORT balance (you already have getAssetBalances)
        const bals = await getAssetBalances({ addresses: [authAddress] });
        const qortBal = (bals ?? []).find((b: any) => b.assetId === 0);
        const haveQort = qortBal ? Number(qortBal.balance) : 0; // assumes human units already; if base units, convert

        if (haveQort < needQort) {
          if (haveQort <= 0) throw new Error('Insufficient QORT');

          // shrink quantity to max affordable
          const maxQ = quantQtyAsset(haveQort / p, divisible);
          if (!(maxQ > 0)) throw new Error('Insufficient QORT');
          q = maxQ;
          needQort = quantQort(p * q);
          // reflect UI
          setQty(String(q));
          setSweptTotalQort(needQort);
          setSweptAvgPrice(q > 0 ? quantPrice(needQort / q) : null);
        }
      } else {
        // SELL: ensure I have enough of the asset (optional; your backend will enforce anyway)
        // (You already have assertSufficientBalance() — feel free to call it here instead.)
      }
    } catch (e: any) {
      return alert(String(e?.message || e));
    }

    try {
      // Final quantization before send
      p = quantPrice(p);
      q = quantQtyAsset(q, divisible);

      await createOrderAndBroadcast({
        side,
        assetId: id,
        priceQortPerAsset: p,
        qtyAsset: q,
        address: authAddress,
        publicKey: authPublicKey,
      });

      setQty('');
      setPrice('');
      setSweptTotalQort(null);
      setSweptAvgPrice(null);
      const [realBids, realAsks] = await Promise.all([
        fetchBids(id, { limit: 50, reverse: true }),
        fetchAsks(id, { limit: 50 }),
      ]);
      setBids(realBids);
      setAsks(realAsks);
      alert('Order placed.');
    } catch (e: any) {
      console.error(e);
      alert(`Order failed: ${String(e?.message || e)}`);
    }
  };

  const onCancelOrder = async (orderId: string) => {
    if (!authAddress) return;
    try {
      await cancelOrderAndBroadcast({ orderId, address: authAddress, publicKey: authPublicKey });
      const [realBids, realAsks] = await Promise.all([
        fetchBids(id, { limit: 50, reverse: true }),
        fetchAsks(id, { limit: 50 }),
      ]);
      setBids(realBids);
      setAsks(realAsks);
    } catch (e: any) {
      alert(`Cancel failed: ${String(e?.message || e)}`);
    }
  };

  // ---- simple chart stub (replace with real data/mini OHLC when you wire it)
  const mid = useMemo(() => {
    const bestBid = bids[0]?.priceQortPerAsset ?? 0;
    const bestAsk = asks[0]?.priceQortPerAsset ?? 0;
    return bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || 0;
  }, [bids, asks]);

  const qtyNum = Number(qty) || 0;
  const priceNum = Number(price) || 0;

  const needQort = useMemo(() => {
    if (side !== 'buy') return 0;
    // when sweeping we already set sweptTotalQort; otherwise price*qty
    const t =
      sweptTotalQort != null ? sweptTotalQort : priceNum > 0 && qtyNum > 0 ? priceNum * qtyNum : 0;
    // quantize to QORT 8dp
    const f = 1e8;
    return Math.trunc(t * f) / f;
  }, [side, sweptTotalQort, priceNum, qtyNum]);

  const needAsset = useMemo(() => {
    if (side !== 'sell') return 0;
    // qty is in asset units already
    if (!(qtyNum > 0)) return 0;
    if (divisible) {
      const f = 1e8;
      return Math.trunc(qtyNum * f) / f;
    }
    return Math.floor(qtyNum);
  }, [side, qtyNum, divisible]);

  const insufficient = useMemo(() => {
    if (!authAddress) return false;
    if (side === 'buy') return balQort != null && needQort > (balQort ?? 0);
    return balAsset != null && needAsset > (balAsset ?? 0);
  }, [side, needQort, needAsset, balQort, balAsset, authAddress]);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, display: 'grid', gap: 2 }}>
      <Box
        display="flex"
        alignItems="baseline"
        justifyContent="space-between"
        flexWrap="wrap"
        gap={1}
      >
        <Typography variant="h5">{name ? `${name}/QORT` : `Asset #${id}/QORT`}</Typography>
        <Typography variant="body2" color="text.secondary">
          Mid: {formatPrice(mid)} QORT
        </Typography>
      </Box>
      {/* Chart stub */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <ToggleButtonGroup
          size="small"
          value={rangeHours}
          exclusive
          onChange={(_, v) => v && setRangeHours(v)}
        >
          <ToggleButton value={1}>1h</ToggleButton>
          <ToggleButton value={24}>24h</ToggleButton>
          <ToggleButton value={24 * 7}>7d</ToggleButton>
          <ToggleButton value={24 * 30}>30d</ToggleButton>
        </ToggleButtonGroup>
        <ToggleButtonGroup
          size="small"
          value={bucketMinutes}
          exclusive
          onChange={(_, v) => v && setBucketMinutes(v)}
        >
          <ToggleButton value={1}>1m</ToggleButton>
          <ToggleButton value={5}>5m</ToggleButton>
          <ToggleButton value={15}>15m</ToggleButton>
          <ToggleButton value={60}>1h</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Paper sx={{ p: 2, display: 'grid', gap: 2 }}>
        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Typography variant="subtitle2" color="text.secondary">
              Price (candles)
            </Typography>
            {ohlc.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                No price data
              </Typography>
            ) : (
              <CandleChart data={ohlc} height={300} />
            )}
            <Typography variant="subtitle2" color="text.secondary">
              Volume
            </Typography>
            <VolumeBars data={ohlc} />
            <Typography variant="subtitle2" color="text.secondary">
              Depth
            </Typography>
            <DepthChart bids={depth.bids} asks={depth.asks} />
          </>
        )}
      </Paper>
      <Typography variant="caption" color="text.secondary">
        Tip: Click a price to auto-fill. Hold Ctrl/⌘ to set price only.
      </Typography>
      {/* Book + Trade + Place order */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1.2fr 1fr' },
          gap: 2,
        }}
      >
        {/* Left: Order book + Recent trades */}
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Order Book
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Bids (QORT)
                </Typography>
                <Box sx={{ mt: 0.5, display: 'grid', gap: 0.25 }}>
                  {bids.map((b, i) => {
                    const creator = getOrderCreator(b);
                    const byIssuer = isIssuerAddress(creator);
                    return (
                      <Box
                        key={i}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          bgcolor: 'success.main',
                          color: 'success.contrastText',
                          px: 1,
                          py: 0.25,
                          borderRadius: 0.5,
                          opacity: 0.9,
                          cursor: 'pointer',
                          userSelect: 'none',
                          '&:hover': { opacity: 1 },
                        }}
                        title="Click to sell at this bid"
                        onClick={(e) => {
                          setSide('sell');
                          const p = quantPrice(b.priceQortPerAsset);
                          if (e.ctrlKey || e.metaKey) {
                            setPrice(String(p));
                            setSweptTotalQort(null);
                            setSweptAvgPrice(null);
                            return;
                          }
                          const { qty, proceeds } = sweepBidsTo(p);
                          const qClamped = quantQtyAsset(qty, divisible);
                          const proceedsClamped = quantQort(p * qClamped);
                          setPrice(String(p));
                          setQty(String(qClamped));
                          setSweptTotalQort(proceedsClamped);
                          setSweptAvgPrice(
                            qClamped > 0 ? quantPrice(proceedsClamped / qClamped) : null
                          );
                        }}
                      >
                        <span>{formatPrice(b.priceQortPerAsset)}</span>
                        {byIssuer && <IssuerTag />}
                        <span>{formatQty(b.qtyAsset, divisible)}</span>
                      </Box>
                    );
                  })}

                  {bids.length === 0 && (
                    <Typography variant="caption" color="text.secondary">
                      No bids
                    </Typography>
                  )}
                </Box>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Asks (QORT)
                </Typography>
                <Box sx={{ mt: 0.5, display: 'grid', gap: 0.25 }}>
                  {asks.map((a, i) => {
                    const creator = getOrderCreator(a);
                    const byIssuer = isIssuerAddress(creator);
                    return (
                      <Box
                        key={i}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          bgcolor: 'error.main',
                          color: 'error.contrastText',
                          px: 1,
                          py: 0.25,
                          borderRadius: 0.5,
                          opacity: 0.9,
                          cursor: 'pointer',
                          userSelect: 'none',
                          '&:hover': { opacity: 1 },
                        }}
                        title="Click to buy at this ask"
                        onClick={(e) => {
                          setSide('buy');
                          const p = quantPrice(a.priceQortPerAsset);
                          if (e.ctrlKey || e.metaKey) {
                            setPrice(String(p));
                            setSweptTotalQort(null);
                            setSweptAvgPrice(null);
                            return;
                          }
                          const { qty, cost } = sweepAsksTo(p);
                          const qClamped = quantQtyAsset(qty, divisible);
                          const costClamped = quantQort(p * qClamped);
                          setPrice(String(p));
                          setQty(String(qClamped));
                          setSweptTotalQort(costClamped);
                          setSweptAvgPrice(
                            qClamped > 0 ? quantPrice(costClamped / qClamped) : null
                          );
                        }}
                      >
                        <span>{formatPrice(a.priceQortPerAsset)}</span>
                        {byIssuer && <IssuerTag />}
                        <span>{formatQty(a.qtyAsset, divisible)}</span>
                      </Box>
                    );
                  })}

                  {asks.length === 0 && (
                    <Typography variant="caption" color="text.secondary">
                      No asks
                    </Typography>
                  )}
                </Box>
              </Box>
            </Box>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                mb: 1,
              }}
            >
              <Typography variant="subtitle1">Recent Trades</Typography>
              <Typography variant="caption" color="text.secondary">
                {allTrades.length.toLocaleString()} total
              </Typography>
            </Box>

            <Box sx={{ display: 'grid', gap: 0.25 }}>
              {pagedTrades.map((t, i) => (
                <Box
                  key={`${t.ts}-${t.price}-${t.quantity}-${i}`}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto auto',
                    gap: 1,
                    fontSize: 14,
                    alignItems: 'center',
                  }}
                >
                  <Box
                    sx={{
                      color: t.side === 'buy' ? 'success.main' : 'error.main',
                      fontWeight: 700,
                    }}
                  >
                    {t.side.toUpperCase()}
                  </Box>
                  <Box>
                    {formatQty(t.quantity, divisible)} {name}
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>{formatPrice(t.price)} QORT</Box>
                  <Box sx={{ textAlign: 'right', color: 'text.secondary' }}>
                    {new Date(t.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Box>
                </Box>
              ))}

              {allTrades.length === 0 && (
                <Typography variant="caption" color="text.secondary">
                  No trades
                </Typography>
              )}
            </Box>

            {/* Pager */}
            {allTrades.length > TRADES_PAGE_SIZE && (
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mt: 1,
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  Page {tradesPage + 1} of {Math.ceil(allTrades.length / TRADES_PAGE_SIZE)}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={tradesPage === 0}
                    onClick={() => setTradesPage((p) => Math.max(0, p - 1))}
                  >
                    Prev
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={(tradesPage + 1) * TRADES_PAGE_SIZE >= allTrades.length}
                    onClick={() => setTradesPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </Box>
              </Box>
            )}
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              My Fills (This Pair)
            </Typography>
            {!authAddress ? (
              <Typography variant="caption" color="text.secondary">
                Sign in to view fills.
              </Typography>
            ) : (
              <PairMyFills fills={myFills} assetName={name} divisible={divisible} />
            )}
          </Paper>
        </Box>

        {/* Right: Place order */}
        <Paper sx={{ p: 2, borderLeft: `4px solid ${c.border}`, bgcolor: c.tint }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Place Order
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={side}
            onChange={(_, v) => v && setSide(v)}
            sx={{ mb: 2 }}
          >
            <ToggleButton value="buy">Buy {name || `#${id}`}</ToggleButton>
            <ToggleButton value="sell">Sell {name || `#${id}`}</ToggleButton>
          </ToggleButtonGroup>

          <Box sx={{ display: 'grid', gap: 1.25 }}>
            <TextField
              size="small"
              label="Price (QORT)"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                setSweptTotalQort(null);
                setSweptAvgPrice(null);
              }}
              inputMode="decimal"
            />
            <TextField
              size="small"
              label={`Quantity (${name || `#${id}`})`}
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
                setSweptTotalQort(null);
                setSweptAvgPrice(null);
              }}
              inputMode="decimal"
              helperText={!divisible ? 'Whole units only' : ' '}
            />
            <Divider />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              {side === 'buy' ? (
                <>
                  <Typography variant="caption" color="text.secondary">
                    Balance (QORT): <b>{fmt(balQort, 8)}</b>
                  </Typography>
                  <Typography
                    variant="caption"
                    color={insufficient ? 'error.main' : 'text.secondary'}
                  >
                    Need: {fmt(needQort, 8)} QORT {insufficient && ' — insufficient'}
                  </Typography>
                </>
              ) : (
                <>
                  <Typography variant="caption" color="text.secondary">
                    Balance ({name || `#${id}`}): <b>{fmt(balAsset, divisible ? 8 : 0)}</b>
                  </Typography>
                  <Typography
                    variant="caption"
                    color={insufficient ? 'error.main' : 'text.secondary'}
                  >
                    Need: {fmt(needAsset, divisible ? 8 : 0)} {name || `#${id}`}{' '}
                    {insufficient && ' — insufficient'}
                  </Typography>
                </>
              )}
            </Box>

            <Typography variant="body2" sx={{ textAlign: 'right' }}>
              Total: <b>{formatPrice(total)} QORT</b>
            </Typography>
            {sweptAvgPrice != null && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: 'right', display: 'block' }}
              >
                Est. avg: {formatPrice(sweptAvgPrice)} QORT/{name || `#${id}`}
              </Typography>
            )}
            <Tooltip title={authAddress ? '' : 'Sign in to place orders'} arrow>
              <span>
                <>
                  {side === 'buy' ? (
                    <BuyButton onClick={placeOrder} disabled={!authAddress}>
                      Place BUY
                    </BuyButton>
                  ) : (
                    <SellButton onClick={placeOrder} disabled={!authAddress}>
                      Place SELL
                    </SellButton>
                  )}
                </>
              </span>
            </Tooltip>
          </Box>
        </Paper>
      </Box>
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          My Orders ({myOrders.length})
        </Typography>

        {!authAddress ? (
          <Typography variant="caption" color="text.secondary">
            Sign in to view your orders.
          </Typography>
        ) : myOrders.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            No open orders for this pair.
          </Typography>
        ) : (
          <Box sx={{ display: 'grid', gap: 0.5 }}>
            {myOrders.map((o) => {
              const side = orderSideLabel(o);
              const qtyA = orderAssetQty(o);
              const price = Number(o.price) || 0;
              const creator = getOrderCreator(o) ?? authAddress;
              const byIssuer = isIssuerAddress(creator);
              const ts =
                Number(o.timestamp) < 2e10 ? Number(o.timestamp) * 1000 : Number(o.timestamp);
              const when = new Date(ts).toLocaleString();

              return (
                <Box
                  key={o.orderId}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto auto',
                    gap: 1,
                    alignItems: 'center',
                    fontSize: 14,
                    px: 1,
                    py: 0.5,
                    borderRadius: 0.5,
                    bgcolor: side === 'buy' ? 'success.main' : 'error.main',
                    color: side === 'buy' ? 'success.contrastText' : 'error.contrastText',
                  }}
                >
                  <Box sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {side.toUpperCase()}
                    {byIssuer && <IssuerTag />}
                  </Box>
                  <Box title={when}>
                    {formatQty(qtyA, divisible)} {name}
                  </Box>
                  <Box>{formatPrice(price)} QORT</Box>
                  <Tooltip title="Cancel order">
                    <span>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => onCancelOrder(o.orderId)}
                        sx={{ borderColor: 'currentColor', color: 'inherit' }}
                      >
                        Cancel
                      </Button>
                    </span>
                  </Tooltip>
                </Box>
              );
            })}
          </Box>
        )}
      </Paper>
    </Box>
  );
}
