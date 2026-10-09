// Hermes has no WebAssembly, so tfhe runs in a hidden WebView. The page is fully self-contained
// (tfhe JS + wasm inlined, see scripts/build-tfhe-webview.mjs): no network, no file access.
// Values go in through injectJavaScript and ciphertexts come back through postMessage (base64).
import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { ENCRYPTOR_HTML } from "./encryptorHtml.generated";
import { encryptor } from "./bridge";

export function EncryptorHost() {
  const ref = useRef<WebView>(null);
  useEffect(() => {
    encryptor.attach((json) => {
      ref.current?.injectJavaScript(`window.__fhish && window.__fhish.handle(${JSON.stringify(json)}); true;`);
    });
  }, []);
  return (
    <View style={s.hidden} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView
        ref={ref}
        originWhitelist={["*"]}
        source={{ html: ENCRYPTOR_HTML }}
        javaScriptEnabled
        onMessage={(e) => encryptor.receive(e.nativeEvent.data)}
        onContentProcessDidTerminate={() => {
          encryptor.reset();
          ref.current?.reload();
        }}
        onRenderProcessGone={() => {
          encryptor.reset();
          ref.current?.reload();
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({ hidden: { position: "absolute", width: 1, height: 1, opacity: 0, left: -10, top: -10 } });
