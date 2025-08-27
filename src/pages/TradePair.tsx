import { useEffect, useMemo, useState, useCallback } from 'react';
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
  fetchQortToAssetTrades,
  type BookOrder,
  type UiMyOrder,
  getMyOrdersForAssetUi,
} from '../utils/markets';
import { VolumeBars, DepthChart } from '../components/trade/PairCharts';
import { buildDepth } from '../utils/chartTransforms';
// import SuccessButton from '../components/buttons/SuccessButton'; // +++
import SellButton from '../components/buttons/SellButton';
import BuyButton from '../components/buttons/BuyButton';
import { getAssetBalances } from '../utils/qortalAssetRequests';
import PairMyFills from '../components/trade/PairMyFills';
import { getTrades, envelopesToFills } from '../utils/markets';
import type { FillEvent } from '../utils/markets';
// import CandleChart from '../components/trade/CandleChart';
import { useMarketConfirmRefresh } from '../trade/useMarketConfirmRefresh';
import {
  tradesAsCandlesPerTrade,
  pickBucketMs,
  computeCandlesCompact,
  toMs,
  type Trade,
} from '../utils/chartData';
import SmartPriceChart from '../components/trade/SmartPriceChart';
import ActionsToolbar from '../components/asset/ActionsToolbar';

export default function TradePair() {
  const { assetId } = useParams<{ assetId: string }>();
  const id = Number(assetId);
  const [name, setName] = useState<string>('');
  const [divisible, setDivisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [myOrders, setMyOrders] = useState<UiMyOrder[]>([]);
  const [myFills, setMyFills] = useState<FillEvent[]>([]);

  // Order book + trades
  const [bids, setBids] = useState<BookOrder[]>([]);
  const [asks, setAsks] = useState<BookOrder[]>([]);
  // const [trades, setTrades] = useState<Trade[]>([]);
  const [chartTrades, setChartTrades] = useState<Trade[]>([]);
  const [sweptTotalQort, setSweptTotalQort] = useState<number | null>(null);
  const [sweptProceedsQort, setSweptProceedsQort] = useState<number | null>(null); // SELL proceeds
  const [sweptAvgPrice, setSweptAvgPrice] = useState<number | null>(null);
  const [issuerAddr, setIssuerAddr] = useState<string | null>(null);
  const [balAsset, setBalAsset] = useState<number | null>(null);
  const [balQort, setBalQort] = useState<number | null>(null);
  // ---- controls for chart window & bucket
  const [rangeHours, setRangeHours] = useState<number>(720); // set default range hours
  const [bucketMinutes, setBucketMinutes] = useState<number>(60); // 1, 5, 15, 60 etc.
  const [allTrades, setAllTrades] = useState<Trade[]>([]);
  const [tradesPage, setTradesPage] = useState(0);

  const TRADES_PAGE_SIZE = 50;

  const { address: authAddress, publicKey: authPublicKey } = useAuth() as any;
  const c = colorFromAssetId(id);

  const candles = useMemo(() => {
    const lookbackMs = rangeHours * 60 * 60 * 1000;
    const bucketMs = pickBucketMs(lookbackMs);
    const now = chartTrades.length ? toMs(chartTrades[chartTrades.length - 1].ts) : Date.now();
    let bars = computeCandlesCompact(chartTrades, { bucketMs, lookbackMs, now });
    // Fallbacks for sparse/flat markets
    if (bars.length < 10) {
      // 1) go to per-trade bars within window (gives you “dots” at each trade)
      bars = tradesAsCandlesPerTrade(chartTrades, lookbackMs, now);
    }
    if (bars.length < 10) {
      const extended = computeCandlesCompact(chartTrades, {
        bucketMs,
        lookbackMs: lookbackMs * 4,
        now,
      });
      if (extended.length > bars.length) bars = extended;
    }

    return bars;
  }, [chartTrades, rangeHours]);

  const candleDataTOHLCV = useMemo(
    () =>
      candles.map((c) => ({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume })),
    [candles]
  );

  // useEffect(() => {
  //   const lows = candles.map((c) => c.low);
  //   const highs = candles.map((c) => c.high);
  //   const min = Math.min(...lows);
  //   const max = Math.max(...highs);
  //   console.log('[candles]', { count: candles.length, min, max, same: min === max });
  // }, [candles]);

  const depth = useMemo(() => buildDepth(bids, asks, { maxLevels: 60 }), [bids, asks]);

  const pagedTrades = useMemo(() => {
    const start = tradesPage * TRADES_PAGE_SIZE;
    const end = start + TRADES_PAGE_SIZE;
    return allTrades.slice(start, end);
  }, [allTrades, tradesPage]);

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

  const DP = 8;
  const TEN_DP = 100000000n;

  function decimalToAtomics(s: string, dp = DP): bigint {
    const m = s.trim().match(/^(\d+)(?:\.(\d{0,18}))?$/); // allow up to 18 just in case
    if (!m) throw new Error('bad decimal');
    const intp = m[1] || '0';
    const frac = (m[2] || '').padEnd(dp, '0').slice(0, dp);
    return BigInt(intp) * BigInt(10 ** dp) + BigInt(frac || '0');
  }
  function atomicsToDecimalString(atoms: bigint, dp = DP): string {
    const f = BigInt(10 ** dp);
    const sign = atoms < 0n ? '-' : '';
    const a = atoms < 0n ? -atoms : atoms;
    const intp = (a / f).toString();
    const frac = (a % f).toString().padStart(dp, '0').replace(/0+$/, '');
    return sign + intp + (frac ? '.' + frac : '');
  }
  const toFixedDp = (n: number, dp = DP) => (Number.isFinite(n) ? n.toFixed(dp) : '0');

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

  const getOrderCreator = (o: any) =>
    (o as any).creatorAddress ?? (o as any).creator ?? (o as any).address ?? null;

  const askPrefix = useMemo(() => {
    let qty = 0,
      cost = 0;
    return asks.map((a) => {
      qty += a.qtyAsset;
      cost += a.qtyAsset * a.priceQortPerAsset;
      return { qty, cost };
    });
  }, [asks]);

  const bidPrefix = useMemo(() => {
    let qty = 0,
      proceeds = 0;
    return bids.map((b) => {
      qty += b.qtyAsset;
      proceeds += b.qtyAsset * b.priceQortPerAsset;
      return { qty, proceeds };
    });
  }, [bids]);

  function sweepAsksThrough(idx: number) {
    return askPrefix[Math.min(idx, askPrefix.length - 1)] ?? { qty: 0, cost: 0 };
  }
  function sweepBidsThrough(idx: number) {
    return bidPrefix[Math.min(idx, bidPrefix.length - 1)] ?? { qty: 0, proceeds: 0 };
  }

  // // Sum cheapest asks up to <= target price (for BUY), returning {qty, cost}
  function simulateBuy(limitPrice: number, targetQty: number) {
    let remaining = Math.max(0, targetQty);
    let taken = 0;
    let cost = 0;
    for (const a of asks) {
      if (a.priceQortPerAsset > limitPrice) break;
      if (remaining <= 0) break;
      const take = Math.min(remaining, a.qtyAsset);
      if (take <= 0) continue;
      taken += take;
      cost += take * a.priceQortPerAsset;
      remaining -= take;
    }
    const avg = taken > 0 ? cost / taken : 0;
    return { taken, cost, avg };
  }

  function simulateSell(limitPrice: number, targetQty: number) {
    let remaining = Math.max(0, targetQty);
    let taken = 0;
    let proceeds = 0;
    for (const b of bids) {
      if (b.priceQortPerAsset < limitPrice) break;
      if (remaining <= 0) break;
      const take = Math.min(remaining, b.qtyAsset);
      if (take <= 0) continue;
      taken += take;
      proceeds += take * b.priceQortPerAsset;
      remaining -= take;
    }
    const avg = taken > 0 ? proceeds / taken : 0;
    return { taken, proceeds, avg };
  }

  const refreshMarket = useCallback(async () => {
    try {
      setLoading(true);

      let mini = readAssetsIndexSync()?.[id] ?? null;
      if (!mini) {
        const idx = await ensureAssetsIndexLoaded();
        mini = idx[id] ?? null;
      }
      if (!mini) mini = await ensureAssetMini(id);

      if (mini) {
        setName(mini.name);
        setDivisible(mini.isDivisible);
        setIssuerAddr(mini.owner || null);
      } else {
        setName(`Asset #${id}`);
        setDivisible(true);
        setIssuerAddr(null);
      }

      const [realBidsRaw, realAsksRaw] = await Promise.all([
        fetchBids(id, { limit: 50 }),
        fetchAsks(id, { limit: 50 }),
      ]);

      const realBids = [...realBidsRaw].sort((a, b) => b.priceQortPerAsset - a.priceQortPerAsset);
      const realAsks = [...realAsksRaw].sort((a, b) => a.priceQortPerAsset - b.priceQortPerAsset);

      const now = Date.now();
      // const windowStart = now - rangeHours * 60 * 60 * 1000;

      const oneYearMs = 365 * 24 * 60 * 60 * 1000;
      const fromWide = now - oneYearMs; // tune this
      const envAll = await fetchQortToAssetTrades(id, fromWide, 5000, 20000);

      const rows = (envAll ?? [])
        .map((env: any) => {
          const io = env.initiatingOrder;
          const t = env.trade;
          const to = env.targetOrder;
          const qtyAsset = Number(t?.targetAmount ?? io?.amount ?? 0);
          const price = Number(to.price);
          const ts = Number(t?.timestamp ?? io?.timestamp ?? 0);
          const side =
            io && typeof io.haveAssetId === 'number'
              ? io.haveAssetId === 0
                ? 'buy'
                : 'sell'
              : 'buy';
          return Number.isFinite(price) && qtyAsset > 0 && ts > 0
            ? ({ price, quantity: qtyAsset, side, ts } as Trade)
            : null;
        })
        .filter(Boolean) as Trade[];

      const fullNewestFirst = rows.sort((a, b) => b.ts - a.ts);
      const asc = [...fullNewestFirst].sort((a, b) => toMs(a.ts) - toMs(b.ts));
      setChartTrades(asc);

      setBids(realBids);
      setAsks(realAsks);
      setAllTrades(fullNewestFirst);
      setTradesPage(0);

      if (authAddress) {
        try {
          const mine = await getMyOrdersForAssetUi(authAddress, id, {
            divisible,
            includeClosed: false,
            includeFulfilled: false,
            limit: 1000,
            reverse: true,
          });
          setMyOrders(mine ?? []);
        } catch {
          setMyOrders([]);
        }
      } else {
        setMyOrders([]);
      }
    } finally {
      setLoading(false);
    }
  }, [id, authAddress, divisible]);

  const refreshMyFills = useCallback(async () => {
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

      setMyFills(fills);
    } catch (e) {
      console.debug('[fills] error', e);
      setMyFills([]);
    }
  }, [authAddress, authPublicKey, id]);

  useMarketConfirmRefresh({
    assetId: id,
    onConfirm: () => {
      // re-fetch only when a market tx confirms
      void refreshMarket();
      void refreshMyFills();
      void refreshBalances();
    },
    intervalMs: 3000,
    hiddenMs: 12000,
    jitterMs: 1000,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!cancelled) {
          await refreshMarket();
          await refreshBalances();
          await refreshMyFills();
        }
      } catch (e) {
        console.debug('[init] error', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ----- Place order state
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState<string>('');
  const [qty, setQty] = useState<string>('');
  const total = useMemo(() => {
    if (side === 'buy' && sweptTotalQort != null) return sweptTotalQort;
    if (side === 'sell' && sweptProceedsQort != null) return sweptProceedsQort;
    const p = Number(price),
      q = Number(qty);
    return Number.isFinite(p) && Number.isFinite(q) ? p * q : 0;
  }, [side, price, qty, sweptTotalQort, sweptProceedsQort]);

  useEffect(() => {
    // reset estimates
    setSweptAvgPrice(null);
    setSweptTotalQort(null);
    setSweptProceedsQort(null);

    const p = quantPrice(Number(price));
    const q = quantQtyAsset(Number(qty), divisible);

    if (!(p > 0) || !(q > 0)) return;

    if (side === 'buy') {
      const { taken, cost, avg } = simulateBuy(p, q);
      if (taken > 0) {
        setSweptTotalQort(quantQort(cost));
        setSweptAvgPrice(quantPrice(avg));
        // Optional: if taken < q, you can hint “only X available up to price”
      }
    } else {
      const { taken, proceeds, avg } = simulateSell(p, q);
      if (taken > 0) {
        setSweptProceedsQort(quantQort(proceeds));
        setSweptAvgPrice(quantPrice(avg));
      }
    }
  }, [price, qty, side, asks, bids, divisible]);

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
      <ActionsToolbar assetId={id} assetName={name} />
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
              Price Chart
            </Typography>
            {candleDataTOHLCV.length === 0 ? (
              <SmartPriceChart data={[]} height={300} />
            ) : (
              <SmartPriceChart data={candleDataTOHLCV} height={300} />
            )}
            <Typography variant="subtitle2" color="text.secondary">
              Volume
            </Typography>
            <VolumeBars data={candleDataTOHLCV} />
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
                          // clicked price (human string, fixed to 8dp)
                          const pHuman = toFixedDp(quantPrice(b.priceQortPerAsset), DP);
                          if (e.ctrlKey || e.metaKey) {
                            setPrice(pHuman);
                            setSweptTotalQort(null);
                            setSweptAvgPrice(null);
                            return;
                          }
                          // cumulative qty you can sell through this bid index
                          const { qty } = sweepBidsThrough(i);
                          // quantity in human string (respect divisibility)
                          const qtyHuman = divisible ? toFixedDp(qty, DP) : String(Math.floor(qty));
                          // math in atomics
                          const qtyAtoms = decimalToAtomics(qtyHuman, DP); // asset atoms
                          const priceAtoms = decimalToAtomics(pHuman, DP); // QORT atoms per asset
                          const proceedsAtoms = (qtyAtoms * priceAtoms) / TEN_DP; // QORT atoms
                          const avgAtoms = qtyAtoms > 0n ? (proceedsAtoms * TEN_DP) / qtyAtoms : 0n; // price atoms
                          // update UI (inputs remain human)
                          setPrice(pHuman);
                          setQty(qtyHuman);
                          setSweptTotalQort(parseFloat(atomicsToDecimalString(proceedsAtoms, DP))); // number for display
                          setSweptAvgPrice(parseFloat(atomicsToDecimalString(avgAtoms, DP))); // blended avg price
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
                          // 1) clicked price in human string (fixed to 8dp)
                          const pHuman = toFixedDp(quantPrice(a.priceQortPerAsset), DP);
                          if (e.ctrlKey || e.metaKey) {
                            // set only price field, leave totals alone
                            setPrice(pHuman);
                            setSweptTotalQort(null);
                            setSweptAvgPrice(null);
                            return;
                          }
                          // 2) cumulative qty through this row (human)
                          const { qty } = sweepAsksThrough(i);
                          const qtyHuman = divisible ? toFixedDp(qty, DP) : String(Math.floor(qty));
                          // 3) math in atomics
                          const qtyAtoms = decimalToAtomics(qtyHuman, DP);
                          const priceAtoms = decimalToAtomics(pHuman, DP);
                          const costAtoms = (qtyAtoms * priceAtoms) / TEN_DP; // QORT atoms
                          const avgAtoms = qtyAtoms > 0n ? (costAtoms * TEN_DP) / qtyAtoms : 0n; // price atoms
                          // 4) update UI with human strings, keep swept totals as numbers
                          setPrice(pHuman);
                          setQty(qtyHuman);
                          setSweptTotalQort(parseFloat(atomicsToDecimalString(costAtoms, DP)));
                          setSweptAvgPrice(parseFloat(atomicsToDecimalString(avgAtoms, DP)));
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
                    {new Date(t.ts < 1e11 ? t.ts * 1000 : t.ts).toLocaleString([], {
                      year: 'numeric',
                      month: 'short', // or '2-digit'
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: undefined, // set to '2-digit' if you want seconds
                    })}
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
              const side = o.side;
              const price = o.priceQortPerAsset;
              const qtyAssetOpen = o.qtyAssetOpen;
              // const qtyAssetTotal = o.qtyAssetTotal;
              const creator = authAddress; // it's your order
              const byIssuer = isIssuerAddress(creator);
              const ts =
                o.ts ??
                (Number(o.raw?.timestamp) < 2e10
                  ? Number(o.raw?.timestamp) * 1000
                  : Number(o.raw?.timestamp));
              const when = new Date(ts).toLocaleString();

              return (
                <Box
                  key={o.orderId}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'auto auto auto 1fr auto', // last column is price
                    alignItems: 'center',
                    gap: 1,
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
                    <Typography variant="body2">Placed:</Typography>
                    <Box color="text.secondary">{when}</Box>
                  </Box>
                  <Box>Remaining: {name}</Box>
                  <Box color="text.secondary">{formatQty(qtyAssetOpen, divisible)}</Box>

                  {/* this acts like a flexible spacer */}
                  <Box />

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box>{formatPrice(price)} QORT</Box>
                    <Tooltip title="Cancel order">
                      <span>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => onCancelOrder(o.orderId)}
                          sx={{ borderColor: 'text.secondary', color: 'text.secondary' }}
                        >
                          Cancel
                        </Button>
                      </span>
                    </Tooltip>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Paper>
    </Box>
  );
}
