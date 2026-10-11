import React, { createContext, useContext, useEffect, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, View, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { C, F, S } from "./theme";
import { T, Row, Chip } from "./kit";
import { useApp } from "../state/AppState";
import { shortHex, describeError } from "../lib/pay";
import type { ParsedLink, ParsedRequestLink } from "../lib/links";

export type Route =
  | { name: "home" }
  | { name: "send" }
  | { name: "activity" }
  | { name: "account" }
  | { name: "fund" }
  | { name: "cashout" }
  | { name: "claim"; link?: ParsedLink }
  | { name: "request" }
  | { name: "request-detail"; link: ParsedRequestLink };
export const TABS = ["home", "send", "activity", "account"] as const;

export const NavCtx = createContext<{ route: Route; go(r: Route): void; back(): void }>({ route: { name: "home" }, go() {}, back() {} });
export const useNav = () => useContext(NavCtx);

export function Screen({
  title,
  children,
  onRefresh,
  refreshing,
  back,
  right,
}: {
  title?: string;
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  back?: boolean;
  right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const nav = useNav();
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[s.header, { paddingTop: insets.top + S.sm }]}>
        <Row style={{ justifyContent: "space-between" }}>
          <Row gap={S.sm} style={{ flexShrink: 1 }}>
            {back ? (
              <Pressable onPress={nav.back} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={s.back}>
                <T style={{ fontSize: 22, color: C.biolum, lineHeight: 24 }}>‹</T>
              </Pressable>
            ) : (
              <Image source={require("../../assets/kakushi-fin.png")} style={s.logo} />
            )}
            <T kind="h2" numberOfLines={1} style={{ flexShrink: 1 }}>
              {title ?? "Kakushi Confidential"}
            </T>
          </Row>
          {right ?? <SessionChip />}
        </Row>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl * 3 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl tintColor={C.biolum} refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Signing-session state: a countdown while the key is in memory, "Locked" after it was wiped. */
export function SessionChip() {
  const app = useApp();
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!app.stored) return null;
  if (app.wallet && app.expiresAt) {
    const left = Math.max(0, app.expiresAt - now);
    const m = Math.floor(left / 60000);
    const sec = Math.floor((left % 60000) / 1000);
    return <Chip tone={left < 60_000 ? "lantern" : "cipher"} text={`● ${m}:${String(sec).padStart(2, "0")}`} onPress={() => app.lock("Locked. The key was wiped from memory.")} />;
  }
  return (
    <Chip
      tone={err ? "danger" : "neutral"}
      text={err ? "Unlock failed" : "🔒 Locked"}
      onPress={() => {
        setErr(null);
        app.unlock().catch((e) => setErr(describeError(e)));
      }}
    />
  );
}

export function AddressChip({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Chip
      tone="neutral"
      text={copied ? "copied" : shortHex(address, 5)}
      onPress={async () => {
        await Clipboard.setStringAsync(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    />
  );
}

export function TabBar() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const items: { name: (typeof TABS)[number]; label: string; glyph: string }[] = [
    { name: "home", label: "Home", glyph: "◈" },
    { name: "send", label: "Send", glyph: "↗" },
    { name: "activity", label: "Activity", glyph: "≋" },
    { name: "account", label: "Account", glyph: "◎" },
  ];
  return (
    <View style={[s.tabs, { paddingBottom: Math.max(insets.bottom, S.sm) }]}>
      {items.map((it) => {
        const on = nav.route.name === it.name;
        return (
          <Pressable key={it.name} style={s.tab} onPress={() => nav.go({ name: it.name } as Route)} accessibilityRole="tab" accessibilityLabel={it.label} accessibilityState={{ selected: on }}>
            <T style={{ fontSize: 18, color: on ? C.biolum : C.faint, lineHeight: 22 }}>{it.glyph}</T>
            <T style={{ fontFamily: F.sansMed, fontSize: 11, color: on ? C.foam : C.faint }}>{it.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: S.lg, paddingBottom: S.md, backgroundColor: C.abyss, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  logo: { width: 28, height: 28, borderRadius: 7 },
  back: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, backgroundColor: C.trench, paddingTop: S.sm },
  tab: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 4 },
});
