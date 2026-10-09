import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { C, F, R, S } from "./theme";

export function T({ style, kind = "body", ...p }: React.ComponentProps<typeof Text> & { kind?: keyof typeof t }) {
  return <Text {...p} style={[t[kind], style]} />;
}

const t = StyleSheet.create({
  hero: { fontFamily: F.display, fontSize: 30, lineHeight: 38, color: C.foam, letterSpacing: -0.6 },
  h1: { fontFamily: F.display, fontSize: 22, lineHeight: 28, color: C.foam, letterSpacing: -0.3 },
  h2: { fontFamily: F.display, fontSize: 16, lineHeight: 22, color: C.foam },
  body: { fontFamily: F.sans, fontSize: 15, lineHeight: 22, color: C.foam },
  dim: { fontFamily: F.sans, fontSize: 14, lineHeight: 20, color: C.mist },
  small: { fontFamily: F.sans, fontSize: 12, lineHeight: 17, color: C.faint },
  label: { fontFamily: F.sansMed, fontSize: 11, lineHeight: 14, color: C.faint, letterSpacing: 1.2, textTransform: "uppercase" },
  mono: { fontFamily: F.mono, fontSize: 13, lineHeight: 18, color: C.mist },
  cipher: { fontFamily: F.monoMed, fontSize: 13, lineHeight: 18, color: C.biolum },
  revealed: { fontFamily: F.display, fontSize: 34, lineHeight: 42, color: C.lantern, letterSpacing: -0.8 },
});

export function Card({ children, style, glow }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; glow?: boolean }) {
  return <View style={[k.card, glow && k.cardGlow, style]}>{children}</View>;
}

export function Row({ children, style, gap = S.sm }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

export function Gap({ h = S.lg }: { h?: number }) {
  return <View style={{ height: h }} />;
}

type BtnKind = "primary" | "secondary" | "ghost" | "danger";
export function Button({
  title,
  onPress,
  kind = "primary",
  busy,
  disabled,
  icon,
  style,
  testID,
}: {
  title: string;
  onPress?: () => void;
  kind?: BtnKind;
  busy?: boolean;
  disabled?: boolean;
  icon?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [k.btn, k[`btn_${kind}`], off && { opacity: 0.45 }, pressed && !off && { transform: [{ scale: 0.98 }], opacity: 0.9 }, style]}
    >
      {busy ? <ActivityIndicator color={kind === "primary" ? C.abyss : C.biolum} /> : null}
      <Text style={[k.btnText, k[`btnText_${kind}`]]}>
        {icon ? `${icon}  ` : ""}
        {title}
      </Text>
    </Pressable>
  );
}

export function Chip({ text, tone = "neutral", onPress, style }: { text: string; tone?: "neutral" | "cipher" | "lantern" | "danger" | "ok"; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  const c = { neutral: C.mist, cipher: C.biolum, lantern: C.lantern, danger: C.danger, ok: C.ok }[tone];
  const bg = { neutral: "rgba(156,188,191,0.08)", cipher: C.biolumDim, lantern: C.lanternDim, danger: C.dangerDim, ok: "rgba(111,240,192,0.1)" }[tone];
  const body = (
    <View style={[k.chip, { backgroundColor: bg, borderColor: c + "44" }, style]}>
      <Text style={[k.chipText, { color: c }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={text}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function Field({ label, hint, error, style, inputStyle, ...p }: TextInputProps & { label?: string; hint?: string; error?: string | null; inputStyle?: StyleProp<TextStyle> }) {
  return (
    <View style={style}>
      {label ? <T kind="label" style={{ marginBottom: 6 }}>{label}</T> : null}
      <TextInput placeholderTextColor={C.faint} autoCorrect={false} autoCapitalize="none" {...p} style={[k.input, error ? { borderColor: C.danger } : null, inputStyle]} />
      {error ? <T kind="small" style={{ color: C.danger, marginTop: 6 }}>{error}</T> : hint ? <T kind="small" style={{ marginTop: 6 }}>{hint}</T> : null}
    </View>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "error" | "warn" | "ok"; title?: string; children?: React.ReactNode }) {
  const c = { info: C.biolum, error: C.danger, warn: C.lantern, ok: C.ok }[tone];
  return (
    <View style={[k.notice, { borderLeftColor: c, backgroundColor: c + "12" }]}>
      {title ? <T kind="body" style={{ fontFamily: F.sansBold, color: c, marginBottom: children ? 2 : 0 }}>{title}</T> : null}
      {typeof children === "string" ? <T kind="dim">{children}</T> : children}
    </View>
  );
}

/** A ciphertext handle, shimmering: the colour of things nobody can read. */
export function Cipher({ value, size = 13, style }: { value: string; size?: number; style?: StyleProp<TextStyle> }) {
  const a = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(a, { toValue: 0.55, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  return (
    <Animated.Text numberOfLines={1} style={[t.cipher, { fontSize: size, lineHeight: size * 1.4, opacity: a }, style]}>
      {value}
    </Animated.Text>
  );
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.line, marginVertical: S.md }} />;
}

export function Segmented<V extends string>({ value, options, onChange }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <View style={k.seg}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[k.segItem, value === o.value && k.segOn]} accessibilityRole="tab" accessibilityState={{ selected: value === o.value }}>
          <Text style={[k.segText, value === o.value && { color: C.abyss }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const k = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.lg, borderWidth: 1, borderColor: C.line },
  cardGlow: { borderColor: C.lineStrong, shadowColor: C.biolum, shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } },
  btn: { minHeight: 52, borderRadius: R.md, paddingHorizontal: S.xl, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: S.sm },
  btn_primary: { backgroundColor: C.biolum },
  btn_secondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.lineStrong },
  btn_ghost: { backgroundColor: "transparent", minHeight: 40, paddingHorizontal: S.md },
  btn_danger: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.danger + "66" },
  btnText: { fontFamily: F.sansBold, fontSize: 16, letterSpacing: 0.2 },
  btnText_primary: { color: C.abyss },
  btnText_secondary: { color: C.foam },
  btnText_ghost: { color: C.biolum, fontSize: 15 },
  btnText_danger: { color: C.danger },
  chip: { borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, maxWidth: 220 },
  chipText: { fontFamily: F.monoMed, fontSize: 11.5, letterSpacing: 0.2 },
  input: {
    minHeight: 50,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.trench,
    color: C.foam,
    paddingHorizontal: S.lg,
    fontFamily: F.mono,
    fontSize: 15,
  },
  notice: { borderLeftWidth: 3, borderRadius: R.sm, padding: S.md },
  seg: { flexDirection: "row", backgroundColor: C.trench, borderRadius: R.md, padding: 4, borderWidth: 1, borderColor: C.line },
  segItem: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: R.sm },
  segOn: { backgroundColor: C.biolum },
  segText: { fontFamily: F.sansBold, fontSize: 14, color: C.mist },
});
