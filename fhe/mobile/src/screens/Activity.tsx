import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { C, F, R, S } from "../ui/theme";
import { T, Card, Cipher, Gap, Notice, Row } from "../ui/kit";
import { Screen, useNav } from "../ui/Screen";
import { useApp } from "../state/AppState";
import { activityWithSource, describeError, formatAusd, shortHex, type ActivityItem, type ActivityResult } from "../lib/pay";

const META: Record<ActivityItem["kind"], { label: string; glyph: string; tone: string }> = {
  sent: { label: "Sent", glyph: "↗", tone: C.foam },
  received: { label: "Received", glyph: "↙", tone: C.biolum },
  "link-created": { label: "Pay link created", glyph: "⌁", tone: C.foam },
  "link-claimed": { label: "Your link was claimed", glyph: "✓", tone: C.mist },
  "link-received": { label: "Claimed a pay link", glyph: "↙", tone: C.biolum },
  "link-refunded": { label: "Link refunded", glyph: "↺", tone: C.mist },
  wrapped: { label: "Made private", glyph: "◈", tone: C.biolum },
  "cashout-requested": { label: "Cash-out requested", glyph: "…", tone: C.mist },
  "cashed-out": { label: "Cashed out", glyph: "↘", tone: C.foam },
  "request-sent": { label: "You sent request", glyph: "↤", tone: C.foam },
  "request-received": { label: "Request for you", glyph: "↦", tone: C.biolum },
  "request-paid": { label: "Payment on request", glyph: "✓", tone: C.biolum },
  "request-cancelled": { label: "Request cancelled", glyph: "×", tone: C.mist },
};

// RequestPaid does not mean "fully paid" (status is private): say what happened, not the outcome
const label = (it: ActivityItem) =>
  it.kind === "request-paid" ? (it.role === "payer" ? "You paid on request" : "Payment on your request") : it.kind === "request-cancelled" && it.role === "payee" ? "You cancelled request" : META[it.kind].label;

const counterpartyText = (it: ActivityItem) => {
  const who = shortHex(it.counterparty!, 5);
  switch (it.kind) {
    case "sent":
      return `to ${who}`;
    case "link-claimed":
      return `by ${who}`;
    case "request-sent":
      return `asked ${who}`;
    case "request-paid":
    case "request-cancelled":
      return it.role === "payer" ? `requested by ${who}` : `asked ${who}`;
    default:
      return `from ${who}`;
  }
};

export function Activity() {
  const app = useApp();
  const nav = useNav();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [source, setSource] = useState<Pick<ActivityResult, "source" | "indexedTo"> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!app.ctx || !app.address) return;
    setLoading(true);
    try {
      const r = await activityWithSource(app.ctx, app.address);
      setItems(r.items);
      setSource({ source: r.source, indexedTo: r.indexedTo });
      setErr(null);
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [app.ctx, app.address]);

  useEffect(() => {
    load();
  }, [load, app.version]);

  return (
    <Screen title="Activity" onRefresh={load} refreshing={loading}>
      <T kind="dim">From on-chain events. Amounts you send and receive stay ciphertext handles: this is exactly what anyone else can see.</T>
      {source ? (
        <T kind="small" style={{ marginTop: 6 }}>
          {source.source === "indexer" ? `History from the Envio indexer (to block ${source.indexedTo}); newer blocks read from the chain.` : "History read from the chain (no indexer): recent blocks only."}
        </T>
      ) : null}
      <Gap h={S.lg} />
      {err ? <Notice tone="error">{err}</Notice> : null}
      {items && items.length === 0 ? (
        <Card>
          <T kind="dim">No activity yet. Add AUSD and make it private to start.</T>
        </Card>
      ) : null}
      {items?.map((it) => {
        const m = META[it.kind];
        const id = `${it.tx}-${it.logIndex}`;
        const isRequest = it.requestId !== undefined;
        return (
          <Pressable
            key={id}
            onPress={async () => {
              if (isRequest) {
                // the request's creation block lets the detail screen check a memo with one log query
                const made = items.find((x) => x.requestId === it.requestId && (x.kind === "request-sent" || x.kind === "request-received"));
                nav.go({ name: "request-detail", link: { net: app.network, id: it.requestId!, block: made?.block } });
                return;
              }
              await Clipboard.setStringAsync(it.tx);
              setCopied(id);
              setTimeout(() => setCopied(null), 1200);
            }}
            style={({ pressed }) => [a.item, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`${label(it)}, block ${it.block}`}
          >
            <View style={a.glyph}>
              <T style={{ color: m.tone, fontSize: 18, lineHeight: 22 }}>{m.glyph}</T>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Row style={{ justifyContent: "space-between" }}>
                <T style={{ fontFamily: F.sansBold, color: C.foam, fontSize: 15 }}>
                  {label(it)}
                  {it.linkId !== undefined ? ` #${it.linkId}` : ""}
                  {it.requestId !== undefined ? ` #${it.requestId}` : ""}
                </T>
                <T kind="small" style={{ fontFamily: F.mono }}>
                  {copied === id ? "tx copied" : `#${it.block}`}
                </T>
              </Row>
              {it.counterparty ? <T kind="small">{counterpartyText(it)}</T> : null}
              {it.handle ? <Cipher value={shortHex(it.handle, 12)} size={12} /> : null}
              {isRequest && (it.kind === "request-sent" || it.kind === "request-received" || it.kind === "request-paid") ? (
                <T kind="small" style={{ color: C.faint }}>
                  {it.kind === "request-paid" ? "moves in full or not at all · open to reveal what's still owed" : "tap to open · only the two of you can reveal the amount"}
                </T>
              ) : null}
              {it.amount !== undefined ? <T style={{ fontFamily: F.monoMed, fontSize: 13, color: C.mist }}>{formatAusd(it.amount)} AUSD · public at the AUSD boundary</T> : null}
            </View>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const a = StyleSheet.create({
  item: { flexDirection: "row", gap: S.md, padding: S.md, borderRadius: R.md, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, marginBottom: S.sm },
  glyph: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.trench, alignItems: "center", justifyContent: "center" },
});
