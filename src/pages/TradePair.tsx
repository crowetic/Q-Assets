import { useEffect, useMemo, useState } from 'react';
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
  getRecentTrades,
  getAddressOrdersByPair,
  type BookOrder,
  NormalizedOrder,
} from '../utils/markets';
import { PriceSparkline, VolumeBars, DepthChart } from '../components/PairCharts';
import { buildOhlc, toCloseLine, buildDepth } from '../utils/chartTransforms';
// import SuccessButton from '../components/buttons/SuccessButton'; // +++
import SellButton from '../components/buttons/SellButton';
import BuyButton from '../components/buttons/BuyButton';
import { getAssetBalances } from '../utils/qortalAssetRequests';

// ---- Types for adapter data (adjust when wiring real endpoints)
// type Order = { price: number; quantity: number }; // in human QORT/asset units
type Trade = { price: number; quantity: number; side: 'buy' | 'sell'; ts: number };

export default function TradePair() {
  const { assetId } = useParams<{ assetId: string }>();
  const id = Number(assetId);
  const [name, setName] = useState<string>('');
  const [divisible, setDivisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [myOrders, setMyOrders] = useState<NormalizedOrder[]>([]);

  // Order book + trades
  const [bids, setBids] = useState<BookOrder[]>([]);
  const [asks, setAsks] = useState<BookOrder[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const { address: authAddress, publicKey: authPublicKey } = useAuth() as any;
  const c = colorFromAssetId(id);
  const ohlc = useMemo(() => buildOhlc(trades, { intervalMs: 5 * 60 * 1000 }), [trades]);
  const priceLine = useMemo(() => toCloseLine(ohlc), [ohlc]);
  const depth = useMemo(() => buildDepth(bids, asks, { maxLevels: 60 }), [bids, asks]);
  const [sweptTotalQort, setSweptTotalQort] = useState<number | null>(null);
  const [sweptAvgPrice, setSweptAvgPrice] = useState<number | null>(null);
  const [issuerAddr, setIssuerAddr] = useState<string | null>(null);
  const [balAsset, setBalAsset] = useState<number | null>(null);
  const [balQort, setBalQort] = useState<number | null>(null);

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

  // Round qty according to divisibility (no half-units if not divisible)
  function clampQtyToDivisibility(qtyAsset: number) {
    return divisible ? Number(qtyAsset.toFixed(8)) : Math.floor(qtyAsset);
  }

  function mapRecent(recent: unknown, realBids: BookOrder[], realAsks: BookOrder[]): Trade[] {
    const arr = Array.isArray(recent) ? recent : [];
    const bestBid = realBids[0]?.priceQortPerAsset ?? 0;
    const bestAsk = realAsks[0]?.priceQortPerAsset ?? 0;

    return arr
      .map((r: any) => {
        const amt = Number(r?.amount) || 0; // ASSET units
        const otherAmt = Number(r?.otherAmount) || 0; // QORT units
        const price = amt > 0 ? otherAmt / amt : 0; // QORT / ASSET
        const side =
          bestAsk && Math.abs(price - bestAsk) < Math.abs(price - bestBid) ? 'sell' : 'buy';
        return { price, quantity: amt, side, ts: Number(r?.timestamp) || 0 } as Trade;
      })
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 30);
  }

  function orderAssetQty(o: NormalizedOrder): number {
    const have = Number(o.haveAmount) || 0;
    const price = Number(o.price) || 0;
    // In this screen, pair is ASSET/QORT; so:
    // - SELL = haveAssetId === id  -> qtyAsset = haveAmount
    // - BUY  = haveAssetId === 0   -> qtyAsset = haveAmount / price
    if (o.haveAssetId === id) return have;
    if (o.haveAssetId === 0) return price > 0 ? have / price : 0;
    // Fallback (weird edge): try wantAmount if want is the asset
    const want = Number(o.wantAmount) || 0;
    if (o.wantAssetId === id) return want;
    return 0;
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

        // --- meta (unchanged)
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

        // --- book + recent
        const [realBids, realAsks, recent] = await Promise.all([
          fetchBids(id, { limit: 50, reverse: true }),
          fetchAsks(id, { limit: 50 }),
          getRecentTrades([id], [0], { limit: 30 }),
        ]);

        if (!cancelled) {
          setBids(realBids);
          setAsks(realAsks);
          setTrades(mapRecent(recent, realBids, realAsks));
        }

        // --- my orders for this pair (only if signed in)
        if (authAddress) {
          try {
            const mine = await getAddressOrdersByPair(authAddress, id, 0, {
              isClosed: false,
              isFulfilled: false,
              limit: 200,
            });
            if (!cancelled) setMyOrders(mine.filter((o) => o.status === 'OPEN'));
          } catch (e) {
            if (!cancelled) setMyOrders([]);
          }
        } else if (!cancelled) {
          setMyOrders([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // initial
    void refresh();

    // optional polling every 15s (pause if not signed in? your call)
    timer = window.setInterval(() => void refresh(), 15000);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
    // include authAddress so we start/stop loading my orders on sign in/out
  }, [id, authAddress]);

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
      <Paper sx={{ p: 2, display: 'grid', gap: 2 }}>
        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Typography variant="subtitle2" color="text.secondary">
              Price (24h)
            </Typography>
            <PriceSparkline data={priceLine} />
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
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Recent Trades
            </Typography>
            <Box sx={{ display: 'grid', gap: 0.25 }}>
              {trades.map((t, i) => (
                <Box
                  key={i}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    gap: 1,
                    fontSize: 14,
                  }}
                >
                  <Box sx={{ color: t.side === 'buy' ? 'success.main' : 'error.main' }}>
                    {t.side.toUpperCase()}
                  </Box>
                  <Box>
                    {formatQty(t.quantity, divisible)} {name}
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>{formatPrice(t.price)} QORT</Box>
                </Box>
              ))}
              {trades.length === 0 && (
                <Typography variant="caption" color="text.secondary">
                  No trades
                </Typography>
              )}
            </Box>
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
