import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { C, F, R, S } from "../ui/theme";
import { T, Card, Cipher, Gap, Notice, Row } from "../ui/kit";
import { Screen } from "../ui/Screen";
import { useApp } from "../state/AppState";
import { activity, describeError, formatAusd, shortHex, type ActivityItem } from "../lib/pay";

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
};

export function Activity() {
  const app = useApp();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!app.ctx || !app.address) return;
    setLoading(true);
    try {
      setItems(await activity(app.ctx, app.address));
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
        return (
          <Pressable
            key={id}
            onPress={async () => {
              await Clipboard.setStringAsync(it.tx);
              setCopied(id);
              setTimeout(() => setCopied(null), 1200);
            }}
            style={({ pressed }) => [a.item, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`${m.label}, block ${it.block}`}
          >
            <View style={a.glyph}>
              <T style={{ color: m.tone, fontSize: 18, lineHeight: 22 }}>{m.glyph}</T>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Row style={{ justifyContent: "space-between" }}>
                <T style={{ fontFamily: F.sansBold, color: C.foam, fontSize: 15 }}>
                  {m.label}
                  {it.linkId !== undefined ? ` #${it.linkId}` : ""}
                </T>
                <T kind="small" style={{ fontFamily: F.mono }}>
                  {copied === id ? "tx copied" : `#${it.block}`}
                </T>
              </Row>
              {it.counterparty ? <T kind="small">{(it.kind === "sent" ? "to " : it.kind === "link-claimed" ? "by " : "from ") + shortHex(it.counterparty, 5)}</T> : null}
              {it.handle ? <Cipher value={shortHex(it.handle, 12)} size={12} /> : null}
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
