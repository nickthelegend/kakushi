import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { useFonts } from "expo-font";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Unbounded_400Regular } from "@expo-google-fonts/unbounded/400Regular";
import { Unbounded_600SemiBold } from "@expo-google-fonts/unbounded/600SemiBold";
import { IBMPlexSans_400Regular } from "@expo-google-fonts/ibm-plex-sans/400Regular";
import { IBMPlexSans_500Medium } from "@expo-google-fonts/ibm-plex-sans/500Medium";
import { IBMPlexSans_600SemiBold } from "@expo-google-fonts/ibm-plex-sans/600SemiBold";
import { IBMPlexMono_400Regular } from "@expo-google-fonts/ibm-plex-mono/400Regular";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono/500Medium";
import { AppProvider, useApp } from "./src/state/AppState";
import { EncryptorHost } from "./src/fhe/EncryptorHost";
import { NavCtx, TabBar, TABS, type Route } from "./src/ui/Screen";
import { C } from "./src/ui/theme";
import { parseLink, parseRequestLink } from "./src/lib/links";
import { Onboarding } from "./src/screens/Onboarding";
import { Home } from "./src/screens/Home";
import { Send } from "./src/screens/Send";
import { Fund } from "./src/screens/Fund";
import { Claim } from "./src/screens/Claim";
import { Request, RequestDetail } from "./src/screens/Request";
import { CashOut } from "./src/screens/CashOut";
import { Activity } from "./src/screens/Activity";
import { Account } from "./src/screens/Account";

export default function App() {
  const [fonts] = useFonts({
    Unbounded_400Regular,
    Unbounded_600SemiBold,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
  });
  return (
    <SafeAreaProvider>
      <AppProvider>
        <View style={{ flex: 1, backgroundColor: C.abyss }}>
          <StatusBar style="light" />
          <EncryptorHost />
          {fonts ? <Root /> : <ActivityIndicator style={{ flex: 1 }} color={C.biolum} />}
        </View>
      </AppProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const app = useApp();
  const [stack, setStack] = useState<Route[]>([{ name: "home" }]);
  const route = stack[stack.length - 1]!;

  const go = useCallback((r: Route) => {
    setStack((s) => ((TABS as readonly string[]).includes(r.name) ? [r] : [...s, r]));
  }, []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);

  // pay links: fhishpay://claim?...#k=... and https://<host>/claim?...#k=... (never logged)
  // request links: fhishpay://request?net=...&id=...  and https://<host>/request?... (no secret)
  useEffect(() => {
    const handle = (url: string | null) => {
      const r = url ? parseRequestLink(url) : null;
      if (r) {
        setStack([{ name: "home" }, { name: "request-detail", link: r }]);
        if (Platform.OS === "web" && typeof history !== "undefined") history.replaceState(null, "", "/");
        return;
      }
      const l = url ? parseLink(url) : null;
      if (!l) return;
      app.setPendingClaim(l);
      setStack([{ name: "home" }, { name: "claim", link: l }]);
      if (Platform.OS === "web" && typeof history !== "undefined") history.replaceState(null, "", "/"); // drop the key from the address bar
    };
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener("url", (e) => handle(e.url));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the testnet heartbeat runs for the app's lifetime (read-only WebSocket)
  useEffect(() => {
    app.heads.start();
    return () => app.heads.stop();
  }, [app.heads]);

  const nav = useMemo(() => ({ route, go, back }), [route, go, back]);

  if (!app.loaded) return <ActivityIndicator style={{ flex: 1 }} color={C.biolum} />;
  if (!app.stored && route.name !== "claim" && route.name !== "request-detail") return <Onboarding />;
  if (!app.ctx && app.stored) {
    // account exists but this network has no deployment: let them switch back
    return (
      <NavCtx.Provider value={nav}>
        <Account />
        <TabBar />
      </NavCtx.Provider>
    );
  }

  let screen: React.ReactNode;
  switch (route.name) {
    case "home":
      screen = <Home />;
      break;
    case "send":
      screen = <Send />;
      break;
    case "fund":
      screen = <Fund />;
      break;
    case "claim":
      screen = <Claim link={route.link} />;
      break;
    case "request":
      screen = <Request />;
      break;
    case "request-detail":
      screen = <RequestDetail link={route.link} />;
      break;
    case "cashout":
      screen = <CashOut />;
      break;
    case "activity":
      screen = <Activity />;
      break;
    case "account":
      screen = <Account />;
      break;
  }
  return (
    <NavCtx.Provider value={nav}>
      <View style={{ flex: 1 }}>{screen}</View>
      {app.stored && (TABS as readonly string[]).includes(route.name) ? <TabBar /> : null}
    </NavCtx.Provider>
  );
}
